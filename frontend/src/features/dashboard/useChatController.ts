import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type ChatApprovalDecision,
  type ChatApprovalPolicy,
  type ChatApprovalRequest,
  type ChatLaunchOptions,
  type ChatMessage,
  type ChatModelOption,
  type ChatSandboxMode,
  type ChatSummary,
  type ChatUserInputRequest,
  type RespondChatUserInputRequest,
  createChat,
  getChat,
  getChatLaunchCatalog,
  interruptTurn,
  listChats,
  respondChatApproval,
  respondChatUserInput,
  sendChatMessage,
  updateChatLaunchOptions,
} from '../../api/chats';
import {
  addOptimisticUserMessage,
  applyStreamEventToMessages,
  sortChatsByUpdatedAt,
  touchChatSummary,
} from '../chat/messageStore';
import { parseChatStreamEvent, type ChatStreamEvent } from '../chat/protocol';
import {
  buildChatWsUrl,
  EMPTY_LAUNCH_OPTIONS,
  resolveEffortForModel,
  resolveModelDefault,
  upsertApprovalRequest,
  upsertUserInputRequest,
} from './dashboardUtils';

interface UseChatControllerParams {
  readonly onToast: (message: string) => void;
  readonly onAfterCreateChat: (chatId: string) => void;
}

interface UseChatControllerResult {
  readonly chats: readonly ChatSummary[];
  readonly selectedChatId: string | null;
  readonly selectedChat: ChatSummary | null;
  readonly messages: readonly ChatMessage[];
  readonly activeTurnId: string | null;
  readonly isLoadingChats: boolean;
  readonly isLoadingCatalog: boolean;
  readonly isLoadingChat: boolean;
  readonly isSending: boolean;
  readonly isUpdatingLaunchOptions: boolean;
  readonly modelOptions: readonly ChatModelOption[];
  readonly workspaceRoot: string | null;
  readonly cwdChoices: readonly string[];
  readonly approvalPolicyOptions: readonly ChatApprovalPolicy[];
  readonly sandboxModeOptions: readonly ChatSandboxMode[];
  readonly newChatLaunchOptions: ChatLaunchOptions;
  readonly newChatPrompt: string;
  readonly newChatEfforts: readonly string[];
  readonly approvalRequests: readonly ChatApprovalRequest[];
  readonly submittingApprovalItemIds: readonly string[];
  readonly userInputRequests: readonly ChatUserInputRequest[];
  readonly submittingUserInputItemIds: readonly string[];
  readonly setSelectedChatId: (chatId: string | null) => void;
  readonly setNewChatLaunchOptions: React.Dispatch<React.SetStateAction<ChatLaunchOptions>>;
  readonly setNewChatPrompt: React.Dispatch<React.SetStateAction<string>>;
  readonly refreshChats: () => Promise<void>;
  readonly refreshLaunchCatalog: () => Promise<void>;
  readonly createChat: () => Promise<void>;
  readonly updateSelectedLaunchOptions: (nextLaunchOptions: ChatLaunchOptions) => Promise<void>;
  readonly sendMessage: (text: string) => Promise<void>;
  readonly stopTurn: () => Promise<void>;
  readonly respondApproval: (itemId: string, decision: ChatApprovalDecision) => Promise<void>;
  readonly respondUserInput: (
    itemId: string,
    payload: RespondChatUserInputRequest,
  ) => Promise<void>;
}

/**
 * chat 一覧、履歴、送受信、launch options をまとめて管理する。
 * @param params 通知と画面遷移のコールバック
 * @returns chat 関連 state と action
 */
