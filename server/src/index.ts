import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import type { IncomingMessage } from 'node:http';
import * as path from 'node:path';

import { Hono } from 'hono';
import { WebSocketServer } from 'ws';

import { AppServerChatBridge, ChatBridgeError } from './appServer/chatBridge.js';
import { loadEnvConfig } from './config/env.js';
import { EditorFileService, EditorFileServiceError } from './editor/fileService.js';
import { TerminalSessionError, TerminalSessionManager } from './terminal/sessionManager.js';
import { listLanIpv4Addresses } from './utils/network.js';

interface ApiError {
  readonly code: string;
  readonly message: string;
}

interface SendMessageRequestBody {
  readonly text: string;
}

interface CreateChatRequestBody {
  readonly model: string | null;
  readonly effort: string | null;
  readonly cwd: string | null;
}

interface UpdateChatOptionsRequestBody {
  readonly model: string | null;
  readonly effort: string | null;
}

interface InterruptRequestBody {
  readonly turnId?: string | null;
}

interface CreateTerminalRequestBody {
  readonly profile: string | null;
  readonly cwd: string | null;
  readonly cols: number | null;
  readonly rows: number | null;
}

interface TerminalWriteRequestBody {
  readonly data: string;
}

interface TerminalResizeRequestBody {
  readonly cols: number;
  readonly rows: number;
}

interface EditorWriteRequestBody {
  readonly path: string;
  readonly content: string;
  readonly expectedVersion: string;
}

const MAX_TERMINAL_WRITE_LENGTH = 8192;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const toErrorResponse = (code: string, message: string): { error: ApiError } => {
  return { error: { code, message } };
};

const parseSendMessageBody = (value: unknown): SendMessageRequestBody | ApiError => {
  if (!isRecord(value) || typeof value.text !== 'string') {
    return { code: 'invalid_payload', message: 'text を含む JSON が必要です。' };
  }
  const text = value.text.trim();
  if (text.length === 0) {
    return { code: 'invalid_payload', message: 'text は空にできません。' };
  }
  return { text };
};

const normalizeOptionalString = (
  value: unknown,
  key: string,
): { ok: true; value: string | null } | { ok: false; error: ApiError } => {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      error: { code: 'invalid_payload', message: `${key} は string で指定してください。` },
    };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: { code: 'invalid_payload', message: `${key} は空文字にできません。` },
    };
  }
  return { ok: true, value: trimmed };
};

const parseCreateChatBody = (value: unknown): CreateChatRequestBody | ApiError => {
  if (value === null || value === undefined) {
    return { model: null, effort: null, cwd: null };
  }
  if (!isRecord(value)) {
    return { code: 'invalid_payload', message: 'JSON オブジェクトで指定してください。' };
  }

  const modelResult = normalizeOptionalString(value.model, 'model');
  if (!modelResult.ok) {
    return modelResult.error;
  }
  const effortResult = normalizeOptionalString(value.effort, 'effort');
  if (!effortResult.ok) {
    return effortResult.error;
  }
  const cwdResult = normalizeOptionalString(value.cwd, 'cwd');
  if (!cwdResult.ok) {
    return cwdResult.error;
  }

  return {
    model: modelResult.value,
    effort: effortResult.value,
    cwd: cwdResult.value,
  };
};

const parseUpdateChatOptionsBody = (value: unknown): UpdateChatOptionsRequestBody | ApiError => {
  if (!isRecord(value)) {
    return { code: 'invalid_payload', message: 'model / effort を含む JSON が必要です。' };
  }

  if (!('model' in value) && !('effort' in value)) {
    return { code: 'invalid_payload', message: 'model または effort を指定してください。' };
  }

  const modelResult = normalizeOptionalString(value.model, 'model');
  if (!modelResult.ok) {
    return modelResult.error;
  }
  const effortResult = normalizeOptionalString(value.effort, 'effort');
  if (!effortResult.ok) {
    return effortResult.error;
  }

  return {
    model: modelResult.value,
    effort: effortResult.value,
  };
};

const parseInterruptBody = (value: unknown): InterruptRequestBody | ApiError => {
  if (value === null || value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return { code: 'invalid_payload', message: 'JSON オブジェクトで指定してください。' };
  }
  if (value.turnId !== undefined && value.turnId !== null && typeof value.turnId !== 'string') {
    return { code: 'invalid_payload', message: 'turnId は string で指定してください。' };
  }
  return { turnId: value.turnId ?? null };
};

const normalizeOptionalInteger = (
  value: unknown,
  key: string,
): { ok: true; value: number | null } | { ok: false; error: ApiError } => {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (!Number.isInteger(value)) {
    return {
      ok: false,
      error: { code: 'invalid_payload', message: `${key} は整数で指定してください。` },
    };
  }
  return { ok: true, value: value as number };
};

