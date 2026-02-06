import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { IPty } from 'node-pty';
import { spawn } from 'node-pty';
import type { WebSocket } from 'ws';

import type {
  TerminalCatalog,
  TerminalClientEvent,
  TerminalErrorEvent,
  TerminalOutputEvent,
  TerminalProfile,
  TerminalReadyEvent,
  TerminalSnapshot,
  TerminalStatus,
  TerminalStatusEvent,
  TerminalSummary,
  TerminalStreamEvent,
} from './types.js';

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;
const MIN_COLS = 20;
const MAX_COLS = 400;
const MIN_ROWS = 10;
const MAX_ROWS = 200;
const MAX_SNAPSHOT_LENGTH = 120000;
const MAX_LAST_OUTPUT_LENGTH = 160;
const MAX_CLIENT_MESSAGE_LENGTH = 8192;
const WS_READY_OPEN = 1;

interface SessionManagerOptions {
  readonly workspaceRoot: string | null;
  readonly idleTimeoutMs: number;
}

interface CreateTerminalInput {
  readonly profile: string | null;
  readonly cwd: string | null;
  readonly cols?: number | null;
  readonly rows?: number | null;
}

interface SessionRecord {
  readonly id: string;
  readonly profile: TerminalProfile;
  readonly cwd: string;
  readonly createdAt: string;
  status: TerminalStatus;
  updatedAt: string;
  lastOutput: string;
  snapshot: string;
  exitCode: number | null;
  signal: number | null;
  cols: number;
  rows: number;
  readonly pty: IPty;
  readonly clients: Set<WebSocket>;
  idleTimer: NodeJS.Timeout | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const isFiniteInteger = (value: unknown): value is number => {
  return Number.isInteger(value) && Number.isFinite(value);
};

const normalizeSizeValue = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const normalizeTerminalSize = (cols?: number | null, rows?: number | null): { cols: number; rows: number } => {
  const resolvedCols = isFiniteInteger(cols)
    ? normalizeSizeValue(cols, MIN_COLS, MAX_COLS)
    : DEFAULT_COLS;
  const resolvedRows = isFiniteInteger(rows)
    ? normalizeSizeValue(rows, MIN_ROWS, MAX_ROWS)
    : DEFAULT_ROWS;
  return {
    cols: resolvedCols,
    rows: resolvedRows,
  };
};

const clipTail = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(value.length - maxLength);
};

export class TerminalSessionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'TerminalSessionError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Operations Terminal の in-memory セッションを管理する。
 * - 起動コマンドは allowlist プロファイルのみ許可
 * - cwd は WORKSPACE_ROOT 配下に限定
 * - 再接続用の出力スナップショットを保持
 */
export class TerminalSessionManager {
  readonly #workspaceRoot: string | null;
  readonly #idleTimeoutMs: number;
  readonly #profiles: readonly TerminalProfile[];
  readonly #sessionById: Map<string, SessionRecord>;

  constructor(options: SessionManagerOptions) {
    this.#workspaceRoot = options.workspaceRoot;
    this.#idleTimeoutMs = options.idleTimeoutMs;
    this.#profiles = this.#buildProfiles();
    this.#sessionById = new Map();
  }

  /**
   * ターミナル作成時の UI 選択肢を返す。
   */
  async getCatalog(): Promise<TerminalCatalog> {
    const cwdChoices = await this.#resolveCwdChoices();
    return {
      workspaceRoot: this.#workspaceRoot,
      cwdChoices,
      profiles: this.#profiles,
    };
  }

