import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react';

import type { ChatMessage } from '../../api/chats';
import { parseCommandExecutionText } from './parseCommandExecutionText';

const normalizeStatus = (value: string | null): string => {
  if (!value) {
    return '';
  }
  return value.replace(/[\s_-]/g, '').toLowerCase();
};

const toAssistantStatus = (
  status: string | null,
): ThreadMessageLike['status'] => {
  const normalized = normalizeStatus(status);
  if (normalized === 'running' || normalized === 'inprogress') {
    return { type: 'running' };
  }
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'interrupted') {
    return { type: 'incomplete', reason: 'cancelled' };
  }
  if (normalized === 'failed' || normalized === 'error') {
    return { type: 'incomplete', reason: 'error' };
  }
  return { type: 'complete', reason: 'stop' };
};

/**
 * assistant-ui の append message から送信用テキストを取り出す。
 * @param message assistant-ui runtime が返すユーザーメッセージ
 * @returns backend へ送る本文。テキストが無い場合は `null`
 */
export const toUserText = (message: AppendMessage): string | null => {
  if (message.role !== 'user') {
    return null;
  }

  const text = message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  return text.length > 0 ? text : null;
};

/**
 * backend のチャットメッセージを assistant-ui の thread message へ変換する。
 * @param message backend から受け取ったメッセージ
 * @returns assistant-ui 用の message 形式
 */
export const toThreadMessage = (message: ChatMessage): ThreadMessageLike => {
  const mappedRole: ThreadMessageLike['role'] =
    message.role === 'assistant' || message.role === 'user' || message.role === 'system'
      ? message.role
      : 'assistant';

  if (message.kind === 'reasoning' && mappedRole === 'assistant') {
    return {
      id: message.id,
      role: 'assistant',
      content: [{ type: 'reasoning', text: message.text || ' ' }],
      status: toAssistantStatus(message.status),
    };
  }

  if (message.kind === 'commandExecution') {
    const parsed = parseCommandExecutionText(message.text);
    const rendered = parsed
      ? [
          '```bash',
          `$ ${parsed.command}`,
          '```',
          '',
          '```text',
          parsed.output || '(empty)',
          '```',
          parsed.exitCode !== null ? `exitCode: ${parsed.exitCode}` : null,
        ]
          .filter((line): line is string => line !== null)
          .join('\n')
      : message.text;

    return {
      id: message.id,
      role: mappedRole === 'user' ? 'assistant' : mappedRole,
      content: [{ type: 'text', text: rendered }],
      ...(mappedRole === 'assistant' ? { status: toAssistantStatus(message.status) } : {}),
    };
  }

  if (mappedRole === 'assistant') {
    return {
      id: message.id,
      role: 'assistant',
      content: [{ type: 'text', text: message.text || ' ' }],
      status: toAssistantStatus(message.status),
    };
  }

  if (mappedRole === 'user') {
    return {
      id: message.id,
      role: 'user',
      content: [{ type: 'text', text: message.text || ' ' }],
    };
  }

  return {
    id: message.id,
    role: 'system',
    content: [{ type: 'text', text: message.text || ' ' }],
  };
};
