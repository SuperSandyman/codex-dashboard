import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  EditorCatalog,
  EditorFileResponse,
  EditorTreeNode,
  EditorTreeResponse,
  WriteEditorFileParams,
} from './types.js';

interface EditorFileServiceOptions {
  readonly workspaceRoot: string | null;
  readonly maxReadFileSizeBytes: number;
  readonly maxSaveFileSizeBytes: number;
}

interface ResolvedPath {
  readonly normalizedPath: string;
  readonly absolutePath: string;
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

const isInsideRoot = (root: string, target: string): boolean => {
  return target === root || target.startsWith(`${root}${path.sep}`);
};

const normalizeEditorPath = (inputPath: string): string => {
  if (inputPath.includes('\u0000')) {
    throw new EditorFileServiceError('invalid_path', 'path に NUL 文字は使えません。', 400);
  }

  const trimmed = inputPath.trim();
  if (trimmed.includes('\\')) {
    throw new EditorFileServiceError('invalid_path', "path は '/' 区切りで指定してください。", 400);
  }

  const nativeNormalizedPath = path.normalize(trimmed.length === 0 ? '.' : trimmed);
  if (path.isAbsolute(nativeNormalizedPath)) {
    throw new EditorFileServiceError('invalid_path', 'workspace 外の path は指定できません。', 400);
  }

  const normalizedPath = nativeNormalizedPath.split(path.sep).join('/');
  if (normalizedPath.startsWith('../') || normalizedPath === '..') {
    throw new EditorFileServiceError('invalid_path', 'workspace 外の path は指定できません。', 400);
  }

  if (normalizedPath === '.') {
    return '';
  }

  return normalizedPath;
};

const toFileVersion = (stat: {
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly size: number;
}): string => {
  return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
};

const toIso = (timestampMs: number): string => {
  return new Date(timestampMs).toISOString();
};

const sortTreeNodes = (nodes: readonly EditorTreeNode[]): EditorTreeNode[] => {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
};

/**
 * Editor 用のワークスペース内ファイル read/write を提供する。
 * - WORKSPACE_ROOT 外参照を拒否する
 * - テキスト判定とサイズ上限を強制する
 * - 保存時は version を使った簡易楽観ロックを行う
 */
export class EditorFileService {
  private readonly workspaceRoot: string | null;

  private readonly maxReadFileSizeBytes: number;

  private readonly maxSaveFileSizeBytes: number;

  public constructor(options: EditorFileServiceOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.maxReadFileSizeBytes = options.maxReadFileSizeBytes;
    this.maxSaveFileSizeBytes = options.maxSaveFileSizeBytes;
  }

  /**
   * Editor 用の基本情報を返す。
   */
  public getCatalog = (): EditorCatalog => {
    return {
      workspaceRoot: this.workspaceRoot,
    };
  };

  /**
   * 指定ディレクトリ配下の子要素を返す。
   * @param inputPath ワークスペース相対パス（空文字で root）
   */
  public getTree = async (inputPath: string): Promise<EditorTreeResponse> => {
    const resolved = await this.resolveExistingPath(inputPath);
    const workspaceRootRealPath = await this.getWorkspaceRootRealPath();
    const targetStat = await fs.stat(resolved.absolutePath);
    if (!targetStat.isDirectory()) {
      throw new EditorFileServiceError('invalid_path', 'directory path を指定してください。', 400);
    }

    const entries = await fs.readdir(resolved.absolutePath, { withFileTypes: true });
    const nodes: EditorTreeNode[] = [];

    for (const entry of entries) {
      const entryAbsolutePath = path.join(resolved.absolutePath, entry.name);
      const relativePath = path.relative(workspaceRootRealPath, entryAbsolutePath);
      const normalizedRelativePath = relativePath.split(path.sep).join('/');
      if (normalizedRelativePath.length === 0 || normalizedRelativePath.startsWith('..')) {
        continue;
      }

      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: normalizedRelativePath,
          kind: 'directory',
          hasChildren: true,
        });
        continue;
      }

      if (entry.isFile()) {
        nodes.push({
          name: entry.name,
          path: normalizedRelativePath,
          kind: 'file',
          hasChildren: false,
        });
        continue;
      }