const parseCreateTerminalBody = (value: unknown): CreateTerminalRequestBody | ApiError => {
  if (value === null || value === undefined) {
    return {
      profile: null,
      cwd: null,
      cols: null,
      rows: null,
    };
  }
  if (!isRecord(value)) {
    return { code: 'invalid_payload', message: 'JSON オブジェクトで指定してください。' };
  }

  const profileResult = normalizeOptionalString(value.profile, 'profile');
  if (!profileResult.ok) {
    return profileResult.error;
  }
  const cwdResult = normalizeOptionalString(value.cwd, 'cwd');
  if (!cwdResult.ok) {
    return cwdResult.error;
  }
  const colsResult = normalizeOptionalInteger(value.cols, 'cols');
  if (!colsResult.ok) {
    return colsResult.error;
  }
  const rowsResult = normalizeOptionalInteger(value.rows, 'rows');
  if (!rowsResult.ok) {
    return rowsResult.error;
  }

  return {
    profile: profileResult.value,
    cwd: cwdResult.value,
    cols: colsResult.value,
    rows: rowsResult.value,
  };
};

const parseTerminalWriteBody = (value: unknown): TerminalWriteRequestBody | ApiError => {
  if (!isRecord(value) || typeof value.data !== 'string') {
    return { code: 'invalid_payload', message: 'data を含む JSON が必要です。' };
  }
  if (value.data.length === 0) {
    return { code: 'invalid_payload', message: 'data は空にできません。' };
  }
  if (value.data.length > MAX_TERMINAL_WRITE_LENGTH) {
    return {
      code: 'invalid_payload',
      message: `data は ${MAX_TERMINAL_WRITE_LENGTH} 文字以内で指定してください。`,
    };
  }
  return { data: value.data };
};

const parseTerminalResizeBody = (value: unknown): TerminalResizeRequestBody | ApiError => {
  if (!isRecord(value)) {
    return { code: 'invalid_payload', message: 'cols / rows を含む JSON が必要です。' };
  }
  if (!Number.isInteger(value.cols) || !Number.isInteger(value.rows)) {
    return { code: 'invalid_payload', message: 'cols と rows は整数で指定してください。' };
  }
  return {
    cols: value.cols as number,
    rows: value.rows as number,
  };
};

const parseEditorWriteBody = (value: unknown): EditorWriteRequestBody | ApiError => {
  if (!isRecord(value)) {
    return { code: 'invalid_payload', message: 'path / content を含む JSON が必要です。' };
  }
  if (typeof value.path !== 'string') {
    return { code: 'invalid_payload', message: 'path は string で指定してください。' };
  }
  if (typeof value.content !== 'string') {
    return { code: 'invalid_payload', message: 'content は string で指定してください。' };
  }
  if (typeof value.expectedVersion !== 'string') {
    return { code: 'invalid_payload', message: 'expectedVersion は string で指定してください。' };
  }
  const expectedVersion = value.expectedVersion.trim();
  if (expectedVersion.length === 0) {
    return { code: 'invalid_payload', message: 'expectedVersion は空文字にできません。' };
  }
  return {
    path: value.path,
    content: value.content,
    expectedVersion,
  };
};

const respondBridgeError = (error: unknown): Response => {
  if (error instanceof ChatBridgeError) {
    return Response.json(toErrorResponse(error.code, error.message), { status: error.status });
  }
  const message = error instanceof Error ? error.message : '不明なエラーが発生しました。';
  return Response.json(toErrorResponse('internal_error', message), { status: 500 });
};

const respondTerminalError = (error: unknown): Response => {
  if (error instanceof TerminalSessionError) {
    return Response.json(toErrorResponse(error.code, error.message), { status: error.status });
  }
  const message = error instanceof Error ? error.message : '不明なエラーが発生しました。';
  return Response.json(toErrorResponse('internal_error', message), { status: 500 });
};

const respondEditorError = (error: unknown): Response => {
  if (error instanceof EditorFileServiceError) {
    return Response.json(toErrorResponse(error.code, error.message), { status: error.status });
  }
  const message = error instanceof Error ? error.message : '不明なエラーが発生しました。';
  return Response.json(toErrorResponse('internal_error', message), { status: 500 });
};

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
const chatBridge = new AppServerChatBridge({
  command: envConfig.appServerCommand,
  args: envConfig.appServerArgs,
  cwd: envConfig.appServerCwd,
  defaultThreadCwd: envConfig.workspaceRoot,
  requestTimeoutMs: envConfig.appServerRequestTimeoutMs,
});
const terminalSessionManager = new TerminalSessionManager({
  workspaceRoot: envConfig.workspaceRoot,
  idleTimeoutMs: envConfig.terminalIdleTimeoutMs,
});
const editorFileService = new EditorFileService({
  workspaceRoot: envConfig.workspaceRoot,
  maxReadFileSizeBytes: envConfig.editorMaxFileSizeBytes,
  maxSaveFileSizeBytes: envConfig.editorMaxSaveBytes,
});

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

