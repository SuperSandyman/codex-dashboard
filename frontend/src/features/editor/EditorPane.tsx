import { useMemo } from 'react';

import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';

import { getLanguageExtension } from './getLanguageExtension';

interface EditorPaneProps {
  readonly filePath: string | null;
  readonly content: string;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly isDirty: boolean;
  readonly errorMessage: string | null;
  readonly saveErrorMessage: string | null;
  readonly saveStatusMessage: string | null;
  readonly onChange: (value: string) => void;
  readonly onSave: () => void;
}

/**
 * CodeMirror ベースのファイル編集ペイン。
 * @param props 表示状態・編集状態・保存ハンドラ
 */
export const EditorPane = ({
  filePath,
  content,
  isLoading,
  isSaving,
  isDirty,
  errorMessage,
  saveErrorMessage,
  saveStatusMessage,
  onChange,
  onSave,
}: EditorPaneProps) => {
  const languageExtensions = useMemo(() => {
    if (!filePath) {
      return [];
    }
    return getLanguageExtension(filePath);
  }, [filePath]);

  if (!filePath) {
    return <div className="chat-empty">Select a file from the tree.</div>;
  }

  if (isLoading) {
    return <div className="chat-empty">Loading file...</div>;
  }

  if (errorMessage) {
    return <div className="chat-empty">{errorMessage}</div>;
  }

  return (
    <div className="editor-pane">
      <div className="editor-pane-header">
        <div
          className="editor-pane-title"
          onTouchStart={(event) => event.stopPropagation()}
          onTouchEnd={(event) => event.stopPropagation()}
        >
          <span className="editor-pane-title-text">{filePath}</span>
        </div>
        <div className="editor-pane-actions">
          <span className={`editor-dirty-badge${isDirty ? ' dirty' : ''}`}>
            {isDirty ? 'Unsaved' : 'Saved'}
          </span>
          <button className="button button-primary" type="button" onClick={onSave} disabled={isSaving || !isDirty}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {saveErrorMessage ? <div className="editor-status editor-status-error">{saveErrorMessage}</div> : null}
      {saveStatusMessage ? <div className="editor-status">{saveStatusMessage}</div> : null}

      <div className="editor-pane-body">
        <CodeMirror
          className="editor-cm-root"
          value={content}
          height="100%"
          theme={oneDark}
          extensions={[...languageExtensions, EditorView.lineWrapping]}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
          }}
        />
      </div>
    </div>
  );
};