  /**
   * 実行中/終了済みターミナルの一覧を返す。
   */
  list(): TerminalSummary[] {
    return Array.from(this.#sessionById.values())
      .map((session) => this.#toSummary(session))
      .sort((a, b) => {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }

  /**
   * 新しいターミナルセッションを作成して起動する。
   * @param payload 作成パラメータ
   */
  async create(payload: CreateTerminalInput): Promise<TerminalSummary> {
    const profile = this.#resolveProfile(payload.profile);
    const cwd = await this.#resolveCwd(payload.cwd);
    const { cols, rows } = normalizeTerminalSize(payload.cols, payload.rows);
    const id = randomUUID();
    const now = new Date().toISOString();

    let pty: IPty;
    try {
      pty = spawn(profile.command, [...profile.args], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to start terminal process';
      throw new TerminalSessionError('terminal_spawn_failed', message, 500);
    }

    const session: SessionRecord = {
      id,
      profile,
      cwd,
      createdAt: now,
      status: 'running',
      updatedAt: now,
      lastOutput: '',
      snapshot: '',
      exitCode: null,
      signal: null,
      cols,
      rows,
      pty,
      clients: new Set(),
      idleTimer: null,
    };

    pty.onData((data) => {
      this.#onOutput(session, data);
    });

    pty.onExit((event) => {
      this.#onExit(session, event.exitCode, event.signal);
    });

    this.#sessionById.set(id, session);
    return this.#toSummary(session);
  }

  /**
   * セッション要約とスナップショットを返す。
   * @param terminalId セッション ID
   */
  snapshot(terminalId: string): TerminalSnapshot {
    const session = this.#sessionById.get(terminalId);
    if (!session) {
      throw new TerminalSessionError('terminal_not_found', 'terminal が見つかりません。', 404);
    }
    return {
      id: session.id,
      profileId: session.profile.id,
      cwd: session.cwd,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      snapshot: session.snapshot,
      cols: session.cols,
      rows: session.rows,
      exitCode: session.exitCode,
      signal: session.signal,
    };
  }

  /**
   * セッションへ入力を送信する。
   * @param terminalId セッション ID
   * @param input 入力文字列
   */
  write(terminalId: string, input: string): void {
    if (input.length === 0) {
      throw new TerminalSessionError('invalid_payload', 'input は空にできません。', 400);
    }

    const session = this.#sessionById.get(terminalId);
    if (!session) {
      throw new TerminalSessionError('terminal_not_found', 'terminal が見つかりません。', 404);
    }
    if (session.status !== 'running') {
      throw new TerminalSessionError('terminal_not_running', 'terminal はすでに終了しています。', 409);
    }

    session.pty.write(input);
    session.updatedAt = new Date().toISOString();
  }

  /**
   * セッションの表示サイズを更新する。
   * @param terminalId セッション ID
   * @param cols カラム数
   * @param rows 行数
   */
  resize(terminalId: string, cols: number, rows: number): void {
    if (!isFiniteInteger(cols) || !isFiniteInteger(rows)) {
      throw new TerminalSessionError('invalid_payload', 'cols と rows は整数で指定してください。', 400);
    }

    const session = this.#sessionById.get(terminalId);
    if (!session) {
      throw new TerminalSessionError('terminal_not_found', 'terminal が見つかりません。', 404);
    }

    const normalizedCols = normalizeSizeValue(cols, MIN_COLS, MAX_COLS);
    const normalizedRows = normalizeSizeValue(rows, MIN_ROWS, MAX_ROWS);

    if (session.status === 'running') {
      session.pty.resize(normalizedCols, normalizedRows);
    }

    session.cols = normalizedCols;
    session.rows = normalizedRows;
    session.updatedAt = new Date().toISOString();
  }

  /**
   * セッションを明示終了する。
   * @param terminalId セッション ID
   */
  kill(terminalId: string): TerminalSummary {
    const session = this.#sessionById.get(terminalId);
    if (!session) {
      throw new TerminalSessionError('terminal_not_found', 'terminal が見つかりません。', 404);
    }

    if (session.status === 'running') {
      session.pty.kill();
    }

    if (session.status === 'running') {
      session.status = 'exited';
      session.updatedAt = new Date().toISOString();
      this.#broadcast(session, {
        type: 'status',
        terminalId: session.id,
        status: 'exited',
        exitCode: session.exitCode,
        signal: session.signal,
      });
    }

    return this.#toSummary(session);
  }

  /**
   * WebSocket クライアントをセッションに接続する。
   * @param terminalId セッション ID
   * @param ws 接続済み WebSocket
   */
  attachWebSocket(terminalId: string, ws: WebSocket): void {
    const session = this.#sessionById.get(terminalId);
    if (!session) {
      throw new TerminalSessionError('terminal_not_found', 'terminal が見つかりません。', 404);
    }

    this.#clearIdleTimer(session);
    session.clients.add(ws);

    const readyEvent: TerminalReadyEvent = {
      type: 'ready',
      terminalId: session.id,
      status: session.status,
      snapshot: session.snapshot,
      cols: session.cols,
      rows: session.rows,
      exitCode: session.exitCode,
      signal: session.signal,
    };
    this.#sendToSocket(ws, readyEvent);

    ws.on('message', (raw) => {
      const payload = this.#parseClientEvent(raw.toString());
      if (!payload) {
        this.#sendToSocket(ws, {
          type: 'error',
          terminalId: session.id,
          error: {
            code: 'invalid_payload',
            message: '不正な terminal event を受信しました。',
          },
        });
        return;
      }

      try {
        if (payload.type === 'input') {
          this.write(session.id, payload.data);
          return;
        }
        this.resize(session.id, payload.cols, payload.rows);
      } catch (error) {
        this.#sendError(ws, session.id, error);
      }
    });

    ws.on('close', () => {
      session.clients.delete(ws);
      if (session.clients.size === 0 && session.status === 'running') {
        this.#scheduleIdleKill(session);
      }
    });

    ws.on('error', () => {
      session.clients.delete(ws);
      if (session.clients.size === 0 && session.status === 'running') {
        this.#scheduleIdleKill(session);
      }
    });
  }

  /**
   * サーバ終了時に全セッションを明示終了する。
   */
  dispose(): void {
    for (const session of this.#sessionById.values()) {
      this.#clearIdleTimer(session);
      if (session.status === 'running') {
        try {
          session.pty.kill();
        } catch {
          // noop
        }
      }
      for (const ws of session.clients) {
        try {
          ws.close(1001, 'server_shutdown');
        } catch {
          // noop
        }
      }
      session.clients.clear();
    }
  }

  #buildProfiles(): readonly TerminalProfile[] {
    const profiles: TerminalProfile[] = [];

    if (process.platform === 'win32') {
      profiles.push({
        id: 'powershell',
        label: 'PowerShell',
        command: 'powershell.exe',
        args: ['-NoLogo'],
      });
      return profiles;
    }

    profiles.push({
      id: 'bash',
      label: 'Bash',
      command: '/bin/bash',
      args: ['-l'],
    });

    profiles.push({
      id: 'zsh',
      label: 'Zsh',
      command: '/bin/zsh',
      args: ['-l'],
    });

    profiles.push({
      id: 'codex',
      label: 'Codex CLI',
      command: 'codex',
      args: [],
    });

    profiles.push({
      id: 'opencode',
      label: 'OpenCode CLI',
      command: 'opencode',
      args: [],
    });

    return profiles;
  }

