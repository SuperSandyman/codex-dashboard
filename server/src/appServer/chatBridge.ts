import { WebSocket } from 'ws';

import {
  AppServerClient,
  AppServerClientError,
  AppServerRequestError,
} from './client.js';
import type {
  ChatDetail,
  ChatMessage,
  ChatRole,
  ChatStreamEvent,
  ChatSummary,
} from './dashboardTypes.js';
import {
  isChatRole,
  parseNotificationItem,
  parseRecord,
  parseStringField,
  parseThreadListResult,
  parseThreadReadResult,
  parseThreadStartResult,
  parseTurnStartResult,
  toChatDetail,
  toChatMessageFromItem,
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

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_ROUNDS = 20;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  return error instanceof Error ? error.message : fallback;
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
      return [...mergedById.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      throw this.#mapBridgeError(error, 'chat_list_failed', 'チャット一覧の取得に失敗しました。');
    }
  }

  /**
   * 新しいチャットを作成する。
   */
  async createChat(): Promise<ChatSummary> {
    try {
      const result = await this.#client.request('thread/start', {
        model: null,
        modelProvider: null,
        cwd: this.#defaultThreadCwd,
        approvalPolicy: 'never',
        sandbox: null,
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
      return toChatSummary(parsed.thread);
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
      const result = await this.#client.request('thread/read', {
        threadId,
        includeTurns: true,
      });
      const parsed = parseThreadReadResult(result);
      if (!parsed) {
        throw new ChatBridgeError('invalid_response', 502, 'thread/read の応答が不正です。');
      }
      const detail = toChatDetail(parsed.thread);
      if (detail.activeTurnId) {
        this.#activeTurnByThread.set(threadId, detail.activeTurnId);
      } else {
        this.#activeTurnByThread.delete(threadId);
      }
      return detail;
    } catch (error) {
      throw this.#mapBridgeError(error, 'chat_get_failed', 'チャット履歴の取得に失敗しました。');
    }
  }

  /**
   * 指定チャットへユーザーメッセージを送信し turn を開始する。
   * @param threadId thread ID
   * @param text ユーザーメッセージ
   */
  async sendMessage(threadId: string, text: string): Promise<{ readonly turnId: string }> {
    try {
      const result = await this.#client.request('turn/start', {
        threadId,
        input: [
          {
            type: 'text',
            text,
            text_elements: [],
          },
        ],
        cwd: null,
        approvalPolicy: 'never',
        sandboxPolicy: null,
        model: null,
        effort: null,
        summary: null,
        personality: null,
        outputSchema: null,
        collaborationMode: null,
      });
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
      case 'error':
        this.#handleTurnError(payload);
        return;
      default:
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
    if (!threadId) {
      return;
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

  #mapBridgeError(error: unknown, code: string, fallback: string): ChatBridgeError {
    if (error instanceof ChatBridgeError) {
      return error;
    }

    if (error instanceof AppServerRequestError) {
      const lowerMessage = error.message.toLowerCase();
      const isNotFound =
        lowerMessage.includes('not found') ||
        lowerMessage.includes('invalid thread id') ||
        lowerMessage.includes('unknown thread');
      if (isNotFound) {
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
