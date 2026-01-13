# Luna Extension

マッチングアプリ「Luna」のメッセージ作成をAIで支援するChrome拡張機能です。

## 開発方法

このプロジェクトは [Plasmo](https://www.plasmo.com/) フレームワークを使用しています。

### 1. 準備
```bash
cd luna-extension
pnpm install
```

### 2. 開発サーバーの起動（ホットリロード対応）
```bash
pnpm dev
```
起動後、Chromeで `chrome://extensions` を開き、「パッケージ化されていない拡張機能を読み込む」から `luna-extension/build/chrome-mv3-dev` を選択してください。

Plasmoは**ホットリロード（HMR）**に対応しているため、ソースコード（`content.tsx`や`options.tsx`など）を変更して保存すると、ブラウザ上の拡張機能に即座に反映されます。手動で拡張機能をリロードしたり、ページを更新したりする必要はありません。

## 本番（利用）方法

### 1. ビルド
```bash
cd luna-extension
pnpm build
```

### 2. Chromeへのインストール
1. Chromeブラウザで `chrome://extensions` を開きます。
2. 右上の「デベロッパー モード」をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」をクリックします。
4. `luna-extension/build/chrome-mv3-prod` フォルダを選択して読み込みます。

### 3. 初期設定
1. 拡張機能のアイコンをクリック、または詳細設定から「オプション」を開きます。
2. 利用するAIプロバイダー（Gemini または OpenAI）を選択し、APIキーを入力して保存します。
3. プロンプトのテンプレートを必要に応じてカスタマイズしてください。

### 4. 使い方
1. Lunaのサイト（luna-matching.com）にアクセスします。
2. チャット画面やプロフィールのメッセージ入力欄の横に表示される「✨ AIでメッセージ生成」ボタンをクリックします。
3. AIが自動的にプロフィール情報を取得し、最適なメッセージを生成して入力欄に挿入します。内容を確認・修正して送信してください。