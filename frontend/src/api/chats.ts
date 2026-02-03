import { requestJson } from './client';

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ChatSummary {
  readonly id: string;
  readonly preview: string;
  readonly modelProvider: string;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
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
  return {
    id: value.id,
    preview: value.preview,
    modelProvider: value.modelProvider,
    source: value.source,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
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
 * 新規チャットを作成する。
 */
export const createChat = async () => {
  return requestJson('/api/chats', { method: 'POST' }, parseChatResponse);
};

/**
 * チャット履歴を取得する。
 * @param id thread ID
 */
export const getChat = async (id: string) => {
  return requestJson(`/api/chats/${encodeURIComponent(id)}`, { method: 'GET' }, parseChatDetailResponse);
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
