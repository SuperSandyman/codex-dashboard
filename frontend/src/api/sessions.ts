import { requestJson } from './client';

export type SessionTool = 'codex' | 'opencode';

export type SessionStatus = 'running' | 'exited' | 'error';

export interface SessionInfo {
  readonly id: string;
  readonly tool: SessionTool;
  readonly workspaceId: string | null;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly exitCode?: number;
}

export interface CreateSessionRequest {
  readonly tool: SessionTool;
  readonly workspaceId: string | null;
}

interface SessionsResponse {
  readonly sessions: SessionInfo[];
}

interface SessionResponse {
  readonly session: SessionInfo;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const isSessionTool = (value: unknown): value is SessionTool => {
  return value === 'codex' || value === 'opencode';
};

const isSessionStatus = (value: unknown): value is SessionStatus => {
  return value === 'running' || value === 'exited' || value === 'error';
};

const parseSessionInfo = (value: unknown): SessionInfo | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== 'string' ||
    !isSessionTool(value.tool) ||
    (value.workspaceId !== null && typeof value.workspaceId !== 'string') ||
    !isSessionStatus(value.status) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  if (value.exitCode !== undefined && typeof value.exitCode !== 'number') {
    return null;
  }

  return {
    id: value.id,
    tool: value.tool,
    workspaceId: value.workspaceId,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    exitCode: value.exitCode,
  };
};

const parseSessionsResponse = (value: unknown): SessionsResponse | null => {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    return null;
  }

  const sessions: SessionInfo[] = [];
  for (const entry of value.sessions) {
    const parsed = parseSessionInfo(entry);
    if (!parsed) {
      return null;
    }
    sessions.push(parsed);
  }

  return { sessions };
};

const parseSessionResponse = (value: unknown): SessionResponse | null => {
  if (!isRecord(value)) {
    return null;
  }
  const session = parseSessionInfo(value.session);
  if (!session) {
    return null;
  }
  return { session };
};

/**
 * セッション一覧を取得する。
 */
export const listSessions = async () => {
  return requestJson('/api/sessions', { method: 'GET' }, parseSessionsResponse);
};

/**
 * セッションを作成する。
 * @param request 作成リクエスト
 */
export const createSession = async (request: CreateSessionRequest) => {
  return requestJson(
    '/api/sessions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
    parseSessionResponse,
  );
};

/**
 * セッションを終了させる。
 * @param id セッションID
 */
export const deleteSession = async (id: string) => {
  return requestJson(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }, parseSessionResponse);
};
