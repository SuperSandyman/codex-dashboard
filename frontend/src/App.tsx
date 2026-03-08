import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import {
  FilePenLineIcon,
  MessageSquareIcon,
  TerminalSquareIcon,
  XIcon,
} from 'lucide-react';

import {
  type ChatApprovalDecision,
  type ChatApprovalPolicy,
  type ChatApprovalRequest,
  type ChatUserInputRequest,
  type RespondChatUserInputRequest,
  type ChatSandboxMode,
  createChat,
  getChat,
  getChatLaunchCatalog,
  interruptTurn,
  listChats,
  respondChatApproval,
  respondChatUserInput,
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
import { FileTree, type EditorDirectoryLoadResult } from './features/editor/FileTree';
import {
  listEditorBookmarks,
  removeEditorBookmark,
  upsertEditorBookmark,
} from './features/editor/bookmarks/indexedDbStore';
import type { EditorFileBookmark } from './features/editor/bookmarks/types';
import { TerminalPane } from './features/terminal/TerminalPane';
import type { TerminalStreamEvent } from './features/terminal/protocol';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Select } from './components/ui/select';
import { Textarea } from './components/ui/textarea';
import { cn } from './lib/utils';

interface ToastState {
  readonly message: string;
}

interface SessionDirectoryRequest {
  readonly workspaceRoot: string;
  readonly promise: Promise<readonly string[]>;
}

interface SessionDirectoryCache {
  readonly workspaceRoot: string;
  readonly fetchedAt: number;
  readonly directories: readonly string[];
}

type AppView = 'chat' | 'terminal' | 'editor';
type CreateMode = 'chat' | 'terminal';
type SwipeDirection = 'left' | 'right';
type WorkbenchTabKind = 'terminal' | 'editor';

interface WorkbenchTab {
  readonly id: string;
  readonly kind: WorkbenchTabKind;
  readonly resourceId: string;
}

const VIEW_ORDER: readonly AppView[] = ['chat', 'terminal', 'editor'];
const MOBILE_BREAKPOINT_MEDIA_QUERY = '(max-width: 720px)';
const MIN_SWIPE_DISTANCE_PX = 48;
const MAX_SWIPE_VERTICAL_DRIFT_PX = 72;
const SESSION_DIRECTORY_CACHE_TTL_MS = 60_000;

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

const toWorkbenchTabId = (kind: WorkbenchTabKind, resourceId: string): string => {
  return `${kind}:${resourceId}`;
};

const toFileTabLabel = (path: string): string => {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
};

const toTerminalTabLabel = (terminal: TerminalSummary | null): string => {
  if (!terminal) {
    return 'Terminal';
  }
  const cwdSegments = terminal.cwd.split('/').filter((segment) => segment.length > 0);
  const cwdLabel = cwdSegments[cwdSegments.length - 1] ?? terminal.cwd;
  return `${cwdLabel} (${terminal.id.slice(0, 6)})`;
};

