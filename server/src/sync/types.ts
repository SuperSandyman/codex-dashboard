export type SyncDirection = 'import' | 'export';

export type SyncChangeType = 'add' | 'update' | 'delete';

export type SyncJobStatus = 'running' | 'succeeded' | 'failed';

export interface SyncConfig {
  readonly host: string;
  readonly sshUser: string | null;
  readonly sshPort: number;
  readonly allowedRoots: readonly string[];
  readonly workspaceRoot: string;
  readonly statusTimeoutMs: number;
  readonly previewTtlMs: number;
}

export interface SyncStatus {
  readonly configured: boolean;
  readonly host: string | null;
  readonly allowedRoots: readonly string[];
  readonly workspaceRoot: string | null;
  readonly online: boolean;
  readonly sshReachable: boolean;
  readonly statusLabel: string;
  readonly checkedAt: string;
}

export interface SyncPreviewSummary {
  readonly add: number;
  readonly update: number;
  readonly delete: number;
}

export interface SyncPreviewFile {
  readonly path: string;
  readonly changeType: SyncChangeType;
  readonly itemize: string | null;
}

export interface SyncPreviewResult {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly workspaceName: string;
  readonly summary: SyncPreviewSummary;
  readonly files: readonly SyncPreviewFile[];
  readonly previewToken: string;
  readonly lastImportSourcePath: string | null;
}

export interface SyncWorkspaceSummary {
  readonly name: string;
  readonly lastImportSourcePath: string | null;
}

export interface SyncJobSnapshot {
  readonly jobId: string;
  readonly direction: SyncDirection;
  readonly workspaceName: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly status: SyncJobStatus;
  readonly progress: number | null;
  readonly message: string;
  readonly bytesTransferred: number | null;
  readonly updatedAt: string;
  readonly lockKey: string;
}

export interface SyncJobErrorDetails {
  readonly jobId: string;
  readonly status: SyncJobStatus;
  readonly error: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/**
 * sync 機能で返す業務エラー。
 * - API ステータスとコードを一緒に運ぶ
 * - stderr を含めたいケースは details を使う
 */
export class SyncServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: SyncJobErrorDetails;

  constructor(code: string, status: number, message: string, details?: SyncJobErrorDetails) {
    super(message);
    this.name = 'SyncServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
