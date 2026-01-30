import { useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import type { SessionStatus } from '../../api/sessions';

interface TerminalPaneProps {
  readonly sessionId: string | null;
  readonly status: SessionStatus | null;
  readonly onStatus: (status: SessionStatus, exitCode?: number) => void;
  readonly onError: (message: string) => void;
  readonly onSendReady: (sender: (value: string) => void) => void;
}

interface SessionServerMessage {
  readonly type: 'output' | 'status' | 'snapshot' | 'error';
  readonly data?: string;
  readonly status?: SessionStatus;
  readonly exitCode?: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

const buildWsUrl = (sessionId: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws/sessions/${encodeURIComponent(sessionId)}`;
};

/**
 * xterm.js でセッションの出力/入力を扱う。
 * @param props TerminalPane プロパティ
 */
export const TerminalPane = ({ sessionId, status, onStatus, onError, onSendReady }: TerminalPaneProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const terminalOptions = useMemo(
    () => ({
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: 'transparent',
        foreground: '#f5f7f8',
        cursor: '#4ee1a0',
        selectionBackground: 'rgba(78, 225, 160, 0.3)',
      },
    }),
    [],
  );

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const terminal = new Terminal(terminalOptions);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current) {
        return;
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        fitAddon.fit();
        const cols = terminal.cols;
        const rows = terminal.rows;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });
    });

    observer.observe(containerRef.current);
    fitAddon.fit();

    return () => {
      observer.disconnect();
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalOptions]);

  useEffect(() => {
    if (!sessionId) {
      wsRef.current?.close();
      wsRef.current = null;
      setIsConnected(false);
      terminalRef.current?.clear();
      return undefined;
    }

    terminalRef.current?.clear();
    const ws = new WebSocket(buildWsUrl(sessionId));
    wsRef.current = ws;
    setIsConnected(false);

    ws.addEventListener('open', () => {
      setIsConnected(true);
      const cols = terminalRef.current?.cols ?? 80;
      const rows = terminalRef.current?.rows ?? 24;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      ws.send(JSON.stringify({ type: 'snapshot' }));
    });

    ws.addEventListener('message', (event) => {
      const payload = typeof event.data === 'string' ? event.data : '';
      let parsed: SessionServerMessage | null = null;
      try {
        parsed = JSON.parse(payload) as SessionServerMessage;
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed.type !== 'string') {
        return;
      }

      switch (parsed.type) {
        case 'output':
        case 'snapshot':
          if (parsed.data) {
            terminalRef.current?.write(parsed.data);
          }
          break;
        case 'status':
          if (parsed.status) {
            onStatus(parsed.status, parsed.exitCode);
          }
          break;
        case 'error':
          if (parsed.error?.message) {
            onError(parsed.error.message);
          }
          break;
        default:
          break;
      }
    });

    ws.addEventListener('close', () => {
      setIsConnected(false);
    });

    ws.addEventListener('error', () => {
      setIsConnected(false);
      onError('WebSocket connection failed');
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, onError, onStatus]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return undefined;
    }

    const disposable = terminal.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    return () => {
      disposable.dispose();
    };
  }, []);

  useEffect(() => {
    onSendReady((value: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data: value }));
      } else {
        onError('Terminal not connected');
      }
    });
    return () => {
      onSendReady(() => {});
    };
  }, [onError, onSendReady]);

  return (
    <div className="terminal-card">
      <div className="terminal-header">
        <div className="terminal-header-title">Terminal</div>
        <div className="terminal-header-status">
          <span className={`status-dot${isConnected ? ' active' : ''}`} />
          {status ?? 'idle'}
        </div>
      </div>
      <div className="terminal-body">
        {!sessionId ? (
          <div className="terminal-overlay">Select or create a session to start.</div>
        ) : null}
        <div className="terminal-surface" ref={containerRef} />
      </div>
    </div>
  );
};
