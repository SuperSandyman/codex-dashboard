import type { SessionInfo } from '../../api/sessions';

interface SessionListProps {
  readonly sessions: SessionInfo[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onKill: (id: string) => void;
}

const formatRelative = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

/**
 * セッション一覧を表示する。
 * @param props セッション一覧プロパティ
 */
export const SessionList = ({ sessions, selectedId, onSelect, onKill }: SessionListProps) => {
  return (
    <div className="session-list">
      {sessions.length === 0 ? (
        <div className="session-empty">No sessions yet. Create one to start.</div>
      ) : (
        sessions.map((session) => {
          const isSelected = session.id === selectedId;
          return (
            <div
              key={session.id}
              className={`session-card${isSelected ? ' selected' : ''}`}
              onClick={() => onSelect(session.id)}
            >
              <div className="session-title">
                <span className={`status-pill ${session.status}`}>{session.status}</span>
                <span>{session.tool}</span>
              </div>
              <div className="session-meta">
                <span>Updated {formatRelative(session.updatedAt)}</span>
                <button
                  className="button button-danger"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onKill(session.id);
                  }}
                >
                  End
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
