import type { ChatDetail, ChatMessage, ChatRole, ChatSummary } from './dashboardTypes.js';

interface AppServerThreadListResult {
  readonly data: AppServerThread[];
  readonly nextCursor: string | null;
}

interface AppServerThreadReadResult {
  readonly thread: AppServerThread;
}

interface AppServerTurnStartResult {
  readonly turn: {
    readonly id: string;
  };
}

interface AppServerThread {
  readonly id: string;
  readonly preview: string;
  readonly modelProvider: string;
  readonly source: unknown;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly turns: AppServerTurn[];
}

interface AppServerTurn {
  readonly id: string;
  readonly status: string;
  readonly errorMessage: string | null;
  readonly items: AppServerThreadItem[];
}

interface AppServerThreadItem extends Record<string, unknown> {
  readonly id: string;
  readonly type: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const asString = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null;
};

const asNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const readString = (record: Record<string, unknown>, key: string): string | null => {
  return asString(record[key]);
};

const readNumber = (record: Record<string, unknown>, key: string): number | null => {
  return asNumber(record[key]);
};

const toIsoTimestamp = (unixSeconds: number): string => {
  return new Date(unixSeconds * 1000).toISOString();
};

const normalizeSource = (source: unknown): string => {
  if (typeof source === 'string') {
    return source;
  }
  if (isRecord(source) && source.subAgent) {
    return 'subAgent';
  }
  return 'unknown';
};

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const readPatchKind = (kind: unknown): string => {
  if (!isRecord(kind)) {
    return 'update';
  }
  const type = asString(kind.type);
  return type ?? 'update';
};

const toUserInputText = (content: unknown): string => {
  if (!isRecord(content)) {
    return '';
  }
  const type = asString(content.type);
  switch (type) {
    case 'text':
      return asString(content.text) ?? '';
    case 'image':
      return `[image] ${asString(content.url) ?? ''}`.trim();
    case 'localImage':
      return `[localImage] ${asString(content.path) ?? ''}`.trim();
    case 'skill':
      return `[skill] ${asString(content.name) ?? ''}`.trim();
    case 'mention':
      return `[mention] ${asString(content.name) ?? ''}`.trim();
    default:
      return '';
  }
};

const toMessageFromCommandExecution = (
  item: AppServerThreadItem,
  threadId: string,
  turnId: string,
): ChatMessage => {
  const command = asString(item.command) ?? '(unknown command)';
  const aggregatedOutput = asString(item.aggregatedOutput) ?? '';
  const status = asString(item.status);
  const exitCode =
    typeof item.exitCode === 'number' && Number.isFinite(item.exitCode)
      ? String(item.exitCode)
      : null;

  const parts = [`$ ${command}`];
  if (aggregatedOutput.length > 0) {
    parts.push(aggregatedOutput);
  }
  if (exitCode) {
    parts.push(`exitCode: ${exitCode}`);
  }

  return {
    id: item.id,
    threadId,
    turnId,
    role: 'tool',
    kind: 'commandExecution',
    text: parts.join('\n\n'),
    status,
  };
};

const toMessageFromFileChange = (
  item: AppServerThreadItem,
  threadId: string,
  turnId: string,
): ChatMessage => {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const lines = changes
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const path = asString(entry.path);
      if (!path) {
        return null;
      }
      return `${readPatchKind(entry.kind)}: ${path}`;
    })
    .filter((value): value is string => value !== null);

  const status = asString(item.status);
  return {
    id: item.id,
    threadId,
    turnId,
    role: 'tool',
    kind: 'fileChange',
    text: lines.length > 0 ? lines.join('\n') : 'file changes',
    status,
  };
};

const toMessageFromMcpToolCall = (
  item: AppServerThreadItem,
  threadId: string,
  turnId: string,
): ChatMessage => {
  const server = asString(item.server) ?? 'unknown';
  const tool = asString(item.tool) ?? 'unknown';
  const status = asString(item.status);
  const result = item.result !== undefined && item.result !== null ? formatJson(item.result) : '';
  const error = item.error !== undefined && item.error !== null ? formatJson(item.error) : '';
  const parts = [`${server}/${tool}`];
  if (result.length > 0) {
    parts.push(result);
  }
  if (error.length > 0) {
    parts.push(`error: ${error}`);
  }

  return {
    id: item.id,
    threadId,
    turnId,
    role: 'tool',
    kind: 'mcpToolCall',
    text: parts.join('\n\n'),
    status,
  };
};

