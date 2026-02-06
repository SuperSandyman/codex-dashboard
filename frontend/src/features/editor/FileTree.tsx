import { useMemo } from 'react';

import type { EditorTreeNode } from '../../api/editor';

interface FileTreeProps {
  readonly currentPath: string;
  readonly selectedFilePath: string | null;
  readonly isLoading: boolean;
  readonly nodes: readonly EditorTreeNode[];
  readonly errorMessage: string | null;
  readonly onOpenDirectory: (path: string) => void;
  readonly onSelectFile: (path: string) => void;
}

/**
 * Editor 用のディレクトリ一覧とファイル選択 UI。
 * @param props 表示状態と選択ハンドラ
 */
export const FileTree = ({
  currentPath,
  selectedFilePath,
  isLoading,
  nodes,
  errorMessage,
  onOpenDirectory,
  onSelectFile,
}: FileTreeProps) => {
  const segments = useMemo(() => {
    if (!currentPath) {
      return [] as string[];
    }
    return currentPath.split('/').filter((segment) => segment.length > 0);
  }, [currentPath]);

  return (
    <div className="editor-tree">
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
            <button className="editor-tree-item" type="button" onClick={() => {
              const parentSegments = currentPath.split('/').filter((segment) => segment.length > 0);
              parentSegments.pop();
              onOpenDirectory(parentSegments.join('/'));
            }}>
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
