import { requestJson } from './client';

export type SyncChangeType = 'add' | 'update' | 'delete';

export type SyncJobStatus = 'running' | 'succeeded' | 'failed';

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

export interface SyncWorkspaceSummary {
  readonly name: string;
  readonly lastImportSourcePath: string | null;
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

export interface SyncJobResponse {
  readonly jobId: string;
}

export interface SyncJobSnapshot {
  readonly jobId: string;
  readonly direction: 'import' | 'export';
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

export interface ImportSyncPreviewRequest {
  readonly sourcePath: string;
  readonly workspaceName: string;
}

export interface ImportSyncExecuteRequest extends ImportSyncPreviewRequest {
  readonly previewToken: string;
}

export interface ExportSyncPreviewRequest {
  readonly workspaceName: string;
  readonly destinationPath: string;
}

export interface ExportSyncExecuteRequest extends ExportSyncPreviewRequest {
  readonly previewToken: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const parseSyncStatus = (value: unknown): SyncStatus | null => {
  if (!isRecord(value) || !Array.isArray(value.allowedRoots)) {
    return null;
  }
  if (
    typeof value.configured !== 'boolean' ||
    (value.host !== null && typeof value.host !== 'string') ||
    (value.workspaceRoot !== null && typeof value.workspaceRoot !== 'string') ||
    typeof value.online !== 'boolean' ||
    typeof value.sshReachable !== 'boolean' ||
    typeof value.statusLabel !== 'string' ||
    typeof value.checkedAt !== 'string'
  ) {
    return null;
  }
  const allowedRoots: string[] = [];
  for (const entry of value.allowedRoots) {
    if (typeof entry !== 'string') {
      return null;
    }
    allowedRoots.push(entry);
  }
  return {
    configured: value.configured,
    host: value.host,
    allowedRoots,
    workspaceRoot: value.workspaceRoot,
    online: value.online,
    sshReachable: value.sshReachable,
    statusLabel: value.statusLabel,
    checkedAt: value.checkedAt,
  };
};

const parseSyncWorkspaceSummary = (value: unknown): SyncWorkspaceSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.name !== 'string' || (value.lastImportSourcePath !== null && typeof value.lastImportSourcePath !== 'string')) {
    return null;
  }
  return {
    name: value.name,
    lastImportSourcePath: value.lastImportSourcePath,
  };
};

const parseSyncWorkspaceList = (
  value: unknown,
): { readonly workspaces: readonly SyncWorkspaceSummary[] } | null => {
  if (!isRecord(value) || !Array.isArray(value.workspaces)) {
    return null;
  }
  const workspaces: SyncWorkspaceSummary[] = [];
  for (const workspace of value.workspaces) {
    const parsed = parseSyncWorkspaceSummary(workspace);
    if (!parsed) {
      return null;
    }
    workspaces.push(parsed);
  }
  return { workspaces };
};

const parseSyncPreviewFile = (value: unknown): SyncPreviewFile | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.path !== 'string' ||
    (value.changeType !== 'add' && value.changeType !== 'update' && value.changeType !== 'delete') ||
    (value.itemize !== null && typeof value.itemize !== 'string')
  ) {
    return null;
  }
  return {
    path: value.path,
    changeType: value.changeType,
    itemize: value.itemize,
  };
};

const parseSyncPreviewResult = (value: unknown): SyncPreviewResult | null => {
  if (!isRecord(value) || !isRecord(value.summary) || !Array.isArray(value.files)) {
    return null;
  }
  if (
    typeof value.sourcePath !== 'string' ||
    typeof value.destinationPath !== 'string' ||
    typeof value.workspaceName !== 'string' ||
    typeof value.previewToken !== 'string' ||
    (value.lastImportSourcePath !== null && typeof value.lastImportSourcePath !== 'string') ||
    typeof value.summary.add !== 'number' ||
    typeof value.summary.update !== 'number' ||
    typeof value.summary.delete !== 'number'
  ) {
    return null;
  }
  const files: SyncPreviewFile[] = [];
  for (const file of value.files) {
    const parsed = parseSyncPreviewFile(file);
    if (!parsed) {
      return null;
    }
    files.push(parsed);
  }
  return {
    sourcePath: value.sourcePath,
    destinationPath: value.destinationPath,
    workspaceName: value.workspaceName,
    summary: {
      add: value.summary.add,
      update: value.summary.update,
      delete: value.summary.delete,
    },
    files,
    previewToken: value.previewToken,
    lastImportSourcePath: value.lastImportSourcePath,
  };
};

