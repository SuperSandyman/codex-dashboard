import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './App.css';
import {
  createChat,
  getChat,
  interruptTurn,
  listChats,
  sendChatMessage,
  type ChatMessage,
  type ChatSummary,
} from './api/chats';
import { ChatPane } from './features/chat/ChatPane';
import {
  addOptimisticUserMessage,
  applyStreamEventToMessages,
  sortChatsByUpdatedAt,
  touchChatSummary,
} from './features/chat/messageStore';
import { parseChatStreamEvent, type ChatStreamEvent } from './features/chat/protocol';

interface ToastState {
  readonly message: string;
}

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

/**
 * codex app-server を利用した Chat 専用ダッシュボード。
 */
const App = () => {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const selectedChatIdRef = useRef<string | null>(null);

  const selectedChat = useMemo(() => {
    return chats.find((chat) => chat.id === selectedChatId) ?? null;
  }, [chats, selectedChatId]);

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

    const hasSelected = selectedChatId
      ? sorted.some((chat) => chat.id === selectedChatId)
      : false;
    if (!hasSelected) {
      setSelectedChatId(sorted[0]?.id ?? null);
    }
  }, [selectedChatId, showToast]);

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

  const handleStreamEvent = useCallback(
    (event: ChatStreamEvent) => {
      if (event.type === 'ready') {
        setActiveTurnId(event.activeTurnId);
        return;
      }
      if (event.type === 'turn_started') {
        setActiveTurnId(event.turnId);
        setChats((prev) => touchChatSummary(prev, event.threadId, null));
        return;
      }
      if (event.type === 'turn_completed') {
        setActiveTurnId((prev) => (prev === event.turnId ? null : prev));
        setChats((prev) => touchChatSummary(prev, event.threadId, null));
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

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      await Promise.resolve();
      if (isCancelled) {
        return;
      }
      await refreshChats();
    })();
    return () => {
      isCancelled = true;
    };
  }, [refreshChats]);

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
      handleStreamEvent(parsed);
    });

    ws.addEventListener('error', () => {
      showToast('Streaming connection failed');
    });

    return () => {
      ws.close();
    };
  }, [handleStreamEvent, selectedChatId, showToast]);

  const handleCreateChat = async () => {
    setIsLoadingChats(true);
    const result = await createChat();
    setIsLoadingChats(false);
    if (!result.ok || !result.data) {
      showToast(result.error?.message ?? 'Failed to create chat');
      return;
    }
    const chat = result.data.chat;
    setChats((prev) => sortChatsByUpdatedAt([chat, ...prev]));
    setSelectedChatId(chat.id);
    setIsMenuOpen(false);
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
      showToast(result.error?.message ?? 'Failed to send message');
      loadChatDetail(selectedChatId);
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
            onClick={handleCreateChat}
            disabled={isLoadingChats}
          >
            New Chat
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={refreshChats}
            disabled={isLoadingChats}
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="app-body">
        <div
          className={`sidebar-backdrop${isMenuOpen ? ' visible' : ''}`}
          onClick={() => setIsMenuOpen(false)}
        />
        <aside className="sidebar">
          <div className="section-title">Chats</div>
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
        </aside>

        <section className="main-panel">
          <ChatPane
            chatId={selectedChatId}
            messages={messages}
            activeTurnId={activeTurnId}
            isLoading={isLoadingChat}
            isSending={isSending}
            onSend={handleSend}
            onStop={handleStop}
          />
        </section>
      </main>

      {toast ? <div className="toast">{toast.message}</div> : null}
      {selectedChat ? <div className="footer-id">Chat ID: {selectedChat.id}</div> : null}
    </div>
  );
};

export default App;
