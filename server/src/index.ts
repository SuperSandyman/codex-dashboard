import * as http from 'node:http';
import type { IncomingMessage } from 'node:http';

import { Hono } from 'hono';
import { WebSocketServer } from 'ws';

import { loadEnvConfig } from './config/env.js';
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

app.get('/api/health', (c) => c.json({ ok: true }));

const server = http.createServer((req, res) => {
  // Hono の fetch 型が Node の型と合わないため any を使用する。
  const handler = (app as any).fetch;
  handler(req, {
    method: req.method,
    headers: req.headers,
    url: `http://localhost${req.url}`,
  })
    .then((r: Response) => {
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      return r.arrayBuffer();
    })
    .then((buf: ArrayBuffer) => res.end(Buffer.from(buf)))
    .catch(() => {
      res.statusCode = 500;
      res.end('Internal Server Error');
    });
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', message: 'ws connected' }));
  ws.on('message', (data) => {
    ws.send(data.toString());
  });
});

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
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
