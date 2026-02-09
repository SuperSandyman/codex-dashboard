import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './App.css';
import {
  type ChatApprovalDecision,
  type ChatApprovalPolicy,
  type ChatApprovalRequest,
  type ChatSandboxMode,
  createChat,
  getChat,
  getChatLaunchCatalog,
  interruptTurn,
  listChats,
  respondChatApproval,
  sendChatMessage,
  updateChatLaunchOptions,
  type ChatLaunchOptions,
  type ChatMessage,
  type ChatModelOption,
  type ChatSummary,
} from './api/chats';
import {
  createTerminal,
  getTerminalCatalog,
  killTerminal,
  listTerminals,
  type TerminalCatalog,
  type TerminalProfile,
  type TerminalSummary,
} from './api/terminals';
import {
  getEditorCatalog,
  getEditorFile,
  getEditorTree,
  saveEditorFile,
  type EditorTreeNode,
} from './api/editor';
import { ChatPane } from './features/chat/ChatPane';
import {
  addOptimisticUserMessage,
  applyStreamEventToMessages,
  sortChatsByUpdatedAt,
  touchChatSummary,
} from './features/chat/messageStore';
import { parseChatStreamEvent, type ChatStreamEvent } from './features/chat/protocol';
import { EditorPane } from './features/editor/EditorPane';
import { FileTree } from './features/editor/FileTree';
import { TerminalPane } from './features/terminal/TerminalPane';
import type { TerminalStreamEvent } from './features/terminal/protocol';

interface ToastState {
  readonly message: string;
}

type AppView = 'chat' | 'terminal' | 'editor';
type CreateMode = 'chat' | 'terminal';

const EMPTY_LAUNCH_OPTIONS: ChatLaunchOptions = {
  model: null,
  effort: null,
  cwd: null,
  approvalPolicy: null,
  sandboxMode: null,
};

const EMPTY_TERMINAL_CATALOG: TerminalCatalog = {
  workspaceRoot: null,
  cwdChoices: [],
  profiles: [],
};