app.get('/api/chats', async (c) => {
  try {
    const chats = await chatBridge.listChats();
    return c.json({ chats });
  } catch (error) {
    return respondBridgeError(error);
  }
});

app.get('/api/chat-options', async (c) => {
  try {
    const catalog = await chatBridge.getLaunchOptionCatalog();
    return c.json(catalog);
  } catch (error) {
    return respondBridgeError(error);
  }
});

app.post('/api/chats', async (c) => {
  let payload: unknown = null;
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      payload = await c.req.json();
    } catch {
      return c.json(toErrorResponse('invalid_payload', 'JSON の解析に失敗しました。'), 400);
    }
  }

  const parsed = parseCreateChatBody(payload);
  if ('code' in parsed) {
    return c.json(toErrorResponse(parsed.code, parsed.message), 400);
  }

  try {
    const chat = await chatBridge.createChat(parsed);
    return c.json({ chat }, 201);
  } catch (error) {
    return respondBridgeError(error);
  }
});

app.get('/api/chats/:id', async (c) => {
  try {
    const chat = await chatBridge.getChat(c.req.param('id'));
    return c.json(chat);
  } catch (error) {
    return respondBridgeError(error);
  }
});

app.post('/api/chats/:id/messages', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(toErrorResponse('invalid_payload', 'JSON の解析に失敗しました。'), 400);
  }

  const parsed = parseSendMessageBody(payload);
  if ('code' in parsed) {
    return c.json(toErrorResponse(parsed.code, parsed.message), 400);
  }

  try {
    const result = await chatBridge.sendMessage(c.req.param('id'), parsed.text);
    return c.json(result, 202);
  } catch (error) {
    return respondBridgeError(error);
  }
});

app.patch('/api/chats/:id/options', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(toErrorResponse('invalid_payload', 'JSON の解析に失敗しました。'), 400);
  }

  const parsed = parseUpdateChatOptionsBody(payload);
  if ('code' in parsed) {
    return c.json(toErrorResponse(parsed.code, parsed.message), 400);
  }

  try {
    const launchOptions = await chatBridge.updateChatLaunchOptions(c.req.param('id'), parsed);
    return c.json({ launchOptions });
  } catch (error) {
    return respondBridgeError(error);
  }
});

app.post('/api/chats/:id/interrupt', async (c) => {
  let payload: unknown = null;
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      payload = await c.req.json();
    } catch {
      return c.json(toErrorResponse('invalid_payload', 'JSON の解析に失敗しました。'), 400);
    }
  }

  const parsed = parseInterruptBody(payload);
  if ('code' in parsed) {
    return c.json(toErrorResponse(parsed.code, parsed.message), 400);
  }

  try {
    const result = await chatBridge.interruptTurn(c.req.param('id'), parsed.turnId ?? null);
    return c.json({
      interrupted: true,
      turnId: result.turnId,
    });
  } catch (error) {
    return respondBridgeError(error);
  }
});

app.get('/api/editor/catalog', (c) => {
  try {
    const catalog = editorFileService.getCatalog();
    return c.json(catalog);
  } catch (error) {
    return respondEditorError(error);
  }
});

app.get('/api/editor/tree', async (c) => {
  const targetPath = c.req.query('path') ?? '';
  try {
    const tree = await editorFileService.getTree(targetPath);
    return c.json(tree);
  } catch (error) {
    return respondEditorError(error);
  }
});

app.get('/api/editor/file', async (c) => {
  const targetPath = c.req.query('path');
  if (!targetPath) {
    return c.json(toErrorResponse('invalid_payload', 'path クエリが必要です。'), 400);
  }

  try {
    const file = await editorFileService.readFile(targetPath);
    return c.json(file);
  } catch (error) {
    return respondEditorError(error);
  }
});

app.put('/api/editor/file', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(toErrorResponse('invalid_payload', 'JSON の解析に失敗しました。'), 400);
  }

  const parsed = parseEditorWriteBody(payload);
  if ('code' in parsed) {
    return c.json(toErrorResponse(parsed.code, parsed.message), 400);
  }

  try {
    const file = await editorFileService.writeFile({
      path: parsed.path,
      content: parsed.content,
      expectedVersion: parsed.expectedVersion,
    });
    return c.json(file);
  } catch (error) {
    return respondEditorError(error);
  }
});

