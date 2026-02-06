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

export interface TerminalSnapshot {
  readonly id: string;
  readonly profileId: string;
  readonly cwd: string;
  readonly status: TerminalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly snapshot: string;
  readonly cols: number;
  readonly rows: number;
  readonly exitCode: number | null;
  readonly signal: number | null;
}

export interface TerminalCatalog {
  readonly workspaceRoot: string | null;
  readonly cwdChoices: readonly string[];
  readonly profiles: readonly TerminalProfile[];
}

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

export interface TerminalInputClientEvent {
  readonly type: 'input';
  readonly data: string;
}

export interface TerminalResizeClientEvent {
  readonly type: 'resize';
  readonly cols: number;
  readonly rows: number;
}

export type TerminalClientEvent = TerminalInputClientEvent | TerminalResizeClientEvent;
