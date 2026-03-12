import {
  FilePenLineIcon,
  TerminalSquareIcon,
  XIcon,
} from 'lucide-react';

import type { TerminalSummary, TerminalStatus } from '../../api/terminals';
import { Card, CardContent } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import { EditorPane } from '../editor/EditorPane';
import { TerminalPane } from '../terminal/TerminalPane';
import type { TerminalStreamEvent } from '../terminal/protocol';
import type { WorkbenchTab } from './types';

interface WorkbenchTabsPanelProps {
  readonly workbenchTabs: readonly WorkbenchTab[];
  readonly activeWorkbenchTabId: string | null;
  readonly activeWorkbenchTab: WorkbenchTab | null;
  readonly terminals: readonly TerminalSummary[];
  readonly selectedFilePath: string | null;
  readonly editorContent: string;
  readonly isLoadingEditorFile: boolean;
  readonly isSavingEditorFile: boolean;
  readonly isEditorDirty: boolean;
  readonly isSelectedFileBookmarked: boolean;
  readonly editorWorkspaceRoot: string | null;
  readonly editorLoadError: string | null;
  readonly editorSaveError: string | null;
  readonly editorSaveStatus: string | null;
  readonly terminalStatus: TerminalStatus | null;
  readonly isKillDisabled: boolean;
  readonly onActivateWorkbenchTab: (tab: WorkbenchTab) => void;
  readonly onCloseWorkbenchTab: (tabId: string) => void;
  readonly onTerminalStreamEvent: (event: TerminalStreamEvent) => void;
  readonly onToast: (message: string) => void;
  readonly onKillTerminal: () => void;
  readonly onChangeEditorContent: (value: string) => void;
  readonly onSaveEditorFile: () => void;
  readonly onToggleBookmark: () => void;
  readonly toTerminalTabLabel: (terminal: TerminalSummary | null) => string;
  readonly toFileTabLabel: (path: string) => string;
  readonly editorUpdatedStatusLabel: string | null;
}

/**
 * タブ付きワークベンチ本体を表示し、terminal/editor を切り替える。
 * @param props タブ状態と terminal/editor の表示に必要な値
 */
export const WorkbenchTabsPanel = (props: WorkbenchTabsPanelProps) => {
  const {
    workbenchTabs,
    activeWorkbenchTabId,
    activeWorkbenchTab,
    terminals,
    selectedFilePath,
    editorContent,
    isLoadingEditorFile,
    isSavingEditorFile,
    isEditorDirty,
    isSelectedFileBookmarked,
    editorWorkspaceRoot,
    editorLoadError,
    editorSaveError,
    editorSaveStatus,
    terminalStatus,
    isKillDisabled,
    onActivateWorkbenchTab,
    onCloseWorkbenchTab,
    onTerminalStreamEvent,
    onToast,
    onKillTerminal,
    onChangeEditorContent,
    onSaveEditorFile,
    onToggleBookmark,
    toTerminalTabLabel,
    toFileTabLabel,
    editorUpdatedStatusLabel,
  } = props;

  return (
    <Card className="mx-2 mb-2 h-[calc(100%-0.5rem)] min-h-0 border-white/10 bg-[#171717] md:mx-0 md:mb-0 md:h-full">
      <CardContent className="grid h-full min-h-0 grid-rows-[auto_1fr] p-0">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-black/20 px-2 py-2 pl-14 md:pl-2">
          {workbenchTabs.length === 0 ? (
            <div className="px-2 py-1 text-xs text-[#8d8d8d]">
              Open a file from the directory tree or create a terminal tab.
            </div>
          ) : null}
          {workbenchTabs.map((tab) => {
            const isActive = tab.id === activeWorkbenchTabId;
            const isDirtyTab =
              tab.kind === 'editor' &&
              tab.resourceId === selectedFilePath &&
              isEditorDirty;
            const terminalForTab =
              tab.kind === 'terminal'
                ? terminals.find((terminal) => terminal.id === tab.resourceId) ?? null
                : null;

            return (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  'group inline-flex max-w-[14rem] items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors sm:max-w-72',
                  isActive
                    ? 'border-white/30 bg-white/12 text-white'
                    : 'border-white/10 bg-white/3 text-[#cfcfcf] hover:bg-white/8',
                )}
                onClick={() => onActivateWorkbenchTab(tab)}
              >
                {tab.kind === 'terminal' ? (
                  <TerminalSquareIcon className="size-3.5 shrink-0" />
                ) : (
                  <FilePenLineIcon className="size-3.5 shrink-0" />
                )}
                <span className="truncate">
                  {tab.kind === 'terminal'
                    ? toTerminalTabLabel(terminalForTab)
                    : toFileTabLabel(tab.resourceId)}
                </span>
                {isDirtyTab ? <span className="text-[10px] text-amber-300">*</span> : null}
                <span
                  className="ml-1 rounded p-0.5 text-[#9f9f9f] hover:bg-white/10 hover:text-white"
                  role="button"
                  aria-label="Close tab"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseWorkbenchTab(tab.id);
                  }}
                >
                  <XIcon className="size-3" />
                </span>
              </button>
            );
          })}
        </div>

        <div className="min-h-0 min-w-0 p-2 sm:p-3">
          {activeWorkbenchTab?.kind === 'terminal' ? (
            <TerminalPane
              terminalId={activeWorkbenchTab.resourceId}
              status={terminalStatus}
              onStreamEvent={onTerminalStreamEvent}
              onToast={onToast}
              onKill={onKillTerminal}
              isKillDisabled={isKillDisabled}
            />
          ) : null}

          {activeWorkbenchTab?.kind === 'editor' ? (
            <EditorPane
              filePath={selectedFilePath}
              content={editorContent}
              isLoading={isLoadingEditorFile}
              isSaving={isSavingEditorFile}
              isDirty={isEditorDirty}
              isBookmarked={isSelectedFileBookmarked}
              errorMessage={editorWorkspaceRoot === null ? 'WORKSPACE_ROOT is not configured.' : editorLoadError}
              saveErrorMessage={editorSaveError}
              saveStatusMessage={editorSaveStatus ?? editorUpdatedStatusLabel}
              onChange={onChangeEditorContent}
              onSave={onSaveEditorFile}
              onToggleBookmark={onToggleBookmark}
            />
          ) : null}

          {!activeWorkbenchTab ? (
            <div className="grid h-full place-items-center rounded-xl border border-dashed border-white/15 bg-black/20 p-6 text-center text-sm text-[#9f9f9f]">
              No active tab. Open a file from the directory tree or create a terminal.
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};
