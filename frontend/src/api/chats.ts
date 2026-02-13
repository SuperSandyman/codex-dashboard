import { requestJson } from './client';

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';
export type ChatApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type ChatSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ChatApprovalDecision = 'accept' | 'decline';
export type ChatApprovalRequestKind = 'commandExecution' | 'fileChange';

export interface ChatLaunchOptions {
  readonly model: string | null;
  readonly effort: string | null;
  readonly cwd: string | null;
  readonly approvalPolicy: ChatApprovalPolicy | null;
  readonly sandboxMode: ChatSandboxMode | null;
}

export interface ChatModelOption {
  readonly id: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly efforts: string[];
  readonly defaultEffort: string | null;
  readonly isDefault: boolean;
}

export interface ChatLaunchCatalog {
  readonly models: ChatModelOption[];
  readonly workspaceRoot: string | null;
  readonly cwdChoices: string[];
  readonly approvalPolicies: ChatApprovalPolicy[];
  readonly sandboxModes: ChatSandboxMode[];
  readonly defaultApprovalPolicy: ChatApprovalPolicy | null;
  readonly defaultSandboxMode: ChatSandboxMode | null;
}

export interface ChatSummary {
  readonly id: string;
  readonly preview: string;
  readonly modelProvider: string;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly launchOptions: ChatLaunchOptions;
}

export interface ChatMessage {
  readonly id: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly role: ChatRole;
  readonly kind: string;
  readonly text: string;
  readonly status: string | null;
}

export interface ChatDetailResponse {
  readonly chat: ChatSummary;
  readonly messages: ChatMessage[];
  readonly activeTurnId: string | null;
}

export interface CreateChatRequest {
  readonly model: string | null;
  readonly effort: string | null;
  readonly cwd: string | null;
  readonly approvalPolicy: ChatApprovalPolicy | null;
  readonly sandboxMode: ChatSandboxMode | null;
}

export interface UpdateChatLaunchOptionsRequest {
  readonly model?: string | null;
  readonly effort?: string | null;
  readonly approvalPolicy?: ChatApprovalPolicy | null;
  readonly sandboxMode?: ChatSandboxMode | null;
}

export interface SendMessageResponse {
  readonly turnId: string;
}

export interface InterruptTurnResponse {
  readonly interrupted: boolean;
  readonly turnId: string;
}

export interface ChatApprovalRequest {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly kind: ChatApprovalRequestKind;
  readonly reason: string | null;
  readonly command: string | null;
  readonly cwd: string | null;
  readonly grantRoot: string | null;
}

export interface ChatUserInputOption {
  readonly label: string;
  readonly description: string;
}

export interface ChatUserInputQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly isOther: boolean;
  readonly isSecret: boolean;
  readonly options: ChatUserInputOption[] | null;
}

export interface ChatUserInputRequest {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly questions: ChatUserInputQuestion[];
}

export interface RespondChatApprovalRequest {
  readonly decision: ChatApprovalDecision;
}

export interface RespondChatApprovalResponse {
  readonly itemId: string;
  readonly decision: ChatApprovalDecision;
}

export interface ChatUserInputAnswer {
  readonly answers: string[];
}

export interface RespondChatUserInputRequest {
  readonly answers: Record<string, ChatUserInputAnswer>;
}

export interface RespondChatUserInputResponse {
  readonly itemId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const isChatRole = (value: unknown): value is ChatRole => {
  return value === 'user' || value === 'assistant' || value === 'tool' || value === 'system';
};

const parseNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : null;
};

const normalizeToken = (value: string): string => {
  return value.replace(/[\s_-]/g, '').toLowerCase();
};