const toFallbackSystemMessage = (
  item: AppServerThreadItem,
  threadId: string,
  turnId: string,
): ChatMessage => {
  return {
    id: item.id,
    threadId,
    turnId,
    role: 'system',
    kind: item.type,
    text: `${item.type}`,
    status: null,
  };
};

/**
 * app-server の ThreadItem をダッシュボード表示用メッセージへ変換する。
 * @param item app-server の item
 * @param threadId thread ID
 * @param turnId turn ID
 */
export const toChatMessageFromItem = (
  item: AppServerThreadItem,
  threadId: string,
  turnId: string,
): ChatMessage | null => {
  switch (item.type) {
    case 'userMessage': {
      const content = Array.isArray(item.content) ? item.content : [];
      const text = content.map(toUserInputText).filter((entry) => entry.length > 0).join('\n');
      return {
        id: item.id,
        threadId,
        turnId,
        role: 'user',
        kind: 'userMessage',
        text,
        status: null,
      };
    }
    case 'agentMessage': {
      const text = asString(item.text) ?? '';
      return {
        id: item.id,
        threadId,
        turnId,
        role: 'assistant',
        kind: 'agentMessage',
        text,
        status: null,
      };
    }
    case 'plan': {
      const text = asString(item.text) ?? '';
      return {
        id: item.id,
        threadId,
        turnId,
        role: 'system',
        kind: 'plan',
        text,
        status: null,
      };
    }
    case 'reasoning': {
      const summary = Array.isArray(item.summary)
        ? item.summary.map((entry) => asString(entry)).filter((entry): entry is string => entry !== null)
        : [];
      const content = Array.isArray(item.content)
        ? item.content.map((entry) => asString(entry)).filter((entry): entry is string => entry !== null)
        : [];
      const parts: string[] = [];
      if (summary.length > 0) {
        parts.push(summary.join('\n'));
      }
      if (content.length > 0) {
        parts.push(content.join('\n'));
      }
      return {
        id: item.id,
        threadId,
        turnId,
        role: 'system',
        kind: 'reasoning',
        text: parts.join('\n\n'),
        status: null,
      };
    }
    case 'commandExecution':
      return toMessageFromCommandExecution(item, threadId, turnId);
    case 'fileChange':
      return toMessageFromFileChange(item, threadId, turnId);
    case 'mcpToolCall':
      return toMessageFromMcpToolCall(item, threadId, turnId);
    default:
      return toFallbackSystemMessage(item, threadId, turnId);
  }
};

const parseThreadItem = (value: unknown): AppServerThreadItem | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  const type = asString(value.type);
  if (!id || !type) {
    return null;
  }
  return {
    ...value,
    id,
    type,
  };
};

const parseTurn = (value: unknown): AppServerTurn | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value, 'id');
  const status = readString(value, 'status');
  if (!id || !status) {
    return null;
  }
  const items: AppServerThreadItem[] = [];
  if (Array.isArray(value.items)) {
    value.items.forEach((entry) => {
      const parsed = parseThreadItem(entry);
      if (parsed) {
        items.push(parsed);
      }
    });
  }
  const errorMessage = isRecord(value.error) ? asString(value.error.message) : null;

  return {
    id,
    status,
    errorMessage,
    items,
  };
};

const parseThread = (value: unknown): AppServerThread | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value, 'id');
  const preview = readString(value, 'preview');
  const modelProvider = readString(value, 'modelProvider');
  const createdAt = readNumber(value, 'createdAt');
  const updatedAt = readNumber(value, 'updatedAt');
  if (!id || preview === null || modelProvider === null || createdAt === null || updatedAt === null) {
    return null;
  }

  const turns: AppServerTurn[] = [];
  if (Array.isArray(value.turns)) {
    value.turns.forEach((entry) => {
      const parsed = parseTurn(entry);
      if (parsed) {
        turns.push(parsed);
      }
    });
  }

  return {
    id,
    preview,
    modelProvider,
    source: value.source,
    createdAt,
    updatedAt,
    turns,
  };
};

