import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ChevronRightIcon,
  FileArchiveIcon,
  FileCodeIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTerminalIcon,
  FileTextIcon,
  FileTypeIcon,
  FileVideoCameraIcon,
  FolderIcon,
  FolderOpenIcon,
  type LucideIcon,
} from 'lucide-react';

import type { EditorTreeNode } from '../../api/editor';
import { cn } from '../../lib/utils';
import type { EditorFileBookmark } from './bookmarks/types';

export interface EditorDirectoryLoadResult {
  readonly ok: boolean;
  readonly nodes: readonly EditorTreeNode[];
  readonly message: string | null;
}

interface FileTreeProps {
  readonly selectedFilePath: string | null;
  readonly bookmarks: readonly EditorFileBookmark[];
  readonly errorMessage: string | null;
  readonly onLoadDirectory: (path: string) => Promise<EditorDirectoryLoadResult>;
  readonly onSelectFile: (path: string) => void;
}

interface TreeRow {
  readonly node: EditorTreeNode;
  readonly depth: number;
}

const ROOT_PATH = '';

const sortNodes = (nodes: readonly EditorTreeNode[]): EditorTreeNode[] => {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
};

const toAncestorDirectories = (filePath: string): string[] => {
  const segments = filePath.split('/').filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return [ROOT_PATH];
  }

  const directories: string[] = [ROOT_PATH];
  let current = '';
  for (let index = 0; index < segments.length - 1; index += 1) {
    current = current.length > 0 ? `${current}/${segments[index]}` : segments[index]!;
    directories.push(current);
  }
  return directories;
};

interface FileIconToken {
  readonly Icon: LucideIcon;
  readonly className: string;
}

const CODE_FILE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'php',
  'java',
  'go',
  'rs',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'cs',
  'swift',
  'kt',
  'scala',
  'sh',
  'bash',
  'zsh',
]);

const TERMINAL_FILE_EXTENSIONS = new Set(['env', 'ini', 'cfg', 'conf', 'toml', 'service']);
const DATA_FILE_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'xml', 'csv', 'tsv']);
const MARKUP_FILE_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'html', 'css', 'scss', 'less']);
const SHEET_FILE_EXTENSIONS = new Set(['xls', 'xlsx', 'ods']);
const IMAGE_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif']);
const VIDEO_FILE_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi']);
const ARCHIVE_FILE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz']);

const resolveFileIconToken = (fileName: string): FileIconToken => {
  const extensionIndex = fileName.lastIndexOf('.');
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex + 1).toLowerCase() : '';

  if (CODE_FILE_EXTENSIONS.has(extension)) {
    return { Icon: FileCodeIcon, className: 'text-sky-300/90' };
  }
  if (TERMINAL_FILE_EXTENSIONS.has(extension)) {
    return { Icon: FileTerminalIcon, className: 'text-emerald-300/90' };
  }
  if (DATA_FILE_EXTENSIONS.has(extension)) {
    return { Icon: FileTypeIcon, className: 'text-cyan-300/90' };
  }
  if (MARKUP_FILE_EXTENSIONS.has(extension)) {
    return { Icon: FileTextIcon, className: 'text-zinc-300/90' };
  }
  if (SHEET_FILE_EXTENSIONS.has(extension)) {
    return { Icon: FileSpreadsheetIcon, className: 'text-green-300/90' };
  }
  if (IMAGE_FILE_EXTENSIONS.has(extension)) {
    return { Icon: FileImageIcon, className: 'text-amber-300/90' };
  }
  if (VIDEO_FILE_EXTENSIONS.has(extension)) {
    return { Icon: FileVideoCameraIcon, className: 'text-violet-300/90' };
  }
  if (ARCHIVE_FILE_EXTENSIONS.has(extension)) {
    return { Icon: FileArchiveIcon, className: 'text-orange-300/90' };
  }
  return { Icon: FileTextIcon, className: 'text-zinc-400' };
};