app.get('/api/terminal-options', async (c) => {
  try {
    const catalog = await terminalSessionManager.getCatalog();
    return c.json(catalog);
  } catch (error) {
    return respondTerminalError(error);
  }
});

app.get('/api/terminals', (c) => {
  try {
    const terminals = terminalSessionManager.list();
    return c.json({ terminals });
  } catch (error) {
    return respondTerminalError(error);
  }
});

app.post('/api/terminals', async (c) => {
  let payload: unknown = null;
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      payload = await c.req.json();
    } catch {
      return c.json(toErrorResponse('invalid_payload', 'JSON の解析に失敗しました。'), 400);
    }
  }

  const parsed = parseCreateTerminalBody(payload);
  if ('code' in parsed) {
    return c.json(toErrorResponse(parsed.code, parsed.message), 400);
  }

  try {
    const terminal = await terminalSessionManager.create(parsed);
    return c.json({ terminal }, 201);
  } catch (error) {
    return respondTerminalError(error);
  }
});

app.get('/api/terminals/:id', (c) => {
  try {
    const terminal = terminalSessionManager.snapshot(c.req.param('id'));
    return c.json({ terminal });
  } catch (error) {
    return respondTerminalError(error);
  }
});

app.post('/api/terminals/:id/write', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(toErrorResponse('invalid_payload', 'JSON の解析に失敗しました。'), 400);
  }

  const parsed = parseTerminalWriteBody(payload);
  if ('code' in parsed) {
    return c.json(toErrorResponse(parsed.code, parsed.message), 400);
  }

  try {
    terminalSessionManager.write(c.req.param('id'), parsed.data);
    return c.json({ ok: true });
  } catch (error) {
    return respondTerminalError(error);
  }
});

app.post('/api/terminals/:id/resize', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(toErrorResponse('invalid_payload', 'JSON の解析に失敗しました。'), 400);
  }

  const parsed = parseTerminalResizeBody(payload);
  if ('code' in parsed) {
    return c.json(toErrorResponse(parsed.code, parsed.message), 400);
  }

  try {
    terminalSessionManager.resize(c.req.param('id'), parsed.cols, parsed.rows);
    return c.json({ ok: true });
  } catch (error) {
    return respondTerminalError(error);
  }
});

app.delete('/api/terminals/:id', (c) => {
  try {
    const terminal = terminalSessionManager.kill(c.req.param('id'));
    return c.json({ terminal });
  } catch (error) {
    return respondTerminalError(error);
  }
});

app.onError((error) => {
  console.error('request handler error', error);
  return Response.json(toErrorResponse('internal_error', 'Internal Server Error'), {
    status: 500,
  });
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

const toRequestHeaders = (headers: IncomingMessage['headers']): Headers => {
  const requestHeaders = new Headers();
  Object.entries(headers).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => requestHeaders.append(key, entry));
      return;
    }
    requestHeaders.set(key, value);
  });
  return requestHeaders;
};

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const host = req.headers.host ?? 'localhost';
  const requestUrl = new URL(req.url ?? '/', `http://${host}`);
  const headers = toRequestHeaders(req.headers);
  const body = method === 'GET' || method === 'HEAD' ? undefined : req;
  const request = new Request(requestUrl, {
    method,
    headers,
    body,
    duplex: body ? 'half' : undefined,
  } as RequestInit);

  try {
    const response = await app.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const buffer = await response.arrayBuffer();
    res.end(Buffer.from(buffer));
  } catch (error: unknown) {
    console.error('server request failed', { url: req.url, error });
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

const chatWss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/ws/chats/')) {
    let threadId: string;
    try {
      threadId = decodeURIComponent(url.pathname.replace('/ws/chats/', ''));
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    chatWss.handleUpgrade(req, socket, head, (ws) => {
      chatBridge.attachWebSocket(threadId, ws);
    });
    return;
  }

  if (url.pathname.startsWith('/ws/terminals/')) {
    let terminalId: string;
    try {
      terminalId = decodeURIComponent(url.pathname.replace('/ws/terminals/', ''));
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    terminalWss.handleUpgrade(req, socket, head, (ws) => {
      try {
        terminalSessionManager.attachWebSocket(terminalId, ws);
      } catch (error) {
        const status = error instanceof TerminalSessionError ? error.status : 500;
        const reason =
          error instanceof TerminalSessionError
            ? `${error.code}:${error.message}`
            : 'internal_error';
        ws.close(status === 404 ? 4404 : 1011, reason.slice(0, 120));
      }
    });
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

const shutdown = (): void => {
  chatBridge.dispose();
  terminalSessionManager.dispose();
  server.close();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