/**
 * thread/list の result を検証して取り出す。
 * @param value RPC result
 */
export const parseThreadListResult = (value: unknown): AppServerThreadListResult | null => {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return null;
  }
  const threads: AppServerThread[] = [];
  for (const entry of value.data) {
    const parsed = parseThread(entry);
    if (!parsed) {
      return null;
    }
    threads.push(parsed);
  }

  const nextCursor = value.nextCursor === null ? null : asString(value.nextCursor);
  if (value.nextCursor !== null && nextCursor === null) {
    return null;
  }

  return {
    data: threads,
    nextCursor,
  };
};

/**
 * thread/read の result を検証して取り出す。
 * @param value RPC result
 */
export const parseThreadReadResult = (value: unknown): AppServerThreadReadResult | null => {
  if (!isRecord(value)) {
    return null;
  }
  const thread = parseThread(value.thread);
  if (!thread) {
    return null;
  }
  return { thread };
};

/**
 * thread/start の result を検証して取り出す。
 * @param value RPC result
 */
export const parseThreadStartResult = (value: unknown): AppServerThreadReadResult | null => {
  if (!isRecord(value)) {
    return null;
  }
  const thread = parseThread(value.thread);
  if (!thread) {
    return null;
  }
  return { thread };
};

/**
 * turn/start の result から turn ID を取り出す。
 * @param value RPC result
 */
export const parseTurnStartResult = (value: unknown): AppServerTurnStartResult | null => {
  if (!isRecord(value) || !isRecord(value.turn)) {
    return null;
  }
  const id = asString(value.turn.id);
  if (!id) {
    return null;
  }
  return {
    turn: { id },
  };
};

/**
 * app-server Thread をダッシュボード用 ChatSummary に変換する。
 * @param thread app-server Thread
 */
export const toChatSummary = (thread: AppServerThread): ChatSummary => {
  return {
    id: thread.id,
    preview: thread.preview,
    modelProvider: thread.modelProvider,
    source: normalizeSource(thread.source),
    createdAt: toIsoTimestamp(thread.createdAt),
    updatedAt: toIsoTimestamp(thread.updatedAt),
  };
};

/**
 * app-server Thread をダッシュボード用 ChatDetail に変換する。
 * @param thread app-server Thread
 */
export const toChatDetail = (thread: AppServerThread): ChatDetail => {
  const messages: ChatMessage[] = [];
  let activeTurnId: string | null = null;

  thread.turns.forEach((turn) => {
    if (turn.status === 'inProgress') {
      activeTurnId = turn.id;
    }
    turn.items.forEach((item) => {
      const message = toChatMessageFromItem(item, thread.id, turn.id);
      if (!message) {
        return;
      }
      messages.push(message);
    });
  });

  return {
    chat: toChatSummary(thread),
    messages,
    activeTurnId,
  };
};

/**
 * ダッシュボードで扱う role かを判定する。
 * @param value role 候補
 */
export const isChatRole = (value: unknown): value is ChatRole => {
  return value === 'user' || value === 'assistant' || value === 'tool' || value === 'system';
};

/**
 * 通知 payload から item を取り出す。
 * @param value 通知 payload
 */
export const parseNotificationItem = (value: unknown): AppServerThreadItem | null => {
  if (!isRecord(value)) {
    return null;
  }
  return parseThreadItem(value.item);
};

/**
 * 汎用 payload から record を取り出す。
 * @param value unknown 値
 */
export const parseRecord = (value: unknown): Record<string, unknown> | null => {
  return isRecord(value) ? value : null;
};

/**
 * payload record から文字列を取り出す。
 * @param payload record
 * @param key キー名
 */
export const parseStringField = (payload: Record<string, unknown>, key: string): string | null => {
  return readString(payload, key);
};
