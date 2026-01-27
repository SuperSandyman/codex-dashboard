import { Hono } from "hono";
import { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import * as http from "node:http";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

const server = http.createServer((req, res) => {
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
    .then((buf) => res.end(Buffer.from(buf)))
    .catch(() => {
      res.statusCode = 500;
      res.end("Internal Server Error");
    });
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", message: "ws connected" }));
  ws.on("message", (data) => {
    ws.send(data.toString());
  });
});

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    return;
  }
  socket.destroy();
});

server.listen(8787, () => {
  console.log("server listening on http://localhost:8787");
});
