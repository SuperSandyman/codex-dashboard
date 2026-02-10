import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import type { TerminalStatus } from '../../api/terminals';
import { parseTerminalStreamEvent, type TerminalStreamEvent } from './protocol';

interface TerminalPaneProps {
  readonly terminalId: string | null;
  readonly status: TerminalStatus | null;
  readonly onStreamEvent: (event: TerminalStreamEvent) => void;
  readonly onToast: (message: string) => void;
  readonly onKill: () => void;
  readonly isKillDisabled: boolean;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

const buildTerminalWsUrl = (terminalId: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws/terminals/${encodeURIComponent(terminalId)}`;
};

/**
 * xterm.js ベースの Operations Terminal ペイン。
 * @param props TerminalPane プロパティ
 */
export const TerminalPane = ({
  terminalId,
  status,
  onStreamEvent,
  onToast,
  onKill,
  isKillDisabled,
}: TerminalPaneProps) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [commandDraft, setCommandDraft] = useState('');
  const [reconnectToken, setReconnectToken] = useState(0);

  const isReady = useMemo(() => {
    return connectionState === 'connected';
  }, [connectionState]);

  const sendPayload = useCallback(
    (payload: Record<string, unknown>) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return false;
      }
      ws.send(JSON.stringify(payload));
      return true;
    },
    [],
  );

  useEffect(() => {
    if (!mountRef.current || terminalRef.current) {
      return undefined;
    }

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily:
        '\'Hack Nerd Font Mono\', \'Hack Nerd Mono\', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: '#091015',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(mountRef.current);
    fitAddon.fit();

    const dataDisposable = term.onData((data) => {
      sendPayload({ type: 'input', data });
    });

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      sendPayload({ type: 'resize', cols: term.cols, rows: term.rows });
    });
    resizeObserver.observe(mountRef.current);

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      term.dispose();
    };
  }, [sendPayload]);

  useEffect(() => {
    if (!terminalId) {
      setConnectionState('disconnected');
      socketRef.current?.close();
      socketRef.current = null;
      terminalRef.current?.clear();
      return undefined;
    }

    const ws = new WebSocket(buildTerminalWsUrl(terminalId));
    socketRef.current = ws;
    setConnectionState('connecting');

    ws.addEventListener('open', () => {
      setConnectionState('connected');
      const term = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!term || !fitAddon) {
        return;
      }
      fitAddon.fit();
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    });

    ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      let payload: unknown = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      const parsed = parseTerminalStreamEvent(payload);
      if (!parsed || parsed.terminalId !== terminalId) {
        return;
      }
      onStreamEvent(parsed);

      const term = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!term) {
        return;
      }

      if (parsed.type === 'ready') {
        term.clear();
        if (parsed.snapshot.length > 0) {
          term.write(parsed.snapshot);
        }
        if (fitAddon) {
          fitAddon.fit();
          sendPayload({ type: 'resize', cols: term.cols, rows: term.rows });
        }
        return;
      }

      if (parsed.type === 'output') {
        term.write(parsed.data);
        return;
      }

      if (parsed.type === 'error') {
        onToast(parsed.error.message);
      }
    });

    ws.addEventListener('error', () => {
      setConnectionState('disconnected');
      onToast('Terminal connection failed');
    });

    ws.addEventListener('close', () => {
      setConnectionState('disconnected');
    });

    return () => {
      ws.close();
      if (socketRef.current === ws) {
        socketRef.current = null;
      }
    };
  }, [onStreamEvent, onToast, reconnectToken, sendPayload, terminalId]);

  return (
    <div className="terminal-card">
      <div className="terminal-header">
        <div className="chat-title">Operations Terminal</div>
        <div className="terminal-status-row">
          <span className={`status-dot${status === 'running' ? ' active' : ''}`} />
          <span>{status ?? 'unknown'}</span>
          <span className="terminal-connection">ws: {connectionState}</span>
          <button
            className="button button-secondary terminal-reconnect"
            type="button"
            onClick={() => setReconnectToken((prev) => prev + 1)}
            disabled={!terminalId || connectionState === 'connecting'}
          >
            Reconnect
          </button>
          <button
            className="button button-secondary terminal-kill mobile-hidden"
            type="button"
            onClick={onKill}
            disabled={isKillDisabled}
            aria-label="Kill terminal process"
          >
            Kill Terminal
          </button>
        </div>
      </div>

      {!terminalId ? <div className="chat-empty">Select or create a terminal.</div> : null}
      <div className="terminal-screen" ref={mountRef} />

      <div className="terminal-command-bar">
        <input
          className="field-input"
          value={commandDraft}
          onChange={(event) => setCommandDraft(event.target.value)}
          placeholder="Run command..."
          disabled={!terminalId || !isReady || status !== 'running'}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') {
              return;
            }
            event.preventDefault();
            const command = commandDraft.trim();
            if (!command) {
              return;
            }
            const sent = sendPayload({ type: 'input', data: `${command}\r` });
            if (!sent) {
              onToast('Terminal is not connected');
              return;
            }
            setCommandDraft('');
          }}
        />
      </div>
    </div>
  );
};
