import { randomUUID } from 'node:crypto';

import type {
  SyncDirection,
  SyncJobErrorDetails,
  SyncJobSnapshot,
  SyncJobStatus,
} from './types.js';
import { SyncServiceError } from './types.js';

interface CreateJobParams {
  readonly direction: SyncDirection;
  readonly workspaceName: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly lockKeys: readonly string[];
  readonly message: string;
}

interface JobRecord {
  readonly jobId: string;
  readonly direction: SyncDirection;
  readonly workspaceName: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly lockKeys: readonly string[];
  status: SyncJobStatus;
  progress: number | null;
  message: string;
  bytesTransferred: number | null;
  updatedAt: string;
  error: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * sync ジョブの進捗と lock を in-memory で管理する。
 * - 同一 lockKey の重複実行を拒否する
 * - 失敗時のみ stderr と終了コードを保持する
 */
export class SyncJobManager {
  readonly #jobs = new Map<string, JobRecord>();
  readonly #locks = new Map<string, string>();

  assertUnlocked(lockKeys: readonly string[]): void {
    for (const lockKey of lockKeys) {
      const runningJobId = this.#locks.get(lockKey);
      if (runningJobId) {
        throw new SyncServiceError(
          'sync_job_locked',
          409,
          '同一対象の sync ジョブがすでに実行中です。',
        );
      }
    }
  }

  createJob(params: CreateJobParams): SyncJobSnapshot {
    this.assertUnlocked(params.lockKeys);

    const now = new Date().toISOString();
    const jobId = `sync-${params.direction}-${randomUUID()}`;
    const record: JobRecord = {
      jobId,
      direction: params.direction,
      workspaceName: params.workspaceName,
      sourcePath: params.sourcePath,
      destinationPath: params.destinationPath,
      lockKeys: [...params.lockKeys],
      status: 'running',
      progress: null,
      message: params.message,
      bytesTransferred: null,
      updatedAt: now,
      error: '',
      stderr: '',
      exitCode: null,
    };

    this.#jobs.set(jobId, record);
    for (const lockKey of params.lockKeys) {
      this.#locks.set(lockKey, jobId);
    }
    return this.#toSnapshot(record);
  }

  update(jobId: string, params: { readonly progress?: number | null; readonly message?: string; readonly bytesTransferred?: number | null }): void {
    const record = this.#requireJob(jobId);
    if (record.status !== 'running') {
      return;
    }
    if (params.progress !== undefined) {
      record.progress = params.progress;
    }
    if (params.message !== undefined) {
      record.message = params.message;
    }
    if (params.bytesTransferred !== undefined) {
      record.bytesTransferred = params.bytesTransferred;
    }
    record.updatedAt = new Date().toISOString();
  }

  succeed(jobId: string, message: string): void {
    const record = this.#requireJob(jobId);
    record.status = 'succeeded';
    record.progress = 100;
    record.message = message;
    record.updatedAt = new Date().toISOString();
    this.#releaseLocks(record);
  }

  fail(jobId: string, error: string, stderr: string, exitCode: number | null): void {
    const record = this.#requireJob(jobId);
    record.status = 'failed';
    record.message = error;
    record.error = error;
    record.stderr = stderr;
    record.exitCode = exitCode;
    record.updatedAt = new Date().toISOString();
    this.#releaseLocks(record);
  }

  get(jobId: string): SyncJobSnapshot {
    return this.#toSnapshot(this.#requireJob(jobId));
  }

  getError(jobId: string): SyncJobErrorDetails {
    const record = this.#requireJob(jobId);
    if (record.status !== 'failed') {
      throw new SyncServiceError('sync_job_not_failed', 409, '指定した job は失敗状態ではありません。');
    }
    return {
      jobId: record.jobId,
      status: record.status,
      error: record.error,
      stderr: record.stderr,
      exitCode: record.exitCode,
    };
  }

  hasActiveLock(lockKey: string): boolean {
    return this.#locks.has(lockKey);
  }

  #requireJob(jobId: string): JobRecord {
    const record = this.#jobs.get(jobId);
    if (!record) {
      throw new SyncServiceError('sync_job_not_found', 404, '指定した sync job が見つかりません。');
    }
    return record;
  }

  #releaseLocks(record: JobRecord): void {
    for (const lockKey of record.lockKeys) {
      const currentJobId = this.#locks.get(lockKey);
      if (currentJobId === record.jobId) {
        this.#locks.delete(lockKey);
      }
    }
  }

  #toSnapshot(record: JobRecord): SyncJobSnapshot {
    return {
      jobId: record.jobId,
      direction: record.direction,
      workspaceName: record.workspaceName,
      sourcePath: record.sourcePath,
      destinationPath: record.destinationPath,
      status: record.status,
      progress: record.progress,
      message: record.message,
      bytesTransferred: record.bytesTransferred,
      updatedAt: record.updatedAt,
      lockKey: record.lockKeys[0] ?? '',
    };
  }
}