export const useChatController = (
  params: UseChatControllerParams,
): UseChatControllerResult => {
  const { onToast, onAfterCreateChat } = params;

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUpdatingLaunchOptions, setIsUpdatingLaunchOptions] = useState(false);

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

  const selectedChatIdRef = useRef<string | null>(null);

  const selectedChat = useMemo(() => {
    return chats.find((chat) => chat.id === selectedChatId) ?? null;
  }, [chats, selectedChatId]);

  const newChatEfforts = useMemo(() => {
    const model = modelOptions.find((entry) => entry.id === newChatLaunchOptions.model) ?? null;
    return model?.efforts ?? [];
  }, [modelOptions, newChatLaunchOptions.model]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  const refreshChats = useCallback(async () => {
    setIsLoadingChats(true);
    const result = await listChats();
    setIsLoadingChats(false);
    if (!result.ok || !result.data) {
      onToast(result.error?.message ?? 'Failed to load chats');
      return;
    }
    const sorted = sortChatsByUpdatedAt(result.data.chats);
    setChats(sorted);

    const hasSelected = selectedChatId ? sorted.some((chat) => chat.id === selectedChatId) : false;
    if (!hasSelected) {
      setSelectedChatId(sorted[0]?.id ?? null);
    }
  }, [onToast, selectedChatId]);

  const refreshLaunchCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    const result = await getChatLaunchCatalog();
    setIsLoadingCatalog(false);
    const catalog = result.data;
    if (!result.ok || !catalog) {
      onToast(result.error?.message ?? 'Failed to load launch options');
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
      return { model, effort, cwd, approvalPolicy, sandboxMode };
    });
  }, [onToast]);

  const loadChatDetail = useCallback(async (chatId: string) => {
    setIsLoadingChat(true);
    const result = await getChat(chatId);
    setIsLoadingChat(false);
    if (!result.ok || !result.data) {
      onToast(result.error?.message ?? 'Failed to load chat history');
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
  }, [onToast]);

  const handleChatStreamEvent = useCallback((event: ChatStreamEvent) => {
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
      onToast(event.error.message);
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
  }, [onToast]);

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
      onToast('Streaming connection failed');
    });

    return () => {
      ws.close();
    };
  }, [handleChatStreamEvent, onToast, selectedChatId]);

  const createChatSession = useCallback(async () => {
    setIsLoadingChats(true);
    const result = await createChat(newChatLaunchOptions);
    setIsLoadingChats(false);
    if (!result.ok || !result.data) {
      onToast(result.error?.message ?? 'Failed to create chat');
      return;
    }

    const chat = result.data.chat;
    setChats((prev) => sortChatsByUpdatedAt([chat, ...prev]));
    setSelectedChatId(chat.id);
    onAfterCreateChat(chat.id);

    const firstPrompt = newChatPrompt.trim();
    setNewChatPrompt('');
    if (!firstPrompt) {
      return;
    }

    setIsSending(true);
    const sendResult = await sendChatMessage(chat.id, firstPrompt);
    setIsSending(false);
    if (!sendResult.ok || !sendResult.data) {
      onToast(sendResult.error?.message ?? 'Failed to send first prompt');
      return;
    }
    setActiveTurnId(sendResult.data.turnId);
  }, [newChatLaunchOptions, newChatPrompt, onAfterCreateChat, onToast]);

  const updateSelectedLaunchOptions = useCallback(async (nextLaunchOptions: ChatLaunchOptions) => {
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
      onToast(result.error?.message ?? 'Failed to update launch options');
      return;
    }

    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== selectedChatId) {
          return chat;
        }
        return { ...chat, launchOptions: payload.launchOptions };
      }),
    );
  }, [onToast, selectedChat, selectedChatId]);

  const sendMessage = useCallback(async (text: string) => {
    if (!selectedChatId) {
      onToast('Select a chat first');
      return;
    }
    setMessages((prev) => addOptimisticUserMessage(prev, selectedChatId, text));
    setChats((prev) => touchChatSummary(prev, selectedChatId, text.slice(0, 120)));

    setIsSending(true);
    const result = await sendChatMessage(selectedChatId, text);
    setIsSending(false);
    if (!result.ok || !result.data) {
      if (result.error?.code === 'chat_not_found') {
        onToast('Thread not found. Please create a new chat manually.');
        void refreshChats();
        return;
      }

      onToast(result.error?.message ?? 'Failed to send message');
      void loadChatDetail(selectedChatId);
      return;
    }
    setActiveTurnId(result.data.turnId);
  }, [loadChatDetail, onToast, refreshChats, selectedChatId]);

  const stopTurn = useCallback(async () => {
    if (!selectedChatId || !activeTurnId) {
      return;
    }
    const result = await interruptTurn(selectedChatId, activeTurnId);
    if (!result.ok || !result.data) {
      onToast(result.error?.message ?? 'Failed to stop streaming');
      return;
    }
    setActiveTurnId(null);
  }, [activeTurnId, onToast, selectedChatId]);

  const respondApproval = useCallback(async (itemId: string, decision: ChatApprovalDecision) => {
    if (!selectedChatId || submittingApprovalItemIds.includes(itemId)) {
      return;
    }

    setSubmittingApprovalItemIds((prev) => [...prev, itemId]);
    const result = await respondChatApproval(selectedChatId, itemId, { decision });
    setSubmittingApprovalItemIds((prev) => prev.filter((entry) => entry !== itemId));
    if (!result.ok || !result.data) {
      onToast(result.error?.message ?? 'Failed to respond approval');
      return;
    }
    setApprovalRequests((prev) => prev.filter((entry) => entry.itemId !== itemId));
  }, [onToast, selectedChatId, submittingApprovalItemIds]);

  const respondUserInput = useCallback(
    async (itemId: string, payload: RespondChatUserInputRequest) => {
      if (!selectedChatId || submittingUserInputItemIds.includes(itemId)) {
        return;
      }

      setSubmittingUserInputItemIds((prev) => [...prev, itemId]);
      const result = await respondChatUserInput(selectedChatId, itemId, payload);
      setSubmittingUserInputItemIds((prev) => prev.filter((entry) => entry !== itemId));
      if (!result.ok || !result.data) {
        onToast(result.error?.message ?? 'Failed to respond user input');
        return;
      }
      setUserInputRequests((prev) => prev.filter((entry) => entry.itemId !== itemId));
    },
    [onToast, selectedChatId, submittingUserInputItemIds],
  );

  return {
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
    createChat: createChatSession,
    updateSelectedLaunchOptions,
    sendMessage,
    stopTurn,
    respondApproval,
    respondUserInput,
  };
};
