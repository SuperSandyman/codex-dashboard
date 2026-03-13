import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';

import {
  type ChatApprovalPolicy,
  type ChatSandboxMode,
  type ChatSummary,
} from '../../api/chats';
import {
  createTerminal,
  getTerminalCatalog,
  killTerminal,
  listTerminals,
  type TerminalCatalog,
  type TerminalProfile,
  type TerminalSummary,
} from '../../api/terminals';
import { getEditorCatalog, getEditorFile, getEditorTree, saveEditorFile } from '../../api/editor';
import { ChatPane } from '../chat/ChatPane';
import type { EditorDirectoryLoadResult } from '../editor/FileTree';
import {
  listEditorBookmarks,
  removeEditorBookmark,
  upsertEditorBookmark,
} from '../editor/bookmarks/indexedDbStore';
import type { EditorFileBookmark } from '../editor/bookmarks/types';
import type { TerminalStreamEvent } from '../terminal/protocol';
import { CreateSessionDialog } from '../workbench/CreateSessionDialog';
import { SidebarNavigation } from '../workbench/SidebarNavigation';
import { WorkbenchTabsPanel } from '../workbench/WorkbenchTabsPanel';
import type {
  AppView,
  CreateMode,
  SwipeDirection,
  ToastState,
  WorkbenchTab,
  WorkbenchTabKind,
} from '../workbench/types';
import { useMobileViewSwitcher } from '../workbench/useMobileViewSwitcher';
import { useSessionDirectoryOptions } from '../workbench/useSessionDirectoryOptions';
import {
  EMPTY_TERMINAL_CATALOG,
  formatApprovalPolicyLabel,
  formatRelative,
  formatSandboxModeLabel,
  MOBILE_BREAKPOINT_MEDIA_QUERY,
  normalizePathFromChatLink,
  resolveDirectoryInputValue,
  resolveEffortForModel,
  sortBookmarksByUpdatedAt,
  sortTerminalsByUpdatedAt,
  toBookmarkLabel,
  toChatSidebarLabel,
  toDirectoryOptionLabel,
  toFileTabLabel,
  toTerminalTabLabel,
  toWorkbenchTabId,
  toWorkspaceRelativePathFromAbsolute,
} from './dashboardUtils';
import { useChatController } from './useChatController';

interface UseDashboardControllerResult {
  readonly activeView: AppView;
  readonly isMenuOpen: boolean;
  readonly toast: ToastState | null;
  readonly selectedChat: ChatSummary | null;
  readonly activeWorkbenchTab: WorkbenchTab | null;
  readonly activeWorkbenchTerminal: TerminalSummary | null;
  readonly selectedFilePath: string | null;
  readonly createDialogProps: ComponentProps<typeof CreateSessionDialog>;
  readonly sidebarProps: ComponentProps<typeof SidebarNavigation>;
  readonly chatPaneProps: ComponentProps<typeof ChatPane>;
  readonly workbenchTabsPanelProps: ComponentProps<typeof WorkbenchTabsPanel>;
  readonly onToggleMenu: () => void;
  readonly onCloseMenu: () => void;
  readonly mobileSwitcherHandlers: ReturnType<typeof useMobileViewSwitcher>;
}

/**
 * App 全体の状態と副作用を集約し、表示用 props へ整形する。
 * @returns レイアウト描画に必要な状態とハンドラ
 */
