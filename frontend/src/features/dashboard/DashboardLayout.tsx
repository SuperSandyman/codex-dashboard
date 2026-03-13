import { MenuIcon } from 'lucide-react';

import { cn } from '../../lib/utils';
import { ChatPane } from '../chat/ChatPane';
import { CreateSessionDialog } from '../workbench/CreateSessionDialog';
import { SidebarNavigation } from '../workbench/SidebarNavigation';
import { WorkbenchTabsPanel } from '../workbench/WorkbenchTabsPanel';

import type { useDashboardController } from './useDashboardController';

type DashboardController = ReturnType<typeof useDashboardController>;

interface DashboardLayoutProps {
  readonly controller: DashboardController;
}

/**
 * Dashboard の外枠レイアウトだけを担当する。
 * @param props controller から受け取った表示状態
 * @returns ダッシュボード UI
 */
export const DashboardLayout = ({ controller }: DashboardLayoutProps) => {
  const {
    activeView,
    isMenuOpen,
    toast,
    selectedChat,
    activeWorkbenchTab,
    activeWorkbenchTerminal,
    selectedFilePath,
    createDialogProps,
    sidebarProps,
    chatPaneProps,
    workbenchTabsPanelProps,
    onToggleMenu,
    onCloseMenu,
    mobileSwitcherHandlers,
  } = controller;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#212121] text-[#ececec]">
      <CreateSessionDialog {...createDialogProps} />

      <main className="relative z-10 flex min-h-0 flex-1 gap-0 p-0">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-20 bg-[linear-gradient(180deg,rgba(33,33,33,0.56)_0%,rgba(33,33,33,0.28)_45%,rgba(33,33,33,0)_100%)] md:hidden" />
        <button
          className={cn(
            'fixed left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 inline-flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/3 text-white backdrop-blur-md transition-[opacity,background-color,border-color] hover:border-white/20 hover:bg-white/6 md:hidden',
            isMenuOpen ? 'pointer-events-none opacity-0' : 'opacity-100',
          )}
          type="button"
          onClick={onToggleMenu}
          aria-label="Open menu"
        >
          <MenuIcon className="size-5 text-white" />
        </button>

        <div
          className={cn(
            'fixed inset-0 z-20 bg-black/55 backdrop-blur-sm md:hidden',
            isMenuOpen ? 'block' : 'hidden',
          )}
          onClick={onCloseMenu}
        />

        <aside
          className={cn(
            'sidebar-scrollbar fixed inset-y-0 left-0 z-30 w-[17rem] max-w-[90vw] overflow-y-auto bg-[#181818] p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-xl transition-transform duration-300 ease-in-out md:static md:z-auto md:w-72 md:max-w-none md:translate-x-0 md:bg-transparent md:p-0 md:shadow-none',
            isMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          )}
        >
          <SidebarNavigation {...sidebarProps} />
        </aside>

        <section
          className="min-h-0 min-w-0 flex-1 transition-all duration-300 ease-out"
          onTouchStart={mobileSwitcherHandlers.onTouchStart}
          onTouchEnd={mobileSwitcherHandlers.onTouchEnd}
        >
          {activeView === 'chat' ? <ChatPane key={chatPaneProps.chatId ?? 'chat-none'} {...chatPaneProps} /> : null}
          {activeView !== 'chat' ? <WorkbenchTabsPanel {...workbenchTabsPanelProps} /> : null}
        </section>
      </main>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 rounded-lg border border-white/20 bg-[#2a2a2a] px-3 py-2 text-center text-sm text-[#ececec] shadow-lg shadow-black/30 md:absolute md:inset-x-auto md:right-3 md:bottom-3 md:text-left">
          {toast.message}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 hidden justify-center pb-[calc(env(safe-area-inset-bottom)+0.25rem)] sm:flex">
        {activeView === 'chat' && selectedChat ? (
          <div className="max-w-[calc(100vw-2rem)] truncate rounded-full border border-white/10 bg-[#171717] px-3 py-1 text-[11px] text-[#9f9f9f]">
            Chat ID: {selectedChat.id}
          </div>
        ) : null}
        {activeView !== 'chat' && activeWorkbenchTab?.kind === 'terminal' && activeWorkbenchTerminal ? (
          <div className="max-w-[calc(100vw-2rem)] truncate rounded-full border border-white/10 bg-[#171717] px-3 py-1 text-[11px] text-[#9f9f9f]">
            Terminal ID: {activeWorkbenchTerminal.id}
          </div>
        ) : null}
        {activeView !== 'chat' && activeWorkbenchTab?.kind === 'editor' && selectedFilePath ? (
          <div className="max-w-[calc(100vw-2rem)] truncate rounded-full border border-white/10 bg-[#171717] px-3 py-1 text-[11px] text-[#9f9f9f]">
            File: {selectedFilePath}
          </div>
        ) : null}
      </div>
    </div>
  );
};
