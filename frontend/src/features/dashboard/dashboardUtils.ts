import type {
  ChatApprovalPolicy,
  ChatApprovalRequest,
  ChatLaunchOptions,
  ChatModelOption,
  ChatSandboxMode,
  ChatUserInputRequest,
} from '../../api/chats';
import type { TerminalCatalog, TerminalSummary } from '../../api/terminals';
import type { EditorFileBookmark } from '../editor/bookmarks/types';
import type { WorkbenchTabKind } from '../workbench/types';

export interface SessionDirectoryRequest {
  readonly workspaceRoot: string;
  readonly promise: Promise<readonly string[]>;
}

export interface SessionDirectoryCache {
  readonly workspaceRoot: string;
  readonly fetchedAt: number;
  readonly directories: readonly string[];
}

export const MOBILE_BREAKPOINT_MEDIA_QUERY = '(max-width: 720px)';
export const SESSION_DIRECTORY_CACHE_TTL_MS = 60_000;

export const EMPTY_LAUNCH_OPTIONS: ChatLaunchOptions = {
  model: null,
  effort: null,
  cwd: null,
  approvalPolicy: null,
  sandboxMode: null,
};

export const EMPTY_TERMINAL_CATALOG: TerminalCatalog = {
  workspaceRoot: null,
  cwdChoices: [],
  profiles: [],
};

/**
 * ワークベンチタブの識別子を生成する。
 * @param kind タブ種別
 * @param resourceId 紐づく terminal/file の識別子
 * @returns 一意なタブ ID
 */
export const toWorkbenchTabId = (kind: WorkbenchTabKind, resourceId: string): string => {
  return `${kind}:${resourceId}`;
};

/**
 * ファイルパスからタブラベルを生成する。
 * @param path ワークスペース相対パス
 * @returns 表示用ラベル
 */
export const toFileTabLabel = (path: string): string => {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
};

/**
 * terminal summary からタブラベルを生成する。
 * @param terminal 対象 terminal
 * @returns 表示用ラベル
 */
export const toTerminalTabLabel = (terminal: TerminalSummary | null): string => {
  if (!terminal) {
    return 'Terminal';
  }
  const cwdSegments = terminal.cwd.split('/').filter((segment) => segment.length > 0);
  const cwdLabel = cwdSegments[cwdSegments.length - 1] ?? terminal.cwd;
  return `${cwdLabel} (${terminal.id.slice(0, 6)})`;
};

/**
 * チャット一覧のラベル長を制御する。
 * @param preview 元の preview 文字列
 * @returns 省略済みラベル
 */
export const toChatSidebarLabel = (preview: string): string => {
  const normalized = preview.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 28) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}…`;
};

/**
 * chat stream の WebSocket URL を構築する。
 * @param threadId chat thread id
 * @returns 接続先 URL
 */
export const buildChatWsUrl = (threadId: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws/chats/${encodeURIComponent(threadId)}`;
};

/**
 * ISO 日時を短い相対表示向けフォーマットに変換する。
 * @param iso ISO8601 文字列
 * @returns 表示用ラベル
 */
export const formatRelative = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

/**
 * モデル一覧から既定モデルを解決する。
 * @param models 利用可能なモデル一覧
 * @returns 既定モデル ID。見つからなければ先頭
 */
export const resolveModelDefault = (models: readonly ChatModelOption[]): string | null => {
  const defaultModel = models.find((model) => model.isDefault);
  if (defaultModel) {
    return defaultModel.id;
  }
  return models[0]?.id ?? null;
};

/**
 * 選択モデルに対応する effort を解決する。
 * @param models モデル一覧
 * @param modelId 対象モデル ID
 * @param currentEffort 現在の effort
 * @returns 利用可能な effort。モデル未選択時は null
 */
export const resolveEffortForModel = (
  models: readonly ChatModelOption[],
  modelId: string | null,
  currentEffort: string | null,
): string | null => {
  if (!modelId) {
    return null;
  }
  const model = models.find((entry) => entry.id === modelId) ?? null;
  if (!model) {
    return null;
  }
  if (currentEffort && model.efforts.includes(currentEffort)) {
    return currentEffort;
  }
  return model.defaultEffort ?? model.efforts[0] ?? null;
};

