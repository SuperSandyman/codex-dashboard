import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './App.css';
import { createSession, deleteSession, listSessions } from './api/sessions';
import type { SessionInfo, SessionStatus, SessionTool } from './api/sessions';
import { SessionList } from './features/sessions/SessionList';
import { CommandBar } from './features/terminal/CommandBar';
import { TerminalPane } from './features/terminal/TerminalPane';

interface ToastState {
  readonly message: string;
}

const TOOL_OPTIONS: readonly SessionTool[] = ['codex', 'opencode'];

const sortSessions = (sessions: SessionInfo[]): SessionInfo[] => {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

const updateSessionList = (
  sessions: SessionInfo[],
  updated: SessionInfo,
): SessionInfo[] => {
  return sessions.map((session) => (session.id === updated.id ? updated : session));
};

/**
 * セッション管理とターミナル表示のメイン画面。
 */
const App = () => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<SessionTool>('codex');
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const sendRef = useRef<(value: string) => void>(() => {});

  const selectedSession = useMemo(() => {
    return sessions.find((session) => session.id === selectedId) ?? null;
  }, [sessions, selectedId]);

  const handleToast = useCallback((message: string) => {
    setToast({ message });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshSessions = useCallback(async () => {
    setIsLoading(true);
    const result = await listSessions();
    setIsLoading(false);
    if (!result.ok || !result.data) {
      handleToast(result.error?.message ?? 'Failed to load sessions');
      return;
    }
    const sorted = sortSessions(result.data.sessions);
    setSessions(sorted);
    const hasSelected = selectedId ? sorted.some((session) => session.id === selectedId) : false;
    if (sorted.length > 0 && !hasSelected) {
      setSelectedId(sorted[0].id);
    }
    if (sorted.length === 0) {
      setSelectedId(null);
    }
  }, [handleToast, selectedId]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const handleCreate = async () => {
    setIsLoading(true);
    const result = await createSession({ tool: selectedTool, workspaceId: null });
    setIsLoading(false);
    if (!result.ok || !result.data) {
      handleToast(result.error?.message ?? 'Failed to create session');
      return;
    }
    setSessions((prev) => sortSessions([result.data.session, ...prev]));
    setSelectedId(result.data.session.id);
  };

  const handleKill = async (id: string) => {
    setIsLoading(true);
    const result = await deleteSession(id);
    setIsLoading(false);
    if (!result.ok || !result.data) {
      handleToast(result.error?.message ?? 'Failed to end session');
      return;
    }
    setSessions((prev) => sortSessions(updateSessionList(prev, result.data.session)));
  };

  const handleStatusUpdate = (status: SessionStatus, exitCode?: number) => {
    if (!selectedSession) {
      return;
    }
    const updated: SessionInfo = {
      ...selectedSession,
      status,
      exitCode,
      updatedAt: new Date().toISOString(),
    };
    setSessions((prev) => sortSessions(updateSessionList(prev, updated)));
  };

  const handleCommandSend = useCallback(
    (value: string) => {
      if (!selectedSession) {
        handleToast('Select a session first');
        return;
      }
      sendRef.current(value);
    },
    [handleToast, selectedSession],
  );

  const handleSendReady = useCallback((sender: (value: string) => void) => {
    sendRef.current = sender;
  }, []);

  return (
    <div className={`app-shell${isMenuOpen ? ' menu-open' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-title">Session Terminal</div>
            <div className="brand-subtitle">Codex Dashboard</div>
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
          <select
            className="select"
            value={selectedTool}
            onChange={(event) => setSelectedTool(event.target.value as SessionTool)}
            disabled={isLoading}
          >
            {TOOL_OPTIONS.map((tool) => (
              <option key={tool} value={tool}>
                {tool}
              </option>
            ))}
          </select>
          <button
            className="button button-primary"
            type="button"
            onClick={handleCreate}
            disabled={isLoading}
          >
            New Session
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={refreshSessions}
            disabled={isLoading}
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
          <div className="section-title">Sessions</div>
          <SessionList
            sessions={sessions}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setIsMenuOpen(false);
            }}
            onKill={handleKill}
          />
        </aside>

        <section className="main-panel">
          <TerminalPane
            sessionId={selectedId}
            status={selectedSession?.status ?? null}
            onStatus={handleStatusUpdate}
            onError={handleToast}
            onSendReady={handleSendReady}
          />
          <CommandBar
            onSend={handleCommandSend}
            disabled={!selectedSession || selectedSession.status !== 'running'}
          />
        </section>
      </main>

      {toast ? <div className="toast">{toast.message}</div> : null}
    </div>
  );
};

export default App;