/**
 * VS Code 風の階層型ディレクトリツリー。
 * @param props 選択状態とディレクトリ読み込みハンドラ
 */
export const FileTree = ({
  selectedFilePath,
  bookmarks,
  errorMessage,
  onLoadDirectory,
  onSelectFile,
}: FileTreeProps) => {
  const [nodesByDirectory, setNodesByDirectory] = useState<Record<string, readonly EditorTreeNode[]>>({});
  const [manuallyExpandedDirectories, setManuallyExpandedDirectories] = useState<Set<string>>(
    () => new Set([ROOT_PATH]),
  );
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set());
  const [treeErrorMessage, setTreeErrorMessage] = useState<string | null>(null);
  const nodesByDirectoryRef = useRef<Record<string, readonly EditorTreeNode[]>>({});
  const loadingDirectoriesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    nodesByDirectoryRef.current = nodesByDirectory;
  }, [nodesByDirectory]);

  useEffect(() => {
    loadingDirectoriesRef.current = loadingDirectories;
  }, [loadingDirectories]);

  const bookmarkedPaths = useMemo(() => {
    return new Set(bookmarks.map((bookmark) => bookmark.path));
  }, [bookmarks]);

  const directoriesToEnsure = useMemo(() => {
    if (!selectedFilePath) {
      return [ROOT_PATH];
    }
    return toAncestorDirectories(selectedFilePath);
  }, [selectedFilePath]);

  const expandedDirectories = useMemo(() => {
    const next = new Set(manuallyExpandedDirectories);
    directoriesToEnsure.forEach((directory) => next.add(directory));
    next.add(ROOT_PATH);
    return next;
  }, [directoriesToEnsure, manuallyExpandedDirectories]);

  const ensureDirectoryLoaded = useCallback(
    async (path: string) => {
      if (loadingDirectoriesRef.current.has(path) || nodesByDirectoryRef.current[path]) {
        return;
      }
      setLoadingDirectories((prev) => {
        const next = new Set(prev);
        next.add(path);
        loadingDirectoriesRef.current = next;
        return next;
      });

      const result = await onLoadDirectory(path);
      if (!result.ok) {
        setTreeErrorMessage(result.message ?? 'Failed to load directory tree');
      } else {
        setTreeErrorMessage(null);
        setNodesByDirectory((prev) => {
          const next = {
            ...prev,
            [path]: sortNodes(result.nodes),
          };
          nodesByDirectoryRef.current = next;
          return next;
        });
      }

      setLoadingDirectories((prev) => {
        const next = new Set(prev);
        next.delete(path);
        loadingDirectoriesRef.current = next;
        return next;
      });
    },
    [onLoadDirectory],
  );

  useEffect(() => {
    let isCancelled = false;
    const timerId = window.setTimeout(() => {
      void (async () => {
        for (const directory of directoriesToEnsure) {
          if (isCancelled) {
            return;
          }
          await ensureDirectoryLoaded(directory);
        }
      })();
    }, 0);
    return () => {
      isCancelled = true;
      window.clearTimeout(timerId);
    };
  }, [directoriesToEnsure, ensureDirectoryLoaded]);

  const rows = useMemo(() => {
    const nextRows: TreeRow[] = [];

    const walk = (directoryPath: string, depth: number) => {
      const nodes = nodesByDirectory[directoryPath] ?? [];
      nodes.forEach((node) => {
        nextRows.push({ node, depth });
        if (node.kind === 'directory' && expandedDirectories.has(node.path)) {
          walk(node.path, depth + 1);
        }
      });
    };

    walk(ROOT_PATH, 0);
    return nextRows;
  }, [expandedDirectories, nodesByDirectory]);

  const toggleDirectory = useCallback(
    (directoryPath: string) => {
      setManuallyExpandedDirectories((prev) => {
        const next = new Set(prev);
        if (next.has(directoryPath)) {
          next.delete(directoryPath);
        } else {
          next.add(directoryPath);
        }
        return next;
      });

      void ensureDirectoryLoaded(directoryPath);
    },
    [ensureDirectoryLoaded],
  );

  const handleRowClick = useCallback(
    (node: EditorTreeNode) => {
      if (node.kind === 'directory') {
        toggleDirectory(node.path);
        return;
      }
      onSelectFile(node.path);
    },
    [onSelectFile, toggleDirectory],
  );

  const isRootLoading = loadingDirectories.has(ROOT_PATH) && !nodesByDirectory[ROOT_PATH];
  const visibleErrorMessage = errorMessage ?? treeErrorMessage;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#181818] text-[13px] text-zinc-300">
      <div className="px-2 py-1 text-[11px] text-zinc-500">
        <span className="uppercase tracking-wide">Explorer</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#181818] px-1 [scrollbar-width:thin]">
        {visibleErrorMessage ? (
          <div className="px-2 py-2 text-xs text-red-300">{visibleErrorMessage}</div>
        ) : null}
        {isRootLoading ? (
          <div className="px-2 py-2 text-xs text-zinc-500">Loading tree...</div>
        ) : null}
        {!isRootLoading && !visibleErrorMessage && rows.length === 0 ? (
          <div className="px-2 py-2 text-xs text-zinc-500">No files</div>
        ) : null}

        <div role="tree" className="grid">
          {rows.map((row) => {
            const { node, depth } = row;
            const isDirectory = node.kind === 'directory';
            const fileIconToken = resolveFileIconToken(node.name);
            const isExpanded = isDirectory && expandedDirectories.has(node.path);
            const isSelected = !isDirectory && selectedFilePath === node.path;
            const isLoadingChildren = isDirectory && loadingDirectories.has(node.path);
            const isBookmarked = !isDirectory && bookmarkedPaths.has(node.path);

            return (
              <div
                key={node.path}
                role="treeitem"
                aria-level={depth + 1}
                aria-expanded={isDirectory ? isExpanded : undefined}
                tabIndex={0}
                className={cn(
                  'group flex h-6 items-center rounded-sm pr-1 text-[12px] leading-none outline-none transition-colors',
                  isSelected ? 'bg-white/12 text-zinc-100' : 'text-zinc-300 hover:bg-white/6',
                  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/20',
                )}
                style={{ paddingLeft: `${4 + depth * 14}px` }}
                onClick={() => handleRowClick(node)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleRowClick(node);
                  }
                }}
              >
                {isDirectory && node.hasChildren ? (
                  <button
                    className="mr-0.5 inline-flex size-4 items-center justify-center rounded-sm text-zinc-500 transition-colors hover:bg-white/6 hover:text-zinc-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/20"
                    type="button"
                    aria-label={isExpanded ? 'Collapse directory' : 'Expand directory'}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleDirectory(node.path);
                    }}
                  >
                    <ChevronRightIcon
                      className={cn(
                        'size-3 transition-transform duration-150',
                        isExpanded ? 'rotate-90' : 'rotate-0',
                      )}
                    />
                  </button>
                ) : (
                  <span className="mr-0.5 inline-block size-4" />
                )}

                <span className="mr-1 inline-flex size-3.5 shrink-0 items-center justify-center text-zinc-400">
                  {isDirectory ? (
                    isExpanded ? <FolderOpenIcon className="size-3.5" /> : <FolderIcon className="size-3.5" />
                  ) : (
                    <fileIconToken.Icon className={cn('size-3.5', fileIconToken.className)} />
                  )}
                </span>

                <span className="min-w-0 flex-1 truncate">{node.name}</span>

                {isLoadingChildren ? <span className="ml-2 text-[10px] text-zinc-500">...</span> : null}
                {isBookmarked ? <span className="ml-2 text-[10px] text-zinc-500">B</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