  async #resolveCwdChoices(): Promise<string[]> {
    if (!this.#workspaceRoot) {
      return [];
    }

    const entries: string[] = [this.#workspaceRoot];
    try {
      const dirEntries = await fs.readdir(this.#workspaceRoot, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }
        entries.push(path.join(this.#workspaceRoot, entry.name));
      }
    } catch {
      return [this.#workspaceRoot];
    }

    return entries;
  }

  #resolveProfile(profileId: string | null): TerminalProfile {
    if (this.#profiles.length === 0) {
      throw new TerminalSessionError('terminal_profile_unavailable', '利用可能な profile がありません。', 500);
    }

    if (!profileId) {
      return this.#profiles[0];
    }

    const resolved = this.#profiles.find((profile) => profile.id === profileId);
    if (!resolved) {
      throw new TerminalSessionError('invalid_payload', '不正な profile が指定されました。', 400);
    }
    return resolved;
  }

  async #resolveCwd(requestedCwd: string | null): Promise<string> {
    if (!this.#workspaceRoot) {
      throw new TerminalSessionError(
        'workspace_root_required',
        'TERMINAL 作成には WORKSPACE_ROOT の設定が必要です。',
        400,
      );
    }

    const rootRealPath = await fs.realpath(this.#workspaceRoot);
    const rootWithSep = rootRealPath.endsWith(path.sep) ? rootRealPath : `${rootRealPath}${path.sep}`;

    const targetRaw = requestedCwd ?? rootRealPath;
    if (!path.isAbsolute(targetRaw)) {
      throw new TerminalSessionError('invalid_payload', 'cwd は絶対パスで指定してください。', 400);
    }

    const targetRealPath = await fs.realpath(targetRaw).catch(() => {
      throw new TerminalSessionError('invalid_payload', 'cwd が存在しません。', 400);
    });

    if (targetRealPath !== rootRealPath && !targetRealPath.startsWith(rootWithSep)) {
      throw new TerminalSessionError(
        'invalid_payload',
        'cwd は WORKSPACE_ROOT 配下のみ指定できます。',
        400,
      );
    }

    return targetRealPath;
  }

  #toSummary(session: SessionRecord): TerminalSummary {
    return {
      id: session.id,
      profileId: session.profile.id,
      cwd: session.cwd,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastOutput: session.lastOutput,
      exitCode: session.exitCode,
      signal: session.signal,
    };
  }

  #onOutput(session: SessionRecord, data: string): void {
    session.updatedAt = new Date().toISOString();
    session.snapshot = clipTail(`${session.snapshot}${data}`, MAX_SNAPSHOT_LENGTH);
    session.lastOutput = clipTail(`${session.lastOutput}${data}`, MAX_LAST_OUTPUT_LENGTH);

    const outputEvent: TerminalOutputEvent = {
      type: 'output',
      terminalId: session.id,
      data,
    };
    this.#broadcast(session, outputEvent);
  }

