import { useMemo } from 'react';

import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { getLanguageExtension } from './getLanguageExtension';

interface EditorPaneProps {
  readonly filePath: string | null;
  readonly content: string;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly isDirty: boolean;
  readonly isBookmarked: boolean;
  readonly errorMessage: string | null;
  readonly saveErrorMessage: string | null;
  readonly saveStatusMessage: string | null;
  readonly onChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onToggleBookmark: () => void;
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
  isBookmarked,
  errorMessage,
  saveErrorMessage,
  saveStatusMessage,
  onChange,
  onSave,
  onToggleBookmark,
}: EditorPaneProps) => {
  const languageExtensions = useMemo(() => {
    if (!filePath) {
      return [];
    }
    return getLanguageExtension(filePath);
  }, [filePath]);

  if (!filePath) {
    return <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">Select a file from the tree.</div>;
  }

  if (isLoading) {
    return <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">Loading file...</div>;
  }

  if (errorMessage) {
    return <div className="grid h-full place-items-center p-6 text-sm text-red-300">{errorMessage}</div>;
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_1fr] gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/80 px-3 py-2">
        <div
          className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted-foreground"
          onTouchStart={(event) => event.stopPropagation()}
          onTouchEnd={(event) => event.stopPropagation()}
          title={filePath}
        >
          {filePath}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" type="button" onClick={onToggleBookmark}>
            {isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
          </Button>
          <Badge variant={isDirty ? 'destructive' : 'success'}>{isDirty ? 'Unsaved' : 'Saved'}</Badge>
          <Button type="button" size="sm" onClick={onSave} disabled={isSaving || !isDirty}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid gap-1">
        {saveErrorMessage ? (
          <div className="rounded-md border border-red-300/40 bg-red-500/15 px-3 py-1.5 text-xs text-red-200">{saveErrorMessage}</div>
        ) : null}
        {saveStatusMessage ? (
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">{saveStatusMessage}</div>
        ) : null}
      </div>

      <div className="min-h-0 overflow-hidden rounded-xl border border-border/60">
        <CodeMirror
          className="h-full"
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
