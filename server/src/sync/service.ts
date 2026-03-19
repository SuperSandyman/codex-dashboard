import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';

import { SyncJobManager } from './jobManager.js';
import {
  assertAllowedRoot,
  normalizeAbsolutePath,
  normalizeWorkspaceName,
  resolveWorkspacePath,
  toDirectorySyncPath,
} from './pathPolicy.js';
import { parseRsyncPreviewOutput } from './previewParser.js';
import type {
  SyncConfig,
  SyncDirection,
  SyncJobSnapshot,
  SyncPreviewResult,
  SyncStatus,
  SyncWorkspaceSummary,
} from './types.js';
import { SyncServiceError } from './types.js';

interface PreviewCacheEntry {
  readonly token: string;
  readonly direction: SyncDirection;
  readonly workspaceName: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly createdAt: number;
}

interface MetadataFileShape {
  readonly workspaces?: Record<string, { readonly lastImportSourcePath?: string }>;
}

interface ExecuteParams {
  readonly sourcePath: string;
  readonly workspaceName: string;
  readonly previewToken: string;
}

const POSIX = path.posix;
const STATUS_COMMAND = 'printf ok';
const METADATA_FILE_NAME = '.codex-dashboard-sync.json';

const toIsoNow = (): string => {
  return new Date().toISOString();
};

const clipOutput = (value: string): string => {
  return value.trim().slice(-20000);
};