const buildChatWsUrl = (threadId: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws/chats/${encodeURIComponent(threadId)}`;
};

const formatRelative = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const resolveModelDefault = (models: readonly ChatModelOption[]): string | null => {
  const defaultModel = models.find((model) => model.isDefault);
  if (defaultModel) {
    return defaultModel.id;
  }
  return models[0]?.id ?? null;
};

const resolveEffortForModel = (
  models: readonly ChatModelOption[],
  modelId: string | null,
  currentEffort: string | null,
): string | null => {
  if (!modelId) {
    return null;
  }
  const model = models.find((entry) => entry.id === modelId) ?? null;
  if (!model) {
    return null;
  }
  if (currentEffort && model.efforts.includes(currentEffort)) {
    return currentEffort;
  }
  return model.defaultEffort ?? model.efforts[0] ?? null;
};

const formatApprovalPolicyLabel = (value: ChatApprovalPolicy): string => {
  switch (value) {
    case 'untrusted':
      return 'Untrusted';
    case 'on-failure':
      return 'On Failure';
    case 'on-request':
      return 'On Request';
    case 'never':
      return 'Never';
    default:
      return value;
  }
};

const formatSandboxModeLabel = (value: ChatSandboxMode): string => {
  switch (value) {
    case 'read-only':
      return 'Read Only';
    case 'workspace-write':
      return 'Workspace Write';
    case 'danger-full-access':
      return 'Danger Full Access';
    default:
      return value;
  }
};

const upsertApprovalRequest = (
  approvals: readonly ChatApprovalRequest[],
  next: ChatApprovalRequest,
): ChatApprovalRequest[] => {
  const index = approvals.findIndex((entry) => entry.itemId === next.itemId);
  if (index < 0) {
    return [...approvals, next];
  }
  const copy = [...approvals];
  copy[index] = next;
  return copy;
};

const sortTerminalsByUpdatedAt = (terminals: readonly TerminalSummary[]): TerminalSummary[] => {
  return [...terminals].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
};

/**
 * Chat と Operations Terminal を切り替えて利用するダッシュボード。
 */
const App = () => {
  const [activeView, setActiveView] = useState<AppView>('chat');

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [editorWorkspaceRoot, setEditorWorkspaceRoot] = useState<string | null>(null);
  const [editorTreePath, setEditorTreePath] = useState('');
  const [editorTreeNodes, setEditorTreeNodes] = useState<EditorTreeNode[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorVersion, setEditorVersion] = useState<string | null>(null);
  const [editorUpdatedAt, setEditorUpdatedAt] = useState<string | null>(null);
  const [lastSavedContent, setLastSavedContent] = useState('');
  const [editorLoadError, setEditorLoadError] = useState<string | null>(null);
  const [editorSaveError, setEditorSaveError] = useState<string | null>(null);
  const [editorSaveStatus, setEditorSaveStatus] = useState<string | null>(null);

  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUpdatingLaunchOptions, setIsUpdatingLaunchOptions] = useState(false);
  const [isLoadingTerminals, setIsLoadingTerminals] = useState(false);
  const [isLoadingTerminalCatalog, setIsLoadingTerminalCatalog] = useState(false);
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false);
  const [isLoadingEditorCatalog, setIsLoadingEditorCatalog] = useState(false);
  const [isLoadingEditorTree, setIsLoadingEditorTree] = useState(false);
  const [isLoadingEditorFile, setIsLoadingEditorFile] = useState(false);
  const [isSavingEditorFile, setIsSavingEditorFile] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCreatePanelOpen, setIsCreatePanelOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('chat');

  const [modelOptions, setModelOptions] = useState<ChatModelOption[]>([]);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [cwdChoices, setCwdChoices] = useState<string[]>([]);
  const [approvalPolicyOptions, setApprovalPolicyOptions] = useState<ChatApprovalPolicy[]>([]);
  const [sandboxModeOptions, setSandboxModeOptions] = useState<ChatSandboxMode[]>([]);
  const [newChatLaunchOptions, setNewChatLaunchOptions] = useState<ChatLaunchOptions>(EMPTY_LAUNCH_OPTIONS);
  const [newChatPrompt, setNewChatPrompt] = useState('');
  const [approvalRequests, setApprovalRequests] = useState<ChatApprovalRequest[]>([]);
  const [submittingApprovalItemIds, setSubmittingApprovalItemIds] = useState<string[]>([]);

  const [terminalCatalog, setTerminalCatalog] = useState<TerminalCatalog>(EMPTY_TERMINAL_CATALOG);
  const [newTerminalProfileId, setNewTerminalProfileId] = useState<string | null>(null);
  const [newTerminalCwd, setNewTerminalCwd] = useState<string | null>(null);

  const selectedChatIdRef = useRef<string | null>(null);

  const selectedChat = useMemo(() => {
    return chats.find((chat) => chat.id === selectedChatId) ?? null;
  }, [chats, selectedChatId]);

  const selectedTerminal = useMemo(() => {
    return terminals.find((terminal) => terminal.id === selectedTerminalId) ?? null;
  }, [terminals, selectedTerminalId]);

  const newChatEfforts = useMemo(() => {
    const model = modelOptions.find((entry) => entry.id === newChatLaunchOptions.model) ?? null;
    return model?.efforts ?? [];
  }, [modelOptions, newChatLaunchOptions.model]);

  const isEditorDirty = useMemo(() => {
    return selectedFilePath !== null && editorContent !== lastSavedContent;
  }, [editorContent, lastSavedContent, selectedFilePath]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  const showToast = useCallback((message: string) => {
    setToast({ message });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshChats = useCallback(async () => {
    setIsLoadingChats(true);
    const result = await listChats();
    setIsLoadingChats(false);
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to load chats');
      return;
    }
    const sorted = sortChatsByUpdatedAt(result.data.chats);
    setChats(sorted);

    const hasSelected = selectedChatId ? sorted.some((chat) => chat.id === selectedChatId) : false;
    if (!hasSelected) {
      setSelectedChatId(sorted[0]?.id ?? null);
    }
  }, [selectedChatId, showToast]);

  const refreshLaunchCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    const result = await getChatLaunchCatalog();
    setIsLoadingCatalog(false);
    const catalog = result.data;
    if (!result.ok || !catalog) {
      showToast(result.error?.message ?? 'Failed to load launch options');
      return;
    }

    setModelOptions(catalog.models);
    setWorkspaceRoot(catalog.workspaceRoot);
    setCwdChoices(catalog.cwdChoices);
    setApprovalPolicyOptions(catalog.approvalPolicies);
    setSandboxModeOptions(catalog.sandboxModes);

    setNewChatLaunchOptions((prev) => {
      const model =
        prev.model && catalog.models.some((entry) => entry.id === prev.model)
          ? prev.model
          : resolveModelDefault(catalog.models);
      const effort = resolveEffortForModel(catalog.models, model, prev.effort);
      const cwd = prev.cwd && catalog.cwdChoices.includes(prev.cwd) ? prev.cwd : null;
      const approvalPolicy =
        prev.approvalPolicy && catalog.approvalPolicies.includes(prev.approvalPolicy)
          ? prev.approvalPolicy
          : (catalog.defaultApprovalPolicy ?? catalog.approvalPolicies[0] ?? null);
      const sandboxMode =
        prev.sandboxMode && catalog.sandboxModes.includes(prev.sandboxMode)
          ? prev.sandboxMode
          : (catalog.defaultSandboxMode ?? catalog.sandboxModes[0] ?? null);
      return {
        model,
        effort,
        cwd,
        approvalPolicy,
        sandboxMode,
      };
    });
  }, [showToast]);

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
    setIsLoadingEditorCatalog(true);
    const result = await getEditorCatalog();
    setIsLoadingEditorCatalog(false);
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to load editor catalog');
      return;
    }
    setEditorWorkspaceRoot(result.data.workspaceRoot);
  }, [showToast]);

  const loadEditorTree = useCallback(
    async (targetPath: string) => {
      setIsLoadingEditorTree(true);
      setEditorLoadError(null);
      const result = await getEditorTree(targetPath);
      setIsLoadingEditorTree(false);
      if (!result.ok || !result.data) {
        const message = result.error?.message ?? 'Failed to load file tree';
        setEditorLoadError(message);
        showToast(message);
        return;
      }
      setEditorTreePath(result.data.path);
      setEditorTreeNodes(result.data.nodes);
    },
    [showToast],
  );

  const loadEditorFile = useCallback(
    async (targetPath: string) => {
      setIsLoadingEditorFile(true);
      setEditorLoadError(null);
      setEditorSaveError(null);
      setEditorSaveStatus(null);
      const result = await getEditorFile(targetPath);
      setIsLoadingEditorFile(false);
      if (!result.ok || !result.data) {
        const message = result.error?.message ?? 'Failed to load file';
        setEditorLoadError(message);
        showToast(message);
        return;
      }
      setSelectedFilePath(result.data.path);
      setEditorContent(result.data.content);
      setLastSavedContent(result.data.content);
      setEditorVersion(result.data.version);
      setEditorUpdatedAt(result.data.updatedAt);
    },
    [showToast],
  );

  const loadChatDetail = useCallback(
    async (chatId: string) => {
      setIsLoadingChat(true);
      const result = await getChat(chatId);
      setIsLoadingChat(false);
      if (!result.ok || !result.data) {
        showToast(result.error?.message ?? 'Failed to load chat history');
        return;
      }
      if (selectedChatIdRef.current !== chatId) {
        return;
      }
      const detail = result.data;
      setMessages(detail.messages);
      setActiveTurnId(detail.activeTurnId);
      setChats((prev) => {
        const hasChat = prev.some((chat) => chat.id === detail.chat.id);
        if (!hasChat) {
          return sortChatsByUpdatedAt([detail.chat, ...prev]);
        }
        return prev.map((chat) => (chat.id === detail.chat.id ? detail.chat : chat));
      });
    },
    [showToast],
  );

  const handleChatStreamEvent = useCallback(
    (event: ChatStreamEvent) => {
      if (event.type === 'ready') {
        setActiveTurnId(event.activeTurnId);
        setApprovalRequests(event.pendingApprovals);
        setSubmittingApprovalItemIds([]);
        return;
      }
      if (event.type === 'turn_started') {
        setActiveTurnId(event.turnId);
        setChats((prev) => touchChatSummary(prev, event.threadId, null));
        return;
      }
      if (event.type === 'turn_completed') {
        setActiveTurnId((prev) => (prev === event.turnId ? null : prev));
        setApprovalRequests((prev) => prev.filter((request) => request.turnId !== event.turnId));
        setSubmittingApprovalItemIds([]);
        setChats((prev) => touchChatSummary(prev, event.threadId, null));
      }
      if (event.type === 'approval_requested') {
        setApprovalRequests((prev) => upsertApprovalRequest(prev, event.request));
        return;
      }
      if (event.type === 'approval_resolved') {
        setApprovalRequests((prev) => prev.filter((request) => request.itemId !== event.itemId));
        setSubmittingApprovalItemIds((prev) => prev.filter((itemId) => itemId !== event.itemId));
        return;
      }
      if (event.type === 'error') {
        showToast(event.error.message);
      }

      setMessages((prev) => applyStreamEventToMessages(prev, event));

      if (event.type === 'item_started' || event.type === 'item_updated') {
        const preview =
          event.message.role === 'user' || event.message.role === 'assistant'
            ? event.message.text.slice(0, 120)
            : null;
        setChats((prev) => touchChatSummary(prev, event.threadId, preview));
      }
    },
    [showToast],
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
    let isCancelled = false;
    let timer: number | null = null;
    if (!selectedChatId) {
      timer = window.setTimeout(() => {
        if (isCancelled) {
          return;
        }
        setMessages([]);
        setActiveTurnId(null);
        setApprovalRequests([]);
        setSubmittingApprovalItemIds([]);
      }, 0);
      return () => {
        isCancelled = true;
        if (timer !== null) {
          window.clearTimeout(timer);
        }
      };
    }
    timer = window.setTimeout(() => {
      if (isCancelled) {
        return;
      }
      setApprovalRequests([]);
      setSubmittingApprovalItemIds([]);
      void loadChatDetail(selectedChatId);
    }, 0);
    return () => {
      isCancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [loadChatDetail, selectedChatId]);

  useEffect(() => {
    if (!selectedChatId) {
      return undefined;
    }

    const ws = new WebSocket(buildChatWsUrl(selectedChatId));
    ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      let payload: unknown = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      const parsed = parseChatStreamEvent(payload);
      if (!parsed || parsed.threadId !== selectedChatIdRef.current) {
        return;
      }
      handleChatStreamEvent(parsed);
    });

    ws.addEventListener('error', () => {
      showToast('Streaming connection failed');
    });

    return () => {
      ws.close();
    };
  }, [handleChatStreamEvent, selectedChatId, showToast]);

  useEffect(() => {
    if (activeView !== 'editor' || editorWorkspaceRoot === null) {
      return;
    }
    if (editorTreeNodes.length > 0) {
      return;
    }
    void loadEditorTree('');
  }, [activeView, editorTreeNodes.length, editorWorkspaceRoot, loadEditorTree]);

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

  const handleCreateChat = async () => {
    setIsLoadingChats(true);
    const result = await createChat(newChatLaunchOptions);
    setIsLoadingChats(false);
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to create chat');
      return;
    }
    const chat = result.data.chat;
    setChats((prev) => sortChatsByUpdatedAt([chat, ...prev]));
    setSelectedChatId(chat.id);
    switchView('chat');
    setIsMenuOpen(false);
    setIsCreatePanelOpen(false);

    const firstPrompt = newChatPrompt.trim();
    setNewChatPrompt('');
    if (!firstPrompt) {
      return;
    }

    setIsSending(true);
    const sendResult = await sendChatMessage(chat.id, firstPrompt);
    setIsSending(false);
    if (!sendResult.ok || !sendResult.data) {
      showToast(sendResult.error?.message ?? 'Failed to send first prompt');
      return;
    }
    setActiveTurnId(sendResult.data.turnId);
  };

  const handleCreateTerminal = async () => {
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
    setSelectedTerminalId(terminal.id);
    switchView('terminal');
    setIsMenuOpen(false);
    setIsCreatePanelOpen(false);
  };

  const handleUpdateSelectedLaunchOptions = async (nextLaunchOptions: ChatLaunchOptions) => {
    if (!selectedChatId || !selectedChat) {
      return;
    }
    if (
      selectedChat.launchOptions.model === nextLaunchOptions.model &&
      selectedChat.launchOptions.effort === nextLaunchOptions.effort &&
      selectedChat.launchOptions.approvalPolicy === nextLaunchOptions.approvalPolicy &&
      selectedChat.launchOptions.sandboxMode === nextLaunchOptions.sandboxMode
    ) {
      return;
    }

    setIsUpdatingLaunchOptions(true);
    const result = await updateChatLaunchOptions(selectedChatId, {
      model: nextLaunchOptions.model,
      effort: nextLaunchOptions.effort,
      approvalPolicy: nextLaunchOptions.approvalPolicy,
      sandboxMode: nextLaunchOptions.sandboxMode,
    });
    setIsUpdatingLaunchOptions(false);
    const payload = result.data;
    if (!result.ok || !payload) {
      showToast(result.error?.message ?? 'Failed to update launch options');
      return;
    }

    setChats((prev) => {
      return prev.map((chat) => {
        if (chat.id !== selectedChatId) {
          return chat;
        }
        return {
          ...chat,
          launchOptions: payload.launchOptions,
        };
      });
    });
  };

  const handleSend = async (text: string) => {
    if (!selectedChatId) {
      showToast('Select a chat first');
      return;
    }
    setMessages((prev) => addOptimisticUserMessage(prev, selectedChatId, text));
    setChats((prev) => touchChatSummary(prev, selectedChatId, text.slice(0, 120)));

    setIsSending(true);
    const result = await sendChatMessage(selectedChatId, text);
    setIsSending(false);
    if (!result.ok || !result.data) {
      if (result.error?.code === 'chat_not_found') {
        showToast('Thread not found. Please create a new chat manually.');
        void refreshChats();
        return;
      }

      showToast(result.error?.message ?? 'Failed to send message');
      void loadChatDetail(selectedChatId);
      return;
    }
    setActiveTurnId(result.data.turnId);
  };

  const handleStop = async () => {
    if (!selectedChatId || !activeTurnId) {
      return;
    }
    const result = await interruptTurn(selectedChatId, activeTurnId);
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to stop streaming');
      return;
    }
    setActiveTurnId(null);
  };

  const handleRespondApproval = async (itemId: string, decision: ChatApprovalDecision) => {
    if (!selectedChatId) {
      return;
    }
    if (submittingApprovalItemIds.includes(itemId)) {
      return;
    }

    setSubmittingApprovalItemIds((prev) => [...prev, itemId]);
    const result = await respondChatApproval(selectedChatId, itemId, { decision });
    setSubmittingApprovalItemIds((prev) => prev.filter((entry) => entry !== itemId));
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to respond approval');
      return;
    }
    setApprovalRequests((prev) => prev.filter((entry) => entry.itemId !== itemId));
  };

  const handleKillTerminal = async () => {
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
  };

  const confirmDiscardEditorChanges = (): boolean => {
    if (!isEditorDirty) {
      return true;
    }
    return window.confirm('You have unsaved changes. Discard them?');
  };

  const handleOpenEditorDirectory = (targetPath: string) => {
    void loadEditorTree(targetPath);
    setIsMenuOpen(false);
  };

  const handleSelectEditorFile = (targetPath: string) => {
    if (!confirmDiscardEditorChanges()) {
      return;
    }
    void loadEditorFile(targetPath);
    setIsMenuOpen(false);
  };

  const handleSaveEditorFile = async () => {
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
  };

  const switchView = (nextView: AppView) => {
    if (activeView === 'editor' && nextView !== 'editor' && !confirmDiscardEditorChanges()) {
      return;
    }
    setActiveView(nextView);
  };

  const handleRefresh = () => {
    void refreshChats();
    void refreshLaunchCatalog();
    void refreshTerminals();
    void refreshTerminalCatalog();
    void refreshEditorCatalog();
    if (activeView === 'editor') {
      void loadEditorTree(editorTreePath);
    }
  };

  const selectedProfile: TerminalProfile | null =
    terminalCatalog.profiles.find((profile) => profile.id === newTerminalProfileId) ?? null;

  return (
    <div className={`app-shell${isMenuOpen ? ' menu-open' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-title">Codex Dashboard</div>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="button button-secondary menu-toggle"
            type="button"
            onClick={() => setIsMenuOpen((prev) => !prev)}
          >
            Menu
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              setCreateMode(activeView === 'terminal' ? 'terminal' : 'chat');
              setIsCreatePanelOpen((prev) => !prev);
            }}
            disabled={isLoadingChats || isCreatingTerminal}
          >
            New Session
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={handleRefresh}
            disabled={isLoadingChats || isLoadingCatalog || isLoadingTerminals || isLoadingTerminalCatalog}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="view-tabs" role="tablist" aria-label="views">
        <button
          className={`view-tab${activeView === 'chat' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeView === 'chat'}
          onClick={() => switchView('chat')}
        >
          Chat
        </button>
        <button
          className={`view-tab${activeView === 'terminal' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeView === 'terminal'}
          onClick={() => switchView('terminal')}
        >
          Terminal
        </button>
        <button
          className={`view-tab${activeView === 'editor' ? ' active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeView === 'editor'}
          onClick={() => switchView('editor')}
        >
          Editor
        </button>
      </section>

      {isCreatePanelOpen ? (
        <section className="new-chat-panel">
          <div className="section-title">New Session</div>
          <div className="create-mode-tabs">
            <button
              className={`create-mode-tab${createMode === 'chat' ? ' active' : ''}`}
              type="button"
              onClick={() => setCreateMode('chat')}
            >
              Chat
            </button>
            <button
              className={`create-mode-tab${createMode === 'terminal' ? ' active' : ''}`}
              type="button"
              onClick={() => setCreateMode('terminal')}
            >
              Terminal
            </button>
          </div>

          {createMode === 'chat' ? (
            <>
              <label className="field-block">
                <span>Model</span>
                <select
                  className="field-input"
                  value={newChatLaunchOptions.model ?? ''}
                  disabled={isLoadingCatalog || modelOptions.length === 0}
                  onChange={(event) => {
                    const nextModel = event.target.value.length > 0 ? event.target.value : null;
                    setNewChatLaunchOptions((prev) => {
                      const nextEffort = resolveEffortForModel(modelOptions, nextModel, prev.effort);
                      return {
                        ...prev,
                        model: nextModel,
                        effort: nextEffort,
                      };
                    });
                  }}
                >
                  {modelOptions.length === 0 ? <option value="">No models available</option> : null}
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block">
                <span>Effort</span>
                <select
                  className="field-input"
                  value={newChatLaunchOptions.effort ?? ''}
                  disabled={isLoadingCatalog || !newChatLaunchOptions.model || newChatEfforts.length === 0}
                  onChange={(event) => {
                    const nextEffort = event.target.value.length > 0 ? event.target.value : null;
                    setNewChatLaunchOptions((prev) => {
                      return {
                        ...prev,
                        effort: nextEffort,
                      };
                    });
                  }}
                >
                  <option value="">Model default</option>
                  {newChatEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block">
                <span>Directory</span>
                <select
                  className="field-input"
                  value={newChatLaunchOptions.cwd ?? ''}
                  disabled={isLoadingCatalog || workspaceRoot === null}
                  onChange={(event) => {
                    const nextCwd = event.target.value.length > 0 ? event.target.value : null;
                    setNewChatLaunchOptions((prev) => {
                      return {
                        ...prev,
                        cwd: nextCwd,
                      };
                    });
                  }}
                >
                  <option value="">
                    {workspaceRoot ? `Workspace default (${workspaceRoot})` : 'WORKSPACE_ROOT not configured'}
                  </option>
                  {cwdChoices.filter((cwd) => cwd !== workspaceRoot).map((cwd) => (
                    <option key={cwd} value={cwd}>
                      {cwd}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block">
                <span>Approval Policy</span>
                <select
                  className="field-input"
                  value={newChatLaunchOptions.approvalPolicy ?? ''}
                  disabled={isLoadingCatalog || approvalPolicyOptions.length === 0}
                  onChange={(event) => {
                    const nextPolicy = event.target.value.length > 0 ? event.target.value : null;
                    setNewChatLaunchOptions((prev) => {
                      return {
                        ...prev,
                        approvalPolicy: nextPolicy as ChatApprovalPolicy | null,
                      };
                    });
                  }}
                >
                  {approvalPolicyOptions.length > 0 ? <option value="">Config default</option> : null}
                  {approvalPolicyOptions.length === 0 ? <option value="">No policies available</option> : null}
                  {approvalPolicyOptions.map((policy) => (
                    <option key={policy} value={policy}>
                      {formatApprovalPolicyLabel(policy)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block">
                <span>Sandbox Mode</span>
                <select
                  className="field-input"
                  value={newChatLaunchOptions.sandboxMode ?? ''}
                  disabled={isLoadingCatalog || sandboxModeOptions.length === 0}
                  onChange={(event) => {
                    const nextMode = event.target.value.length > 0 ? event.target.value : null;
                    if (nextMode === 'danger-full-access') {
                      const accepted = window.confirm(
                        'Danger Full Access disables filesystem sandboxing. Continue?',
                      );
                      if (!accepted) {
                        return;
                      }
                    }
                    setNewChatLaunchOptions((prev) => {
                      return {
                        ...prev,
                        sandboxMode: nextMode as ChatSandboxMode | null,
                      };
                    });
                  }}
                >
                  {sandboxModeOptions.length > 0 ? <option value="">Config default</option> : null}
                  {sandboxModeOptions.length === 0 ? <option value="">No sandbox modes available</option> : null}
                  {sandboxModeOptions.map((mode) => (
                    <option key={mode} value={mode}>
                      {formatSandboxModeLabel(mode)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block new-chat-prompt-field">
                <span>Prompt</span>
                <textarea
                  className="field-input new-chat-prompt"
                  placeholder="Type the first prompt..."
                  value={newChatPrompt}
                  onChange={(event) => setNewChatPrompt(event.target.value)}
                  disabled={isLoadingChats}
                />
              </label>
            </>
          ) : (
            <>
              <label className="field-block">
                <span>Profile</span>
                <select
                  className="field-input"
                  value={newTerminalProfileId ?? ''}
                  disabled={isLoadingTerminalCatalog || terminalCatalog.profiles.length === 0}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    setNewTerminalProfileId(value.length > 0 ? value : null);
                  }}
                >
                  {terminalCatalog.profiles.length === 0 ? <option value="">No profiles available</option> : null}
                  {terminalCatalog.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block">
                <span>Directory</span>
                <select
                  className="field-input"
                  value={newTerminalCwd ?? ''}
                  disabled={isLoadingTerminalCatalog || terminalCatalog.workspaceRoot === null}
                  onChange={(event) => {
                    const nextCwd = event.target.value.length > 0 ? event.target.value : null;
                    setNewTerminalCwd(nextCwd);
                  }}
                >
                  <option value="">
                    {terminalCatalog.workspaceRoot
                      ? `Workspace default (${terminalCatalog.workspaceRoot})`
                      : 'WORKSPACE_ROOT not configured'}
                  </option>
                  {terminalCatalog.cwdChoices
                    .filter((cwd) => cwd !== terminalCatalog.workspaceRoot)
                    .map((cwd) => (
                      <option key={cwd} value={cwd}>
                        {cwd}
                      </option>
                    ))}
                </select>
              </label>

              <div className="field-block">
                <span>Command</span>
                <input
                  className="field-input"
                  value={selectedProfile ? `${selectedProfile.command} ${selectedProfile.args.join(' ')}`.trim() : ''}
                  disabled
                />
              </div>
            </>
          )}

          <div className="new-chat-panel-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setIsCreatePanelOpen(false)}
              disabled={isLoadingChats || isCreatingTerminal}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={createMode === 'chat' ? handleCreateChat : handleCreateTerminal}
              disabled={
                createMode === 'chat'
                  ? isLoadingChats
                  : isCreatingTerminal || !newTerminalProfileId
              }
            >
              {createMode === 'chat' ? 'Create Chat' : 'Create Terminal'}
            </button>
          </div>
        </section>
      ) : null}

      <main className="app-body">
        <div
          className={`sidebar-backdrop${isMenuOpen ? ' visible' : ''}`}
          onClick={() => setIsMenuOpen(false)}
        />
        <aside className="sidebar">
          <div className="section-title">
            {activeView === 'chat' ? 'Chats' : activeView === 'terminal' ? 'Terminals' : 'Editor'}
          </div>
          {activeView === 'chat' ? (
            <div className="chat-list">
              {chats.length === 0 ? <div className="chat-list-empty">No chats yet.</div> : null}
              {chats.map((chat) => {
                const isSelected = chat.id === selectedChatId;
                return (
                  <article
                    key={chat.id}
                    className={`chat-list-item${isSelected ? ' selected' : ''}`}
                    onClick={() => {
                      setSelectedChatId(chat.id);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="chat-list-title">{chat.preview || '(untitled)'}</div>
                    <div className="chat-list-meta">
                      <span>{chat.source}</span>
                      <span>{formatRelative(chat.updatedAt)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {activeView === 'terminal' ? (
            <div className="chat-list">
              {terminals.length === 0 ? <div className="chat-list-empty">No terminals yet.</div> : null}
              {terminals.map((terminal) => {
                const isSelected = terminal.id === selectedTerminalId;
                return (
                  <article
                    key={terminal.id}
                    className={`chat-list-item${isSelected ? ' selected' : ''}`}
                    onClick={() => {
                      setSelectedTerminalId(terminal.id);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="chat-list-title">{terminal.profileId}</div>
                    <div className="chat-list-meta">
                      <span>{terminal.status}</span>
                      <span>{formatRelative(terminal.updatedAt)}</span>
                    </div>
                    <div className="terminal-list-output">{terminal.lastOutput || '(no output yet)'}</div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {activeView === 'editor' ? (
            <FileTree
              currentPath={editorTreePath}
              selectedFilePath={selectedFilePath}
              isLoading={isLoadingEditorCatalog || isLoadingEditorTree}
              nodes={editorTreeNodes}
              errorMessage={
                editorWorkspaceRoot === null
                  ? 'WORKSPACE_ROOT is not configured.'
                  : editorLoadError
              }
              onOpenDirectory={handleOpenEditorDirectory}
              onSelectFile={handleSelectEditorFile}
            />
          ) : null}
        </aside>

        <section className="main-panel">
          <div className={`view-pane${activeView === 'chat' ? ' active' : ''}`}>
            <ChatPane
              chatId={selectedChatId}
              messages={messages}
              activeTurnId={activeTurnId}
              isLoading={isLoadingChat}
              isSending={isSending}
              launchOptions={selectedChat?.launchOptions ?? null}
              modelOptions={modelOptions}
              approvalPolicyOptions={approvalPolicyOptions}
              sandboxModeOptions={sandboxModeOptions}
              isUpdatingLaunchOptions={isUpdatingLaunchOptions}
              approvalRequests={approvalRequests}
              submittingApprovalItemIds={submittingApprovalItemIds}
              onSend={handleSend}
              onStop={handleStop}
              onRespondApproval={handleRespondApproval}
              onUpdateLaunchOptions={handleUpdateSelectedLaunchOptions}
            />
          </div>

          <div className={`view-pane${activeView === 'terminal' ? ' active' : ''}`}>
            <TerminalPane
              terminalId={selectedTerminalId}
              status={selectedTerminal?.status ?? null}
              onStreamEvent={handleTerminalStreamEvent}
              onToast={showToast}
            />
            <div className="terminal-pane-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={handleKillTerminal}
                disabled={!selectedTerminalId || selectedTerminal?.status !== 'running'}
              >
                Kill Terminal
              </button>
            </div>
          </div>

          <div className={`view-pane${activeView === 'editor' ? ' active' : ''}`}>
            <div className="chat-card editor-placeholder">
              <EditorPane
                filePath={selectedFilePath}
                content={editorContent}
                isLoading={isLoadingEditorFile}
                isSaving={isSavingEditorFile}
                isDirty={isEditorDirty}
                errorMessage={
                  editorWorkspaceRoot === null
                    ? 'WORKSPACE_ROOT is not configured.'
                    : editorLoadError
                }
                saveErrorMessage={editorSaveError}
                saveStatusMessage={editorSaveStatus}
                onChange={(value) => {
                  setEditorContent(value);
                  setEditorSaveError(null);
                  setEditorSaveStatus(editorUpdatedAt ? `Loaded ${formatRelative(editorUpdatedAt)}` : null);
                }}
                onSave={handleSaveEditorFile}
              />
            </div>
          </div>
        </section>
      </main>

      {toast ? <div className="toast">{toast.message}</div> : null}
      {activeView === 'chat' && selectedChat ? <div className="footer-id">Chat ID: {selectedChat.id}</div> : null}
      {activeView === 'terminal' && selectedTerminal ? <div className="footer-id">Terminal ID: {selectedTerminal.id}</div> : null}
      {activeView === 'editor' && selectedFilePath ? <div className="footer-id">File: {selectedFilePath}</div> : null}
    </div>
  );
};

export default App;