const toChatSidebarLabel = (preview: string): string => {
  const normalized = preview.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 28) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}…`;
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

const upsertUserInputRequest = (
  requests: readonly ChatUserInputRequest[],
  next: ChatUserInputRequest,
): ChatUserInputRequest[] => {
  const index = requests.findIndex((entry) => entry.itemId === next.itemId);
  if (index < 0) {
    return [...requests, next];
  }
  const copy = [...requests];
  copy[index] = next;
  return copy;
};

const sortTerminalsByUpdatedAt = (terminals: readonly TerminalSummary[]): TerminalSummary[] => {
  return [...terminals].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
};

const trimTrailingSlash = (value: string): string => {
  if (value === '/') {
    return value;
  }
  return value.replace(/\/+$/, '');
};

const toAbsoluteWorkspacePath = (workspaceRoot: string, relativePath: string): string => {
  const normalizedRoot = trimTrailingSlash(workspaceRoot);
  const normalizedRelative = relativePath.replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (normalizedRelative.length === 0) {
    return normalizedRoot;
  }
  return `${normalizedRoot}/${normalizedRelative}`;
};

const toRelativeWorkspacePath = (workspaceRoot: string, absolutePath: string): string | null => {
  const normalizedRoot = trimTrailingSlash(workspaceRoot);
  const normalizedPath = trimTrailingSlash(absolutePath);
  if (normalizedPath === normalizedRoot) {
    return '';
  }
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return null;
  }
  return normalizedPath.slice(normalizedRoot.length + 1);
};

const resolveDirectoryInputValue = (workspaceRoot: string | null, rawValue: string): string | null => {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0 || trimmed === '.' || trimmed === './') {
    return null;
  }
  if (!workspaceRoot || trimmed.startsWith('/')) {
    return trimmed;
  }
  const normalizedRelative = trimmed.replace(/^\.\/+/, '');
  if (
    normalizedRelative === '..' ||
    normalizedRelative.startsWith('../') ||
    normalizedRelative.includes('/../')
  ) {
    return trimmed;
  }
  return toAbsoluteWorkspacePath(workspaceRoot, normalizedRelative);
};

const toDirectoryOptionLabel = (workspaceRoot: string | null, cwd: string): string => {
  if (!workspaceRoot) {
    return cwd;
  }
  const relativePath = toRelativeWorkspacePath(workspaceRoot, cwd);
  if (relativePath === null) {
    return cwd;
  }
  return relativePath.length === 0 ? '.' : `./${relativePath}`;
};

const countPathDepth = (pathValue: string): number => {
  return pathValue.split('/').filter((segment) => segment.length > 0).length;
};

const toBookmarkLabel = (path: string): string => {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
};

const sortBookmarksByUpdatedAt = (
  bookmarks: readonly EditorFileBookmark[],
): EditorFileBookmark[] => {
  return [...bookmarks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

const stripLineInfoFromPath = (value: string): string => {
  return value.replace(/#L\d+(C\d+)?$/, '').replace(/:\d+(?::\d+)?$/, '');
};

const decodePathComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizePathFromChatLink = (rawPath: string): string => {
  const trimmed = rawPath.trim().replace(/^<|>$/g, '').replace(/^['"`]|['"`]$/g, '');
  if (!trimmed) {
    return '';
  }

  const withoutFileScheme = trimmed.replace(/^file:\/\//, '');
  const resolvedUrlPath = (() => {
    try {
      const url = new URL(withoutFileScheme);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return `${url.pathname}${url.hash}`;
      }
    } catch {
      return withoutFileScheme;
    }
    return withoutFileScheme;
  })();

  const decoded = decodePathComponent(resolvedUrlPath);
  const withoutQuery = decoded.split('?')[0] ?? decoded;
  const withoutHash = withoutQuery.split('#')[0] ?? withoutQuery;
  const stripped = stripLineInfoFromPath(withoutHash);
  return stripped.replace(/\\/g, '/').replace(/^\.\/+/, '');
};