const parseApprovalPolicy = (value: unknown): ChatApprovalPolicy | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const raw = value.trim();
  if (raw === 'untrusted' || raw === 'on-failure' || raw === 'on-request' || raw === 'never') {
    return raw;
  }
  const normalized = normalizeToken(raw);
  if (normalized === 'untrusted' || normalized === 'unlesstrusted') {
    return 'untrusted';
  }
  if (normalized === 'onfailure') {
    return 'on-failure';
  }
  if (normalized === 'onrequest') {
    return 'on-request';
  }
  if (normalized === 'never') {
    return 'never';
  }
  return null;
};

const parseSandboxMode = (value: unknown): ChatSandboxMode | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const raw = value.trim();
  if (raw === 'read-only' || raw === 'workspace-write' || raw === 'danger-full-access') {
    return raw;
  }
  const normalized = normalizeToken(raw);
  if (normalized === 'readonly') {
    return 'read-only';
  }
  if (normalized === 'workspacewrite') {
    return 'workspace-write';
  }
  if (normalized === 'dangerfullaccess') {
    return 'danger-full-access';
  }
  return null;
};

const parseChatLaunchOptions = (value: unknown): ChatLaunchOptions | null => {
  if (value === null || value === undefined) {
    return {
      model: null,
      effort: null,
      cwd: null,
      approvalPolicy: null,
      sandboxMode: null,
    };
  }
  if (!isRecord(value)) {
    return null;
  }
  const model = parseNullableString(value.model);
  const effort = parseNullableString(value.effort);
  const cwd = parseNullableString(value.cwd);
  const approvalPolicy =
    value.approvalPolicy === undefined || value.approvalPolicy === null
      ? null
      : parseApprovalPolicy(value.approvalPolicy);
  const sandboxMode =
    value.sandboxMode === undefined || value.sandboxMode === null
      ? null
      : parseSandboxMode(value.sandboxMode);
  if (
    (value.model !== undefined && value.model !== null && model === null) ||
    (value.effort !== undefined && value.effort !== null && effort === null) ||
    (value.cwd !== undefined && value.cwd !== null && cwd === null) ||
    (value.approvalPolicy !== undefined && value.approvalPolicy !== null && approvalPolicy === null) ||
    (value.sandboxMode !== undefined && value.sandboxMode !== null && sandboxMode === null)
  ) {
    return null;
  }
  return {
    model,
    effort,
    cwd,
    approvalPolicy,
    sandboxMode,
  };
};

const parseChatSummary = (value: unknown): ChatSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.preview !== 'string' ||
    typeof value.modelProvider !== 'string' ||
    typeof value.source !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  const launchOptions = parseChatLaunchOptions(value.launchOptions);
  if (!launchOptions) {
    return null;
  }

  return {
    id: value.id,
    preview: value.preview,
    modelProvider: value.modelProvider,
    source: value.source,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    launchOptions,
  };
};

const parseChatMessage = (value: unknown): ChatMessage | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.threadId !== 'string' ||
    (value.turnId !== null && typeof value.turnId !== 'string') ||
    !isChatRole(value.role) ||
    typeof value.kind !== 'string' ||
    typeof value.text !== 'string' ||
    (value.status !== null && typeof value.status !== 'string')
  ) {
    return null;
  }
  return {
    id: value.id,
    threadId: value.threadId,
    turnId: value.turnId,
    role: value.role,
    kind: value.kind,
    text: value.text,
    status: value.status,
  };
};

const parseModelOption = (value: unknown): ChatModelOption | null => {
  if (!isRecord(value) || !Array.isArray(value.efforts)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.displayName !== 'string' ||
    (value.description !== null && typeof value.description !== 'string') ||
    (value.defaultEffort !== null && typeof value.defaultEffort !== 'string') ||
    typeof value.isDefault !== 'boolean'
  ) {
    return null;
  }

  const efforts: string[] = [];
  for (const effort of value.efforts) {
    if (typeof effort !== 'string') {
      return null;
    }
    efforts.push(effort);
  }

  return {
    id: value.id,
    displayName: value.displayName,
    description: value.description,
    efforts,
    defaultEffort: value.defaultEffort,
    isDefault: value.isDefault,
  };
};

