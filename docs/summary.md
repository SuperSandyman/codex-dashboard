# codex-dashboard — プロジェクト要約

`codex-dashboard` は、自宅環境でローカルに起動して使う前提の、開発用ダッシュボードです。ブラウザ（PC/スマホ）から、ローカルマシン上の CLI ツールを操作したり、ワークスペースのコード閲覧や Markdown（Skills）管理を行えます。

## 主な機能
- **CLI セッション操作**
  - Codex CLI / opencode などの実行・対話（セッション作成 / 切替 / 終了）
  - ストリーミング出力表示、入力送信、リサイズ対応
  - セッション再接続時のログ復元（直近バッファ）

- **表示の切替**
  - **Terminal 表示（正）**と、読みやすさ重視の **Chat/Lens 表示（派生）**を切り替え（予定）

- **コードビューワー**
  - ワークスペースのファイルツリー表示とコード閲覧（まずは read-only）
  - 既存 LSP ビューワー資産の再利用や LSP 連携は後段で検討

- **Skills（Markdown）管理**
  - Markdown の作成・編集・プレビュー・検索（段階的に追加）

## 技術構成（予定）
- モノレポ：pnpm workspaces
- フロント：React + Vite + TypeScript
- サーバ：Node.js + TypeScript + Hono
- 通信：WebSocket（ストリーミング）
- 端末：PTY（node-pty）+ xterm.js
- コード表示：CodeMirror
- Markdown：markdown-it（プレビュー生成）

## 開発方針
- まず「Terminal で確実に動く」ことを最優先にし、Chat/Lens はログから生成する派生ビューとして後付けします。
- 開発はホスト環境で回し、Docker は本番運用段階で検討します。