const toPreviewToken = (): string => {
  return `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const parseProgress = (
  output: string,
): { readonly progress: number | null; readonly bytesTransferred: number | null } => {
  const normalized = output.replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    const progressMatch = line.match(/(\d+)%/);
    if (!progressMatch) {
      continue;
    }
    const bytesMatch = line.match(/^\s*([\d,]+)/);
    const bytesTransferred = bytesMatch ? Number(bytesMatch[1].replace(/,/g, '')) : null;
    return {
      progress: Number(progressMatch[1]),
      bytesTransferred: Number.isFinite(bytesTransferred) ? bytesTransferred : null,
    };
  }
  return {
    progress: null,
    bytesTransferred: null,
  };
};

/**
 * rsync over ssh を使う sync 機能のサービス本体。
 * - preview token と job 状態を in-memory 管理する
 * - 成功した import 元パスだけを metadata として永続化する
 */
export class SyncService {
  readonly #config: SyncConfig | null;
  readonly #jobManager = new SyncJobManager();
  readonly #previewCache = new Map<string, PreviewCacheEntry>();

  constructor(config: SyncConfig | null) {
    this.#config = config;
  }

  /**
   * 現在の接続状態と許可ルート情報を返す。
   */
  async getStatus(): Promise<SyncStatus> {
    if (!this.#config) {
      return {
        configured: false,
        host: null,
        allowedRoots: [],
        workspaceRoot: null,
        online: false,
        sshReachable: false,
        statusLabel: 'Not configured',
        checkedAt: toIsoNow(),
      };
    }

    const probe = await this.#probeStatus();
    return {
      configured: true,
      host: this.#config.host,
      allowedRoots: this.#config.allowedRoots,
      workspaceRoot: this.#config.workspaceRoot,
      online: probe.online,
      sshReachable: probe.sshReachable,
      statusLabel: probe.statusLabel,
      checkedAt: probe.checkedAt,
    };
  }

  /**
   * Export 元に選べる server workspace 一覧を返す。
   */
  async listWorkspaces(): Promise<{ workspaces: readonly SyncWorkspaceSummary[] }> {
    const config = this.#requireConfig();
    await fs.mkdir(config.workspaceRoot, { recursive: true });
    const metadata = await this.#readMetadata();
    const entries = await fs.readdir(config.workspaceRoot, { withFileTypes: true });
    const workspaces = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        lastImportSourcePath: metadata.workspaces?.[entry.name]?.lastImportSourcePath ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return { workspaces };
  }

  /**
   * Import preview を実行し、preview token 付きの差分一覧を返す。
   */
  async previewImport(params: {
    readonly sourcePath: string;
    readonly workspaceName: string;
  }): Promise<SyncPreviewResult> {
    const config = this.#requireConfig();
    const sourcePath = normalizeAbsolutePath(params.sourcePath, 'sourcePath');
    assertAllowedRoot(sourcePath, config.allowedRoots, 'sourcePath');
    const workspaceName = normalizeWorkspaceName(params.workspaceName);
    const destinationPath = resolveWorkspacePath(config.workspaceRoot, workspaceName);
    this.#jobManager.assertUnlocked([this.#workspaceLockKey(destinationPath)]);
    await fs.mkdir(config.workspaceRoot, { recursive: true });

    const preview = await this.#runPreview({
      direction: 'import',
      sourcePath,
      destinationPath,
      workspaceName,
    });
    return {
      ...preview,
      lastImportSourcePath: null,
    };
  }

  /**
   * Export preview を実行し、last import path 付きの差分一覧を返す。
   */
  async previewExport(params: {
    readonly workspaceName: string;
    readonly destinationPath: string;
  }): Promise<SyncPreviewResult> {
    const config = this.#requireConfig();
    const workspaceName = normalizeWorkspaceName(params.workspaceName);
    const sourcePath = resolveWorkspacePath(config.workspaceRoot, workspaceName);
    const destinationPath = normalizeAbsolutePath(params.destinationPath, 'destinationPath');
    assertAllowedRoot(destinationPath, config.allowedRoots, 'destinationPath');
    this.#jobManager.assertUnlocked([
      this.#workspaceLockKey(sourcePath),
      this.#remoteLockKey(destinationPath),
    ]);

    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory()) {
      throw new SyncServiceError('workspace_not_found', 404, '指定した workspace が見つかりません。');
    }

    const preview = await this.#runPreview({
      direction: 'export',
      sourcePath,
      destinationPath,
      workspaceName,
    });
    const metadata = await this.#readMetadata();
    return {
      ...preview,
      lastImportSourcePath: metadata.workspaces?.[workspaceName]?.lastImportSourcePath ?? null,
    };
  }

  /**
   * Import 実行ジョブを開始する。
   */
  async startImport(params: ExecuteParams): Promise<{ jobId: string }> {
    const config = this.#requireConfig();
    const sourcePath = normalizeAbsolutePath(params.sourcePath, 'sourcePath');
    assertAllowedRoot(sourcePath, config.allowedRoots, 'sourcePath');
    const workspaceName = normalizeWorkspaceName(params.workspaceName);
    const destinationPath = resolveWorkspacePath(config.workspaceRoot, workspaceName);

    await this.#assertReadyForExecute({
      direction: 'import',
      sourcePath,
      destinationPath,
      workspaceName,
      previewToken: params.previewToken,
    });

    const job = this.#jobManager.createJob({
      direction: 'import',
      workspaceName,
      sourcePath,
      destinationPath,
      lockKeys: [this.#workspaceLockKey(destinationPath)],
      message: 'Importing workspace',
    });

    this.#runExecuteJob(job, {
      direction: 'import',
      sourcePath,
      destinationPath,
      workspaceName,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Import failed';
      this.#jobManager.fail(job.jobId, message, message, null);
    });

    return { jobId: job.jobId };
  }

  /**
   * Export 実行ジョブを開始する。
   */
  async startExport(params: ExecuteParams): Promise<{ jobId: string }> {
    const config = this.#requireConfig();
    const workspaceName = normalizeWorkspaceName(params.workspaceName);
    const sourcePath = resolveWorkspacePath(config.workspaceRoot, workspaceName);
    const destinationPath = normalizeAbsolutePath(params.sourcePath, 'destinationPath');
    assertAllowedRoot(destinationPath, config.allowedRoots, 'destinationPath');

    await this.#assertReadyForExecute({
      direction: 'export',
      sourcePath,
      destinationPath,
      workspaceName,
      previewToken: params.previewToken,
    });

    const job = this.#jobManager.createJob({
      direction: 'export',
      workspaceName,
      sourcePath,
      destinationPath,
      lockKeys: [this.#workspaceLockKey(sourcePath), this.#remoteLockKey(destinationPath)],
      message: 'Exporting workspace',
    });

    this.#runExecuteJob(job, {
      direction: 'export',
      sourcePath,
      destinationPath,
      workspaceName,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Export failed';
      this.#jobManager.fail(job.jobId, message, message, null);
    });

    return { jobId: job.jobId };
  }

  /**
   * ジョブ状態を返す。
   * @param jobId 対象 job id
   */
  getJob(jobId: string): SyncJobSnapshot {
    return this.#jobManager.get(jobId);
  }

  /**
   * 失敗済みジョブの stderr 詳細を返す。
   * @param jobId 対象 job id
   */
  getJobError(jobId: string) {
    return this.#jobManager.getError(jobId);
  }

  #requireConfig(): SyncConfig {
    if (!this.#config) {
      throw new SyncServiceError('sync_not_configured', 503, 'sync 機能が設定されていません。');
    }
    return this.#config;
  }

  async #probeStatus(): Promise<{
    readonly online: boolean;
    readonly sshReachable: boolean;
    readonly statusLabel: string;
    readonly checkedAt: string;
  }> {
    const config = this.#requireConfig();
    const result = await this.#spawnCapture('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      `ConnectTimeout=${Math.max(1, Math.ceil(config.statusTimeoutMs / 1000))}`,
      this.#remoteHost(),
      STATUS_COMMAND,
    ]);

    if (result.exitCode === 0) {
      return {
        online: true,
        sshReachable: true,
        statusLabel: 'Online',
        checkedAt: toIsoNow(),
      };
    }

    const stderr = `${result.stderr}\n${result.stdout}`.toLowerCase();
    const statusLabel = stderr.includes('permission denied') ? 'SSH unreachable' : 'Offline';
    return {
      online: false,
      sshReachable: false,
      statusLabel,
      checkedAt: toIsoNow(),
    };
  }

  async #runPreview(params: {
    readonly direction: SyncDirection;
    readonly sourcePath: string;
    readonly destinationPath: string;
    readonly workspaceName: string;
  }): Promise<SyncPreviewResult> {
    const status = await this.#probeStatus();
    if (!status.sshReachable) {
      throw new SyncServiceError('ssh_unreachable', 503, 'SSH 接続先へ到達できません。');
    }

    const result = await this.#spawnCapture('rsync', this.#buildRsyncArgs({
      ...params,
      dryRun: true,
    }));
    if (result.exitCode !== 0) {
      throw new SyncServiceError(
        'sync_preview_failed',
        502,
        clipOutput(result.stderr || result.stdout || 'rsync preview failed'),
      );
    }

    const parsed = parseRsyncPreviewOutput(result.stdout);
    const previewToken = toPreviewToken();
    this.#previewCache.set(previewToken, {
      token: previewToken,
      direction: params.direction,
      workspaceName: params.workspaceName,
      sourcePath: params.sourcePath,
      destinationPath: params.destinationPath,
      createdAt: Date.now(),
    });

    return {
      sourcePath: params.sourcePath,
      destinationPath: params.destinationPath,
      workspaceName: params.workspaceName,
      summary: parsed.summary,
      files: parsed.files,
      previewToken,
      lastImportSourcePath: null,
    };
  }

  async #assertReadyForExecute(params: {
    readonly direction: SyncDirection;
    readonly sourcePath: string;
    readonly destinationPath: string;
    readonly workspaceName: string;
    readonly previewToken: string;
  }): Promise<void> {
    const config = this.#requireConfig();
    const preview = this.#previewCache.get(params.previewToken);
    if (!preview) {
      throw new SyncServiceError('preview_required', 409, 'execute 前に preview を再実行してください。');
    }
    if (Date.now() - preview.createdAt > config.previewTtlMs) {
      this.#previewCache.delete(params.previewToken);
      throw new SyncServiceError('preview_expired', 409, 'preview の有効期限が切れました。再実行してください。');
    }
    if (
      preview.direction !== params.direction ||
      preview.workspaceName !== params.workspaceName ||
      preview.sourcePath !== params.sourcePath ||
      preview.destinationPath !== params.destinationPath
    ) {
      throw new SyncServiceError('preview_mismatch', 409, 'preview 結果と execute 入力が一致しません。');
    }

    const status = await this.#probeStatus();
    if (!status.sshReachable) {
      throw new SyncServiceError('ssh_unreachable', 503, 'SSH 接続先へ到達できません。');
    }
  }

  async #runExecuteJob(
    job: SyncJobSnapshot,
    params: {
      readonly direction: SyncDirection;
      readonly sourcePath: string;
      readonly destinationPath: string;
      readonly workspaceName: string;
    },
  ): Promise<void> {
    const process = spawn('rsync', this.#buildRsyncArgs({
      ...params,
      dryRun: false,
    }), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      const progress = parseProgress(stdout);
      this.#jobManager.update(job.jobId, {
        progress: progress.progress,
        bytesTransferred: progress.bytesTransferred,
        message: params.direction === 'import' ? 'Importing workspace' : 'Exporting workspace',
      });
    });
    process.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      process.on('error', reject);
      process.on('close', (code) => resolve(code));
    });

    if (exitCode !== 0) {
      this.#jobManager.fail(
        job.jobId,
        clipOutput(stderr || stdout || 'sync failed'),
        clipOutput(stderr),
        exitCode,
      );
      return;
    }

    if (params.direction === 'import') {
      await this.#writeLastImportSourcePath(params.workspaceName, params.sourcePath);
    }

    this.#jobManager.succeed(job.jobId, params.direction === 'import' ? 'Import completed' : 'Export completed');
  }

  #buildRsyncArgs(params: {
    readonly direction: SyncDirection;
    readonly sourcePath: string;
    readonly destinationPath: string;
    readonly dryRun: boolean;
  }): string[] {
    const args = [
      '-a',
      '--delete',
      '--protect-args',
    ];

    if (params.dryRun) {
      args.push('--dry-run', '--itemize-changes');
    } else {
      args.push('--info=progress2');
    }

    args.push('-e', this.#sshCommand());

    if (params.direction === 'import') {
      args.push(
        this.#toRemoteSpec(params.sourcePath),
        toDirectorySyncPath(params.destinationPath),
      );
      return args;
    }

    args.push(
      toDirectorySyncPath(params.sourcePath),
      this.#toRemoteSpec(params.destinationPath),
    );
    return args;
  }

  #sshCommand(): string {
    const config = this.#requireConfig();
    const connectTimeoutSeconds = Math.max(1, Math.ceil(config.statusTimeoutMs / 1000));
    return [
      'ssh',
      '-o',
      'BatchMode=yes',
      '-o',
      `ConnectTimeout=${connectTimeoutSeconds}`,
      '-p',
      String(config.sshPort),
    ].join(' ');
  }

  #remoteHost(): string {
    const config = this.#requireConfig();
    return config.sshUser ? `${config.sshUser}@${config.host}` : config.host;
  }

  #toRemoteSpec(targetPath: string): string {
    return `${this.#remoteHost()}:${toDirectorySyncPath(targetPath)}`;
  }

  #workspaceLockKey(workspacePath: string): string {
    return `workspace:${workspacePath}`;
  }

  #remoteLockKey(targetPath: string): string {
    return `remote:${targetPath}`;
  }

  async #spawnCapture(command: string, args: readonly string[]): Promise<{
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number | null;
  }> {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code));
    });

    return {
      stdout,
      stderr,
      exitCode,
    };
  }

  async #readMetadata(): Promise<MetadataFileShape> {
    const config = this.#requireConfig();
    const metadataPath = POSIX.join(config.workspaceRoot, METADATA_FILE_NAME);
    const raw = await fs.readFile(metadataPath, 'utf8').catch(() => null);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as MetadataFileShape;
      return parsed;
    } catch {
      return {};
    }
  }

  async #writeLastImportSourcePath(workspaceName: string, sourcePath: string): Promise<void> {
    const config = this.#requireConfig();
    await fs.mkdir(config.workspaceRoot, { recursive: true });
    const metadataPath = POSIX.join(config.workspaceRoot, METADATA_FILE_NAME);
    const current = await this.#readMetadata();
    const next: MetadataFileShape = {
      workspaces: {
        ...(current.workspaces ?? {}),
        [workspaceName]: {
          lastImportSourcePath: sourcePath,
        },
      },
    };
    await fs.writeFile(metadataPath, JSON.stringify(next, null, 2), 'utf8');
  }
}
