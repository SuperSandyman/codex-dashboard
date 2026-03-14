import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TerminalStatus } from '../../api/terminals';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { createGhosttyTerminalSession } from './ghosttyTerminal';
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
 * ghostty-web ベースの Operations Terminal ペイン。
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
  const terminalSessionRef = useRef<Awaited<ReturnType<typeof createGhosttyTerminalSession>> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [commandDraft, setCommandDraft] = useState('');
  const [reconnectToken, setReconnectToken] = useState(0);
  const [isTerminalReady, setIsTerminalReady] = useState(false);

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

  const sendResizePayload = useCallback(() => {
    const session = terminalSessionRef.current;
    if (!session) {
      return;
    }
    sendPayload({ type: 'resize', cols: session.terminal.cols, rows: session.terminal.rows });
  }, [sendPayload]);

  useEffect(() => {
    if (!mountRef.current || terminalSessionRef.current) {
      return undefined;
    }

    const container = mountRef.current;
    let isDisposed = false;

    void createGhosttyTerminalSession({
      container,
      onData: (data) => {
        sendPayload({ type: 'input', data });
      },
      onResize: ({ cols, rows }) => {
        sendPayload({ type: 'resize', cols, rows });
      },
    })
      .then((session) => {
        if (isDisposed) {
          session.dispose();
          return;
        }
        terminalSessionRef.current = session;
        setIsTerminalReady(true);
      })
      .catch((error: unknown) => {
        if (isDisposed) {
          return;
        }
        console.error('Failed to initialize ghostty-web terminal', error);
        onToast('Failed to initialize terminal renderer');
      });

    return () => {
      isDisposed = true;
      setIsTerminalReady(false);
      terminalSessionRef.current?.dispose();
      terminalSessionRef.current = null;
      container.replaceChildren();
    };
  }, [onToast, sendPayload]);

  useEffect(() => {
    if (!terminalId) {
      socketRef.current?.close();
      socketRef.current = null;
      terminalSessionRef.current?.terminal.clear();
      queueMicrotask(() => setConnectionState('disconnected'));
      return undefined;
    }

    if (!isTerminalReady) {
      return undefined;
    }

    const ws = new WebSocket(buildTerminalWsUrl(terminalId));
    socketRef.current = ws;
    queueMicrotask(() => setConnectionState('connecting'));

    ws.addEventListener('open', () => {
      setConnectionState('connected');
      terminalSessionRef.current?.fitAddon.fit();
      sendResizePayload();
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

      const session = terminalSessionRef.current;
      if (!session) {
        return;
      }

      if (parsed.type === 'ready') {
        session.terminal.clear();
        if (parsed.snapshot.length > 0) {
          session.terminal.write(parsed.snapshot);
        }
        session.fitAddon.fit();
        sendResizePayload();
        return;
      }

      if (parsed.type === 'output') {
        session.terminal.write(parsed.data);
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
  }, [isTerminalReady, onStreamEvent, onToast, reconnectToken, sendResizePayload, terminalId]);

  return (
    <Card className="flex h-full min-h-0 flex-col border-border/60 bg-card/80">
      <CardHeader className="px-3 pb-2 pt-3 sm:px-6 sm:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-2">
            <CardTitle className="text-sm text-white sm:text-base">Operations Terminal</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status === 'running' ? 'success' : 'outline'}>{status ?? 'unknown'}</Badge>
              <Badge variant={connectionState === 'connected' ? 'secondary' : 'outline'}>ws: {connectionState}</Badge>
            </div>
          </div>
          <div className="flex w-full flex-nowrap items-center gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 flex-1 px-2 text-[11px] sm:h-9 sm:flex-none sm:px-3 sm:text-xs"
              onClick={() => setReconnectToken((prev) => prev + 1)}
              disabled={!terminalId || connectionState === 'connecting'}
            >
              Reconnect
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 flex-1 px-2 text-[11px] sm:h-9 sm:flex-none sm:px-3 sm:text-xs"
              onClick={onKill}
              disabled={isKillDisabled}
              aria-label="Kill terminal process"
            >
              Kill Terminal
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid min-h-0 flex-1 grid-rows-[minmax(16rem,1fr)_auto] gap-2 px-3 pb-3 pt-0 sm:grid-rows-[1fr_auto] sm:px-6 sm:pb-6">
        {!terminalId ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-border/60 bg-background/40 p-6 text-center text-sm text-muted-foreground">
            Select or create a terminal.
          </div>
        ) : (
          <div className="min-h-[16rem] overflow-hidden rounded-xl border border-border/60 bg-black sm:min-h-0">
            <div className="h-full min-h-0 p-2" ref={mountRef} />
          </div>
        )}

        <Input
          className="h-10"
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
      </CardContent>
    </Card>
  );
};
