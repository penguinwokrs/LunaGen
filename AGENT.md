# LunaGen (Developer Documentation)

このファイルは、AIエージェント（Antigravity等）が本プロジェクトを継続的にメンテナンス・拡張するための技術仕様書です。

## 🪐 システム概要
LunaGenは、Plasmo Frameworkを使用したManifest V3準拠のChrome拡張機能です。

### アーキテクチャ構成
1.  **Content Script (`content.tsx`)**:
    - `luna-matching.com` のDOMを監視し、`textarea` にAI生成ボタンを注入。
    - ページ更新や特定のURL (`/user/show/` 等) での条件付き表示を制御。
    - `sessionStorage` を介して `interceptor.ts` からデータを受け取る。
2.  **API Interceptor (`contents/interceptor.ts`)**:
    - `world: "MAIN"` で動作し、XHR/Fetchをフックして Luna の内部APIを傍受。
    - 取得したユーザーデータを背景スクリプトやContent Scriptへ連携。
3.  **Background Script (`background.ts`)**:
    - AI（Gemini/OpenAI）との通信を代行。
    - ストレージ管理（`local` 領域）とデバッグログの集約。
4.  **Options Page (`options.tsx`)**:
    - APIキー、プロンプトテンプレート、自分のプロフィール管理。
    - デバッグログの閲覧インターフェース。

## 🛠 技術的制約とルール

### ストレージ
- **領域**: `chrome.storage.sync` ではなく、必ず `chrome.storage.local` を使用すること（クォータ制限 8KB 回避のため）。
- **インスタンス**: `new Storage({ area: "local" })` を使用し、各コンポーネント間で設定を共有。

### データ取得
- **プロフィールの取得**: 原則としてAPIインターセプター経由で行う。DOMスクレイピングは廃止済み。
- **キャッシュ**: `sessionStorage` キー `luna_last_viewed_user` に最後に閲覧したターゲットのJSONを保持。

### AIプロンプト
- **プレースホルダー**: `{my_info_clean}` と `{target_info_clean}` を使用。
- **動的拡張**: `isPremium` フラグが true の場合、バックグラウンド側で「200文字以内」を「500文字以内」に自動置換する。

## ⚠️ 注意点
- **アイコン**: `assets/icon.png` を基にPlasmoが各サイズを自動生成する。
- **メッセージ挿入**: `insertText` 関数は既存のテキストを「完全に上書き」する仕様（再生成しやすさを優先）。
- **ログイン状態**: 自己プロフィールの手動取得時は `api/user/is_auth` を確認し、未認証時はエラーを出す。

## 📈 今後の拡張予定
- メッセージ送信後の自動チャットログ記録。
- 生成メッセージの「トーン（敬語/タメ口/情熱的など）」の選択機能。
- 複数プロンプトテンプレートの保存と切り替え。