const parseSyncJobResponse = (value: unknown): SyncJobResponse | null => {
  if (!isRecord(value) || typeof value.jobId !== 'string') {
    return null;
  }
  return { jobId: value.jobId };
};

const parseSyncJobSnapshot = (value: unknown): SyncJobSnapshot | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.jobId !== 'string' ||
    (value.direction !== 'import' && value.direction !== 'export') ||
    typeof value.workspaceName !== 'string' ||
    typeof value.sourcePath !== 'string' ||
    typeof value.destinationPath !== 'string' ||
    (value.status !== 'running' && value.status !== 'succeeded' && value.status !== 'failed') ||
    (value.progress !== null && typeof value.progress !== 'number') ||
    typeof value.message !== 'string' ||
    (value.bytesTransferred !== null && typeof value.bytesTransferred !== 'number') ||
    typeof value.updatedAt !== 'string' ||
    typeof value.lockKey !== 'string'
  ) {
    return null;
  }
  return {
    jobId: value.jobId,
    direction: value.direction,
    workspaceName: value.workspaceName,
    sourcePath: value.sourcePath,
    destinationPath: value.destinationPath,
    status: value.status,
    progress: value.progress,
    message: value.message,
    bytesTransferred: value.bytesTransferred,
    updatedAt: value.updatedAt,
    lockKey: value.lockKey,
  };
};

const parseSyncJobErrorDetails = (value: unknown): SyncJobErrorDetails | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.jobId !== 'string' ||
    (value.status !== 'running' && value.status !== 'succeeded' && value.status !== 'failed') ||
    typeof value.error !== 'string' ||
    typeof value.stderr !== 'string' ||
    (value.exitCode !== null && typeof value.exitCode !== 'number')
  ) {
    return null;
  }
  return {
    jobId: value.jobId,
    status: value.status,
    error: value.error,
    stderr: value.stderr,
    exitCode: value.exitCode,
  };
};

/**
 * sync 状態を取得する。
 */
export const getSyncStatus = async () => {
  return requestJson('/api/sync/status', { method: 'GET' }, parseSyncStatus);
};

/**
 * Export 元候補の workspace 一覧を取得する。
 */
export const listSyncWorkspaces = async () => {
  return requestJson('/api/sync/workspaces', { method: 'GET' }, parseSyncWorkspaceList);
};

/**
 * Import preview を実行する。
 * @param payload sourcePath / workspaceName
 */
export const previewSyncImport = async (payload: ImportSyncPreviewRequest) => {
  return requestJson(
    '/api/sync/import/preview',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseSyncPreviewResult,
  );
};

/**
 * Import を開始する。
 * @param payload previewToken を含む実行内容
 */
export const executeSyncImport = async (payload: ImportSyncExecuteRequest) => {
  return requestJson(
    '/api/sync/import',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseSyncJobResponse,
  );
};

/**
 * Export preview を実行する。
 * @param payload workspaceName / destinationPath
 */
export const previewSyncExport = async (payload: ExportSyncPreviewRequest) => {
  return requestJson(
    '/api/sync/export/preview',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseSyncPreviewResult,
  );
};

/**
 * Export を開始する。
 * @param payload previewToken を含む実行内容
 */
export const executeSyncExport = async (payload: ExportSyncExecuteRequest) => {
  return requestJson(
    '/api/sync/export',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseSyncJobResponse,
  );
};

/**
 * sync job の状態を取得する。
 * @param jobId 対象 job id
 */
export const getSyncJob = async (jobId: string) => {
  return requestJson(`/api/sync/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, parseSyncJobSnapshot);
};

/**
 * 失敗した sync job の詳細を取得する。
 * @param jobId 対象 job id
 */
export const getSyncJobError = async (jobId: string) => {
  return requestJson(
    `/api/sync/jobs/${encodeURIComponent(jobId)}/error`,
    { method: 'GET' },
    parseSyncJobErrorDetails,
  );
};
