import { requestJson } from './client';

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ChatLaunchOptions {
  readonly model: string | null;
  readonly effort: string | null;
  readonly cwd: string | null;
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
}

export interface UpdateChatLaunchOptionsRequest {
  readonly model: string | null;
  readonly effort: string | null;
}

export interface SendMessageResponse {
  readonly turnId: string;
}

export interface InterruptTurnResponse {
  readonly interrupted: boolean;
  readonly turnId: string;
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

const parseChatLaunchOptions = (value: unknown): ChatLaunchOptions | null => {
  if (value === null || value === undefined) {
    return {
      model: null,
      effort: null,
      cwd: null,
    };
  }
  if (!isRecord(value)) {
    return null;
  }
  const model = parseNullableString(value.model);
  const effort = parseNullableString(value.effort);
  const cwd = parseNullableString(value.cwd);
  if ((value.model !== undefined && value.model !== null && model === null) || (value.effort !== undefined && value.effort !== null && effort === null) || (value.cwd !== undefined && value.cwd !== null && cwd === null)) {
    return null;
  }
  return {
    model,
    effort,
    cwd,
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

  return {
    models,
    workspaceRoot: value.workspaceRoot,
    cwdChoices,
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