const parseChatsResponse = (value: unknown): { readonly chats: ChatSummary[] } | null => {
  if (!isRecord(value) || !Array.isArray(value.chats)) {
    return null;
  }
  const chats: ChatSummary[] = [];
  for (const entry of value.chats) {
    const parsed = parseChatSummary(entry);
    if (!parsed) {
      return null;
    }
    chats.push(parsed);
  }
  return { chats };
};

const parseChatResponse = (value: unknown): { readonly chat: ChatSummary } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const chat = parseChatSummary(value.chat);
  if (!chat) {
    return null;
  }
  return { chat };
};

const parseChatDetailResponse = (value: unknown): ChatDetailResponse | null => {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    return null;
  }
  const chat = parseChatSummary(value.chat);
  if (!chat) {
    return null;
  }
  if (value.activeTurnId !== null && typeof value.activeTurnId !== 'string') {
    return null;
  }

  const messages: ChatMessage[] = [];
  for (const entry of value.messages) {
    const parsed = parseChatMessage(entry);
    if (!parsed) {
      return null;
    }
    messages.push(parsed);
  }

  return {
    chat,
    messages,
    activeTurnId: value.activeTurnId,
  };
};

const parseLaunchCatalogResponse = (value: unknown): ChatLaunchCatalog | null => {
  if (!isRecord(value) || !Array.isArray(value.models) || !Array.isArray(value.cwdChoices)) {
    return null;
  }
  if (value.workspaceRoot !== null && typeof value.workspaceRoot !== 'string') {
    return null;
  }
  if (!Array.isArray(value.approvalPolicies) || !Array.isArray(value.sandboxModes)) {
    return null;
  }

  const models: ChatModelOption[] = [];
  for (const entry of value.models) {
    const parsed = parseModelOption(entry);
    if (!parsed) {
      return null;
    }
    models.push(parsed);
  }

  const cwdChoices: string[] = [];
  for (const entry of value.cwdChoices) {
    if (typeof entry !== 'string') {
      return null;
    }
    cwdChoices.push(entry);
  }

  const approvalPolicies: ChatApprovalPolicy[] = [];
  for (const entry of value.approvalPolicies) {
    const parsed = parseApprovalPolicy(entry);
    if (!parsed) {
      return null;
    }
    approvalPolicies.push(parsed);
  }

  const sandboxModes: ChatSandboxMode[] = [];
  for (const entry of value.sandboxModes) {
    const parsed = parseSandboxMode(entry);
    if (!parsed) {
      return null;
    }
    sandboxModes.push(parsed);
  }

  const defaultApprovalPolicy =
    value.defaultApprovalPolicy === undefined || value.defaultApprovalPolicy === null
      ? null
      : parseApprovalPolicy(value.defaultApprovalPolicy);
  const defaultSandboxMode =
    value.defaultSandboxMode === undefined || value.defaultSandboxMode === null
      ? null
      : parseSandboxMode(value.defaultSandboxMode);
  if (
    (value.defaultApprovalPolicy !== undefined &&
      value.defaultApprovalPolicy !== null &&
      !defaultApprovalPolicy) ||
    (value.defaultSandboxMode !== undefined && value.defaultSandboxMode !== null && !defaultSandboxMode)
  ) {
    return null;
  }

  return {
    models,
    workspaceRoot: value.workspaceRoot,
    cwdChoices,
    approvalPolicies,
    sandboxModes,
    defaultApprovalPolicy,
    defaultSandboxMode,
  };
};

const parseLaunchOptionsResponse = (value: unknown): { readonly launchOptions: ChatLaunchOptions } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const launchOptions = parseChatLaunchOptions(value.launchOptions);
  if (!launchOptions) {
    return null;
  }
  return { launchOptions };
};

