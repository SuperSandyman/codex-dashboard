import type { ChatMessage, ChatSummary } from '../../api/chats';
import type { ChatStreamEvent } from './protocol';

const LOCAL_USER_ID_PREFIX = 'local-user-';

const replaceMessageAt = (messages: readonly ChatMessage[], index: number, next: ChatMessage): ChatMessage[] => {
  const copy = [...messages];
  copy[index] = next;
  return copy;
};

const upsertMessage = (messages: readonly ChatMessage[], next: ChatMessage): ChatMessage[] => {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) {
    return [...messages, next];
  }
  return replaceMessageAt(messages, index, next);
};

const findOptimisticUserMessageIndex = (
  messages: readonly ChatMessage[],
  threadId: string,
  text: string,
): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.threadId === threadId &&
      message.role === 'user' &&
      message.turnId === null &&
      message.id.startsWith(LOCAL_USER_ID_PREFIX) &&
      message.text === text
    ) {
      return index;
    }
  }
  return -1;
};

/**
 * optimistic なユーザーメッセージを追加する。
 * @param messages 既存メッセージ
 * @param threadId thread ID
 * @param text 送信テキスト
 */
export const addOptimisticUserMessage = (
  messages: readonly ChatMessage[],
  threadId: string,
  text: string,
): ChatMessage[] => {
  const optimistic: ChatMessage = {
    id: `${LOCAL_USER_ID_PREFIX}${Date.now()}`,
    threadId,
    turnId: null,
    role: 'user',
    kind: 'userMessage',
    text,
    status: null,
  };
  return [...messages, optimistic];
};

/**
 * ストリーミングイベントをメッセージ配列へ反映する。
 * @param messages 現在のメッセージ
 * @param event ストリームイベント
 */
export const applyStreamEventToMessages = (
  messages: readonly ChatMessage[],
  event: ChatStreamEvent,
): ChatMessage[] => {
  switch (event.type) {
    case 'ready':
    case 'turn_started':
    case 'approval_requested':
    case 'approval_resolved':
    case 'user_input_requested':
    case 'user_input_resolved':
      return [...messages];
    case 'item_started':
    case 'item_updated': {
      if (event.message.role === 'user') {
        const optimisticIndex = findOptimisticUserMessageIndex(messages, event.threadId, event.message.text);
        if (optimisticIndex >= 0) {
          return replaceMessageAt(messages, optimisticIndex, event.message);
        }
      }
      return upsertMessage(messages, event.message);
    }
    case 'message_delta': {
      const existingIndex = messages.findIndex((message) => message.id === event.itemId);
      if (existingIndex < 0) {
        return [
          ...messages,
          {
            id: event.itemId,
            threadId: event.threadId,
            turnId: event.turnId,
            role: event.role,
            kind: event.kind,
            text: event.delta,
            status: 'inProgress',
          },
        ];
      }

      const current = messages[existingIndex];
      return replaceMessageAt(messages, existingIndex, {
        ...current,
        text: `${current.text}${event.delta}`,
        role: event.role,
        kind: event.kind,
        turnId: event.turnId,
        status: current.status ?? 'inProgress',
      });
    }
    case 'turn_completed': {
      const updated = messages.map((message) => {
        if (message.turnId !== event.turnId) {
          return message;
        }
        return {
          ...message,
          status: event.status,
        };
      });

      if (event.status === 'failed' && event.errorMessage) {
        const errorMessage: ChatMessage = {
          id: `turn-error-${event.turnId}`,
          threadId: event.threadId,
          turnId: event.turnId,
          role: 'system',
          kind: 'error',
          text: event.errorMessage,
          status: 'failed',
        };
        return upsertMessage(updated, errorMessage);
      }

      return updated;
    }
    case 'error': {
      const message: ChatMessage = {
        id: `stream-error-${Date.now()}`,
        threadId: event.threadId,
        turnId: null,
        role: 'system',
        kind: 'error',
        text: event.error.message,
        status: 'failed',
      };
      return [...messages, message];
    }
    default:
      return [...messages];
  }
};

/**
 * チャット一覧を更新日時の降順でソートする。
 * @param chats チャット一覧
 */
export const sortChatsByUpdatedAt = (chats: readonly ChatSummary[]): ChatSummary[] => {
  return [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

/**
 * チャットの preview/updatedAt を更新し、先頭へ移動する。
 * @param chats チャット一覧
 * @param threadId thread ID
 * @param preview 最新 preview
 */
export const touchChatSummary = (
  chats: readonly ChatSummary[],
  threadId: string,
  preview: string | null,
): ChatSummary[] => {
  const now = new Date().toISOString();
  const next = chats.map((chat) => {
    if (chat.id !== threadId) {
      return chat;
    }

    const hasFixedPreview = chat.preview.trim().length > 0 && chat.preview !== '(untitled)';
    const nextPreview =
      preview !== null && !hasFixedPreview
        ? preview
        : chat.preview;

    return {
      ...chat,
      updatedAt: now,
      preview: nextPreview,
    };
  });
  return sortChatsByUpdatedAt(next);
};
