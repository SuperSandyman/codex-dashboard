import { useMemo, useState } from 'react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Separator } from '../../components/ui/separator';
import type { EditorTreeNode } from '../../api/editor';
import type { EditorFileBookmark } from './bookmarks/types';

interface FileTreeProps {
  readonly currentPath: string;
  readonly selectedFilePath: string | null;
  readonly isLoading: boolean;
  readonly isLoadingBookmarks: boolean;
  readonly bookmarkPendingPath: string | null;
  readonly bookmarks: readonly EditorFileBookmark[];
  readonly nodes: readonly EditorTreeNode[];
  readonly errorMessage: string | null;
  readonly onOpenDirectory: (path: string) => void;
  readonly onSelectFile: (path: string) => void;
  readonly onSelectBookmark: (path: string) => void;
}

/**
 * Editor 用のディレクトリ一覧とファイル選択 UI。
 * @param props 表示状態と選択ハンドラ
 */
export const FileTree = ({
  currentPath,
  selectedFilePath,
  isLoading,
  isLoadingBookmarks,
  bookmarkPendingPath,
  bookmarks,
  nodes,
  errorMessage,
  onOpenDirectory,
  onSelectFile,
  onSelectBookmark,
}: FileTreeProps) => {
  const [isBookmarkSectionOpen, setIsBookmarkSectionOpen] = useState(false);

  const segments = useMemo(() => {
    if (!currentPath) {
      return [] as string[];
    }
    return currentPath.split('/').filter((segment) => segment.length > 0);
  }, [currentPath]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_1fr] gap-2">
      <div className="rounded-xl border border-border/60 bg-card/80 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Bookmarks</div>
          <Badge variant="outline">{bookmarks.length}</Badge>
        </div>
        <Button
          className="w-full"
          variant="outline"
          size="sm"
          type="button"
          aria-expanded={isBookmarkSectionOpen}
          onClick={() => setIsBookmarkSectionOpen((prev) => !prev)}
        >
          {isBookmarkSectionOpen ? 'Hide' : 'Show'}
        </Button>

        {isBookmarkSectionOpen ? (
          <div className="mt-2 grid max-h-36 gap-1 overflow-y-auto">
            {isLoadingBookmarks ? <div className="text-xs text-muted-foreground">Loading bookmarks...</div> : null}
            {!isLoadingBookmarks && bookmarks.length === 0 ? (
              <div className="text-xs text-muted-foreground">No bookmarks</div>
            ) : null}
            {!isLoadingBookmarks && bookmarks.length > 0
              ? bookmarks.map((bookmark) => {
                const isSelected = bookmark.path === selectedFilePath;
                const isPending = bookmark.path === bookmarkPendingPath;
                return (
                  <button
                    key={bookmark.path}
                    className={`rounded-md border px-2 py-1 text-left transition-colors ${
                      isSelected
                        ? 'border-primary/60 bg-primary/15 text-primary'
                        : 'border-border/60 bg-background/60 hover:bg-accent/70'
                    }`}
                    type="button"
                    onClick={() => onSelectBookmark(bookmark.path)}
                    disabled={isPending}
                  >
                    <div className="truncate text-xs font-medium">{bookmark.label}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{bookmark.path}</div>
                  </button>
                );
              })
              : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-border/60 bg-card/80 p-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Path</div>
        <Input value={currentPath || '/'} disabled />
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <button className="rounded px-1.5 py-0.5 hover:bg-accent/70" type="button" onClick={() => onOpenDirectory('')}>
            root
          </button>
          {segments.map((segment, index) => {
            const segmentPath = segments.slice(0, index + 1).join('/');
            return (
              <span key={segmentPath} className="inline-flex items-center gap-1">
                <span className="text-muted-foreground">/</span>
                <button
                  className="rounded px-1.5 py-0.5 hover:bg-accent/70"
                  type="button"
                  onClick={() => onOpenDirectory(segmentPath)}
                >
                  {segment}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 overflow-hidden rounded-xl border border-border/60 bg-card/70 p-2">
        <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Files</div>
        <Separator className="mb-2" />

        {isLoading ? <div className="px-2 py-1 text-xs text-muted-foreground">Loading tree...</div> : null}
        {!isLoading && errorMessage ? <div className="px-2 py-1 text-xs text-red-300">{errorMessage}</div> : null}
        {!isLoading && !errorMessage && nodes.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">No files</div>
        ) : null}

        {!isLoading && !errorMessage ? (
          <div className="grid max-h-full gap-1 overflow-y-auto">
            {currentPath ? (
              <button
                className="rounded-md border border-border/60 bg-background/60 px-2 py-1 text-left text-xs hover:bg-accent/70"
                type="button"
                onClick={() => {
                  const parentSegments = currentPath.split('/').filter((segment) => segment.length > 0);
                  parentSegments.pop();
                  onOpenDirectory(parentSegments.join('/'));
                }}
              >
                ..
              </button>
            ) : null}
            {nodes.map((node) => {
              const isSelected = node.kind === 'file' && node.path === selectedFilePath;
              return (
                <button
                  key={node.path}
                  className={`rounded-md border px-2 py-1 text-left text-xs transition-colors ${
                    isSelected
                      ? 'border-primary/60 bg-primary/15 text-primary'
                      : 'border-border/60 bg-background/60 hover:bg-accent/70'
                  }`}
                  type="button"
                  onClick={() => {
                    if (node.kind === 'directory') {
                      onOpenDirectory(node.path);
                      return;
                    }
                    onSelectFile(node.path);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      {node.kind === 'directory' ? 'DIR' : 'FILE'}
                    </Badge>
                    <span className="truncate">{node.name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};
