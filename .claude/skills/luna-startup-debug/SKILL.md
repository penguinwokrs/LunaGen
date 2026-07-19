---
name: luna-startup-debug
description: LunaGen拡張の起動確認デバッグ。ビルド済み拡張を実ブラウザにロードし、luna-matching.comへログイン→実ページで生成ボタン(AI/クリア)の注入をスクショ確認し、拡張のデバッグログを読む。「起動確認して」「拡張をデバッグして」「実機でスクショ」等のときに使う。
---

# LunaGen 起動確認デバッグ

ビルド済み拡張(`build/chrome-mv3-prod`)を Playwright の persistent context でロードし、
**実際の luna-matching.com** 上で content script が生成ボタン(**AI** / **クリア**)を注入するかを
スクショで確認する一連の手順。認証は Bitwarden CLI、ログイン状態は `e2e/.profile` に永続化される。

## 前提

1. **ビルドが最新であること**（コード変更後は必須）:
   ```
   pnpm build
   ```
2. **Bitwarden がアンロック済み**であること。
   - ⚠️ 環境変数 `BW_SESSION` は**古いことがある**（`bw status` が locked/unauthenticated を返す）。
     有効なセッションキーは **`/home/owner/.bw_session_key`**（`$BW_SESSION_FILE`）に入っている。
     必ずこのファイルから読む: `S="$(cat /home/owner/.bw_session_key)"; bw get username <id> --session "$S"`
   - `bwl` というコマンドは**存在しない**（過去メモの誤り）。
3. Playwright 用の Chromium が導入済み（`@playwright/test` の `channel: "chromium"`）。

## 手順

### 1. ビルド
```
pnpm build
```

### 2. 起動確認 + スクショ
```
node .claude/skills/luna-startup-debug/verify.mjs
```
- 初回は Bitwarden から認証情報を取り出して自動ログイン（以降は `e2e/.profile` で省略）。
- 会話一覧 `/congratulation/list` を開き、**先頭の会話をクリックしてスレッドを開く**。
- スレッドの `textarea` に **AI**/**クリア** ボタンが注入されているかを検証し、スクショを保存。
- 認証情報は `bw` の出力を**プロセス内メモリに直接**取り込み、標準出力・ファイルに出さない。

環境変数で調整可:
- `SHOT_DIR` … スクショ保存先（既定: `<repo>/test-results/startup-debug`、gitignore配下）
- `FOCUS` … メッセージ欄に入れる優先話題テキスト（既定: `キャンプと焚き火の話`）。空文字で無効化。
- `HEADED=1` … ヘッド付きで起動（目視確認したいとき）
- `BW_ITEM` … Bitwarden のログインアイテムID（既定: luna のログイン）
- `BW_SESSION_FILE` … セッションキーのファイル（既定: `/home/owner/.bw_session_key`）

保存されるスクショ:
- `01-list.png` … 会話一覧
- `02-thread-buttons.png` … スレッドで AI/クリア ボタン注入を確認（メイン成果物）

### 2.5 プロフィール改善機能の確認
```
node .claude/skills/luna-startup-debug/verify-profile.mjs
```
- `/user/mod` → 自己紹介の「編集する」→「✨ AIで改善」注入 → 3択モーダル（堅実/物語/軽快）表示を検証。
- APIキー無しプロファイルではカードがエラー表示になるのが正常（注入とUIの確認が目的）。
- スクショ: `test-results/profile-improve-debug/01-edit-overlay-button.png`, `02-panel-cards.png`

### 2.6 パネルがサイトのUIを壊さないことの確認（回帰テスト）
```
node .claude/skills/luna-startup-debug/verify-panel-isolation.mjs
```
- パネル内クリック・再生成・キャンセル・背景クリックで、**背後の編集オーバーレイが維持される**ことを検証。
- **判定は textarea の有無で行う**（トップ画面は textarea 0個）。「自己紹介」等の見出しテキストは
  トップ画面にも存在するため判定に使えない（過去にこれで誤検証した）。
- 背景: Lunaは編集オーバーレイを開くと `document` に `pointerdown`(bubble) の外側クリック検知を登録する。
  シャドウDOM内のクリックはリターゲティングで host（body直下）への操作に見えるため、
  host でイベントを止めないと編集画面が閉じてしまう。

### 3. 拡張ログの確認（生成が失敗した等の切り分け）
```
node .claude/skills/luna-startup-debug/read-logs.mjs
```
- `e2e/.profile` の `chrome.storage.local` から `debugLogs`（と `aiProvider`）を読み出して表示。
- 例: 生成失敗が `{"error":"Gemini API Key is not set"}` なら、**このデバッグ用プロファイルに
  APIキーが無いだけ**（実運用プロファイルの sync ストレージにキーがある）。コードのバグではない。

## 注意 / つまずきどころ

- **未ログイン時のリダイレクト**: `luna-matching.com` は未ログインだと `luna-match.com`(LP)へ飛ぶ。
  ログイン判定は `/api/user/get/me` が 200 かどうか（`reference_luna_auth_api` 参照）。
- **会話一覧の行はonclickルーター**（hrefなし）。セレクタ指定より**座標クリック**が確実
  （verify.mjs は先頭行 `(640, 100)` 付近をクリック。ダメなら下の行を順に試す）。
- **注入対象ページ**: `/user/show/`・`/user/service/show/`・URLに `/message` を含むページ
  （`content.tsx` の `injectButtons`）。マッチ後会話は `/user/message/{id}`。
- **プロファイルの秘匿**: `e2e/.profile` はログインCookieを含む。`.gitignore` 済み。コミットしないこと。
- **APIキー**: デバッグ用 `e2e/.profile` には Gemini/OpenAI キーが無いので**実生成は失敗する**のが正常。
  実生成まで確認したい場合のみ、キーの入手方法をユーザーに確認して sync ストレージへ投入する。

関連メモリ: `reference_debugging`(Bitwarden), `reference_luna_auth_api`(ログイン判定),
`reference_luna_message_ui`(UI/注入箇所)。
