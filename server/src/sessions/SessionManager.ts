import { randomUUID } from 'node:crypto';

import type { RawData, WebSocket } from 'ws';

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
      entry.info = {
        ...entry.info,
        status: 'exited',
        exitCode,
        updatedAt: new Date().toISOString(),
      };
      this.#clearIdleTimer(entry);
      this.#broadcast(entry, { type: 'status', status: 'exited', exitCode });
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
      entry.pty.kill();
      entry.info = {
        ...entry.info,
        status: 'exited',
        updatedAt: new Date().toISOString(),
      };
      this.#clearIdleTimer(entry);
      this.#broadcast(entry, { type: 'status', status: 'exited' });
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
    this.#sendToClient(ws, { type: 'status', status: entry.info.status, exitCode: entry.info.exitCode });

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
      this.#sendToClient(ws, {
        type: 'error',
        error: { code: 'invalid_message', message: 'JSON の解析に失敗しました。' },
      });
      return;
    }

    const message = this.#parseClientMessage(parsed);
    if (!message) {
      this.#sendToClient(ws, {
        type: 'error',
        error: { code: 'invalid_message', message: '不正なメッセージ形式です。' },
      });
      return;
    }

    switch (message.type) {
      case 'input':
        if (entry.info.status !== 'running') {
          this.#sendToClient(ws, {
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
          this.#sendToClient(ws, {
            type: 'error',
            error: { code: 'session_inactive', message: 'セッションが終了しています。' },
          });
          return;
        }
        entry.pty.resize(message.cols, message.rows);
        this.#touchSession(entry);
        break;
      case 'snapshot':
        this.#sendToClient(ws, { type: 'snapshot', data: entry.logBuffer.snapshot() });
        break;
      default:
        this.#sendToClient(ws, {
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

  #touchSession(entry: SessionEntry): void {
    entry.info = {
      ...entry.info,
      updatedAt: new Date().toISOString(),
    };
    this.#setupIdleTimer(entry);
  }

  #setupIdleTimer(entry: SessionEntry): void {
    if (this.#idleTimeoutMs <= 0) {
      return;
    }

    this.#clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      if (entry.info.status === 'running') {
        entry.pty.kill();
        entry.info = {
          ...entry.info,
          status: 'exited',
          updatedAt: new Date().toISOString(),
        };
        this.#broadcast(entry, { type: 'status', status: 'exited' });
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
      this.#sendToClient(client, message);
    }
  }

  #sendToClient(client: WebSocket, message: SessionServerMessage): void {
    client.send(JSON.stringify(message));
  }
}

/**
 * セッション作成時に許可する tool 名か判定する。
 * @param tool tool 名
 */
export const isAllowedSessionTool = (tool: string): tool is SessionTool => {
  return tool === 'codex' || tool === 'opencode';
};