const toWorkspaceRelativePathFromAbsolute = (
  workspaceRoot: string,
  absolutePath: string,
): string | null => {
  const directRelativePath = toRelativeWorkspacePath(workspaceRoot, absolutePath);
  if (directRelativePath !== null) {
    return directRelativePath;
  }

  const workspaceRepoRoot = workspaceRoot.replace(/\/worktrees\/[^/]+$/, '');
  const relativeFromRepoRoot = toRelativeWorkspacePath(workspaceRepoRoot, absolutePath);
  if (relativeFromRepoRoot === null) {
    return null;
  }

  const adjustedRelativePath = relativeFromRepoRoot.replace(/^worktrees\/[^/]+\//, '');
  if (
    adjustedRelativePath === '..' ||
    adjustedRelativePath.startsWith('../') ||
    adjustedRelativePath.includes('/../')
  ) {
    return null;
  }
  return adjustedRelativePath;
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

  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUpdatingLaunchOptions, setIsUpdatingLaunchOptions] = useState(false);
  const [isLoadingTerminals, setIsLoadingTerminals] = useState(false);
  const [isLoadingTerminalCatalog, setIsLoadingTerminalCatalog] = useState(false);
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false);
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
  const [userInputRequests, setUserInputRequests] = useState<ChatUserInputRequest[]>([]);
  const [submittingUserInputItemIds, setSubmittingUserInputItemIds] = useState<string[]>([]);
  const [sessionDirectoryOptions, setSessionDirectoryOptions] = useState<string[]>([]);
  const [isLoadingSessionDirectories, setIsLoadingSessionDirectories] = useState(false);
  const [sessionDirectoryError, setSessionDirectoryError] = useState<string | null>(null);

  const [terminalCatalog, setTerminalCatalog] = useState<TerminalCatalog>(EMPTY_TERMINAL_CATALOG);
  const [newTerminalProfileId, setNewTerminalProfileId] = useState<string | null>(null);
  const [newTerminalCwd, setNewTerminalCwd] = useState<string | null>(null);

  const selectedChatIdRef = useRef<string | null>(null);
  const mobileSwitcherTouchStartRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const sessionDirectoryInFlightRef = useRef<SessionDirectoryRequest | null>(null);
  const sessionDirectoryCacheRef = useRef<SessionDirectoryCache | null>(null);
  const sessionDirectoryRequestIdRef = useRef(0);

  const selectedChat = useMemo(() => {
    return chats.find((chat) => chat.id === selectedChatId) ?? null;
  }, [chats, selectedChatId]);

  const activeWorkbenchTab = useMemo(() => {
    if (!activeWorkbenchTabId) {
      return null;
    }
    return workbenchTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null;
  }, [activeWorkbenchTabId, workbenchTabs]);

  const activeWorkbenchTerminal = useMemo(() => {
    if (!activeWorkbenchTab || activeWorkbenchTab.kind !== 'terminal') {
      return null;
    }
    return terminals.find((terminal) => terminal.id === activeWorkbenchTab.resourceId) ?? null;
  }, [activeWorkbenchTab, terminals]);

  const activeWorkbenchKind: WorkbenchTabKind | null = useMemo(() => {
    if (activeWorkbenchTab) {
      return activeWorkbenchTab.kind;
    }
    if (activeView === 'chat') {
      return null;
    }
    return activeView;
  }, [activeView, activeWorkbenchTab]);

  const newChatEfforts = useMemo(() => {
    const model = modelOptions.find((entry) => entry.id === newChatLaunchOptions.model) ?? null;
    return model?.efforts ?? [];
  }, [modelOptions, newChatLaunchOptions.model]);

  const isEditorDirty = useMemo(() => {
    return selectedFilePath !== null && editorContent !== lastSavedContent;
  }, [editorContent, lastSavedContent, selectedFilePath]);

  const isSelectedFileBookmarked = useMemo(() => {
    if (!selectedFilePath) {
      return false;
    }
    return editorBookmarks.some((bookmark) => bookmark.path === selectedFilePath);
  }, [editorBookmarks, selectedFilePath]);

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
    const result = await getEditorCatalog();
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to load editor catalog');
      return;
    }
    setEditorWorkspaceRoot(result.data.workspaceRoot);
  }, [showToast]);

  const refreshSessionDirectoryOptions = useCallback(
    async (notifyOnError: boolean, forceReload = false) => {
      const pickerWorkspaceRoot = workspaceRoot ?? terminalCatalog.workspaceRoot;
      if (!pickerWorkspaceRoot) {
        sessionDirectoryInFlightRef.current = null;
        sessionDirectoryCacheRef.current = null;
        setSessionDirectoryOptions([]);
        setSessionDirectoryError(null);
        return;
      }

      const directorySet = new Set<string>();
      const appendSeedDirectory = (cwd: string) => {
        const candidate = resolveDirectoryInputValue(pickerWorkspaceRoot, cwd);
        if (!candidate || candidate === pickerWorkspaceRoot) {
          return;
        }
        const relativePath = toRelativeWorkspacePath(pickerWorkspaceRoot, candidate);
        if (relativePath === null) {
          return;
        }
        directorySet.add(toAbsoluteWorkspacePath(pickerWorkspaceRoot, relativePath));
      };

      cwdChoices.forEach((cwd) => appendSeedDirectory(cwd));
      terminalCatalog.cwdChoices.forEach((cwd) => appendSeedDirectory(cwd));

      const mergeOptions = (directories: readonly string[]): string[] => {
        const merged = new Set(directorySet);
        directories.forEach((directory) => merged.add(directory));
        return [...merged].sort((a, b) => a.localeCompare(b));
      };

      const cached = sessionDirectoryCacheRef.current;
      const isCacheFresh =
        cached &&
        cached.workspaceRoot === pickerWorkspaceRoot &&
        Date.now() - cached.fetchedAt < SESSION_DIRECTORY_CACHE_TTL_MS;
      if (!forceReload && isCacheFresh) {
        setSessionDirectoryOptions(mergeOptions(cached.directories));
        setSessionDirectoryError(null);
        setIsLoadingSessionDirectories(false);
        return;
      }

      setIsLoadingSessionDirectories(true);
      setSessionDirectoryError(null);

      let fetchPromise: Promise<readonly string[]>;
      const inFlight = sessionDirectoryInFlightRef.current;
      if (inFlight && inFlight.workspaceRoot === pickerWorkspaceRoot) {
        fetchPromise = inFlight.promise;
      } else {
        fetchPromise = (async (): Promise<readonly string[]> => {
          const rootTreeResult = await getEditorTree('');
          if (!rootTreeResult.ok || !rootTreeResult.data) {
            throw new Error(rootTreeResult.error?.message ?? 'Failed to load directories');
          }

          const firstLevelDirectories = rootTreeResult.data.nodes
            .filter((node) => node.kind === 'directory' && countPathDepth(node.path) <= 1)
            .map((node) => node.path)
            .slice(0, 30);

          const treeDirectories = new Set<string>();
          firstLevelDirectories.forEach((relativePath) => {
            treeDirectories.add(toAbsoluteWorkspacePath(pickerWorkspaceRoot, relativePath));
          });

          const secondLevelResults = await Promise.all(
            firstLevelDirectories.map((relativePath) => getEditorTree(relativePath)),
          );
          secondLevelResults.forEach((result) => {
            if (!result.ok || !result.data) {
              return;
            }
            result.data.nodes.forEach((node) => {
              if (node.kind !== 'directory') {
                return;
              }
              if (countPathDepth(node.path) <= 2) {
                treeDirectories.add(toAbsoluteWorkspacePath(pickerWorkspaceRoot, node.path));
              }
            });
          });
          return [...treeDirectories].sort((a, b) => a.localeCompare(b));
        })();
        sessionDirectoryInFlightRef.current = {
          workspaceRoot: pickerWorkspaceRoot,
          promise: fetchPromise,
        };
      }

      const requestId = sessionDirectoryRequestIdRef.current + 1;
      sessionDirectoryRequestIdRef.current = requestId;
      try {
        const loadedDirectories = await fetchPromise;
        if (sessionDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        sessionDirectoryCacheRef.current = {
          workspaceRoot: pickerWorkspaceRoot,
          fetchedAt: Date.now(),
          directories: loadedDirectories,
        };
        setSessionDirectoryOptions(mergeOptions(loadedDirectories));
        setSessionDirectoryError(null);
      } catch (error) {
        if (sessionDirectoryRequestIdRef.current !== requestId) {
          return;
        }
        setSessionDirectoryOptions(mergeOptions([]));
        const message = error instanceof Error ? error.message : 'Failed to load directories';
        setSessionDirectoryError(message);
        if (notifyOnError) {
          showToast(message);
        }
      } finally {
        if (sessionDirectoryRequestIdRef.current === requestId) {
          setIsLoadingSessionDirectories(false);
        }
        const latestInFlight = sessionDirectoryInFlightRef.current;
        if (latestInFlight?.workspaceRoot === pickerWorkspaceRoot && latestInFlight.promise === fetchPromise) {
          sessionDirectoryInFlightRef.current = null;
        }
      }
    },
    [cwdChoices, showToast, terminalCatalog.cwdChoices, terminalCatalog.workspaceRoot, workspaceRoot],
  );

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
        setUserInputRequests(event.pendingUserInputRequests);
        setSubmittingUserInputItemIds([]);
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
        setUserInputRequests((prev) => prev.filter((request) => request.turnId !== event.turnId));
        setSubmittingUserInputItemIds([]);
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
      if (event.type === 'user_input_requested') {
        setUserInputRequests((prev) => upsertUserInputRequest(prev, event.request));
        return;
      }
      if (event.type === 'user_input_resolved') {
        setUserInputRequests((prev) => prev.filter((request) => request.itemId !== event.itemId));
        setSubmittingUserInputItemIds((prev) => prev.filter((itemId) => itemId !== event.itemId));
        return;
      }
      if (event.type === 'error') {
        showToast(event.error.message);
      }
      if (event.type === 'app_server_event') {
        return;
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
    if (!isCreatePanelOpen) {
      return;
    }
    void refreshSessionDirectoryOptions(false);
  }, [isCreatePanelOpen, refreshSessionDirectoryOptions]);

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
        setUserInputRequests([]);
        setSubmittingUserInputItemIds([]);
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
      setUserInputRequests([]);
      setSubmittingUserInputItemIds([]);
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
    if (!editorWorkspaceRoot) {
      setEditorBookmarks([]);
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
      return [
        ...prev,
        {
          id: tabId,
          kind: 'terminal',
          resourceId: terminalId,
        },
      ];
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
        return [
          ...prev,
          {
            id: tabId,
            kind: 'editor',
            resourceId: targetPath,
          },
        ];
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

      const fallbackTab =
        nextTabs[closingIndex] ??
        nextTabs[Math.max(closingIndex - 1, 0)] ??
        null;
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

  useEffect(() => {
    const availableTerminalIds = new Set(terminals.map((terminal) => terminal.id));
    setWorkbenchTabs((prev) => {
      return prev.filter((tab) => tab.kind === 'editor' || availableTerminalIds.has(tab.resourceId));
    });
  }, [terminals]);

  useEffect(() => {
    if (!activeWorkbenchTabId) {
      return;
    }
    const hasActiveTab = workbenchTabs.some((tab) => tab.id === activeWorkbenchTabId);
    if (hasActiveTab) {
      return;
    }
    const fallbackTab = workbenchTabs[0] ?? null;
    if (!fallbackTab) {
      setActiveWorkbenchTabId(null);
      return;
    }
    activateWorkbenchTab(fallbackTab);
  }, [activeWorkbenchTabId, activateWorkbenchTab, workbenchTabs]);

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
    openTerminalTab(terminal.id);
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

  const handleRespondUserInput = async (
    itemId: string,
    payload: RespondChatUserInputRequest,
  ) => {
    if (!selectedChatId) {
      return;
    }
    if (submittingUserInputItemIds.includes(itemId)) {
      return;
    }

    setSubmittingUserInputItemIds((prev) => [...prev, itemId]);
    const result = await respondChatUserInput(selectedChatId, itemId, payload);
    setSubmittingUserInputItemIds((prev) => prev.filter((entry) => entry !== itemId));
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to respond user input');
      return;
    }
    setUserInputRequests((prev) => prev.filter((entry) => entry.itemId !== itemId));
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
    const terminalTabId = toWorkbenchTabId('terminal', terminalIdToKill);
    setWorkbenchTabs((prev) => prev.filter((tab) => tab.id !== terminalTabId));
    if (activeWorkbenchTabId === terminalTabId) {
      setActiveWorkbenchTabId(null);
    }
  };

  const handleSelectEditorFile = (targetPath: string) => {
    void openEditorTab(targetPath);
    setIsMenuOpen(false);
  };

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
    setActiveView(nextView);
  };

  const handleOpenFileFromChat = useCallback(
    (rawPath: string) => {
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
    },
    [editorWorkspaceRoot, openEditorTab, showToast],
  );

  const switchViewBySwipe = (direction: SwipeDirection) => {
    if (!window.matchMedia(MOBILE_BREAKPOINT_MEDIA_QUERY).matches) {
      return;
    }
    const currentIndex = VIEW_ORDER.indexOf(activeView);
    if (currentIndex < 0) {
      return;
    }
    const offset = direction === 'left' ? 1 : -1;
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= VIEW_ORDER.length) {
      return;
    }
    switchView(VIEW_ORDER[nextIndex]);
  };

  const handleMobileSwitcherTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) {
      mobileSwitcherTouchStartRef.current = null;
      return;
    }
    mobileSwitcherTouchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  };

  const handleMobileSwitcherTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const startPoint = mobileSwitcherTouchStartRef.current;
    mobileSwitcherTouchStartRef.current = null;
    if (!startPoint) {
      return;
    }
    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }
    const deltaX = touch.clientX - startPoint.x;
    const deltaY = touch.clientY - startPoint.y;
    if (Math.abs(deltaX) < MIN_SWIPE_DISTANCE_PX) {
      return;
    }
    if (Math.abs(deltaY) > MAX_SWIPE_VERTICAL_DRIFT_PX || Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }
    switchViewBySwipe(deltaX < 0 ? 'left' : 'right');
  };

  const selectedProfile: TerminalProfile | null =
    terminalCatalog.profiles.find((profile) => profile.id === newTerminalProfileId) ?? null;
  const toSidebarRowClassName = (isSelected: boolean): string => {
    return cn(
      'flex w-full items-center gap-3 rounded-none px-2.5 py-2 text-left text-sm transition-colors',
      isSelected
        ? 'bg-white/[0.14] text-white'
        : 'text-[#f1f1f1] hover:bg-white/[0.06] hover:text-white',
    );
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#212121] text-[#ececec]">
      {isCreatePanelOpen ? (
        <section
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 px-3 pt-8 pb-4 backdrop-blur-sm"
          onClick={() => setIsCreatePanelOpen(false)}
        >
          <Card
            className="w-full max-w-5xl border-white/10 bg-[#171717]"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">New Session</CardTitle>
                <div className="inline-flex rounded-md border border-white/10 bg-white/[0.03] p-1">
                  <Button
                    variant={createMode === 'chat' ? 'default' : 'ghost'}
                    size="sm"
                    type="button"
                    onClick={() => setCreateMode('chat')}
                  >
                    Chat
                  </Button>
                  <Button
                    variant={createMode === 'terminal' ? 'default' : 'ghost'}
                    size="sm"
                    type="button"
                    onClick={() => setCreateMode('terminal')}
                  >
                    Terminal
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 pt-0">

              {createMode === 'chat' ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      <span>Model</span>
                      <Select
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
                      </Select>
                    </label>

                    <label className="grid gap-1 text-xs text-muted-foreground">
                      <span>Effort</span>
                      <Select
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
                      </Select>
                    </label>

                    <label className="grid gap-1 text-xs text-muted-foreground">
                      <span>Approval Policy</span>
                      <Select
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
                      </Select>
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      <span>Directory</span>
                      <Input
                        list="new-session-chat-directory-options"
                        value={newChatLaunchOptions.cwd ?? ''}
                        disabled={isLoadingCatalog || workspaceRoot === null}
                        placeholder={workspaceRoot ? `Workspace default (${workspaceRoot})` : 'WORKSPACE_ROOT not configured'}
                        onChange={(event) => {
                          const nextCwd = resolveDirectoryInputValue(workspaceRoot, event.target.value);
                          setNewChatLaunchOptions((prev) => {
                            return {
                              ...prev,
                              cwd: nextCwd,
                            };
                          });
                        }}
                      />
                      <datalist id="new-session-chat-directory-options">
                        {chatDirectoryOptions.map((cwd) => (
                          <option key={cwd} value={cwd} />
                        ))}
                      </datalist>
                    </label>

                    <label className="grid gap-1 text-xs text-muted-foreground">
                      <span>Sandbox Mode</span>
                      <Select
                        value={newChatLaunchOptions.sandboxMode ?? ''}
                        disabled={isLoadingCatalog || sandboxModeOptions.length === 0}
                        onChange={(event) => {
                          const nextMode = event.target.value.length > 0 ? event.target.value : null;
                          if (nextMode === 'danger-full-access') {
                            const accepted = window.confirm('Danger Full Access disables filesystem sandboxing. Continue?');
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
                      </Select>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={workspaceRoot === null}
                      onClick={() => {
                        setNewChatLaunchOptions((prev) => {
                          return {
                            ...prev,
                            cwd: null,
                          };
                        });
                      }}
                    >
                      Workspace default
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={workspaceRoot === null || isLoadingSessionDirectories}
                      onClick={() => {
                        void refreshSessionDirectoryOptions(true, true);
                      }}
                    >
                      Reload list
                    </Button>
                    <Badge variant="outline">
                      {isLoadingSessionDirectories ? 'Loading directories...' : 'Directory suggestions ready'}
                    </Badge>
                    {sessionDirectoryError ? <Badge variant="destructive">{sessionDirectoryError}</Badge> : null}
                  </div>

                  <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2">
                    {chatDirectoryOptions.slice(0, 24).map((cwd) => (
                      <button
                        key={cwd}
                        type="button"
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-xs',
                          newChatLaunchOptions.cwd === cwd
                            ? 'border-primary/60 bg-primary/15 text-primary'
                            : 'border-border/60 hover:bg-accent/70',
                        )}
                        onClick={() => {
                          setNewChatLaunchOptions((prev) => {
                            return {
                              ...prev,
                              cwd,
                            };
                          });
                        }}
                        title={cwd}
                      >
                        {toDirectoryOptionLabel(workspaceRoot, cwd)}
                      </button>
                    ))}
                  </div>

                  <label className="grid gap-1 text-xs text-muted-foreground">
                    <span>Prompt</span>
                    <Textarea
                      className="min-h-24"
                      placeholder="Type the first prompt..."
                      value={newChatPrompt}
                      onChange={(event) => setNewChatPrompt(event.target.value)}
                      disabled={isLoadingChats}
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      <span>Profile</span>
                      <Select
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
                      </Select>
                    </label>

                    <label className="grid gap-1 text-xs text-muted-foreground">
                      <span>Directory</span>
                      <Input
                        list="new-session-terminal-directory-options"
                        value={newTerminalCwd ?? ''}
                        disabled={isLoadingTerminalCatalog || terminalCatalog.workspaceRoot === null}
                        placeholder={
                          terminalCatalog.workspaceRoot
                            ? `Workspace default (${terminalCatalog.workspaceRoot})`
                            : 'WORKSPACE_ROOT not configured'
                        }
                        onChange={(event) => {
                          const nextCwd = resolveDirectoryInputValue(terminalCatalog.workspaceRoot, event.target.value);
                          setNewTerminalCwd(nextCwd);
                        }}
                      />
                      <datalist id="new-session-terminal-directory-options">
                        {terminalDirectoryOptions.map((cwd) => (
                          <option key={cwd} value={cwd} />
                        ))}
                      </datalist>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={terminalCatalog.workspaceRoot === null}
                      onClick={() => {
                        setNewTerminalCwd(terminalCatalog.workspaceRoot);
                      }}
                    >
                      Workspace default
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={terminalCatalog.workspaceRoot === null || isLoadingSessionDirectories}
                      onClick={() => {
                        void refreshSessionDirectoryOptions(true, true);
                      }}
                    >
                      Reload list
                    </Button>
                  </div>

                  <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2">
                    {terminalDirectoryOptions.slice(0, 24).map((cwd) => (
                      <button
                        key={cwd}
                        type="button"
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-xs',
                          newTerminalCwd === cwd
                            ? 'border-primary/60 bg-primary/15 text-primary'
                            : 'border-border/60 hover:bg-accent/70',
                        )}
                        onClick={() => {
                          setNewTerminalCwd(cwd);
                        }}
                        title={cwd}
                      >
                        {toDirectoryOptionLabel(terminalCatalog.workspaceRoot, cwd)}
                      </button>
                    ))}
                  </div>

                  <label className="grid gap-1 text-xs text-muted-foreground">
                    <span>Command</span>
                    <Input
                      value={selectedProfile ? `${selectedProfile.command} ${selectedProfile.args.join(' ')}`.trim() : ''}
                      disabled
                    />
                  </label>
                </>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setIsCreatePanelOpen(false)}
                  disabled={isLoadingChats || isCreatingTerminal}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={createMode === 'chat' ? handleCreateChat : handleCreateTerminal}
                  disabled={createMode === 'chat' ? isLoadingChats : isCreatingTerminal || !newTerminalProfileId}
                >
                  {createMode === 'chat' ? 'Create Chat' : 'Create Terminal'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <main className="relative z-10 flex min-h-0 flex-1 gap-0 p-0">
        <Button
          className="fixed left-3 top-3 z-40 md:hidden"
          variant="outline"
          size="sm"
          type="button"
          onClick={() => setIsMenuOpen((prev) => !prev)}
        >
          Menu
        </Button>

        <div
          className={cn(
            'fixed inset-0 z-20 bg-black/55 backdrop-blur-sm md:hidden',
            isMenuOpen ? 'block' : 'hidden',
          )}
          onClick={() => setIsMenuOpen(false)}
        />

        <aside
          className={cn(
            'sidebar-scrollbar fixed inset-y-0 left-0 z-30 w-[17rem] max-w-[90vw] overflow-y-auto bg-[#181818] p-3 shadow-xl transition-transform duration-300 ease-in-out md:static md:z-auto md:w-72 md:max-w-none md:translate-x-0 md:bg-transparent md:p-0 md:shadow-none',
            isMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          )}
        >
          <Card className="h-full min-h-0 rounded-none border-white/10 bg-[#181818]">
            <CardContent className="sidebar-scrollbar flex min-h-0 flex-col gap-4 overflow-x-hidden overflow-y-auto p-2 text-[#f1f1f1]">
              <div className="grid gap-1">
                <button
                  type="button"
                  className={toSidebarRowClassName(false)}
                  onClick={() => {
                    openChatCreateDialog();
                  }}
                >
                  <MessageSquareIcon className="size-4" />
                  <span>新しいチャット</span>
                </button>
                <button
                  type="button"
                  className={toSidebarRowClassName(activeWorkbenchKind === 'terminal')}
                  onClick={() => {
                    openTerminalCreateDialog();
                  }}
                >
                  <TerminalSquareIcon className="size-4" />
                  <span>ターミナル</span>
                  {isLoadingTerminals ? <span className="ml-auto text-[10px] text-[#c7c7c7]">読み込み中</span> : null}
                </button>
                <button
                  type="button"
                  className={toSidebarRowClassName(activeWorkbenchKind === 'editor')}
                  onClick={() => {
                    handleFocusEditorWorkbench();
                    setIsMenuOpen(false);
                  }}
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
                          onClick={() => {
                            setSelectedChatId(chat.id);
                            switchView('chat');
                            setIsMenuOpen(false);
                          }}
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
                    bookmarks={editorBookmarks}
                    errorMessage={editorWorkspaceRoot === null ? 'WORKSPACE_ROOT is not configured.' : null}
                    onLoadDirectory={loadEditorDirectory}
                    onSelectFile={handleSelectEditorFile}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </aside>

        <section
          className="min-h-0 flex-1 transition-all duration-300 ease-out"
          onTouchStart={handleMobileSwitcherTouchStart}
          onTouchEnd={handleMobileSwitcherTouchEnd}
        >
          {activeView === 'chat' ? (
            <ChatPane
              key={selectedChatId ?? 'chat-none'}
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
              userInputRequests={userInputRequests}
              submittingUserInputItemIds={submittingUserInputItemIds}
              onSend={handleSend}
              onStop={handleStop}
              onRespondApproval={handleRespondApproval}
              onRespondUserInput={handleRespondUserInput}
              onUpdateLaunchOptions={handleUpdateSelectedLaunchOptions}
              onOpenFileFromChat={handleOpenFileFromChat}
            />
          ) : null}

          {activeView !== 'chat' ? (
            <Card className="h-full min-h-0 border-white/10 bg-[#171717]">
              <CardContent className="grid h-full min-h-0 grid-rows-[auto_1fr] p-0">
                <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-black/20 p-2">
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
                          'group inline-flex max-w-72 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                          isActive
                            ? 'border-white/30 bg-white/[0.12] text-white'
                            : 'border-white/10 bg-white/[0.03] text-[#cfcfcf] hover:bg-white/[0.08]',
                        )}
                        onClick={() => {
                          activateWorkbenchTab(tab);
                        }}
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
                            closeWorkbenchTab(tab.id);
                          }}
                        >
                          <XIcon className="size-3" />
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="min-h-0 p-3">
                  {activeWorkbenchTab?.kind === 'terminal' ? (
                    <TerminalPane
                      terminalId={activeWorkbenchTab.resourceId}
                      status={activeWorkbenchTerminal?.status ?? null}
                      onStreamEvent={handleTerminalStreamEvent}
                      onToast={showToast}
                      onKill={handleKillTerminal}
                      isKillDisabled={!activeWorkbenchTerminal || activeWorkbenchTerminal.status !== 'running'}
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
                      saveStatusMessage={editorSaveStatus}
                      onChange={(value) => {
                        setEditorContent(value);
                        setEditorSaveError(null);
                        setEditorSaveStatus(editorUpdatedAt ? `Loaded ${formatRelative(editorUpdatedAt)}` : null);
                      }}
                      onSave={handleSaveEditorFile}
                      onToggleBookmark={() => {
                        void handleToggleEditorBookmark();
                      }}
                    />
                  ) : null}

                  {!activeWorkbenchTab ? (
                    <div className="grid h-full place-items-center rounded-xl border border-dashed border-white/15 bg-black/20 p-6 text-sm text-[#9f9f9f]">
                      No active tab. Open a file from the directory tree or create a terminal.
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </section>
      </main>

      {toast ? (
        <div className="pointer-events-none absolute right-3 bottom-3 z-40 rounded-lg border border-white/20 bg-[#2a2a2a] px-3 py-2 text-sm text-[#ececec] shadow-lg shadow-black/30">
          {toast.message}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-1">
        {activeView === 'chat' && selectedChat ? (
          <div className="rounded-full border border-white/10 bg-[#171717] px-3 py-1 text-[11px] text-[#9f9f9f]">
            Chat ID: {selectedChat.id}
          </div>
        ) : null}
        {activeView !== 'chat' && activeWorkbenchTab?.kind === 'terminal' && activeWorkbenchTerminal ? (
          <div className="rounded-full border border-white/10 bg-[#171717] px-3 py-1 text-[11px] text-[#9f9f9f]">
            Terminal ID: {activeWorkbenchTerminal.id}
          </div>
        ) : null}
        {activeView !== 'chat' && activeWorkbenchTab?.kind === 'editor' && selectedFilePath ? (
          <div className="rounded-full border border-white/10 bg-[#171717] px-3 py-1 text-[11px] text-[#9f9f9f]">
            File: {selectedFilePath}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default App;
