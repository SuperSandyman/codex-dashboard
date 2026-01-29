import { randomUUID } from 'node:crypto';

import { WebSocket, type RawData } from 'ws';

import { LogBuffer } from './logBuffer.js';
import { spawnPty } from './pty.js';
import type {
  ApiError,
  CreateSessionRequest,
  SessionClientMessage,
  SessionInfo,
  SessionServerMessage,
  SessionTool,
} from './types.js';

interface SessionEntry {
  info: SessionInfo;
  readonly pty: ReturnType<typeof spawnPty>['pty'];
  readonly logBuffer: LogBuffer;
  readonly clients: Set<WebSocket>;
  idleTimer: NodeJS.Timeout | null;
}

interface SessionManagerOptions {
  readonly workspaceRoot: string;
  readonly logBufferSize: number;
  readonly idleTimeoutMs: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MIN_COLS = 1;
const MIN_ROWS = 1;
const MAX_COLS = 500;
const MAX_ROWS = 500;

class SessionManagerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * PTY セッションを in-memory で管理する。
 */
export class SessionManager {
  readonly #sessions = new Map<string, SessionEntry>();
  readonly #workspaceRoot: string;
  readonly #logBufferSize: number;
  readonly #idleTimeoutMs: number;

  /**
   * PTY セッションマネージャを作成する。
   * @param options 初期化オプション
   */
  constructor(options: SessionManagerOptions) {
    this.#workspaceRoot = options.workspaceRoot;
    this.#logBufferSize = options.logBufferSize;
    this.#idleTimeoutMs = options.idleTimeoutMs;
  }

  /**
   * セッションを作成する。
   * @param request セッション作成リクエスト
   */
  create(request: CreateSessionRequest): SessionInfo {
    const now = new Date().toISOString();
    const id = randomUUID();

    const { pty } = spawnPty({
      tool: request.tool,
      cwd: this.#workspaceRoot,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });

    const info: SessionInfo = {
      id,
      tool: request.tool,
      workspaceId: request.workspaceId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };

    const entry: SessionEntry = {
      info,
      pty,
      logBuffer: new LogBuffer(this.#logBufferSize),
      clients: new Set<WebSocket>(),
      idleTimer: null,
    };

    this.#sessions.set(id, entry);

    pty.onData((data) => {
      entry.logBuffer.append(data);
      this.#touchSession(entry);
      this.#broadcast(entry, { type: 'output', data });
    });

    pty.onExit(({ exitCode }) => {
      this.#markExited(entry, exitCode);
    });

    this.#setupIdleTimer(entry);

    return info;
  }

  /**
   * セッション一覧を返す。
   */
  list(): SessionInfo[] {
    return [...this.#sessions.values()].map((entry) => entry.info);
  }

  /**
   * セッション情報を取得する。
   * @param id セッションID
   */
  get(id: string): SessionInfo | null {
    return this.#sessions.get(id)?.info ?? null;
  }

  /**
   * セッションが存在するか判定する。
   * @param id セッションID
   */
  has(id: string): boolean {
    return this.#sessions.has(id);
  }

  /**
   * セッションを終了させる。
   * @param id セッションID
   */
  kill(id: string): SessionInfo {
    const entry = this.#sessions.get(id);
    if (!entry) {
      throw new SessionManagerError('session_not_found', 'セッションが見つかりません。');
    }

    if (entry.info.status === 'running') {
      this.#requestKill(entry);
    }

    return entry.info;
  }

  /**
   * WebSocket をセッションに接続する。
   * @param id セッションID
   * @param ws 接続済み WebSocket
   */
  attachWebSocket(id: string, ws: WebSocket): void {
    const entry = this.#sessions.get(id);
    if (!entry) {
      ws.close(1008, 'session not found');
      return;
    }

    entry.clients.add(ws);
    const sent = this.#sendToClient(entry, ws, {
      type: 'status',
      status: entry.info.status,
      exitCode: entry.info.exitCode,
    });
    if (!sent) {
      ws.close(1011, 'failed to send');
      return;
    }

    ws.on('message', (raw) => {
      this.#handleClientMessage(entry, ws, raw);
    });

    ws.on('close', () => {
      entry.clients.delete(ws);
    });
  }

  /**
   * SessionManager 由来のエラーを API 用エラーに変換する。
   * @param error 捕捉したエラー
   */
  toApiError(error: unknown): ApiError {
    if (error instanceof SessionManagerError) {
      return { code: error.code, message: error.message };
    }

    const message = error instanceof Error ? error.message : '不明なエラーが発生しました。';
    return { code: 'internal_error', message };
  }

  #handleClientMessage(entry: SessionEntry, ws: WebSocket, raw: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      this.#sendToClient(entry, ws, {
        type: 'error',
        error: { code: 'invalid_message', message: 'JSON の解析に失敗しました。' },
      });
      return;
    }