const parseSendMessageResponse = (value: unknown): SendMessageResponse | null => {
  if (!isRecord(value) || typeof value.turnId !== 'string') {
    return null;
  }
  return { turnId: value.turnId };
};

const parseInterruptResponse = (value: unknown): InterruptTurnResponse | null => {
  if (!isRecord(value) || typeof value.interrupted !== 'boolean' || typeof value.turnId !== 'string') {
    return null;
  }
  return {
    interrupted: value.interrupted,
    turnId: value.turnId,
  };
};

const parseRespondApprovalResponse = (value: unknown): RespondChatApprovalResponse | null => {
  if (!isRecord(value) || typeof value.itemId !== 'string' || typeof value.decision !== 'string') {
    return null;
  }
  if (value.decision !== 'accept' && value.decision !== 'decline') {
    return null;
  }
  return {
    itemId: value.itemId,
    decision: value.decision,
  };
};

const parseRespondUserInputResponse = (value: unknown): RespondChatUserInputResponse | null => {
  if (!isRecord(value) || typeof value.itemId !== 'string') {
    return null;
  }
  return {
    itemId: value.itemId,
  };
};

/**
 * チャット一覧を取得する。
 */
export const listChats = async () => {
  return requestJson('/api/chats', { method: 'GET' }, parseChatsResponse);
};

/**
 * 新規チャット作成で使うモデル/cwd 候補を取得する。
 */
export const getChatLaunchCatalog = async () => {
  return requestJson('/api/chat-options', { method: 'GET' }, parseLaunchCatalogResponse);
};

/**
 * 新規チャットを作成する。
 * @param payload 作成時の launch options
 */
export const createChat = async (payload: CreateChatRequest) => {
  return requestJson(
    '/api/chats',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseChatResponse,
  );
};

/**
 * チャット履歴を取得する。
 * @param id thread ID
 */
export const getChat = async (id: string) => {
  return requestJson(`/api/chats/${encodeURIComponent(id)}`, { method: 'GET' }, parseChatDetailResponse);
};

/**
 * チャットの model/effort 設定を更新する。
 * @param id thread ID
 * @param payload 更新内容
 */
export const updateChatLaunchOptions = async (
  id: string,
  payload: UpdateChatLaunchOptionsRequest,
) => {
  return requestJson(
    `/api/chats/${encodeURIComponent(id)}/options`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseLaunchOptionsResponse,
  );
};

/**
 * ユーザーメッセージを送信する。
 * @param id thread ID
 * @param text 送信テキスト
 */
export const sendChatMessage = async (id: string, text: string) => {
  return requestJson(
    `/api/chats/${encodeURIComponent(id)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    },
    parseSendMessageResponse,
  );
};

/**
 * 実行中 turn を中断する。
 * @param id thread ID
 * @param turnId 中断対象 turn ID
 */
export const interruptTurn = async (id: string, turnId: string | null) => {
  return requestJson(
    `/api/chats/${encodeURIComponent(id)}/interrupt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId }),
    },
    parseInterruptResponse,
  );
};

/**
 * 承認要求に accept/decline を返す。
 * @param id thread ID
 * @param itemId 承認対象 item ID
 * @param payload 応答内容
 */
export const respondChatApproval = async (
  id: string,
  itemId: string,
  payload: RespondChatApprovalRequest,
) => {
  return requestJson(
    `/api/chats/${encodeURIComponent(id)}/approvals/${encodeURIComponent(itemId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseRespondApprovalResponse,
  );
};

/**
 * user input 要求へ回答を返す。
 * @param id thread ID
 * @param itemId 対象 item ID
 * @param payload 回答内容
 */
export const respondChatUserInput = async (
  id: string,
  itemId: string,
  payload: RespondChatUserInputRequest,
) => {
  return requestJson(
    `/api/chats/${encodeURIComponent(id)}/user-input/${encodeURIComponent(itemId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseRespondUserInputResponse,
  );
};
