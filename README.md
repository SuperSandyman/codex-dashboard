# codex-dashboard

A local development dashboard that lets you switch between Chat, Terminal, and Editor in the browser while working with `codex app-server` and files in your workspace.

## Features

- Chat: integrates with `codex app-server` for thread creation, messaging, streaming output, launch permission options, approval responses, and tool user-input responses
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
PORT=4877
BIND_HOST=127.0.0.1
WORKSPACE_ROOT=/absolute/path/to/workspace
APP_SERVER_COMMAND=codex
APP_SERVER_ARGS=app-server
APP_SERVER_CWD=/absolute/path/to/workspace
```

## Environment Variables

- `PORT` (default: `4877`): API server port
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

- Frontend: `http://localhost:4873`
- Server API: `http://localhost:4877`
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
- Chats: `GET/POST /api/chats`, `GET /api/chat-options`, `GET /api/chats/:id`, `PATCH /api/chats/:id/options`
- Chat actions: `POST /api/chats/:id/messages`, `POST /api/chats/:id/interrupt`, `POST /api/chats/:id/approvals/:itemId`, `POST /api/chats/:id/user-input/:itemId`
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

## Chat Launch Options

`GET /api/chat-options` returns:

- model choices (`models`)
- `cwd` choices (`workspaceRoot`, `cwdChoices`)
- approval/sandbox choices (`approvalPolicies`, `sandboxModes`)
- defaults (`defaultApprovalPolicy`, `defaultSandboxMode`)

When creating or updating chats, you can set:

- `approvalPolicy` (`untrusted` / `on-failure` / `on-request` / `never`)
- `sandboxMode` (`read-only` / `workspace-write` / `danger-full-access`)

The server normalizes known aliases (for example `onRequest`, `workspaceWrite`) to canonical values above.

## Approval / User Input Flow

When app-server asks for approval (`item/commandExecution/requestApproval` or `item/fileChange/requestApproval`):

1. Dashboard emits WS event `approval_requested`
2. UI shows a `Yes / No` card inline in Chat view
3. UI calls `POST /api/chats/:id/approvals/:itemId` with `{ "decision": "accept" | "decline" }`
4. Dashboard replies to app-server with the same request id and emits `approval_resolved`

When app-server requests tool user input (`item/tool/requestUserInput`):

1. Dashboard emits WS event `user_input_requested`
2. UI renders question cards and submits answers
3. UI calls `POST /api/chats/:id/user-input/:itemId` with:

```json
{
  "answers": {
    "question_id": { "answers": ["selected or typed value"] }
  }
}
```

4. Dashboard replies to app-server with the same request id and emits `user_input_resolved`

`item/tool/call` is currently rejected explicitly as unsupported by this dashboard.
