import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IncomingMessage } from 'node:http';

import { Hono } from 'hono';
import { WebSocketServer } from 'ws';

import { loadEnvConfig } from './config/env.js';
import { SessionManager, isAllowedSessionTool } from './sessions/SessionManager.js';
import type { ApiError, CreateSessionRequest } from './sessions/types.js';
import { listLanIpv4Addresses } from './utils/network.js';

const envConfig = (() => {
  try {
    return loadEnvConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
})();

const app = new Hono();

const distRoot = path.resolve(process.cwd(), '..', 'frontend', 'dist');
const distRootWithSep = distRoot.endsWith(path.sep) ? distRoot : `${distRoot}${path.sep}`;

const toSafeDistPath = (urlPathname: string): string | null => {
  try {
    const decoded = decodeURIComponent(urlPathname);
    const target = path.resolve(distRoot, `.${decoded}`);
    if (!target.startsWith(distRootWithSep)) {
      return null;
    }
    return target;
  } catch (error) {
    console.error('failed to decode url pathname', error);
    return null;
  }
};

const resolveContentType = (targetPath: string): string => {
  const ext = path.extname(targetPath);
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.ico':
      return 'image/x-icon';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
};

app.get('/api/health', (c) => c.json({ ok: true }));

app.onError((error, c) => {
  console.error('request handler error', error);
  return c.text('Internal Server Error', 500);
});

const sessionManager = (() => {
  if (!envConfig.workspaceRoot) {
    return null;
  }

  return new SessionManager({
    workspaceRoot: envConfig.workspaceRoot,
    logBufferSize: envConfig.ptyLogBufferSize,
    idleTimeoutMs: envConfig.ptyIdleTimeoutMs,
  });
})();

const toErrorResponse = (code: string, message: string): { error: ApiError } => {
  return { error: { code, message } };
};

const parseCreateSessionRequest = (body: unknown): CreateSessionRequest | ApiError => {
  if (!body || typeof body !== 'object') {
    return { code: 'invalid_payload', message: 'リクエストボディが不正です。' };
  }

  const record = body as Record<string, unknown>;
  if (typeof record.tool !== 'string' || !isAllowedSessionTool(record.tool)) {
    return { code: 'invalid_tool', message: 'tool が不正です。' };
  }

  const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : null;

  return { tool: record.tool, workspaceId };
};

app.get('/api/sessions', (c) => {
  if (!sessionManager) {
    return c.json(toErrorResponse('workspace_not_configured', 'WORKSPACE_ROOT が未設定です。'), 500);
  }

  return c.json({ sessions: sessionManager.list() });
});

app.post('/api/sessions', async (c) => {
  if (!sessionManager) {
    return c.json(toErrorResponse('workspace_not_configured', 'WORKSPACE_ROOT が未設定です。'), 500);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(toErrorResponse('invalid_payload', 'JSON の解析に失敗しました。'), 400);
  }

  const request = parseCreateSessionRequest(body);
  if ('code' in request) {
    return c.json(toErrorResponse(request.code, request.message), 400);
  }

  try {
    const session = sessionManager.create(request);
    return c.json({ session }, 201);
  } catch (error) {
    const apiError = sessionManager.toApiError(error);
    return c.json(toErrorResponse(apiError.code, apiError.message), 500);
  }
});

app.delete('/api/sessions/:id', (c) => {
  if (!sessionManager) {
    return c.json(toErrorResponse('workspace_not_configured', 'WORKSPACE_ROOT が未設定です。'), 500);
  }

  const id = c.req.param('id');
  try {
    const session = sessionManager.kill(id);
    return c.json({ session });
  } catch (error) {
    const apiError = sessionManager.toApiError(error);
    const status = apiError.code === 'session_not_found' ? 404 : 500;
    return c.json(toErrorResponse(apiError.code, apiError.message), status);
  }
});

app.get('*', async (c) => {
  const method = c.req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return c.text('Not Found', 404);
  }

  const url = new URL(c.req.url, 'http://localhost');
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) {
    return c.text('Not Found', 404);
  }

  const safePath = toSafeDistPath(url.pathname === '/' ? '/index.html' : url.pathname);
  if (!safePath) {
    return c.text('Not Found', 404);
  }

  try {
    const stat = await fs.stat(safePath);
    if (!stat.isFile()) {
      return c.text('Not Found', 404);
    }

    const headerRecord: Record<string, string> = {
      'content-type': resolveContentType(safePath),
    };
    if (!safePath.endsWith('.html')) {
      headerRecord['cache-control'] = 'public, max-age=31536000, immutable';
    }

    if (method === 'HEAD') {
      return c.body(null, 200, headerRecord);
    }

    const content = await fs.readFile(safePath);
    return c.body(content, 200, headerRecord);
  } catch {
    // SPA のために index.html をフォールバックする
    const indexPath = path.join(distRoot, 'index.html');
    try {
      const indexContent = await fs.readFile(indexPath);
      return c.body(indexContent, 200, {
        'content-type': 'text/html; charset=utf-8',
      });
    } catch {
      return c.text('Not Found', 404);
    }
  }
});

const server = http.createServer((req, res) => {
  // Hono の fetch 型が Node の型と合わないため any を使用する。
  const handler = (app as any).fetch;
  handler(req, {
    method: req.method,
    headers: req.headers,
    url: `http://localhost${req.url ?? '/'}`,
  })
    .then((r: Response) => {
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      return r.arrayBuffer();
    })
    .then((buf: ArrayBuffer) => res.end(Buffer.from(buf)))
    .catch((error: unknown) => {
      console.error('server request failed', { url: req.url, error });
      res.statusCode = 500;
      res.end('Internal Server Error');
  });
});

const wss = new WebSocketServer({ noServer: true });
const sessionWss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', message: 'ws connected' }));
  ws.on('message', (data) => {
    ws.send(data.toString());
  });
});

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/ws/sessions/')) {
    const sessionId = decodeURIComponent(url.pathname.replace('/ws/sessions/', ''));
    if (!sessionManager || !sessionManager.has(sessionId)) {
      socket.write('HTTP/1.1 404 Not Found\\r\\n\\r\\n');
      socket.destroy();
      return;
    }

    sessionWss.handleUpgrade(req, socket, head, (ws) => {
      sessionManager.attachWebSocket(sessionId, ws);
    });
    return;
  }
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    return;
  }
  socket.destroy();
});

const { port, bindHost, envPath } = envConfig;

server.listen(port, bindHost, () => {
  console.log(`server listening on http://localhost:${port}`);
  console.log(`bind host: ${bindHost}`);
  if (envPath) {
    console.log(`env loaded: ${envPath}`);
  }

  if (bindHost !== '127.0.0.1' && bindHost !== 'localhost') {
    console.log(`external bind: http://${bindHost}:${port}`);
  }

  if (bindHost === '0.0.0.0') {
    const lanIps = listLanIpv4Addresses();
    if (lanIps.length > 0) {
      console.log('lan addresses:');
      lanIps.forEach((entry) => {
        console.log(`- http://${entry.ip}:${port} (${entry.name})`);
      });
    }
  }
});
