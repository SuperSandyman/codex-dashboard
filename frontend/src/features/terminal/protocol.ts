import type { TerminalStatus } from '../../api/terminals';

export interface TerminalReadyEvent {
  readonly type: 'ready';
  readonly terminalId: string;
  readonly status: TerminalStatus;
  readonly snapshot: string;
  readonly cols: number;
  readonly rows: number;
  readonly exitCode: number | null;
  readonly signal: number | null;
}

export interface TerminalOutputEvent {
  readonly type: 'output';
  readonly terminalId: string;
  readonly data: string;
}

export interface TerminalStatusEvent {
  readonly type: 'status';
  readonly terminalId: string;
  readonly status: TerminalStatus;
  readonly exitCode: number | null;
  readonly signal: number | null;
}

export interface TerminalErrorEvent {
  readonly type: 'error';
  readonly terminalId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type TerminalStreamEvent =
  | TerminalReadyEvent
  | TerminalOutputEvent
  | TerminalStatusEvent
  | TerminalErrorEvent;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const parseStatus = (value: unknown): TerminalStatus | null => {
  if (value === 'running' || value === 'exited' || value === 'error') {
    return value;
  }
  return null;
};

/**
 * Terminal WebSocket イベントを検証する。
 * @param payload 受信 JSON
 */
export const parseTerminalStreamEvent = (payload: unknown): TerminalStreamEvent | null => {
  if (!isRecord(payload) || typeof payload.type !== 'string' || typeof payload.terminalId !== 'string') {
    return null;
  }

  if (payload.type === 'output') {
    if (typeof payload.data !== 'string') {
      return null;
    }
    return {
      type: 'output',
      terminalId: payload.terminalId,
      data: payload.data,
    };
  }

  if (payload.type === 'status') {
    const status = parseStatus(payload.status);
    if (!status || (payload.exitCode !== null && typeof payload.exitCode !== 'number') || (payload.signal !== null && typeof payload.signal !== 'number')) {
      return null;
    }
    return {
      type: 'status',
      terminalId: payload.terminalId,
      status,
      exitCode: payload.exitCode,
      signal: payload.signal,
    };
  }

  if (payload.type === 'ready') {
    const status = parseStatus(payload.status);
    if (
      !status ||
      typeof payload.snapshot !== 'string' ||
      typeof payload.cols !== 'number' ||
      typeof payload.rows !== 'number' ||
      (payload.exitCode !== null && typeof payload.exitCode !== 'number') ||
      (payload.signal !== null && typeof payload.signal !== 'number')
    ) {
      return null;
    }
    return {
      type: 'ready',
      terminalId: payload.terminalId,
      status,
      snapshot: payload.snapshot,
      cols: payload.cols,
      rows: payload.rows,
      exitCode: payload.exitCode,
      signal: payload.signal,
    };
  }

  if (payload.type === 'error') {
    if (!isRecord(payload.error) || typeof payload.error.code !== 'string' || typeof payload.error.message !== 'string') {
      return null;
    }
    return {
      type: 'error',
      terminalId: payload.terminalId,
      error: {
        code: payload.error.code,
        message: payload.error.message,
      },
    };
  }

  return null;
};