    const message = this.#parseClientMessage(parsed);
    if (!message) {
      this.#sendToClient(entry, ws, {
        type: 'error',
        error: { code: 'invalid_message', message: '不正なメッセージ形式です。' },
      });
      return;
    }

    switch (message.type) {
      case 'input':
        if (entry.info.status !== 'running') {
          this.#sendToClient(entry, ws, {
            type: 'error',
            error: { code: 'session_inactive', message: 'セッションが終了しています。' },
          });
          return;
        }
        entry.pty.write(message.data);
        this.#touchSession(entry);
        break;
      case 'resize':
        if (entry.info.status !== 'running') {
          this.#sendToClient(entry, ws, {
            type: 'error',
            error: { code: 'session_inactive', message: 'セッションが終了しています。' },
          });
          return;
        }
        if (!this.#isValidResize(message.cols, message.rows)) {
          this.#sendToClient(entry, ws, {
            type: 'error',
            error: { code: 'invalid_message', message: 'cols/rows の値が不正です。' },
          });
          return;
        }
        entry.pty.resize(message.cols, message.rows);
        this.#touchSession(entry);
        break;
      case 'snapshot':
        this.#sendToClient(entry, ws, { type: 'snapshot', data: entry.logBuffer.snapshot() });
        break;
      default:
        this.#sendToClient(entry, ws, {
          type: 'error',
          error: { code: 'invalid_message', message: '不明なメッセージタイプです。' },
        });
        break;
    }
  }

  #parseClientMessage(payload: unknown): SessionClientMessage | null {
    if (!this.#isRecord(payload) || typeof payload.type !== 'string') {
      return null;
    }

    switch (payload.type) {
      case 'input':
        if (typeof payload.data !== 'string') {
          return null;
        }
        return { type: 'input', data: payload.data };
      case 'resize':
        if (typeof payload.cols !== 'number' || typeof payload.rows !== 'number') {
          return null;
        }
        return { type: 'resize', cols: payload.cols, rows: payload.rows };
      case 'snapshot':
        return { type: 'snapshot' };
      default:
        return null;
    }
  }

  #isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
  }

  #isValidResize(cols: number, rows: number): boolean {
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
      return false;
    }
    if (cols < MIN_COLS || rows < MIN_ROWS) {
      return false;
    }
    if (cols > MAX_COLS || rows > MAX_ROWS) {
      return false;
    }
    return true;
  }

  #touchSession(entry: SessionEntry): void {
    entry.info = {
      ...entry.info,
      updatedAt: new Date().toISOString(),
    };
    this.#setupIdleTimer(entry);
  }

  #requestKill(entry: SessionEntry): void {
    this.#clearIdleTimer(entry);
    try {
      entry.pty.kill();
    } catch (error) {
      console.error('failed to kill pty session', { sessionId: entry.info.id, error });
    }
  }

  #markExited(entry: SessionEntry, exitCode?: number): void {
    if (entry.info.status === 'exited') {
      return;
    }

    entry.info = {
      ...entry.info,
      status: 'exited',
      exitCode,
      updatedAt: new Date().toISOString(),
    };
    this.#clearIdleTimer(entry);
    this.#broadcast(entry, { type: 'status', status: 'exited', exitCode });
  }

  #setupIdleTimer(entry: SessionEntry): void {
    if (this.#idleTimeoutMs <= 0) {
      return;
    }

    this.#clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      if (entry.info.status === 'running') {
        this.#requestKill(entry);
      }
    }, this.#idleTimeoutMs);
  }

  #clearIdleTimer(entry: SessionEntry): void {
    if (!entry.idleTimer) {
      return;
    }

    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  #broadcast(entry: SessionEntry, message: SessionServerMessage): void {
    for (const client of entry.clients) {
      this.#sendToClient(entry, client, message);
    }
  }

  #sendToClient(entry: SessionEntry, client: WebSocket, message: SessionServerMessage): boolean {
    if (client.readyState !== WebSocket.OPEN) {
      entry.clients.delete(client);
      return false;
    }

    try {
      client.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('failed to send ws message', { sessionId: entry.info.id, error });
      entry.clients.delete(client);
      return false;
    }
  }
}

/**
 * セッション作成時に許可する tool 名か判定する。
 * @param tool tool 名
 */
export const isAllowedSessionTool = (tool: string): tool is SessionTool => {
  return tool === 'codex' || tool === 'opencode';
};