/**
 * approval policy の表示ラベルを返す。
 * @param value approval policy
 * @returns 表示ラベル
 */
export const formatApprovalPolicyLabel = (value: ChatApprovalPolicy): string => {
  switch (value) {
    case 'untrusted':
      return 'Untrusted';
    case 'on-failure':
      return 'On Failure';
    case 'on-request':
      return 'On Request';
    case 'never':
      return 'Never';
    default:
      return value;
  }
};

/**
 * sandbox mode の表示ラベルを返す。
 * @param value sandbox mode
 * @returns 表示ラベル
 */
export const formatSandboxModeLabel = (value: ChatSandboxMode): string => {
  switch (value) {
    case 'read-only':
      return 'Read Only';
    case 'workspace-write':
      return 'Workspace Write';
    case 'danger-full-access':
      return 'Danger Full Access';
    default:
      return value;
  }
};

/**
 * approval request を itemId 基準で upsert する。
 * @param approvals 現在の request 一覧
 * @param next 新しい request
 * @returns 更新後一覧
 */
export const upsertApprovalRequest = (
  approvals: readonly ChatApprovalRequest[],
  next: ChatApprovalRequest,
): ChatApprovalRequest[] => {
  const index = approvals.findIndex((entry) => entry.itemId === next.itemId);
  if (index < 0) {
    return [...approvals, next];
  }
  const copy = [...approvals];
  copy[index] = next;
  return copy;
};

/**
 * user input request を itemId 基準で upsert する。
 * @param requests 現在の request 一覧
 * @param next 新しい request
 * @returns 更新後一覧
 */
export const upsertUserInputRequest = (
  requests: readonly ChatUserInputRequest[],
  next: ChatUserInputRequest,
): ChatUserInputRequest[] => {
  const index = requests.findIndex((entry) => entry.itemId === next.itemId);
  if (index < 0) {
    return [...requests, next];
  }
  const copy = [...requests];
  copy[index] = next;
  return copy;
};

/**
 * terminal 一覧を updatedAt 降順に整列する。
 * @param terminals terminal 一覧
 * @returns ソート済み配列
 */
export const sortTerminalsByUpdatedAt = (terminals: readonly TerminalSummary[]): TerminalSummary[] => {
  return [...terminals].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
};

const trimTrailingSlash = (value: string): string => {
  if (value === '/') {
    return value;
  }
  return value.replace(/\/+$/, '');
};

/**
 * ワークスペース相対パスを絶対パスへ解決する。
 * @param workspaceRoot ワークスペースルート
 * @param relativePath ワークスペース相対パス
 * @returns 絶対パス
 */
export const toAbsoluteWorkspacePath = (workspaceRoot: string, relativePath: string): string => {
  const normalizedRoot = trimTrailingSlash(workspaceRoot);
  const normalizedRelative = relativePath.replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (normalizedRelative.length === 0) {
    return normalizedRoot;
  }
  return `${normalizedRoot}/${normalizedRelative}`;
};

/**
 * 絶対パスが workspace 配下なら相対パスへ変換する。
 * @param workspaceRoot ワークスペースルート
 * @param absolutePath 絶対パス
 * @returns 相対パス。配下でなければ null
 */
export const toRelativeWorkspacePath = (workspaceRoot: string, absolutePath: string): string | null => {
  const normalizedRoot = trimTrailingSlash(workspaceRoot);
  const normalizedPath = trimTrailingSlash(absolutePath);
  if (normalizedPath === normalizedRoot) {
    return '';
  }
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return null;
  }
  return normalizedPath.slice(normalizedRoot.length + 1);
};

/**
 * ディレクトリ入力欄の値を API 用 path に正規化する。
 * @param workspaceRoot ワークスペースルート
 * @param rawValue 入力文字列
 * @returns 正規化後 path。空なら null
 */