export const useDashboardController = (): UseDashboardControllerResult => {
  const [activeView, setActiveView] = useState<AppView>('chat');

  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [workbenchTabs, setWorkbenchTabs] = useState<WorkbenchTab[]>([]);
  const [activeWorkbenchTabId, setActiveWorkbenchTabId] = useState<string | null>(null);
  const [editorWorkspaceRoot, setEditorWorkspaceRoot] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [editorBookmarks, setEditorBookmarks] = useState<EditorFileBookmark[]>([]);
  const [editorContent, setEditorContent] = useState('');
  const [editorVersion, setEditorVersion] = useState<string | null>(null);
  const [editorUpdatedAt, setEditorUpdatedAt] = useState<string | null>(null);
  const [lastSavedContent, setLastSavedContent] = useState('');
  const [editorLoadError, setEditorLoadError] = useState<string | null>(null);
  const [editorSaveError, setEditorSaveError] = useState<string | null>(null);
  const [editorSaveStatus, setEditorSaveStatus] = useState<string | null>(null);

  const [isLoadingTerminals, setIsLoadingTerminals] = useState(false);
  const [isLoadingTerminalCatalog, setIsLoadingTerminalCatalog] = useState(false);
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false);
  const [isLoadingEditorFile, setIsLoadingEditorFile] = useState(false);
  const [isSavingEditorFile, setIsSavingEditorFile] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCreatePanelOpen, setIsCreatePanelOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('chat');

  const [terminalCatalog, setTerminalCatalog] = useState<TerminalCatalog>(EMPTY_TERMINAL_CATALOG);
  const [newTerminalProfileId, setNewTerminalProfileId] = useState<string | null>(null);
  const [newTerminalCwd, setNewTerminalCwd] = useState<string | null>(null);

  const availableTerminalIds = useMemo(() => {
    return new Set(terminals.map((terminal) => terminal.id));
  }, [terminals]);

  const visibleWorkbenchTabs = useMemo(() => {
    return workbenchTabs.filter((tab) => tab.kind === 'editor' || availableTerminalIds.has(tab.resourceId));
  }, [availableTerminalIds, workbenchTabs]);

  const resolvedActiveWorkbenchTabId = useMemo(() => {
    if (!activeWorkbenchTabId) {
      return visibleWorkbenchTabs[0]?.id ?? null;
    }
    const hasActiveTab = visibleWorkbenchTabs.some((tab) => tab.id === activeWorkbenchTabId);
    if (hasActiveTab) {
      return activeWorkbenchTabId;
    }
    return visibleWorkbenchTabs[0]?.id ?? null;
  }, [activeWorkbenchTabId, visibleWorkbenchTabs]);

  const activeWorkbenchTab = useMemo(() => {
    if (!resolvedActiveWorkbenchTabId) {
      return null;
    }
    return visibleWorkbenchTabs.find((tab) => tab.id === resolvedActiveWorkbenchTabId) ?? null;
  }, [resolvedActiveWorkbenchTabId, visibleWorkbenchTabs]);

  const activeWorkbenchTerminal = useMemo(() => {
    if (!activeWorkbenchTab || activeWorkbenchTab.kind !== 'terminal') {
      return null;
    }
    return terminals.find((terminal) => terminal.id === activeWorkbenchTab.resourceId) ?? null;
  }, [activeWorkbenchTab, terminals]);

  const activeWorkbenchKind: WorkbenchTabKind | null = useMemo(() => {
    if (activeView === 'chat') {
      return null;
    }
    if (activeWorkbenchTab) {
      return activeWorkbenchTab.kind;
    }
    return activeView;
  }, [activeView, activeWorkbenchTab]);

  const isEditorDirty = useMemo(() => {
    return selectedFilePath !== null && editorContent !== lastSavedContent;
  }, [editorContent, lastSavedContent, selectedFilePath]);

  const isSelectedFileBookmarked = useMemo(() => {
    if (!selectedFilePath) {
      return false;
    }
    return editorBookmarks.some((bookmark) => bookmark.path === selectedFilePath);
  }, [editorBookmarks, selectedFilePath]);

  const showToast = useCallback((message: string) => {
    setToast({ message });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const {
    chats,
    selectedChatId,
    selectedChat,
    messages,
    activeTurnId,
    isLoadingChats,
    isLoadingCatalog,
    isLoadingChat,
    isSending,
    isUpdatingLaunchOptions,
    modelOptions,
    workspaceRoot,
    cwdChoices,
    approvalPolicyOptions,
    sandboxModeOptions,
    newChatLaunchOptions,
    newChatPrompt,
    newChatEfforts,
    approvalRequests,
    submittingApprovalItemIds,
    userInputRequests,
    submittingUserInputItemIds,
    setSelectedChatId,
    setNewChatLaunchOptions,
    setNewChatPrompt,
    refreshChats,
    refreshLaunchCatalog,
    createChat: handleCreateChat,
    updateSelectedLaunchOptions: handleUpdateSelectedLaunchOptions,
    sendMessage: handleSend,
    stopTurn: handleStop,
    respondApproval: handleRespondApproval,
    respondUserInput: handleRespondUserInput,
  } = useChatController({
    onToast: showToast,
    onAfterCreateChat: () => {
      setActiveView('chat');
      setIsMenuOpen(false);
      setIsCreatePanelOpen(false);
    },
  });

  const {
    sessionDirectoryOptions,
    isLoadingSessionDirectories,
    sessionDirectoryError,
    refreshSessionDirectoryOptions,
  } = useSessionDirectoryOptions({
    workspaceRoot,
    chatCwdChoices: cwdChoices,
    terminalWorkspaceRoot: terminalCatalog.workspaceRoot,
    terminalCwdChoices: terminalCatalog.cwdChoices,
    onError: showToast,
  });

  const chatDirectoryOptions = useMemo(() => {
    const options = new Set(sessionDirectoryOptions);
    if (newChatLaunchOptions.cwd) {
      options.add(newChatLaunchOptions.cwd);
    }
    return [...options].sort((a, b) => a.localeCompare(b));
  }, [newChatLaunchOptions.cwd, sessionDirectoryOptions]);

  const terminalDirectoryOptions = useMemo(() => {
    const options = new Set(sessionDirectoryOptions);
    if (newTerminalCwd) {
      options.add(newTerminalCwd);
    }
    return [...options].sort((a, b) => a.localeCompare(b));
  }, [newTerminalCwd, sessionDirectoryOptions]);

  const refreshTerminals = useCallback(async () => {
    setIsLoadingTerminals(true);
    const result = await listTerminals();
    setIsLoadingTerminals(false);
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to load terminals');
      return;
    }

    const sorted = sortTerminalsByUpdatedAt(result.data.terminals);
    setTerminals(sorted);

    const hasSelected = selectedTerminalId
      ? sorted.some((terminal) => terminal.id === selectedTerminalId)
      : false;
    if (!hasSelected) {
      setSelectedTerminalId(sorted[0]?.id ?? null);
    }
  }, [selectedTerminalId, showToast]);

  const refreshTerminalCatalog = useCallback(async () => {
    setIsLoadingTerminalCatalog(true);
    const result = await getTerminalCatalog();
    setIsLoadingTerminalCatalog(false);
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to load terminal options');
      return;
    }

    const catalog = result.data;
    setTerminalCatalog(catalog);
    setNewTerminalProfileId((prev) => {
      if (prev && catalog.profiles.some((profile) => profile.id === prev)) {
        return prev;
      }
      return catalog.profiles[0]?.id ?? null;
    });
    setNewTerminalCwd((prev) => {
      if (prev && catalog.cwdChoices.includes(prev)) {
        return prev;
      }
      return catalog.workspaceRoot;
    });
  }, [showToast]);

  const refreshEditorCatalog = useCallback(async () => {
    const result = await getEditorCatalog();
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to load editor catalog');
      return;
    }
    setEditorWorkspaceRoot(result.data.workspaceRoot);
  }, [showToast]);

  const loadEditorFile = useCallback(
    async (targetPath: string, options?: { readonly suppressToast?: boolean }) => {
      setIsLoadingEditorFile(true);
      setEditorLoadError(null);
      setEditorSaveError(null);
      setEditorSaveStatus(null);
      const result = await getEditorFile(targetPath);
      setIsLoadingEditorFile(false);
      if (!result.ok || !result.data) {
        const message = result.error?.message ?? 'Failed to load file';
        setEditorLoadError(message);
        if (!options?.suppressToast) {
          showToast(message);
        }
        return {
          ok: false as const,
          status: result.status,
          errorCode: result.error?.code ?? null,
          message,
        };
      }
      setSelectedFilePath(result.data.path);
      setEditorContent(result.data.content);
      setLastSavedContent(result.data.content);
      setEditorVersion(result.data.version);
      setEditorUpdatedAt(result.data.updatedAt);
      return { ok: true as const };
    },
    [showToast],
  );

  const loadEditorDirectory = useCallback(
    async (targetPath: string): Promise<EditorDirectoryLoadResult> => {
      const result = await getEditorTree(targetPath);
      if (!result.ok || !result.data) {
        return {
          ok: false,
          nodes: [],
          message: result.error?.message ?? 'Failed to load file tree',
        };
      }
      return {
        ok: true,
        nodes: result.data.nodes,
        message: null,
      };
    },
    [],
  );

  const handleTerminalStreamEvent = useCallback((event: TerminalStreamEvent) => {
    if (event.type === 'error') {
      showToast(event.error.message);
      return;
    }

    if (event.type === 'ready') {
      setTerminals((prev) => {
        const next = prev.map((terminal) => {
          if (terminal.id !== event.terminalId) {
            return terminal;
          }
          return {
            ...terminal,
            status: event.status,
            updatedAt: new Date().toISOString(),
            exitCode: event.exitCode,
            signal: event.signal,
          };
        });
        return sortTerminalsByUpdatedAt(next);
      });
      return;
    }

    if (event.type === 'output') {
      setTerminals((prev) => {
        const next = prev.map((terminal) => {
          if (terminal.id !== event.terminalId) {
            return terminal;
          }
          const combined = `${terminal.lastOutput}${event.data}`;
          return {
            ...terminal,
            lastOutput: combined.slice(Math.max(combined.length - 160, 0)),
            updatedAt: new Date().toISOString(),
          };
        });
        return sortTerminalsByUpdatedAt(next);
      });
      return;
    }

    setTerminals((prev) => {
      const next = prev.map((terminal) => {
        if (terminal.id !== event.terminalId) {
          return terminal;
        }
        return {
          ...terminal,
          status: event.status,
          updatedAt: new Date().toISOString(),
          exitCode: event.exitCode,
          signal: event.signal,
        };
      });
      return sortTerminalsByUpdatedAt(next);
    });
  }, [showToast]);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      await Promise.resolve();
      if (isCancelled) {
        return;
      }
      await Promise.all([
        refreshChats(),
        refreshLaunchCatalog(),
        refreshTerminals(),
        refreshTerminalCatalog(),
        refreshEditorCatalog(),
      ]);
    })();
    return () => {
      isCancelled = true;
    };
  }, [refreshChats, refreshEditorCatalog, refreshLaunchCatalog, refreshTerminalCatalog, refreshTerminals]);

  useEffect(() => {
    if (!isCreatePanelOpen) {
      return;
    }
    void refreshSessionDirectoryOptions({ notifyOnError: false });
  }, [isCreatePanelOpen, refreshSessionDirectoryOptions]);

  useEffect(() => {
    if (!editorWorkspaceRoot) {
      return;
    }

    let isCancelled = false;
    void (async () => {
      try {
        const bookmarks = await listEditorBookmarks(editorWorkspaceRoot);
        if (isCancelled) {
          return;
        }
        setEditorBookmarks(sortBookmarksByUpdatedAt(bookmarks));
      } catch (error) {
        if (isCancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to load bookmarks';
        showToast(`Bookmarks are unavailable: ${message}`);
        setEditorBookmarks([]);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [editorWorkspaceRoot, showToast]);

  useEffect(() => {
    if (!isEditorDirty) {
      return undefined;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [isEditorDirty]);

  const confirmDiscardEditorChanges = useCallback((): boolean => {
    if (!isEditorDirty) {
      return true;
    }
    return window.confirm('You have unsaved changes. Discard them?');
  }, [isEditorDirty]);

  const openTerminalTab = useCallback((terminalId: string) => {
    const tabId = toWorkbenchTabId('terminal', terminalId);
    setWorkbenchTabs((prev) => {
      if (prev.some((tab) => tab.id === tabId)) {
        return prev;
      }
      return [...prev, { id: tabId, kind: 'terminal', resourceId: terminalId }];
    });
    setActiveWorkbenchTabId(tabId);
    setSelectedTerminalId(terminalId);
    setActiveView('terminal');
  }, []);

  const openEditorTab = useCallback(
    async (targetPath: string, options?: { readonly suppressToast?: boolean }): Promise<boolean> => {
      if (selectedFilePath && selectedFilePath !== targetPath && !confirmDiscardEditorChanges()) {
        return false;
      }

      const tabId = toWorkbenchTabId('editor', targetPath);
      setWorkbenchTabs((prev) => {
        if (prev.some((tab) => tab.id === tabId)) {
          return prev;
        }
        return [...prev, { id: tabId, kind: 'editor', resourceId: targetPath }];
      });
      setActiveWorkbenchTabId(tabId);
      setActiveView('editor');
      setSelectedFilePath(targetPath);

      const result = await loadEditorFile(targetPath, options);
      return result.ok;
    },
    [confirmDiscardEditorChanges, loadEditorFile, selectedFilePath],
  );

  const activateWorkbenchTab = useCallback(
    (tab: WorkbenchTab) => {
      if (tab.kind === 'terminal') {
        openTerminalTab(tab.resourceId);
        return;
      }
      void openEditorTab(tab.resourceId);
    },
    [openEditorTab, openTerminalTab],
  );

  const closeWorkbenchTab = useCallback(
    (tabId: string) => {
      const closingTab = workbenchTabs.find((tab) => tab.id === tabId) ?? null;
      if (!closingTab) {
        return;
      }

      const isClosingActiveTab = activeWorkbenchTabId === tabId;
      if (
        isClosingActiveTab &&
        closingTab.kind === 'editor' &&
        selectedFilePath === closingTab.resourceId &&
        !confirmDiscardEditorChanges()
      ) {
        return;
      }

      const closingIndex = workbenchTabs.findIndex((tab) => tab.id === tabId);
      const nextTabs = workbenchTabs.filter((tab) => tab.id !== tabId);
      setWorkbenchTabs(nextTabs);

      if (closingTab.kind === 'terminal' && selectedTerminalId === closingTab.resourceId) {
        const nextTerminalTab = nextTabs.find((tab) => tab.kind === 'terminal') ?? null;
        setSelectedTerminalId(nextTerminalTab?.resourceId ?? null);
      }

      if (!isClosingActiveTab) {
        return;
      }

      if (closingTab.kind === 'editor' && selectedFilePath === closingTab.resourceId) {
        setSelectedFilePath(null);
        setEditorContent('');
        setLastSavedContent('');
        setEditorVersion(null);
        setEditorUpdatedAt(null);
        setEditorLoadError(null);
        setEditorSaveError(null);
        setEditorSaveStatus(null);
      }

      const fallbackTab = nextTabs[closingIndex] ?? nextTabs[Math.max(closingIndex - 1, 0)] ?? null;
      if (!fallbackTab) {
        setActiveWorkbenchTabId(null);
        return;
      }
      activateWorkbenchTab(fallbackTab);
    },
    [
      activeWorkbenchTabId,
      activateWorkbenchTab,
      confirmDiscardEditorChanges,
      selectedFilePath,
      selectedTerminalId,
      workbenchTabs,
    ],
  );

  const handleFocusEditorWorkbench = useCallback(() => {
    const activeEditorTab = activeWorkbenchTab?.kind === 'editor' ? activeWorkbenchTab : null;
    const fallbackEditorTab = [...workbenchTabs].reverse().find((tab) => tab.kind === 'editor') ?? null;
    const targetPath = activeEditorTab?.resourceId ?? fallbackEditorTab?.resourceId ?? selectedFilePath;
    if (!targetPath) {
      setActiveView('editor');
      return;
    }
    void openEditorTab(targetPath);
  }, [activeWorkbenchTab, openEditorTab, selectedFilePath, workbenchTabs]);

  const handleFocusTerminalWorkbench = useCallback(() => {
    const activeTerminalTab = activeWorkbenchTab?.kind === 'terminal' ? activeWorkbenchTab : null;
    const fallbackTerminalTab = [...workbenchTabs].reverse().find((tab) => tab.kind === 'terminal') ?? null;
    const targetTerminalId = activeTerminalTab?.resourceId ?? fallbackTerminalTab?.resourceId ?? selectedTerminalId;
    if (!targetTerminalId) {
      setActiveView('terminal');
      setIsMenuOpen(false);
      return;
    }
    openTerminalTab(targetTerminalId);
    setIsMenuOpen(false);
  }, [activeWorkbenchTab, openTerminalTab, selectedTerminalId, workbenchTabs]);

  const openChatCreateDialog = useCallback(() => {
    setCreateMode('chat');
    setIsCreatePanelOpen(true);
    setIsMenuOpen(false);
  }, []);

  const openTerminalCreateDialog = useCallback(() => {
    setCreateMode('terminal');
    setIsCreatePanelOpen(true);
    setIsMenuOpen(false);
  }, []);

  const handleCreateTerminal = useCallback(async () => {
    setIsCreatingTerminal(true);
    const result = await createTerminal({
      profile: newTerminalProfileId,
      cwd: newTerminalCwd,
      cols: null,
      rows: null,
    });
    setIsCreatingTerminal(false);
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to create terminal');
      return;
    }

    const terminal = result.data.terminal;
    setTerminals((prev) => sortTerminalsByUpdatedAt([terminal, ...prev]));
    openTerminalTab(terminal.id);
    setIsMenuOpen(false);
    setIsCreatePanelOpen(false);
  }, [newTerminalCwd, newTerminalProfileId, openTerminalTab, showToast]);

  const handleKillTerminal = useCallback(async () => {
    if (!selectedTerminalId) {
      return;
    }

    const terminalIdToKill = selectedTerminalId;
    const result = await killTerminal(selectedTerminalId);
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to kill terminal');
      return;
    }

    let nextSelectedTerminalId: string | null = null;
    setTerminals((prev) => {
      const next = prev.filter((terminal) => terminal.id !== terminalIdToKill);
      nextSelectedTerminalId = next[0]?.id ?? null;
      return sortTerminalsByUpdatedAt(next);
    });
    setSelectedTerminalId(nextSelectedTerminalId);
    const terminalTabId = toWorkbenchTabId('terminal', terminalIdToKill);
    setWorkbenchTabs((prev) => prev.filter((tab) => tab.id !== terminalTabId));
    if (activeWorkbenchTabId === terminalTabId) {
      setActiveWorkbenchTabId(null);
    }
  }, [activeWorkbenchTabId, selectedTerminalId, showToast]);

  const handleSelectEditorFile = useCallback((targetPath: string) => {
    void openEditorTab(targetPath);
    setIsMenuOpen(false);
  }, [openEditorTab]);

  const handleToggleEditorBookmark = useCallback(async () => {
    if (!editorWorkspaceRoot || !selectedFilePath) {
      return;
    }
    const existing = editorBookmarks.find((bookmark) => bookmark.path === selectedFilePath) ?? null;
    const previousBookmarks = editorBookmarks;
    if (existing) {
      const nextBookmarks = editorBookmarks.filter((bookmark) => bookmark.path !== selectedFilePath);
      setEditorBookmarks(nextBookmarks);
      try {
        await removeEditorBookmark(editorWorkspaceRoot, selectedFilePath);
      } catch (error) {
        setEditorBookmarks(previousBookmarks);
        const message = error instanceof Error ? error.message : 'Failed to remove bookmark';
        showToast(`Failed to update bookmark: ${message}`);
      }
      return;
    }

    const nextBookmark: EditorFileBookmark = {
      path: selectedFilePath,
      label: toBookmarkLabel(selectedFilePath),
      updatedAt: new Date().toISOString(),
    };
    const nextBookmarks = sortBookmarksByUpdatedAt([
      ...editorBookmarks.filter((bookmark) => bookmark.path !== selectedFilePath),
      nextBookmark,
    ]);
    setEditorBookmarks(nextBookmarks);
    try {
      await upsertEditorBookmark(editorWorkspaceRoot, nextBookmark);
    } catch (error) {
      setEditorBookmarks(previousBookmarks);
      const message = error instanceof Error ? error.message : 'Failed to add bookmark';
      showToast(`Failed to update bookmark: ${message}`);
    }
  }, [editorBookmarks, editorWorkspaceRoot, selectedFilePath, showToast]);

  const handleSaveEditorFile = useCallback(async () => {
    if (!selectedFilePath) {
      return;
    }
    if (!editorVersion) {
      const message = 'Missing file version. Reload the file before saving.';
      setEditorSaveError(message);
      showToast(message);
      return;
    }
    setIsSavingEditorFile(true);
    setEditorSaveError(null);
    setEditorSaveStatus(null);
    const result = await saveEditorFile({
      path: selectedFilePath,
      content: editorContent,
      expectedVersion: editorVersion,
    });
    setIsSavingEditorFile(false);
    if (!result.ok || !result.data) {
      const message = result.error?.message ?? 'Failed to save file';
      if (result.status === 409) {
        const conflictMessage = `${message} Local edits are kept.`;
        setEditorSaveError(conflictMessage);
        setEditorSaveStatus('Reload the latest file to resolve conflicts.');
        showToast(conflictMessage);
        const shouldReload = window.confirm(
          'This file was updated externally. Reload the latest content and discard local edits?',
        );
        if (shouldReload) {
          void loadEditorFile(selectedFilePath);
        }
        return;
      }
      setEditorSaveError(message);
      showToast(message);
      return;
    }
    setEditorContent(result.data.content);
    setLastSavedContent(result.data.content);
    setEditorVersion(result.data.version);
    setEditorUpdatedAt(result.data.updatedAt);
    setEditorSaveStatus(`Saved at ${formatRelative(result.data.updatedAt)}`);
  }, [editorContent, editorVersion, loadEditorFile, selectedFilePath, showToast]);

  const handleOpenFileFromChat = useCallback((rawPath: string) => {
    let targetPath = normalizePathFromChatLink(rawPath);

    if (targetPath.length === 0) {
      return;
    }

    if (targetPath.startsWith('/')) {
      if (!editorWorkspaceRoot) {
        showToast('WORKSPACE_ROOT is not configured.');
        return;
      }
      const relative = toWorkspaceRelativePathFromAbsolute(editorWorkspaceRoot, targetPath);
      if (relative === null) {
        showToast('Selected file is outside WORKSPACE_ROOT.');
        return;
      }
      targetPath = relative;
    }

    void openEditorTab(targetPath);
    setIsMenuOpen(false);
  }, [editorWorkspaceRoot, openEditorTab, showToast]);

  const switchViewBySwipe = useCallback((direction: SwipeDirection) => {
    if (!window.matchMedia(MOBILE_BREAKPOINT_MEDIA_QUERY).matches) {
      return;
    }
    const isChatActive = activeView === 'chat';
    if (direction === 'left' && isChatActive) {
      if (activeWorkbenchKind === 'editor') {
        handleFocusEditorWorkbench();
        return;
      }
      handleFocusTerminalWorkbench();
      return;
    }
    if (direction === 'right' && !isChatActive) {
      setActiveView('chat');
    }
  }, [activeView, activeWorkbenchKind, handleFocusEditorWorkbench, handleFocusTerminalWorkbench]);

  const mobileSwitcherHandlers = useMobileViewSwitcher({
    mediaQuery: MOBILE_BREAKPOINT_MEDIA_QUERY,
    onSwipe: switchViewBySwipe,
  });

  const selectedProfile: TerminalProfile | null =
    terminalCatalog.profiles.find((profile) => profile.id === newTerminalProfileId) ?? null;

  const createDialogProps: ComponentProps<typeof CreateSessionDialog> = {
    isOpen: isCreatePanelOpen,
    createMode,
    isLoadingChats,
    isCreatingTerminal,
    isLoadingCatalog,
    isLoadingTerminalCatalog,
    isLoadingSessionDirectories,
    sessionDirectoryError,
    workspaceRoot,
    newChatLaunchOptions,
    newChatEfforts,
    newChatPrompt,
    modelOptions,
    approvalPolicyOptions,
    sandboxModeOptions,
    chatDirectoryOptions,
    terminalCatalog,
    terminalDirectoryOptions,
    newTerminalProfileId,
    newTerminalCwd,
    selectedProfile,
    onClose: () => setIsCreatePanelOpen(false),
    onSelectMode: setCreateMode,
    onChangeNewChatModel: (rawModel) => {
      const nextModel = rawModel.length > 0 ? rawModel : null;
      setNewChatLaunchOptions((prev) => {
        const nextEffort = resolveEffortForModel(modelOptions, nextModel, prev.effort);
        return {
          ...prev,
          model: nextModel,
          effort: nextEffort,
        };
      });
    },
    onChangeNewChatEffort: (rawEffort) => {
      const nextEffort = rawEffort.length > 0 ? rawEffort : null;
      setNewChatLaunchOptions((prev) => ({ ...prev, effort: nextEffort }));
    },
    onChangeNewChatApprovalPolicy: (rawPolicy) => {
      const nextPolicy = rawPolicy.length > 0 ? rawPolicy : null;
      setNewChatLaunchOptions((prev) => ({
        ...prev,
        approvalPolicy: nextPolicy as ChatApprovalPolicy | null,
      }));
    },
    onChangeNewChatDirectory: (value) => {
      const nextCwd = resolveDirectoryInputValue(workspaceRoot, value);
      setNewChatLaunchOptions((prev) => ({ ...prev, cwd: nextCwd }));
    },
    onResetNewChatDirectory: () => {
      setNewChatLaunchOptions((prev) => ({ ...prev, cwd: null }));
    },
    onReloadDirectoryOptions: () => {
      void refreshSessionDirectoryOptions({ notifyOnError: true, forceReload: true });
    },
    onChangeNewChatSandboxMode: (rawMode) => {
      const nextMode = rawMode.length > 0 ? rawMode : null;
      if (nextMode === 'danger-full-access') {
        const accepted = window.confirm('Danger Full Access disables filesystem sandboxing. Continue?');
        if (!accepted) {
          return;
        }
      }
      setNewChatLaunchOptions((prev) => ({
        ...prev,
        sandboxMode: nextMode as ChatSandboxMode | null,
      }));
    },
    onSelectChatDirectory: (cwd) => {
      setNewChatLaunchOptions((prev) => ({ ...prev, cwd }));
    },
    onChangeNewChatPrompt: setNewChatPrompt,
    onChangeNewTerminalProfileId: (value) => {
      const trimmed = value.trim();
      setNewTerminalProfileId(trimmed.length > 0 ? trimmed : null);
    },
    onChangeNewTerminalCwd: (value) => {
      const nextCwd = resolveDirectoryInputValue(terminalCatalog.workspaceRoot, value);
      setNewTerminalCwd(nextCwd);
    },
    onResetNewTerminalCwd: () => {
      setNewTerminalCwd(terminalCatalog.workspaceRoot);
    },
    onSelectTerminalDirectory: setNewTerminalCwd,
    onCreateChat: handleCreateChat,
    onCreateTerminal: handleCreateTerminal,
    formatApprovalPolicyLabel,
    formatSandboxModeLabel,
    toDirectoryOptionLabel,
  };

  const sidebarProps: ComponentProps<typeof SidebarNavigation> = {
    activeView,
    activeWorkbenchKind,
    chats,
    selectedChatId,
    isLoadingTerminals,
    selectedFilePath,
    bookmarks: editorWorkspaceRoot ? editorBookmarks : [],
    editorWorkspaceRoot,
    onLoadDirectory: loadEditorDirectory,
    onSelectFile: handleSelectEditorFile,
    onOpenChatView: () => {
      setActiveView('chat');
      setIsMenuOpen(false);
    },
    onSelectChat: (chatId) => {
      setSelectedChatId(chatId);
      setActiveView('chat');
      setIsMenuOpen(false);
    },
    onCreateChat: openChatCreateDialog,
    onOpenTerminalWorkbench: handleFocusTerminalWorkbench,
    onCreateTerminal: openTerminalCreateDialog,
    onOpenEditorWorkbench: () => {
      handleFocusEditorWorkbench();
      setIsMenuOpen(false);
    },
    toChatSidebarLabel,
  };

  const chatPaneProps: ComponentProps<typeof ChatPane> = {
    chatId: selectedChatId,
    messages,
    activeTurnId,
    isLoading: isLoadingChat,
    isSending,
    launchOptions: selectedChat?.launchOptions ?? null,
    modelOptions,
    approvalPolicyOptions,
    sandboxModeOptions,
    isUpdatingLaunchOptions,
    approvalRequests,
    submittingApprovalItemIds,
    userInputRequests,
    submittingUserInputItemIds,
    onSend: handleSend,
    onStop: handleStop,
    onRespondApproval: handleRespondApproval,
    onRespondUserInput: handleRespondUserInput,
    onUpdateLaunchOptions: handleUpdateSelectedLaunchOptions,
    onOpenFileFromChat: handleOpenFileFromChat,
  };

  const workbenchTabsPanelProps: ComponentProps<typeof WorkbenchTabsPanel> = {
    workbenchTabs: visibleWorkbenchTabs,
    activeWorkbenchTabId: resolvedActiveWorkbenchTabId,
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
    terminalStatus: activeWorkbenchTerminal?.status ?? null,
    isKillDisabled: !activeWorkbenchTerminal || activeWorkbenchTerminal.status !== 'running',
    onActivateWorkbenchTab: activateWorkbenchTab,
    onCloseWorkbenchTab: closeWorkbenchTab,
    onTerminalStreamEvent: handleTerminalStreamEvent,
    onToast: showToast,
    onKillTerminal: handleKillTerminal,
    onChangeEditorContent: (value) => {
      setEditorContent(value);
      setEditorSaveError(null);
      setEditorSaveStatus(editorUpdatedAt ? `Loaded ${formatRelative(editorUpdatedAt)}` : null);
    },
    onSaveEditorFile: handleSaveEditorFile,
    onToggleBookmark: () => {
      void handleToggleEditorBookmark();
    },
    toTerminalTabLabel,
    toFileTabLabel,
    editorUpdatedStatusLabel: editorUpdatedAt ? `Loaded ${formatRelative(editorUpdatedAt)}` : null,
  };

  return {
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
    onToggleMenu: () => setIsMenuOpen((prev) => !prev),
    onCloseMenu: () => setIsMenuOpen(false),
    mobileSwitcherHandlers,
  };
};
