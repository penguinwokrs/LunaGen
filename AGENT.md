# LunaGen (Developer Documentation)

このファイルは、AIエージェント（Antigravity等）が本プロジェクトを継続的にメンテナンス・拡張するための技術仕様書です。

## 🪐 システム概要
LunaGenは、Plasmo Frameworkを使用したManifest V3準拠のChrome拡張機能です。プロジェクトはモダンなコンポーネント指向で設計されています。

### アーキテクチャ構成
1.  **Content Script (`content.tsx`)**:
    - `luna-matching.com` のDOMを監視し、`components/Content/GenerateButton.tsx` を注入。
    - `sessionStorage` を介して `interceptor.ts` からデータを受け取り、`utils/profile.ts` で解析。
1.5. **プロフィール改善 (`components/Content/ProfileImprovePanel.tsx`)**:
    - `/user/mod`（プロフィール編集）の編集オーバーレイに `ProfileImproveButton` を注入。
    - 欄判別は `utils/profile-field.ts` の `detectProfileField`（placeholder優先、見出しフォールバック）。
    - テイスト3択（堅実/物語/軽快）をシャドウDOMモーダルで比較し、`insertText` で反映。保存はサイト純正ボタン。
    - プロンプト定数は `profile-prompts.ts`（原則の出典: docs/superpowers/specs/2026-07-20-luna-profile-improvement-design.md）。
    - background の `generate_profile` アクションが生成（400字コード検証・嗜好名詞保全チェック付き）。
2.  **API Interceptor (`contents/interceptor.ts`)**:
    - `world: "MAIN"` で動作し、XHR/Fetchをフックして Luna の内部APIを傍受。
    - 取得したデータを `window.postMessage` で Content Script へ転送。
3.  **Background Script (`background.ts`)**:
    - AI（Gemini/OpenAI）との通信を代行。
    - メッセージ生成のリクエストを処理。
4.  **Options Page (`options.tsx`)**:
    - `components/Options/` 以下のモジュール化されたコンポーネントで構成。
    - APIキー、プロンプト、自分のプロフィールを管理。

### フォルダ構造
- `components/`: UIコンポーネント（Options/Content/Common）。
- `logic/`: ビジネスロジック。
- `utils/`: 共通ユーティリティ（ロガー、プロフィール解析）。
- `constants.ts`: プロンプトやモデル名の定数。

## 🛠 技術的制約とルール

### ストレージ
- **領域**: 必ず `chrome.storage.local` を使用（`new Storage({ area: "local" })`）。
- **デバッグログ**: `utils/logger.ts` を通じて記録。`isDebugEnabled` フラグに従う。

### ログ管理 (`utils/logger.ts`)
- `addLog(level, message, detail, context)` を使用。
- `process.env.NODE_ENV === "development"` の場合、デフォルトでデバッグログが有効。
- エラーログは設定に関わらず常にコンソールとストレージに出力される。

### AIプロンプト
- **プレースホルダー**: `{my_info_clean}` と `{target_info_clean}` を使用。
- **動的拡張**: `isPremium` フラグが true の場合、バックグラウンド側で「200文字以内」を「500文字以内」に自動置換する。

## ⚠️ 注意点
- **プロフィール抽出**: `utils/profile.ts` の `extractProfileFromJSON` を一貫して使用すること。
- **メッセージ注入**: `logic/content-logic.ts` の `insertText` を使用し、React/Vueのイベントを発火させる。
- **アイコン**: `assets/icon.png` を基に自動生成。

## 🧪 テスト
- **ユニット**: Vitest (`*.test.tsx`)。`pnpm exec vitest`。
- **E2E / ブラウザ操作**: Playwright (`@playwright/test`)。`e2e/` 配下。
  - `pnpm build` 済みの `build/chrome-mv3-prod` を persistent context でロードする。
  - `pnpm e2e` で実行。詳細は `e2e/README.md`。
  - luna-matching.com のログインは `pnpm e2e:login` でプロファイルを作り、
    `E2E_USER_DATA_DIR=e2e/.profile` で再利用する。

## 📈 今後の拡張予定
- メッセージ送信後の自動チャットログ記録。
- 生成メッセージの「トーン」選択機能。
- 複数プロンプトテンプレートの保存と切り替え。
