# codex-dashboard やりたいことリスト（Backlog）

## 0. ゴール（体験）
- [ ] 自宅PCでサーバを起動すると、スマホ/PCからアクセスして操作できる
- [ ] 同じセッションを **Terminal / Chat(Lens)** で切り替えて使える
- [ ] 作業の進捗と成果が **Activity** に流れて「動いてる感」が出る

---

## 1. リポジトリ/基盤
- [ ] pnpm workspace の雛形を確定（`app/`, `server/`, `data/`, `workspaces/`）
- [ ] ルート scripts 整備（`dev`, `build`, `start`, `lint`）
- [ ] `.env` 読み込み（PORT, WORKSPACE_ROOT, SKILLS_DIR, API keys）
- [ ] 起動時にアクセスURLを表示（LAN IP + port）

---

## 2. サーバ（中核）
### 2.1 PTY セッション（CLIラッパー）
- [ ] SessionManager（in-memory）
  - [ ] create / list / kill
  - [ ] status（running/exited/error）
  - [ ] idle timeout（任意）
- [ ] コマンド allowlist（`codex`, `opencode`）
- [ ] PTY 起動（cwd=workspace）
- [ ] WS: `/ws/sessions/:id`
  - [ ] output（stream）
  - [ ] input（text）
  - [ ] resize（cols/rows）
  - [ ] log snapshot（再接続復元）

### 2.2 Workspace / FS（read-only から）
- [ ] `workspaces.json`（登録/永続）
- [ ] `GET /api/workspaces` / `POST /api/workspaces`
- [ ] `GET /api/fs/tree`（ツリー）
- [ ] `GET /api/fs/file`（ファイル内容）
- [ ] 安全なパス検証（workspace root 制限、`..`/symlink脱出対策）

### 2.3 Skills（Markdown）
- [ ] `data/skills/*.md` のCRUD
- [ ] タグ/タイトル（frontmatter任意）
- [ ] Markdown preview（サーバ変換）

### 2.4 Activity（イベント）
- [ ] event モデル定義（session/file/skill）
- [ ] session started/exited を出す
- [ ] skills created/updated を出す
- [ ] `GET /api/activity`（直近N件）
- [ ] WS push（任意）
- [ ] file change（chokidar）（後追い）

---

## 3. フロント（UI）
### 3.1 共通UI（ダークでかっこよく）
- [ ] レスポンシブ骨格
  - [ ] PC: sidebar + 2-3ペイン
  - [ ] Mobile: 下部タブ
- [ ] テーマトークン（背景/パネル/境界/アクセント）
- [ ] 150–250ms の基本モーション（hover/switch）

### 3.2 Sessions
- [ ] セッション一覧（状態、最終出力、最終更新）
- [ ] セッション作成（tool + workspace）
- [ ] セッション切替（同一画面で）

### 3.3 Terminal View（必須）
- [ ] xterm.js で描画
- [ ] WS 接続（output/input/resize）
- [ ] スマホ向け Command Bar（1行送信）

### 3.4 Chat View / Lens（必須）
- [ ] Terminal/Chat 切替トグル（同一sessionId）
- [ ] 入力イベントを基準に turns を生成して表示
- [ ] 出力の整形（ANSI除去、折りたたみ）
- [ ] 送信（同じPTYへ）

### 3.5 Code Viewer（read-only）
- [ ] workspace選択
- [ ] ファイルツリー
- [ ] CodeMirror 表示
- [ ] 最近開いたファイル（Quick）
- [ ] （任意）diff 表示（git diff）

### 3.6 Skills
- [ ] Skills一覧（カード + タグ + 更新日時）
- [ ] 作成/編集/削除
- [ ] Preview（タブ/分割）
- [ ] 検索（タイトル/タグ/全文）

### 3.7 Activity
- [ ] Activity Feed 表示（時系列）
- [ ] クリックで該当（session/file/skill）にジャンプ

---

## 4. LSP 再利用（後段）
- [ ] 既存LSPビューワー資産を `packages/lsp-viewer` 化
- [ ] CodeMirror に組み込み
- [ ] ホストLSPプロキシ（WSブリッジ）を追加
- [ ] hover / diagnostics / definition を最低限提供

---

## 5. 仕上げ（ワクワク要素強化）
- [ ] “Running” の控えめパルス、接続インジケータ
- [ ] Activity のイベント整形（アイコン、カテゴリ、短い要約）
- [ ] セッションごとの「最近触ったファイル」表示（任意）
- [ ] スナップショット復元のUX改善（再接続で自然に戻る）

---

## 6. 将来（運用/本番）
- [ ] build して server が静的配信できる構造を維持
- [ ] Docker Compose は本番時に検討（server 1コンテナ基本）