  #onExit(session: SessionRecord, exitCode: number, signal: number): void {
    session.status = exitCode === 0 ? 'exited' : 'error';
    session.exitCode = exitCode;
    session.signal = signal;
    session.updatedAt = new Date().toISOString();
    this.#clearIdleTimer(session);

    const statusEvent: TerminalStatusEvent = {
      type: 'status',
      terminalId: session.id,
      status: session.status,
      exitCode: session.exitCode,
      signal: session.signal,
    };
    this.#broadcast(session, statusEvent);
  }

  #scheduleIdleKill(session: SessionRecord): void {
    if (this.#idleTimeoutMs <= 0) {
      return;
    }
    this.#clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
      session.idleTimer = null;
      if (session.clients.size > 0 || session.status !== 'running') {
        return;
      }
      this.kill(session.id);
    }, this.#idleTimeoutMs);
  }

  #clearIdleTimer(session: SessionRecord): void {
    if (!session.idleTimer) {
      return;
    }
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }

  #parseClientEvent(raw: string): TerminalClientEvent | null {
    if (raw.length > MAX_CLIENT_MESSAGE_LENGTH) {
      return null;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!isRecord(payload) || typeof payload.type !== 'string') {
      return null;
    }

    if (payload.type === 'input') {
      if (typeof payload.data !== 'string') {
        return null;
      }
      return {
        type: 'input',
        data: payload.data,
      };
    }

    if (payload.type === 'resize') {
      if (!isFiniteInteger(payload.cols) || !isFiniteInteger(payload.rows)) {
        return null;
      }
      return {
        type: 'resize',
        cols: payload.cols,
        rows: payload.rows,
      };
    }

    return null;
  }

  #broadcast(session: SessionRecord, event: TerminalStreamEvent): void {
    const encoded = JSON.stringify(event);
    for (const client of session.clients) {
      if (client.readyState !== WS_READY_OPEN) {
        continue;
      }
      client.send(encoded);
    }
  }

  #sendError(ws: WebSocket, terminalId: string, error: unknown): void {
    let code = 'internal_error';
    let message = '不明なエラーが発生しました。';
    if (error instanceof TerminalSessionError) {
      code = error.code;
      message = error.message;
    } else if (error instanceof Error) {
      message = error.message;
    }

    const event: TerminalErrorEvent = {
      type: 'error',
      terminalId,
      error: {
        code,
        message,
      },
    };
    this.#sendToSocket(ws, event);
  }

  #sendToSocket(ws: WebSocket, event: TerminalStreamEvent): void {
    if (ws.readyState !== WS_READY_OPEN) {
      return;
    }
    ws.send(JSON.stringify(event));
  }
}
