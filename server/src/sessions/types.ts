export type SessionTool = 'codex' | 'opencode';

export type SessionStatus = 'running' | 'exited' | 'error';

export interface ApiError {
  readonly code: string;
  readonly message: string;
}

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

export interface SessionInputMessage {
  readonly type: 'input';
  readonly data: string;
}

export interface SessionResizeMessage {
  readonly type: 'resize';
  readonly cols: number;
  readonly rows: number;
}

export interface SessionSnapshotRequestMessage {
  readonly type: 'snapshot';
}

export type SessionClientMessage =
  | SessionInputMessage
  | SessionResizeMessage
  | SessionSnapshotRequestMessage;

export interface SessionOutputMessage {
  readonly type: 'output';
  readonly data: string;
}

export interface SessionStatusMessage {
  readonly type: 'status';
  readonly status: SessionStatus;
  readonly exitCode?: number;
}

export interface SessionSnapshotMessage {
  readonly type: 'snapshot';
  readonly data: string;
}

export interface SessionErrorMessage {
  readonly type: 'error';
  readonly error: ApiError;
}

export type SessionServerMessage =
  | SessionOutputMessage
  | SessionStatusMessage
  | SessionSnapshotMessage
  | SessionErrorMessage;
