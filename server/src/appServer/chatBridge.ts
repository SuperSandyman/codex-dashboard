import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { WebSocket } from 'ws';

import {
  AppServerClient,
  AppServerClientError,
  AppServerRequestError,
} from './client.js';
import type {
  ChatApprovalDecision,
  ChatApprovalPolicy,
  ChatApprovalRequest,
  ChatDetail,
  ChatLaunchOptionCatalog,
  ChatLaunchOptions,
  ChatMessage,
  ChatModelOption,
  ChatRole,
  ChatSandboxMode,
  ChatStreamEvent,
  ChatSummary,
  ChatUserInputRequest,
  ChatUserInputResponse,
} from './dashboardTypes.js';
import {
  isChatRole,
  normalizeChatApprovalPolicy,
  normalizeChatSandboxMode,
  parseCommandExecutionApprovalRequest,
  parseConfigDefaults,
  parseConfigRequirementOptions,
  parseFileChangeApprovalRequest,
  parseModelListResult,
  parseNotificationItem,
  parseRecord,
  parseStringField,
  parseToolRequestUserInputRequest,
  parseThreadListResult,
  parseThreadReadResult,
  parseThreadStartResult,
  parseTurnStartResult,
  toChatDetail,
  toChatMessageFromItem,
  toChatModelOption,
  toChatSummary,
} from './normalizer.js';

interface AppServerBridgeOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly defaultThreadCwd: string | null;
  readonly requestTimeoutMs: number;
}

interface ListChatsParams {
  readonly archived: boolean;
}

interface CreateChatLaunchOptionsInput {
  readonly model: string | null;
  readonly effort: string | null;
  readonly cwd: string | null;
  readonly approvalPolicy: string | null;
  readonly sandboxMode: string | null;
}

interface UpdateChatLaunchOptionsInput {
  readonly model?: string | null;
  readonly effort?: string | null;
  readonly approvalPolicy?: string | null;
  readonly sandboxMode?: string | null;
}

interface ChatModelCache {
  readonly models: ChatModelOption[];
  readonly loadedAt: number;
}

interface ChatPolicyCatalog {
  readonly approvalPolicies: ChatApprovalPolicy[];
  readonly sandboxModes: ChatSandboxMode[];
  readonly defaultApprovalPolicy: ChatApprovalPolicy | null;
  readonly defaultSandboxMode: ChatSandboxMode | null;
}

interface ChatPolicyCache {
  readonly catalog: ChatPolicyCatalog;
  readonly loadedAt: number;
}

interface PendingApproval {
  readonly requestId: string | number;
  readonly request: ChatApprovalRequest;
}

interface PendingUserInputRequest {
  readonly requestId: string | number;
  readonly request: ChatUserInputRequest;
}

interface ChatLaunchValidationInput {
  readonly model: string | null;
  readonly effort: string | null;
  readonly cwd: string | null;
  readonly approvalPolicy: string | null;
  readonly sandboxMode: string | null;
}

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_ROUNDS = 20;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const POLICY_CACHE_TTL_MS = 30 * 1000;
const WORKSPACE_DIR_LIMIT = 80;
const DEFAULT_APPROVAL_POLICIES: ChatApprovalPolicy[] = [
  'untrusted',
  'on-failure',
  'on-request',
  'never',
];
const DEFAULT_SANDBOX_MODES: ChatSandboxMode[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  return error instanceof Error ? error.message : fallback;
};

const isThreadNotFoundRequestError = (error: unknown): boolean => {
  if (!(error instanceof AppServerRequestError)) {
    return false;
  }
  const lowerMessage = error.message.toLowerCase();
  return (
    lowerMessage.includes('not found') ||
    lowerMessage.includes('invalid thread id') ||
    lowerMessage.includes('unknown thread')
  );
};

/**
 * チャット API レイヤーで返すアプリケーションエラー。
 */
export class ChatBridgeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * codex app-server と dashboard API の間を取り持つ。
 */
export class AppServerChatBridge {
  readonly #client: AppServerClient;
  readonly #defaultThreadCwd: string | null;
  readonly #subscriptions = new Map<string, Set<WebSocket>>();
  readonly #activeTurnByThread = new Map<string, string>();
  readonly #launchOptionsByThread = new Map<string, ChatLaunchOptions>();
  readonly #pendingApprovalsByThread = new Map<string, Map<string, PendingApproval>>();
  readonly #pendingUserInputsByThread = new Map<string, Map<string, PendingUserInputRequest>>();
  #modelCache: ChatModelCache | null = null;
  #policyCache: ChatPolicyCache | null = null;
  #workspaceRootRealPath: string | null | undefined = undefined;

