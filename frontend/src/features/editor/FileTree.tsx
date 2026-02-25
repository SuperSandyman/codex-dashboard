import { useMemo, useState } from 'react';

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
    <div className="editor-tree">
      <div className="editor-bookmark-section">
        <div className="editor-bookmark-header-row">
          <div className="editor-bookmark-header">Bookmarks ({bookmarks.length})</div>
          <button
            className="editor-bookmark-toggle"
            type="button"
            aria-expanded={isBookmarkSectionOpen}
            onClick={() => setIsBookmarkSectionOpen((prev) => !prev)}
          >
            {isBookmarkSectionOpen ? 'Hide' : 'Show'}
          </button>
        </div>
        {isBookmarkSectionOpen && isLoadingBookmarks ? (
          <div className="chat-list-empty">Loading bookmarks...</div>
        ) : null}
        {isBookmarkSectionOpen && !isLoadingBookmarks && bookmarks.length === 0 ? (
          <div className="chat-list-empty">No bookmarks</div>
        ) : null}
        {isBookmarkSectionOpen && !isLoadingBookmarks && bookmarks.length > 0 ? (
          <div className="editor-bookmark-list">
            {bookmarks.map((bookmark) => {
              const isSelected = bookmark.path === selectedFilePath;
              const isPending = bookmark.path === bookmarkPendingPath;
              return (
                <button
                  key={bookmark.path}
                  className={`editor-bookmark-item${isSelected ? ' selected' : ''}`}
                  type="button"
                  onClick={() => onSelectBookmark(bookmark.path)}
                  disabled={isPending}
                >
                  <span className="editor-bookmark-label">{bookmark.label}</span>
                  <span className="editor-bookmark-path">{bookmark.path}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="editor-path-line">
        <button className="editor-path-button" type="button" onClick={() => onOpenDirectory('')}>
          root
        </button>
        {segments.map((segment, index) => {
          const segmentPath = segments.slice(0, index + 1).join('/');
          return (
            <span key={segmentPath} className="editor-path-segment">
              <span className="editor-path-separator">/</span>
              <button
                className="editor-path-button"
                type="button"
                onClick={() => onOpenDirectory(segmentPath)}
              >
                {segment}
              </button>
            </span>
          );
        })}
      </div>

      {isLoading ? <div className="chat-list-empty">Loading tree...</div> : null}
      {!isLoading && errorMessage ? <div className="chat-list-empty">{errorMessage}</div> : null}
      {!isLoading && !errorMessage && nodes.length === 0 ? (
        <div className="chat-list-empty">No files</div>
      ) : null}

      {!isLoading && !errorMessage ? (
        <div className="editor-tree-list">
          {currentPath ? (
            <button
              className="editor-tree-item"
              type="button"
              onClick={() => {
                const parentSegments = currentPath
                  .split('/')
                  .filter((segment) => segment.length > 0);
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
                className={`editor-tree-item${isSelected ? ' selected' : ''}`}
                type="button"
                onClick={() => {
                  if (node.kind === 'directory') {
                    onOpenDirectory(node.path);
                    return;
                  }
                  onSelectFile(node.path);
                }}
              >
                <span className="editor-tree-kind">{node.kind === 'directory' ? 'DIR' : 'FILE'}</span>
                <span className="editor-tree-name">{node.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
