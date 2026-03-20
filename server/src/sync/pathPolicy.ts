import path from 'node:path';

import { SyncServiceError } from './types.js';

const POSIX = path.posix;

const isInsideRoot = (rootPath: string, targetPath: string): boolean => {
  if (targetPath === rootPath) {
    return true;
  }
  const normalizedRoot = rootPath.endsWith(POSIX.sep) ? rootPath : `${rootPath}${POSIX.sep}`;
  return targetPath.startsWith(normalizedRoot);
};

/**
 * ユーザー入力の絶対パスを正規化する。
 * - UNIX 系パスのみ対象
 * - `..` を含む入力も正規化後に扱う
 * @param rawPath 入力パス
 * @param label エラーメッセージ用ラベル
 */
export const normalizeAbsolutePath = (rawPath: string, label: string): string => {
  const trimmed = rawPath.trim();
  if (!POSIX.isAbsolute(trimmed)) {
    throw new SyncServiceError('invalid_path', 400, `${label} は絶対パスで指定してください。`);
  }
  return POSIX.normalize(trimmed);
};

/**
 * 許可ルート配下かどうかを検証する。
 * @param targetPath 検証対象パス
 * @param allowedRoots 許可ルート一覧
 * @param label エラーメッセージ用ラベル
 */
export const assertAllowedRoot = (
  targetPath: string,
  allowedRoots: readonly string[],
  label: string,
): void => {
  const isAllowed = allowedRoots.some((rootPath) => isInsideRoot(rootPath, targetPath));
  if (!isAllowed) {
    throw new SyncServiceError(
      'invalid_path',
      400,
      `${label} は allowedRoots 配下のみ指定できます。`,
    );
  }
};

/**
 * workspace 名を単一ディレクトリ名として検証する。
 * @param workspaceName 入力された workspace 名
 */
export const normalizeWorkspaceName = (workspaceName: string): string => {
  const trimmed = workspaceName.trim();
  if (trimmed.length === 0) {
    throw new SyncServiceError('invalid_workspace_name', 400, 'workspaceName は空にできません。');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new SyncServiceError(
      'invalid_workspace_name',
      400,
      'workspaceName は英数字・ドット・ハイフン・アンダースコアのみ使用できます。',
    );
  }
  return trimmed;
};

/**
 * sync workspace 直下の絶対パスへ変換し、root 配下制約を検証する。
 * @param workspaceRoot サーバー側 workspace 保存ルート
 * @param workspaceName workspace 名
 */
export const resolveWorkspacePath = (workspaceRoot: string, workspaceName: string): string => {
  const normalizedRoot = POSIX.normalize(workspaceRoot);
  const normalizedName = normalizeWorkspaceName(workspaceName);
  const resolved = POSIX.resolve(normalizedRoot, normalizedName);
  if (!isInsideRoot(normalizedRoot, resolved)) {
    throw new SyncServiceError(
      'invalid_workspace_name',
      400,
      'workspaceName が許可範囲外を指しています。',
    );
  }
  return resolved;
};

/**
 * パスを rsync のディレクトリ同期用に末尾 `/` 付きへ整える。
 * @param targetPath 元の絶対パス
 */
export const toDirectorySyncPath = (targetPath: string): string => {
  return targetPath.endsWith('/') ? targetPath : `${targetPath}/`;
};