export const resolveDirectoryInputValue = (
  workspaceRoot: string | null,
  rawValue: string,
): string | null => {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0 || trimmed === '.' || trimmed === './') {
    return null;
  }
  if (!workspaceRoot || trimmed.startsWith('/')) {
    return trimmed;
  }
  const normalizedRelative = trimmed.replace(/^\.\/+/, '');
  if (
    normalizedRelative === '..' ||
    normalizedRelative.startsWith('../') ||
    normalizedRelative.includes('/../')
  ) {
    return trimmed;
  }
  return toAbsoluteWorkspacePath(workspaceRoot, normalizedRelative);
};

/**
 * ディレクトリ候補の表示ラベルを返す。
 * @param workspaceRoot ワークスペースルート
 * @param cwd 対象 cwd
 * @returns 表示用ラベル
 */
export const toDirectoryOptionLabel = (workspaceRoot: string | null, cwd: string): string => {
  if (!workspaceRoot) {
    return cwd;
  }
  const relativePath = toRelativeWorkspacePath(workspaceRoot, cwd);
  if (relativePath === null) {
    return cwd;
  }
  return relativePath.length === 0 ? '.' : `./${relativePath}`;
};

export const countPathDepth = (pathValue: string): number => {
  return pathValue.split('/').filter((segment) => segment.length > 0).length;
};

/**
 * bookmark の短いラベルを生成する。
 * @param path ファイルパス
 * @returns 表示ラベル
 */
export const toBookmarkLabel = (path: string): string => {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
};

/**
 * bookmark を更新日時降順に整列する。
 * @param bookmarks bookmark 一覧
 * @returns ソート済み配列
 */
export const sortBookmarksByUpdatedAt = (
  bookmarks: readonly EditorFileBookmark[],
): EditorFileBookmark[] => {
  return [...bookmarks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

const stripLineInfoFromPath = (value: string): string => {
  return value.replace(/#L\d+(C\d+)?$/, '').replace(/:\d+(?::\d+)?$/, '');
};

const decodePathComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * チャット内リンクからファイルパス部分を抽出して正規化する。
 * @param rawPath メッセージ内の raw path
 * @returns 正規化済み path。空入力なら空文字
 */
export const normalizePathFromChatLink = (rawPath: string): string => {
  const trimmed = rawPath.trim().replace(/^<|>$/g, '').replace(/^['"`]|['"`]$/g, '');
  if (!trimmed) {
    return '';
  }

  const withoutFileScheme = trimmed.replace(/^file:\/\//, '');
  const resolvedUrlPath = (() => {
    try {
      const url = new URL(withoutFileScheme);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return `${url.pathname}${url.hash}`;
      }
    } catch {
      return withoutFileScheme;
    }
    return withoutFileScheme;
  })();

  const decoded = decodePathComponent(resolvedUrlPath);
  const withoutQuery = decoded.split('?')[0] ?? decoded;
  const withoutHash = withoutQuery.split('#')[0] ?? withoutQuery;
  const stripped = stripLineInfoFromPath(withoutHash);
  return stripped.replace(/\\/g, '/').replace(/^\.\/+/, '');
};

/**
 * repo root や worktree を考慮して絶対パスを workspace 相対へ変換する。
 * @param workspaceRoot 現在の workspace root
 * @param absolutePath 絶対パス
 * @returns 相対パス。解決不能なら null
 */
export const toWorkspaceRelativePathFromAbsolute = (
  workspaceRoot: string,
  absolutePath: string,
): string | null => {
  const directRelativePath = toRelativeWorkspacePath(workspaceRoot, absolutePath);
  if (directRelativePath !== null) {
    return directRelativePath;
  }

  const workspaceRepoRoot = workspaceRoot.replace(/\/worktrees\/[^/]+$/, '');
  const relativeFromRepoRoot = toRelativeWorkspacePath(workspaceRepoRoot, absolutePath);
  if (relativeFromRepoRoot === null) {
    return null;
  }

  const adjustedRelativePath = relativeFromRepoRoot.replace(/^worktrees\/[^/]+\//, '');
  if (
    adjustedRelativePath === '..' ||
    adjustedRelativePath.startsWith('../') ||
    adjustedRelativePath.includes('/../')
  ) {
    return null;
  }
  return adjustedRelativePath;
};