      if (entry.isSymbolicLink()) {
        const safeResolved = await this.resolveSymlinkTarget(entryAbsolutePath);
        if (!safeResolved) {
          continue;
        }
        const stat = await fs.stat(safeResolved);
        nodes.push({
          name: entry.name,
          path: normalizedRelativePath,
          kind: stat.isDirectory() ? 'directory' : 'file',
          hasChildren: stat.isDirectory(),
        });
      }
    }

    return {
      path: resolved.normalizedPath,
      nodes: sortTreeNodes(nodes),
    };
  };

  /**
   * テキストファイルを読み込む。
   * @param inputPath ワークスペース相対ファイルパス
   */
  public readFile = async (inputPath: string): Promise<EditorFileResponse> => {
    const resolved = await this.resolveExistingPath(inputPath);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) {
      throw new EditorFileServiceError('invalid_path', 'file path を指定してください。', 400);
    }

    if (stat.size > this.maxReadFileSizeBytes) {
      throw new EditorFileServiceError(
        'file_too_large',
        `ファイルサイズが上限を超えています。(${this.maxReadFileSizeBytes} bytes)`,
        413,
      );
    }

    const contentBuffer = await fs.readFile(resolved.absolutePath);
    if (contentBuffer.includes(0x00)) {
      throw new EditorFileServiceError('non_text_file', 'バイナリファイルは編集できません。', 415);
    }

    let content = '';
    try {
      content = UTF8_DECODER.decode(contentBuffer);
    } catch {
      throw new EditorFileServiceError('non_text_file', 'UTF-8 テキスト以外は編集できません。', 415);
    }

    return {
      path: resolved.normalizedPath,
      content,
      sizeBytes: stat.size,
      version: toFileVersion(stat),
      updatedAt: toIso(stat.mtimeMs),
    };
  };

  /**
   * テキストファイルを保存する。
   * @param params 保存対象のパス/内容/version
   */
  public writeFile = async (params: WriteEditorFileParams): Promise<EditorFileResponse> => {
    const resolved = await this.resolveExistingPath(params.path);
    const beforeStat = await fs.stat(resolved.absolutePath);
    if (!beforeStat.isFile()) {
      throw new EditorFileServiceError('invalid_path', 'file path を指定してください。', 400);
    }

    const currentVersion = toFileVersion(beforeStat);
    if (params.expectedVersion !== currentVersion) {
      throw new EditorFileServiceError(
        'version_conflict',
        'ファイルが外部で更新されています。再読込してから保存してください。',
        409,
      );
    }

    if (params.content.includes('\u0000')) {
      throw new EditorFileServiceError('invalid_payload', 'content に NUL 文字は使えません。', 400);
    }

    const payloadBytes = Buffer.byteLength(params.content, 'utf-8');
    if (payloadBytes > this.maxSaveFileSizeBytes) {
      throw new EditorFileServiceError(
        'payload_too_large',
        `保存サイズが上限を超えています。(${this.maxSaveFileSizeBytes} bytes)`,
        413,
      );
    }

    const temporaryPath = path.join(
      path.dirname(resolved.absolutePath),
      `.codex-editor-${randomUUID()}.tmp`,
    );
    let temporaryCreated = false;
    try {
      await fs.writeFile(temporaryPath, params.content, { encoding: 'utf-8', flag: 'wx' });
      temporaryCreated = true;
      await fs.chmod(temporaryPath, beforeStat.mode);
      await fs.rename(temporaryPath, resolved.absolutePath);
    } catch (error) {
      if (temporaryCreated) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : 'ファイル保存に失敗しました。';
      throw new EditorFileServiceError('write_failed', message, 500);
    }

    const afterStat = await fs.stat(resolved.absolutePath);

    return {
      path: resolved.normalizedPath,
      content: params.content,
      sizeBytes: afterStat.size,
      version: toFileVersion(afterStat),
      updatedAt: toIso(afterStat.mtimeMs),
    };
  };

  private getWorkspaceRootRealPath = async (): Promise<string> => {
    if (!this.workspaceRoot) {
      throw new EditorFileServiceError(
        'workspace_not_configured',
        'WORKSPACE_ROOT が設定されていません。',
        503,
      );
    }

    try {
      const realRoot = await fs.realpath(this.workspaceRoot);
      const rootStat = await fs.stat(realRoot);
      if (!rootStat.isDirectory()) {
        throw new EditorFileServiceError(
          'workspace_not_available',
          'WORKSPACE_ROOT がディレクトリではありません。',
          500,
        );
      }
      return realRoot;
    } catch (error) {
      if (error instanceof EditorFileServiceError) {
        throw error;
      }
      throw new EditorFileServiceError('workspace_not_available', 'WORKSPACE_ROOT を参照できません。', 500);
    }
  };

  private resolveExistingPath = async (inputPath: string): Promise<ResolvedPath> => {
    const normalizedPath = normalizeEditorPath(inputPath);
    const workspaceRoot = await this.getWorkspaceRootRealPath();
    const candidatePath = path.resolve(workspaceRoot, normalizedPath);
    if (!isInsideRoot(workspaceRoot, candidatePath)) {
      throw new EditorFileServiceError('invalid_path', 'workspace 外の path は指定できません。', 400);
    }

    let realPath = '';
    try {
      realPath = await fs.realpath(candidatePath);
    } catch {
      throw new EditorFileServiceError('file_not_found', '指定した path が見つかりません。', 404);
    }

    if (!isInsideRoot(workspaceRoot, realPath)) {
      throw new EditorFileServiceError('invalid_path', 'workspace 外の path は指定できません。', 400);
    }

    return {
      normalizedPath,
      absolutePath: realPath,
    };
  };

  private resolveSymlinkTarget = async (targetPath: string): Promise<string | null> => {
    const workspaceRoot = await this.getWorkspaceRootRealPath();
    try {
      const realPath = await fs.realpath(targetPath);
      if (!isInsideRoot(workspaceRoot, realPath)) {
        return null;
      }
      return realPath;
    } catch {
      return null;
    }
  };
}

/**
 * Editor API で扱う業務エラー。
 */
export class EditorFileServiceError extends Error {
  public readonly code: string;

  public readonly status: number;

  public constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
