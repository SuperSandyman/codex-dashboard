# codex app-server メモ（feat/add-chat-lens）

## 起動
- dashboard server は `APP_SERVER_COMMAND` + `APP_SERVER_ARGS` で `codex app-server` を子プロセス起動する
- 既定値:
  - `APP_SERVER_COMMAND=codex`
  - `APP_SERVER_ARGS=app-server`

## 接続方式
- dashboard server (`server/src/appServer/client.ts`) が app-server と **stdin/stdout の JSON-RPC 風行プロトコル**で通信
- フロントは dashboard server のみを参照
  - HTTP: `/api/chats`, `/api/chats/:id`, `/api/chats/:id/messages`, `/api/chats/:id/interrupt`
  - WS: `/ws/chats/:threadId`

## 利用している app-server メソッド（MVP）
- `initialize`
- `thread/list`
- `thread/start`
- `thread/read`
- `turn/start`
- `turn/interrupt`

## ストリーミング通知の中継
- app-server 通知を dashboard 内部イベントへ正規化して WS 配信:
  - `turn/started` → `turn_started`
  - `turn/completed` → `turn_completed`
  - `item/started` / `item/completed`
  - `item/agentMessage/delta`
  - `item/commandExecution/outputDelta`
  - `item/fileChange/outputDelta`
  - `item/reasoning/textDelta`
  - `item/reasoning/summaryTextDelta`
  - `item/plan/delta`

## 既知の注意点
- app-server 側のセッション保存ディレクトリに権限がないと `thread/start` が失敗する
- その場合は API エラー `{ error: { code, message } }` としてフロントへ返す