  /**
   * app-server ブリッジを作成する。
   * @param options ブリッジ初期化オプション
   */
  constructor(options: AppServerBridgeOptions) {
    this.#client = new AppServerClient({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#defaultThreadCwd = options.defaultThreadCwd;
    this.#client.onNotification((notification) => {
      this.#handleNotification(notification.method, notification.params);
    });
    this.#client.onServerRequest((request) => {
      return this.#handleServerRequest(request.id, request.method, request.params);
    });
  }

  /**
   * app-server との接続を破棄する。
   */
  dispose(): void {
    this.#subscriptions.forEach((clients) => {
      clients.forEach((client) => {
        client.close(1012, 'server restarting');
      });
    });
    this.#subscriptions.clear();
    this.#activeTurnByThread.clear();
    this.#launchOptionsByThread.clear();
    this.#pendingApprovalsByThread.clear();
    this.#pendingUserInputsByThread.clear();
    this.#modelCache = null;
    this.#policyCache = null;
    this.#client.dispose();
  }

  /**
   * チャット一覧を返す。
   */
  async listChats(): Promise<ChatSummary[]> {
    try {
      const [activeChats, archivedChats] = await Promise.all([
        this.#listChatsByArchived({ archived: false }),
        this.#listChatsByArchived({ archived: true }),
      ]);
      const mergedById = new Map<string, ChatSummary>();
      [...activeChats, ...archivedChats].forEach((chat) => {
        mergedById.set(chat.id, chat);
      });
      const chats = await Promise.all(
        [...mergedById.values()].map((chat) => this.#withLaunchOptions(chat)),
      );
      return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      throw this.#mapBridgeError(error, 'chat_list_failed', 'チャット一覧の取得に失敗しました。');
    }
  }

  /**
   * チャット作成 UI 用のモデル一覧と cwd 候補を返す。
   */
  async getLaunchOptionCatalog(): Promise<ChatLaunchOptionCatalog> {
    try {
      const [models, cwdChoices, workspaceRoot, policyCatalog] = await Promise.all([
        this.#listModelsWithFallback(),
        this.#listWorkspaceDirectories(),
        this.#getWorkspaceRootRealPath(),
        this.#getPolicyCatalog(false),
      ]);

      return {
        models,
        workspaceRoot,
        cwdChoices,
        approvalPolicies: policyCatalog.approvalPolicies,
        sandboxModes: policyCatalog.sandboxModes,
        defaultApprovalPolicy: policyCatalog.defaultApprovalPolicy,
        defaultSandboxMode: policyCatalog.defaultSandboxMode,
      };
    } catch (error) {
      throw this.#mapBridgeError(error, 'chat_options_failed', 'チャット起動オプションの取得に失敗しました。');
    }
  }

  /**
   * 新しいチャットを作成する。
   */
  async createChat(input: CreateChatLaunchOptionsInput): Promise<ChatSummary> {
    try {
      const launchOptions = await this.#validateCreateLaunchOptions(input);
      const appliedLaunchOptions: ChatLaunchOptions = {
        ...launchOptions,
        cwd: launchOptions.cwd ?? this.#defaultThreadCwd,
      };
      const result = await this.#client.request('thread/start', {
        model: appliedLaunchOptions.model,
        modelProvider: null,
        cwd: appliedLaunchOptions.cwd,
        approvalPolicy: appliedLaunchOptions.approvalPolicy,
        sandbox: appliedLaunchOptions.sandboxMode,
        config: null,
        baseInstructions: null,
        developerInstructions: null,
        personality: null,
        ephemeral: false,
        dynamicTools: null,
        experimentalRawEvents: false,
      });
      const parsed = parseThreadStartResult(result);
      if (!parsed) {
        throw new ChatBridgeError('invalid_response', 502, 'thread/start の応答が不正です。');
      }
      const summary = toChatSummary(parsed.thread);
      this.#launchOptionsByThread.set(summary.id, appliedLaunchOptions);
      return await this.#withLaunchOptions(summary);
    } catch (error) {
      throw this.#mapBridgeError(error, 'chat_create_failed', 'チャット作成に失敗しました。');
    }
  }

  /**
   * 指定チャットの履歴を返す。
   * @param threadId thread ID
   */
  async getChat(threadId: string): Promise<ChatDetail> {
    try {
      const result = await this.#readThreadWithAutoResume(threadId);
      const parsed = parseThreadReadResult(result);
      if (!parsed) {
        throw new ChatBridgeError('invalid_response', 502, 'thread/read の応答が不正です。');
      }
      const detail = toChatDetail(parsed.thread);
      const launchOptions = await this.#resolveLaunchOptionsForThread(
        detail.chat.id,
        detail.chat.launchOptions,
      );
      if (detail.activeTurnId) {
        this.#activeTurnByThread.set(threadId, detail.activeTurnId);
      } else {
        this.#activeTurnByThread.delete(threadId);
      }
      return {
        ...detail,
        chat: {
          ...detail.chat,
          launchOptions,
        },
      };
    } catch (error) {
      throw this.#mapBridgeError(error, 'chat_get_failed', 'チャット履歴の取得に失敗しました。');
    }
  }

  /**
   * 既存チャットのモデル/推論量設定を更新する。
   * @param threadId thread ID
   * @param input 更新する launch options
   */
  async updateChatLaunchOptions(
    threadId: string,
    input: UpdateChatLaunchOptionsInput,
  ): Promise<ChatLaunchOptions> {
    try {
      const current = await this.#getOrRestoreLaunchOptions(threadId);
      const next = await this.#validateModelAndEffort({
        model: input.model !== undefined ? input.model : current.model,
        effort: input.effort !== undefined ? input.effort : current.effort,
        cwd: current.cwd,
        approvalPolicy:
          input.approvalPolicy !== undefined ? input.approvalPolicy : current.approvalPolicy,
        sandboxMode: input.sandboxMode !== undefined ? input.sandboxMode : current.sandboxMode,
      });
      this.#launchOptionsByThread.set(threadId, next);
      return next;
    } catch (error) {
      throw this.#mapBridgeError(error, 'chat_options_update_failed', 'チャット設定の更新に失敗しました。');
    }
  }

  /**
   * 指定チャットへユーザーメッセージを送信し turn を開始する。
   * @param threadId thread ID
   * @param text ユーザーメッセージ
   */
  async sendMessage(threadId: string, text: string): Promise<{ readonly turnId: string }> {
    try {
      const launchOptions = await this.#getOrRestoreLaunchOptions(threadId);
      const result = await this.#startTurnWithAutoResume(threadId, text, launchOptions);
      const parsed = parseTurnStartResult(result);
      if (!parsed) {
        throw new ChatBridgeError('invalid_response', 502, 'turn/start の応答が不正です。');
      }
      this.#activeTurnByThread.set(threadId, parsed.turn.id);
      return { turnId: parsed.turn.id };
    } catch (error) {
      throw this.#mapBridgeError(error, 'chat_send_failed', 'メッセージ送信に失敗しました。');
    }
  }

  /**
   * 実行中 turn を中断する。
   * @param threadId thread ID
   * @param turnId 中断対象 turn ID（省略時は最後に開始した turn）
   */
  async interruptTurn(threadId: string, turnId: string | null): Promise<{ readonly turnId: string }> {
    const targetTurnId = turnId ?? this.#activeTurnByThread.get(threadId) ?? null;
    if (!targetTurnId) {
      throw new ChatBridgeError('turn_not_running', 409, '中断可能な turn がありません。');
    }

    try {
      await this.#client.request('turn/interrupt', {
        threadId,
        turnId: targetTurnId,
      });
      return { turnId: targetTurnId };
    } catch (error) {
      throw this.#mapBridgeError(error, 'chat_interrupt_failed', 'turn の中断に失敗しました。');
    }
  }

  /**
   * 保留中の承認リクエストへ accept/decline を返す。
   * @param threadId thread ID
   * @param itemId 承認対象 item ID
   * @param decision 承認結果
   */
  respondApproval(
    threadId: string,
    itemId: string,
    decision: ChatApprovalDecision,
  ): { readonly itemId: string; readonly decision: ChatApprovalDecision } {
    const bucket = this.#pendingApprovalsByThread.get(threadId);
    const pending = bucket?.get(itemId);
    if (!pending) {
      throw new ChatBridgeError('approval_not_found', 404, `承認対象が見つかりません: ${itemId}`);
    }

    const result = { decision: decision === 'accept' ? 'accept' : 'decline' };

    try {
      this.#client.respondServerRequest(pending.requestId, result);
    } catch (error) {
      throw this.#mapBridgeError(error, 'approval_respond_failed', '承認応答の送信に失敗しました。');
    }

    bucket?.delete(itemId);
    if (bucket && bucket.size === 0) {
      this.#pendingApprovalsByThread.delete(threadId);
    }

    this.#broadcast(threadId, {
      type: 'approval_resolved',
      threadId,
      itemId,
      decision,
    });
    return { itemId, decision };
  }

  /**
   * 保留中の user input 要求へ回答を返す。
   * @param threadId thread ID
   * @param itemId 対象 item ID
   * @param response 回答 payload
   */
  respondUserInput(
    threadId: string,
    itemId: string,
    response: ChatUserInputResponse,
  ): { readonly itemId: string } {
    const bucket = this.#pendingUserInputsByThread.get(threadId);
    const pending = bucket?.get(itemId);
    if (!pending) {
      throw new ChatBridgeError('user_input_not_found', 404, `入力要求が見つかりません: ${itemId}`);
    }

    try {
      this.#client.respondServerRequest(pending.requestId, response);
    } catch (error) {
      throw this.#mapBridgeError(error, 'user_input_respond_failed', '入力応答の送信に失敗しました。');
    }

    bucket?.delete(itemId);
    if (bucket && bucket.size === 0) {
      this.#pendingUserInputsByThread.delete(threadId);
    }

    this.#broadcast(threadId, {
      type: 'user_input_resolved',
      threadId,
      itemId,
    });
    return { itemId };
  }

  /**
   * 指定 thread のストリームイベント購読へ WebSocket を紐づける。
   * @param threadId thread ID
   * @param ws 接続済み WebSocket
   */
  attachWebSocket(threadId: string, ws: WebSocket): void {
    let bucket = this.#subscriptions.get(threadId);
    if (!bucket) {
      bucket = new Set<WebSocket>();
      this.#subscriptions.set(threadId, bucket);
    }
    bucket.add(ws);

    this.#sendToClient(ws, {
      type: 'ready',
      threadId,
      activeTurnId: this.#activeTurnByThread.get(threadId) ?? null,
      pendingApprovals: this.#listPendingApprovals(threadId),
      pendingUserInputRequests: this.#listPendingUserInputs(threadId),
    });

    ws.on('close', () => {
      this.#detachWebSocket(threadId, ws);
    });

    ws.on('error', () => {
      this.#detachWebSocket(threadId, ws);
    });
  }

  async #listChatsByArchived(params: ListChatsParams): Promise<ChatSummary[]> {
    const chats: ChatSummary[] = [];
    let cursor: string | null = null;

    for (let index = 0; index < MAX_PAGE_ROUNDS; index += 1) {
      const result = await this.#client.request('thread/list', {
        cursor,
        limit: DEFAULT_PAGE_LIMIT,
        sortKey: 'updated_at',
        modelProviders: null,
        sourceKinds: null,
        archived: params.archived,
      });
      const parsed = parseThreadListResult(result);
      if (!parsed) {
        throw new ChatBridgeError('invalid_response', 502, 'thread/list の応答が不正です。');
      }
      parsed.data.forEach((thread) => {
        chats.push(toChatSummary(thread));
      });
      cursor = parsed.nextCursor;
      if (!cursor) {
        break;
      }
    }

    return chats;
  }

  async #withLaunchOptions(chat: ChatSummary): Promise<ChatSummary> {
    const launchOptions = await this.#resolveLaunchOptionsForThread(chat.id, chat.launchOptions);
    return {
      ...chat,
      launchOptions,
    };
  }

  async #getOrRestoreLaunchOptions(threadId: string): Promise<ChatLaunchOptions> {
    const existing = this.#launchOptionsByThread.get(threadId);
    if (existing) {
      return existing;
    }

    try {
      const result = await this.#readThreadWithAutoResume(threadId);
      const parsed = parseThreadReadResult(result);
      if (parsed) {
        const summary = toChatSummary(parsed.thread);
        return await this.#resolveLaunchOptionsForThread(threadId, summary.launchOptions);
      }
    } catch {
      // fall back to defaults when thread metadata restore is unavailable
    }

    const policyCatalog = await this.#getPolicyCatalog(false);
    const fallback: ChatLaunchOptions = {
      model: null,
      effort: null,
      cwd: this.#defaultThreadCwd,
      approvalPolicy: policyCatalog.defaultApprovalPolicy,
      sandboxMode: policyCatalog.defaultSandboxMode,
    };
    this.#launchOptionsByThread.set(threadId, fallback);
    return fallback;
  }

  async #resolveLaunchOptionsForThread(
    threadId: string,
    fallback: ChatLaunchOptions,
  ): Promise<ChatLaunchOptions> {
    const existing = this.#launchOptionsByThread.get(threadId);
    if (existing) {
      return existing;
    }

    const resolvedCwd = await this.#restoreCwdOrDefault(fallback.cwd);
    const policyCatalog = await this.#getPolicyCatalog(false);
    const launchOptions: ChatLaunchOptions = {
      model: fallback.model,
      effort: fallback.effort,
      cwd: resolvedCwd,
      approvalPolicy: this.#resolveApprovalPolicy(fallback.approvalPolicy, policyCatalog),
      sandboxMode: this.#resolveSandboxMode(fallback.sandboxMode, policyCatalog),
    };
    this.#launchOptionsByThread.set(threadId, launchOptions);
    return launchOptions;
  }

  async #restoreCwdOrDefault(candidateCwd: string | null): Promise<string | null> {
    if (!candidateCwd || !path.isAbsolute(candidateCwd)) {
      return this.#defaultThreadCwd;
    }

    const resolved = path.resolve(candidateCwd);
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        return this.#defaultThreadCwd;
      }
      return await fs.realpath(resolved);
    } catch {
      return this.#defaultThreadCwd;
    }
  }

  async #validateCreateLaunchOptions(input: CreateChatLaunchOptionsInput): Promise<ChatLaunchOptions> {
    const next = await this.#validateModelAndEffort({
      model: input.model,
      effort: input.effort,
      cwd: null,
      approvalPolicy: input.approvalPolicy,
      sandboxMode: input.sandboxMode,
    });
    const cwd = await this.#validateCwd(input.cwd);
    return {
      ...next,
      cwd,
    };
  }

  async #validateModelAndEffort(input: ChatLaunchValidationInput): Promise<ChatLaunchOptions> {
    const policyCatalog = await this.#getPolicyCatalog(false);
    const approvalPolicy = this.#resolveApprovalPolicy(input.approvalPolicy, policyCatalog);
    const sandboxMode = this.#resolveSandboxMode(input.sandboxMode, policyCatalog);

    if (input.model === null && input.effort === null) {
      return {
        model: null,
        effort: null,
        cwd: input.cwd,
        approvalPolicy,
        sandboxMode,
      };
    }

    const models = await this.#listModels(false);
    const modelMap = new Map<string, ChatModelOption>();
    models.forEach((model) => {
      modelMap.set(model.id, model);
    });

    if (input.model !== null && !modelMap.has(input.model)) {
      throw new ChatBridgeError('invalid_model', 400, `未知の model です: ${input.model}`);
    }

    if (input.effort !== null) {
      if (input.model === null) {
        throw new ChatBridgeError('invalid_effort', 400, 'effort を指定する場合は model も指定してください。');
      }
      const model = modelMap.get(input.model);
      if (!model) {
        throw new ChatBridgeError('invalid_model', 400, `未知の model です: ${input.model}`);
      }
      if (!model.efforts.includes(input.effort)) {
        throw new ChatBridgeError(
          'invalid_effort',
          400,
          `${input.model} では effort=${input.effort} を利用できません。`,
        );
      }
    }

    return {
      model: input.model,
      effort: input.effort,
      cwd: input.cwd,
      approvalPolicy,
      sandboxMode,
    };
  }

  async #validateCwd(cwd: string | null): Promise<string | null> {
    if (cwd === null) {
      return null;
    }
    if (!path.isAbsolute(cwd)) {
      throw new ChatBridgeError('invalid_cwd', 400, 'cwd は絶対パスで指定してください。');
    }

    const workspaceRoot = await this.#getWorkspaceRootRealPath();
    if (!workspaceRoot) {
      throw new ChatBridgeError('invalid_cwd', 400, 'WORKSPACE_ROOT が未設定のため cwd を指定できません。');
    }

    const resolvedPath = path.resolve(cwd);
    let stat;
    try {
      stat = await fs.stat(resolvedPath);
    } catch {
      throw new ChatBridgeError('invalid_cwd', 400, `cwd が存在しません: ${cwd}`);
    }
    if (!stat.isDirectory()) {
      throw new ChatBridgeError('invalid_cwd', 400, `cwd はディレクトリを指定してください: ${cwd}`);
    }

    let realPath: string;
    try {
      realPath = await fs.realpath(resolvedPath);
    } catch {
      throw new ChatBridgeError('invalid_cwd', 400, `cwd の解決に失敗しました: ${cwd}`);
    }
    if (!this.#isPathInsideRoot(workspaceRoot, realPath)) {
      throw new ChatBridgeError('invalid_cwd', 400, 'cwd は WORKSPACE_ROOT 配下のみ指定できます。');
    }

    return realPath;
  }

  async #getWorkspaceRootRealPath(): Promise<string | null> {
    if (this.#workspaceRootRealPath !== undefined) {
      return this.#workspaceRootRealPath;
    }

    if (!this.#defaultThreadCwd) {
      this.#workspaceRootRealPath = null;
      return this.#workspaceRootRealPath;
    }

    const resolved = path.resolve(this.#defaultThreadCwd);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      throw new ChatBridgeError('workspace_root_invalid', 500, `WORKSPACE_ROOT が存在しません: ${resolved}`);
    }
    if (!stat.isDirectory()) {
      throw new ChatBridgeError(
        'workspace_root_invalid',
        500,
        `WORKSPACE_ROOT はディレクトリである必要があります: ${resolved}`,
      );
    }

    this.#workspaceRootRealPath = await fs.realpath(resolved);
    return this.#workspaceRootRealPath;
  }

  #isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
    if (candidatePath === rootPath) {
      return true;
    }
    const rootPrefix = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
    return candidatePath.startsWith(rootPrefix);
  }

  async #listWorkspaceDirectories(): Promise<string[]> {
    const workspaceRoot = await this.#getWorkspaceRootRealPath();
    if (!workspaceRoot) {
      return [];
    }

    const choices = new Set<string>([workspaceRoot]);
    const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
    const directoryNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const name of directoryNames) {
      if (choices.size >= WORKSPACE_DIR_LIMIT) {
        break;
      }
      const target = path.resolve(workspaceRoot, name);
      let realPath: string;
      try {
        realPath = await fs.realpath(target);
      } catch {
        continue;
      }
      if (!this.#isPathInsideRoot(workspaceRoot, realPath)) {
        continue;
      }
      choices.add(realPath);
    }

    return [...choices];
  }

  async #listModels(forceRefresh: boolean): Promise<ChatModelOption[]> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.#modelCache &&
      now - this.#modelCache.loadedAt <= MODEL_CACHE_TTL_MS
    ) {
      return this.#modelCache.models;
    }

    const modelsById = new Map<string, ChatModelOption>();
    let cursor: string | null = null;

    for (let index = 0; index < MAX_PAGE_ROUNDS; index += 1) {
      const params = cursor ? { cursor } : {};
      const result = await this.#client.request('model/list', params);
      const parsed = parseModelListResult(result);
      if (!parsed) {
        throw new ChatBridgeError('invalid_response', 502, 'model/list の応答が不正です。');
      }
      parsed.data.forEach((model) => {
        const converted = toChatModelOption(model);
        modelsById.set(converted.id, converted);
      });

      cursor = parsed.nextCursor;
      if (!cursor) {
        break;
      }
    }

    const models = [...modelsById.values()].sort((a, b) => {
      if (a.isDefault && !b.isDefault) {
        return -1;
      }
      if (!a.isDefault && b.isDefault) {
        return 1;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    this.#modelCache = {
      models,
      loadedAt: now,
    };
    return models;
  }

  async #readThreadWithAutoResume(threadId: string): Promise<unknown> {
    try {
      return await this.#client.request('thread/read', {
        threadId,
        includeTurns: true,
      });
    } catch (error) {
      if (!isThreadNotFoundRequestError(error)) {
        throw error;
      }
      await this.#resumeThread(threadId);
      return this.#client.request('thread/read', {
        threadId,
        includeTurns: true,
      });
    }
  }

  async #startTurnWithAutoResume(
    threadId: string,
    text: string,
    launchOptions: ChatLaunchOptions,
  ): Promise<unknown> {
    try {
      return await this.#startTurn(threadId, text, launchOptions);
    } catch (error) {
      if (!isThreadNotFoundRequestError(error)) {
        throw error;
      }
      await this.#resumeThread(threadId);
      return this.#startTurn(threadId, text, launchOptions);
    }
  }

  async #resumeThread(threadId: string): Promise<void> {
    await this.#client.request('thread/resume', { threadId });
  }

  async #startTurn(
    threadId: string,
    text: string,
    launchOptions: ChatLaunchOptions,
  ): Promise<unknown> {
    return this.#client.request('turn/start', {
      threadId,
      input: [
        {
          type: 'text',
          text,
          text_elements: [],
        },
      ],
      cwd: launchOptions.cwd,
      approvalPolicy: launchOptions.approvalPolicy,
      sandboxPolicy: this.#toSandboxPolicyPayload(launchOptions.sandboxMode),
      model: launchOptions.model,
      effort: launchOptions.effort,
      summary: null,
      personality: null,
      outputSchema: null,
      collaborationMode: null,
    });
  }

  async #listModelsWithFallback(): Promise<ChatModelOption[]> {
    try {
      return await this.#listModels(false);
    } catch (error) {
      if (error instanceof AppServerRequestError || error instanceof AppServerClientError) {
        console.warn('model/list is unavailable; launch options will use defaults', {
          message: error.message,
        });
        return [];
      }
      if (error instanceof ChatBridgeError && error.code === 'invalid_response') {
        console.warn('model/list returned invalid payload; launch options will use defaults');
        return [];
      }
      throw error;
    }
  }

  #detachWebSocket(threadId: string, ws: WebSocket): void {
    const bucket = this.#subscriptions.get(threadId);
    if (!bucket) {
      return;
    }
    bucket.delete(ws);
    if (bucket.size === 0) {
      this.#subscriptions.delete(threadId);
    }
  }

  #sendToClient(client: WebSocket, event: ChatStreamEvent): void {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }
    client.send(JSON.stringify(event));
  }

  #broadcast(threadId: string, event: ChatStreamEvent): void {
    const clients = this.#subscriptions.get(threadId);
    if (!clients || clients.size === 0) {
      return;
    }
    clients.forEach((client) => {
      this.#sendToClient(client, event);
    });
  }

  #handleNotification(method: string, params: unknown): void {
    const payload = parseRecord(params);
    if (!payload) {
      return;
    }

    switch (method) {
      case 'turn/started':
        this.#handleTurnStarted(payload);
        return;
      case 'turn/completed':
        this.#handleTurnCompleted(payload);
        return;
      case 'item/started':
        this.#handleItemEvent('item_started', payload);
        return;
      case 'item/completed':
        this.#handleItemEvent('item_updated', payload);
        return;
      case 'item/agentMessage/delta':
        this.#handleDeltaEvent(payload, 'assistant', 'agentMessage');
        return;
      case 'item/commandExecution/outputDelta':
        this.#handleDeltaEvent(payload, 'tool', 'commandExecution');
        return;
      case 'item/fileChange/outputDelta':
        this.#handleDeltaEvent(payload, 'tool', 'fileChange');
        return;
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        this.#handleDeltaEvent(payload, 'system', 'reasoning');
        return;
      case 'item/plan/delta':
        this.#handleDeltaEvent(payload, 'system', 'plan');
        return;
      case 'turn/plan/updated':
      case 'thread/tokenUsage/updated':
      case 'item/reasoning/summaryPartAdded':
        this.#logIgnoredNotification(method, payload);
        return;
      case 'error':
        this.#handleTurnError(payload);
        return;
      default:
        this.#logIgnoredNotification(method, payload);
        return;
    }
  }

  #handleTurnStarted(payload: Record<string, unknown>): void {
    const threadId = parseStringField(payload, 'threadId');
    const turn = parseRecord(payload.turn);
    const turnId = turn ? parseStringField(turn, 'id') : null;
    if (!threadId || !turnId) {
      return;
    }
    this.#activeTurnByThread.set(threadId, turnId);
    this.#broadcast(threadId, {
      type: 'turn_started',
      threadId,
      turnId,
    });
  }

  #handleTurnCompleted(payload: Record<string, unknown>): void {
    const threadId = parseStringField(payload, 'threadId');
    const turn = parseRecord(payload.turn);
    const turnId = turn ? parseStringField(turn, 'id') : null;
    const status = turn ? parseStringField(turn, 'status') : null;
    const error = turn && isRecord(turn.error) ? parseStringField(turn.error, 'message') : null;
    if (!threadId || !turnId || !status) {
      return;
    }
    if (this.#activeTurnByThread.get(threadId) === turnId) {
      this.#activeTurnByThread.delete(threadId);
    }
    this.#clearPendingApprovalsForTurn(threadId, turnId);
    this.#clearPendingUserInputsForTurn(threadId, turnId);
    this.#broadcast(threadId, {
      type: 'turn_completed',
      threadId,
      turnId,
      status,
      errorMessage: error,
    });
  }

  #handleItemEvent(type: 'item_started' | 'item_updated', payload: Record<string, unknown>): void {
    const threadId = parseStringField(payload, 'threadId');
    const turnId = parseStringField(payload, 'turnId');
    const item = parseNotificationItem(payload);
    if (!threadId || !turnId || !item) {
      return;
    }
    const message = toChatMessageFromItem(item, threadId, turnId);
    if (!message) {
      return;
    }
    this.#broadcast(threadId, {
      type,
      threadId,
      turnId,
      message,
    });
  }

  #handleDeltaEvent(
    payload: Record<string, unknown>,
    role: ChatRole,
    kind: string,
  ): void {
    if (!isChatRole(role)) {
      return;
    }
    const threadId = parseStringField(payload, 'threadId');
    const turnId = parseStringField(payload, 'turnId');
    const itemId = parseStringField(payload, 'itemId');
    const delta = parseStringField(payload, 'delta');
    if (!threadId || !turnId || !itemId || !delta) {
      return;
    }
    this.#broadcast(threadId, {
      type: 'message_delta',
      threadId,
      turnId,
      itemId,
      role,
      kind,
      delta,
    });
  }

  #handleTurnError(payload: Record<string, unknown>): void {
    const threadId = parseStringField(payload, 'threadId');
    const turnId = parseStringField(payload, 'turnId');
    if (!threadId) {
      return;
    }
    if (turnId) {
      this.#clearPendingApprovalsForTurn(threadId, turnId);
      this.#clearPendingUserInputsForTurn(threadId, turnId);
    }
    const errorRecord = parseRecord(payload.error);
    const message = errorRecord ? parseStringField(errorRecord, 'message') : null;
    this.#broadcast(threadId, {
      type: 'error',
      threadId,
      error: {
        code: 'turn_error',
        message: message ?? 'app-server でエラーが発生しました。',
      },
    });
  }

  #handleServerRequest(id: string | number, method: string, params: unknown): boolean {
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const request = parseCommandExecutionApprovalRequest(params);
        if (!request) {
          this.#client.rejectServerRequest(id, -32602, 'invalid command approval params');
          return true;
        }
        this.#queueApprovalRequest(id, request);
        return true;
      }
      case 'item/fileChange/requestApproval': {
        const request = parseFileChangeApprovalRequest(params);
        if (!request) {
          this.#client.rejectServerRequest(id, -32602, 'invalid file approval params');
          return true;
        }
        this.#queueApprovalRequest(id, request);
        return true;
      }
      case 'item/tool/requestUserInput': {
        const request = parseToolRequestUserInputRequest(params);
        if (!request) {
          this.#client.rejectServerRequest(id, -32602, 'invalid tool requestUserInput params');
          return true;
        }
        this.#queueUserInputRequest(id, request);
        return true;
      }
      case 'item/tool/call': {
        this.#client.rejectServerRequest(
          id,
          -32004,
          'item/tool/call is not supported by codex-dashboard',
        );
        return true;
      }
      default:
        this.#client.rejectServerRequest(id, -32004, `unsupported app-server request: ${method}`);
        return true;
    }
  }

  #queueApprovalRequest(id: string | number, request: ChatApprovalRequest): void {
    let bucket = this.#pendingApprovalsByThread.get(request.threadId);
    if (!bucket) {
      bucket = new Map<string, PendingApproval>();
      this.#pendingApprovalsByThread.set(request.threadId, bucket);
    }
    bucket.set(request.itemId, {
      requestId: id,
      request,
    });
    this.#broadcast(request.threadId, {
      type: 'approval_requested',
      threadId: request.threadId,
      request,
    });
  }

  #queueUserInputRequest(id: string | number, request: ChatUserInputRequest): void {
    let bucket = this.#pendingUserInputsByThread.get(request.threadId);
    if (!bucket) {
      bucket = new Map<string, PendingUserInputRequest>();
      this.#pendingUserInputsByThread.set(request.threadId, bucket);
    }
    bucket.set(request.itemId, {
      requestId: id,
      request,
    });
    this.#broadcast(request.threadId, {
      type: 'user_input_requested',
      threadId: request.threadId,
      request,
    });
  }

  #listPendingApprovals(threadId: string): ChatApprovalRequest[] {
    const bucket = this.#pendingApprovalsByThread.get(threadId);
    if (!bucket) {
      return [];
    }
    return [...bucket.values()].map((entry) => entry.request);
  }

  #listPendingUserInputs(threadId: string): ChatUserInputRequest[] {
    const bucket = this.#pendingUserInputsByThread.get(threadId);
    if (!bucket) {
      return [];
    }
    return [...bucket.values()].map((entry) => entry.request);
  }

  #clearPendingApprovalsForTurn(threadId: string, turnId: string): void {
    const bucket = this.#pendingApprovalsByThread.get(threadId);
    if (!bucket) {
      return;
    }
    const matchedItemIds: string[] = [];
    bucket.forEach((pending, itemId) => {
      if (pending.request.turnId === turnId) {
        matchedItemIds.push(itemId);
      }
    });
    matchedItemIds.forEach((itemId) => {
      bucket.delete(itemId);
    });
    if (bucket.size === 0) {
      this.#pendingApprovalsByThread.delete(threadId);
    }
  }

  #clearPendingUserInputsForTurn(threadId: string, turnId: string): void {
    const bucket = this.#pendingUserInputsByThread.get(threadId);
    if (!bucket) {
      return;
    }
    const matchedItemIds: string[] = [];
    bucket.forEach((pending, itemId) => {
      if (pending.request.turnId === turnId) {
        matchedItemIds.push(itemId);
      }
    });
    matchedItemIds.forEach((itemId) => {
      bucket.delete(itemId);
    });
    if (bucket.size === 0) {
      this.#pendingUserInputsByThread.delete(threadId);
    }
  }

  #resolveApprovalPolicy(
    value: string | null,
    catalog: ChatPolicyCatalog,
  ): ChatApprovalPolicy | null {
    const normalized = value === null ? null : normalizeChatApprovalPolicy(value);
    if (value !== null && !normalized) {
      throw new ChatBridgeError('invalid_approval_policy', 400, `未知の approvalPolicy です: ${value}`);
    }
    const resolved = normalized ?? catalog.defaultApprovalPolicy;
    if (!resolved) {
      return null;
    }
    if (!catalog.approvalPolicies.includes(resolved)) {
      throw new ChatBridgeError(
        'invalid_approval_policy',
        400,
        `許可されていない approvalPolicy です: ${resolved}`,
      );
    }
    return resolved;
  }

  #resolveSandboxMode(value: string | null, catalog: ChatPolicyCatalog): ChatSandboxMode | null {
    const normalized = value === null ? null : normalizeChatSandboxMode(value);
    if (value !== null && !normalized) {
      throw new ChatBridgeError('invalid_sandbox_mode', 400, `未知の sandboxMode です: ${value}`);
    }
    const resolved = normalized ?? catalog.defaultSandboxMode;
    if (!resolved) {
      return null;
    }
    if (!catalog.sandboxModes.includes(resolved)) {
      throw new ChatBridgeError(
        'invalid_sandbox_mode',
        400,
        `許可されていない sandboxMode です: ${resolved}`,
      );
    }
    return resolved;
  }

  #toSandboxPolicyPayload(sandboxMode: ChatSandboxMode | null): Record<string, unknown> | null {
    switch (sandboxMode) {
      case 'read-only':
        return { type: 'readOnly' };
      case 'workspace-write':
        return { type: 'workspaceWrite' };
      case 'danger-full-access':
        return { type: 'dangerFullAccess' };
      default:
        return null;
    }
  }

  #logIgnoredNotification(method: string, payload: Record<string, unknown>): void {
    console.info('ignored app-server notification', {
      method,
      threadId: parseStringField(payload, 'threadId'),
      turnId: parseStringField(payload, 'turnId'),
      itemId: parseStringField(payload, 'itemId'),
    });
  }

  async #getPolicyCatalog(forceRefresh: boolean): Promise<ChatPolicyCatalog> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.#policyCache &&
      now - this.#policyCache.loadedAt <= POLICY_CACHE_TTL_MS
    ) {
      return this.#policyCache.catalog;
    }

    const [requirements, defaults] = await Promise.all([
      this.#readConfigRequirementOptionsWithFallback(),
      this.#readConfigDefaultsWithFallback(),
    ]);

    const approvalPolicies =
      requirements?.allowedApprovalPolicies && requirements.allowedApprovalPolicies.length > 0
        ? requirements.allowedApprovalPolicies
        : [...DEFAULT_APPROVAL_POLICIES];
    const sandboxModes =
      requirements?.allowedSandboxModes && requirements.allowedSandboxModes.length > 0
        ? requirements.allowedSandboxModes
        : [...DEFAULT_SANDBOX_MODES];

    const defaultApprovalPolicy = (() => {
      if (defaults.approvalPolicy && approvalPolicies.includes(defaults.approvalPolicy)) {
        return defaults.approvalPolicy;
      }
      return approvalPolicies[0] ?? null;
    })();
    const defaultSandboxMode = (() => {
      if (defaults.sandboxMode && sandboxModes.includes(defaults.sandboxMode)) {
        return defaults.sandboxMode;
      }
      return sandboxModes.includes('workspace-write')
        ? 'workspace-write'
        : (sandboxModes[0] ?? null);
    })();

    const catalog: ChatPolicyCatalog = {
      approvalPolicies,
      sandboxModes,
      defaultApprovalPolicy,
      defaultSandboxMode,
    };
    this.#policyCache = {
      catalog,
      loadedAt: now,
    };
    return catalog;
  }

  async #readConfigDefaultsWithFallback(): Promise<{
    readonly approvalPolicy: ChatApprovalPolicy | null;
    readonly sandboxMode: ChatSandboxMode | null;
  }> {
    try {
      const result = await this.#client.request('config/read', {});
      const parsed = parseConfigDefaults(result);
      if (parsed) {
        return parsed;
      }
      return {
        approvalPolicy: null,
        sandboxMode: null,
      };
    } catch (error) {
      if (error instanceof AppServerRequestError || error instanceof AppServerClientError) {
        console.warn('config/read is unavailable; policy defaults will use built-in values', {
          message: error.message,
        });
        return {
          approvalPolicy: null,
          sandboxMode: null,
        };
      }
      throw error;
    }
  }

  async #readConfigRequirementOptionsWithFallback(): Promise<{
    readonly allowedApprovalPolicies: ChatApprovalPolicy[] | null;
    readonly allowedSandboxModes: ChatSandboxMode[] | null;
  } | null> {
    try {
      const result = await this.#client.request('configRequirements/read', {});
      const parsed = parseConfigRequirementOptions(result);
      if (parsed) {
        return parsed;
      }
      return null;
    } catch (error) {
      if (error instanceof AppServerRequestError || error instanceof AppServerClientError) {
        console.warn('configRequirements/read is unavailable; policy restrictions are not applied', {
          message: error.message,
        });
        return null;
      }
      throw error;
    }
  }

  #mapBridgeError(error: unknown, code: string, fallback: string): ChatBridgeError {
    if (error instanceof ChatBridgeError) {
      return error;
    }

    if (error instanceof AppServerRequestError) {
      if (isThreadNotFoundRequestError(error)) {
        return new ChatBridgeError('chat_not_found', 404, error.message);
      }
      return new ChatBridgeError(code, 502, error.message);
    }

    if (error instanceof AppServerClientError) {
      return new ChatBridgeError('app_server_unavailable', 503, error.message);
    }

    return new ChatBridgeError(code, 500, toErrorMessage(error, fallback));
  }
}
