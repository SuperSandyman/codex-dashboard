import {
  FilePenLineIcon,
  MessageSquareIcon,
  PlusIcon,
  TerminalSquareIcon,
} from 'lucide-react';

import type { ChatSummary } from '../../api/chats';
import { Card, CardContent } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import { FileTree, type EditorDirectoryLoadResult } from '../editor/FileTree';
import type { EditorFileBookmark } from '../editor/bookmarks/types';
import type { AppView, WorkbenchTabKind } from './types';

interface SidebarNavigationProps {
  readonly activeView: AppView;
  readonly activeWorkbenchKind: WorkbenchTabKind | null;
  readonly chats: readonly ChatSummary[];
  readonly selectedChatId: string | null;
  readonly isLoadingTerminals: boolean;
  readonly selectedFilePath: string | null;
  readonly bookmarks: readonly EditorFileBookmark[];
  readonly editorWorkspaceRoot: string | null;
  readonly onLoadDirectory: (path: string) => Promise<EditorDirectoryLoadResult>;
  readonly onSelectFile: (path: string) => void;
  readonly onOpenChatView: () => void;
  readonly onSelectChat: (chatId: string) => void;
  readonly onCreateChat: () => void;
  readonly onOpenTerminalWorkbench: () => void;
  readonly onCreateTerminal: () => void;
  readonly onOpenEditorWorkbench: () => void;
  readonly toChatSidebarLabel: (preview: string) => string;
}

const toSidebarRowClassName = (isSelected: boolean): string => {
  return cn(
    'flex w-full items-center gap-3 rounded-none px-2.5 py-2 text-left text-sm transition-colors',
    isSelected ? 'bg-white/14 text-white' : 'text-[#f1f1f1] hover:bg-white/6 hover:text-white',
  );
};

const sidebarCreateButtonClassName =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[#d9d9d9] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30';

/**
 * ダッシュボード左側のナビゲーションとチャット履歴/ファイルツリーを表示する。
 * @param props 表示状態と画面遷移ハンドラ
 */
export const SidebarNavigation = (props: SidebarNavigationProps) => {
  const {
    activeView,
    activeWorkbenchKind,
    chats,
    selectedChatId,
    isLoadingTerminals,
    selectedFilePath,
    bookmarks,
    editorWorkspaceRoot,
    onLoadDirectory,
    onSelectFile,
    onOpenChatView,
    onSelectChat,
    onCreateChat,
    onOpenTerminalWorkbench,
    onCreateTerminal,
    onOpenEditorWorkbench,
    toChatSidebarLabel,
  } = props;

  return (
    <Card className="h-full min-h-0 rounded-none border-white/10 bg-[#181818]">
      <CardContent className="sidebar-scrollbar flex min-h-0 flex-col gap-4 overflow-x-hidden overflow-y-auto p-2 text-[#f1f1f1]">
        <div className="grid gap-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={cn(toSidebarRowClassName(activeView === 'chat'), 'min-w-0 flex-1')}
              onClick={onOpenChatView}
            >
              <MessageSquareIcon className="size-4" />
              <span>チャット</span>
            </button>
            <button
              type="button"
              className={sidebarCreateButtonClassName}
              aria-label="Create chat"
              onClick={onCreateChat}
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className={cn(toSidebarRowClassName(activeWorkbenchKind === 'terminal'), 'min-w-0 flex-1')}
              onClick={onOpenTerminalWorkbench}
            >
              <TerminalSquareIcon className="size-4" />
              <span>ターミナル</span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {isLoadingTerminals ? <span className="text-[10px] text-[#c7c7c7]">読み込み中</span> : null}
              </span>
            </button>
            <button
              type="button"
              className={sidebarCreateButtonClassName}
              aria-label="Create terminal"
              onClick={onCreateTerminal}
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>

          <button
            type="button"
            className={toSidebarRowClassName(activeWorkbenchKind === 'editor')}
            onClick={onOpenEditorWorkbench}
          >
            <FilePenLineIcon className="size-4" />
            <span>エディタ</span>
          </button>
        </div>

        <div className="h-px bg-white/10" />

        {activeView === 'chat' ? (
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            <p className="mb-1 px-1 text-[11px] text-[#d0d0d0]">あなたのチャット</p>
            <div className="grid gap-1">
              {chats.length === 0 ? (
                <div className="px-2 py-2 text-sm text-[#d0d0d0]">チャット履歴はまだありません</div>
              ) : null}
              {chats.map((chat, index) => {
                const isSelected = chat.id === selectedChatId;
                return (
                  <button
                    key={chat.id}
                    type="button"
                    className={toSidebarRowClassName(isSelected)}
                    onClick={() => onSelectChat(chat.id)}
                  >
                    <MessageSquareIcon className="size-4" />
                    <span className="min-w-0 flex-1 truncate">
                      {toChatSidebarLabel(chat.preview || '(untitled)')}
                    </span>
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        !isSelected && index < 2 ? 'bg-white/70' : 'bg-transparent',
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden bg-[#181818]">
            <FileTree
              selectedFilePath={selectedFilePath}
              bookmarks={bookmarks}
              errorMessage={editorWorkspaceRoot === null ? 'WORKSPACE_ROOT is not configured.' : null}
              onLoadDirectory={onLoadDirectory}
              onSelectFile={onSelectFile}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};
