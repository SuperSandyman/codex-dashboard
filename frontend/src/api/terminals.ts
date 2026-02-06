import { requestJson } from './client';

export type TerminalStatus = 'running' | 'exited' | 'error';

export interface TerminalProfile {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface TerminalSummary {
  readonly id: string;
  readonly profileId: string;
  readonly cwd: string;
  readonly status: TerminalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastOutput: string;
  readonly exitCode: number | null;
  readonly signal: number | null;
}

export interface TerminalSnapshot extends TerminalSummary {
  readonly snapshot: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalCatalog {
  readonly workspaceRoot: string | null;
  readonly cwdChoices: string[];
  readonly profiles: TerminalProfile[];
}

export interface CreateTerminalRequest {
  readonly profile: string | null;
  readonly cwd: string | null;
  readonly cols: number | null;
  readonly rows: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const parseStatus = (value: unknown): TerminalStatus | null => {
  if (value === 'running' || value === 'exited' || value === 'error') {
    return value;
  }
  return null;
};

const parseTerminalProfile = (value: unknown): TerminalProfile | null => {
  if (!isRecord(value) || !Array.isArray(value.args)) {
    return null;
  }
  if (typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.command !== 'string') {
    return null;
  }

  const args: string[] = [];
  for (const entry of value.args) {
    if (typeof entry !== 'string') {
      return null;
    }
    args.push(entry);
  }

  return {
    id: value.id,
    label: value.label,
    command: value.command,
    args,
  };
};

const parseTerminalSummary = (value: unknown): TerminalSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  const status = parseStatus(value.status);
  if (!status) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.profileId !== 'string' ||
    typeof value.cwd !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    typeof value.lastOutput !== 'string' ||
    (value.exitCode !== null && typeof value.exitCode !== 'number') ||
    (value.signal !== null && typeof value.signal !== 'number')
  ) {
    return null;
  }

  return {
    id: value.id,
    profileId: value.profileId,
    cwd: value.cwd,
    status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastOutput: value.lastOutput,
    exitCode: value.exitCode,
    signal: value.signal,
  };
};

const parseTerminalSnapshot = (value: unknown): TerminalSnapshot | null => {
  const summary = parseTerminalSummary(value);
  if (!summary || !isRecord(value)) {
    return null;
  }
  if (typeof value.snapshot !== 'string' || typeof value.cols !== 'number' || typeof value.rows !== 'number') {
    return null;
  }

  return {
    ...summary,
    snapshot: value.snapshot,
    cols: value.cols,
    rows: value.rows,
  };
};

const parseTerminalCatalog = (value: unknown): TerminalCatalog | null => {
  if (!isRecord(value) || !Array.isArray(value.cwdChoices) || !Array.isArray(value.profiles)) {
    return null;
  }
  if (value.workspaceRoot !== null && typeof value.workspaceRoot !== 'string') {
    return null;
  }

  const cwdChoices: string[] = [];
  for (const entry of value.cwdChoices) {
    if (typeof entry !== 'string') {
      return null;
    }
    cwdChoices.push(entry);
  }

  const profiles: TerminalProfile[] = [];
  for (const entry of value.profiles) {
    const parsed = parseTerminalProfile(entry);
    if (!parsed) {
      return null;
    }
    profiles.push(parsed);
  }

  return {
    workspaceRoot: value.workspaceRoot,
    cwdChoices,
    profiles,
  };
};

const parseTerminalListResponse = (value: unknown): { readonly terminals: TerminalSummary[] } | null => {
  if (!isRecord(value) || !Array.isArray(value.terminals)) {
    return null;
  }
  const terminals: TerminalSummary[] = [];
  for (const entry of value.terminals) {
    const parsed = parseTerminalSummary(entry);
    if (!parsed) {
      return null;
    }
    terminals.push(parsed);
  }
  return { terminals };
};

const parseTerminalResponse = (value: unknown): { readonly terminal: TerminalSummary } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const terminal = parseTerminalSummary(value.terminal);
  if (!terminal) {
    return null;
  }
  return { terminal };
};

const parseTerminalSnapshotResponse = (value: unknown): { readonly terminal: TerminalSnapshot } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const terminal = parseTerminalSnapshot(value.terminal);
  if (!terminal) {
    return null;
  }
  return { terminal };
};

const parseOkResponse = (value: unknown): { readonly ok: boolean } | null => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return null;
  }
  return { ok: value.ok };
};

/**
 * ターミナル作成時の選択肢を取得する。
 */
export const getTerminalCatalog = async () => {
  return requestJson('/api/terminal-options', { method: 'GET' }, parseTerminalCatalog);
};

/**
 * ターミナル一覧を取得する。
 */
export const listTerminals = async () => {
  return requestJson('/api/terminals', { method: 'GET' }, parseTerminalListResponse);
};

/**
 * ターミナルを作成する。
 * @param payload 作成パラメータ
 */
export const createTerminal = async (payload: CreateTerminalRequest) => {
  return requestJson(
    '/api/terminals',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseTerminalResponse,
  );
};

/**
 * ターミナルのスナップショットを取得する。
 * @param id terminal ID
 */
export const getTerminal = async (id: string) => {
  return requestJson(
    `/api/terminals/${encodeURIComponent(id)}`,
    { method: 'GET' },
    parseTerminalSnapshotResponse,
  );
};

/**
 * ターミナルへ入力を送信する。
 * @param id terminal ID
 * @param data 入力文字列
 */
export const writeTerminal = async (id: string, data: string) => {
  return requestJson(
    `/api/terminals/${encodeURIComponent(id)}/write`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    },
    parseOkResponse,
  );
};

/**
 * ターミナルの表示サイズを更新する。
 * @param id terminal ID
 * @param cols カラム数
 * @param rows 行数
 */
export const resizeTerminal = async (id: string, cols: number, rows: number) => {
  return requestJson(
    `/api/terminals/${encodeURIComponent(id)}/resize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    },
    parseOkResponse,
  );
};

/**
 * ターミナルを終了する。
 * @param id terminal ID
 */
export const killTerminal = async (id: string) => {
  return requestJson(
    `/api/terminals/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    parseTerminalResponse,
  );
};
