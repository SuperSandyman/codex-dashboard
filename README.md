# codex-dashboard

A local development dashboard that lets you switch between Chat, Terminal, and Editor in the browser while working with `codex app-server` and files in your workspace.

## Features

- Chat: integrates with `codex app-server` for thread creation, messaging, and streaming output
- Terminal: create PTY sessions, send input, resize, and reconnect
- Editor: browse and edit files under `WORKSPACE_ROOT` with basic conflict detection

## Tech Stack

- Monorepo: pnpm workspaces
- Frontend: React + Vite + TypeScript
- Server: Node.js + TypeScript + Hono + ws + node-pty

## Prerequisites

- Node.js 20+
- pnpm
- `codex` CLI available (`codex app-server` must run)

## Setup

```bash
pnpm install
```

`.env` is automatically loaded from either `server/.env` or the repository root `.env`.

Example:

```dotenv
PORT=8787
BIND_HOST=127.0.0.1
WORKSPACE_ROOT=/absolute/path/to/workspace
APP_SERVER_COMMAND=codex
APP_SERVER_ARGS=app-server
APP_SERVER_CWD=/absolute/path/to/workspace
```

## Environment Variables

- `PORT` (default: `8787`): API server port
- `BIND_HOST` (default: `127.0.0.1`): bind host (`0.0.0.0` to expose on LAN)
- `WORKSPACE_ROOT` (optional, recommended): root path for Terminal / Editor / Chat `cwd` restrictions (absolute path)
- `APP_SERVER_COMMAND` (default: `codex`): app-server command
- `APP_SERVER_ARGS` (default: `app-server`): app-server arguments (space-separated)
- `APP_SERVER_CWD` (optional): working directory for the app-server child process (absolute path)
- `APP_SERVER_REQUEST_TIMEOUT_MS` (default: `120000`): app-server RPC timeout
- `TERMINAL_IDLE_TIMEOUT_MS` (default: `600000`): terminal idle timeout in ms
- `EDITOR_MAX_FILE_SIZE_BYTES` (default: `1048576`): max file read size in Editor
- `EDITOR_MAX_SAVE_BYTES` (default: `1048576`): max file save size in Editor

## Development

Run both frontend and server from the repository root:

```bash
pnpm dev
```

- Frontend: `http://localhost:5173`
- Server API: `http://localhost:8787`
- Vite proxies `/api` and `/ws` to the server.

Run separately:

```bash
pnpm -C server dev
pnpm -C frontend dev
```

## Build / Production Run

```bash
pnpm build
pnpm start
```

`pnpm build` generates `frontend/dist`, and `pnpm start` (server) serves static assets.

## Core API / WS Endpoints

- Health: `GET /api/health`
- Chats: `GET/POST /api/chats`, `POST /api/chats/:id/messages`, `POST /api/chats/:id/interrupt`
- Editor: `GET /api/editor/tree`, `GET/PUT /api/editor/file`
- Terminals: `GET/POST /api/terminals`, `POST /api/terminals/:id/write`, `POST /api/terminals/:id/resize`
- Chat WS: `/ws/chats/:threadId`
- Terminal WS: `/ws/terminals/:terminalId`

## Directory Structure

```text
.
├── frontend/   # React + Vite UI
└── server/     # Hono API / WS / PTY / app-server bridge
```
