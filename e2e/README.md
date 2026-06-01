# E2E / ブラウザ操作 (Playwright)

Node 版 `@playwright/test` でブラウザ操作・拡張のE2Eを行う。

## 前提

ビルド済み拡張をロードするため、先にビルドする:

```bash
pnpm build        # build/chrome-mv3-prod を生成
pnpm exec playwright install chromium   # 初回のみ
```

## 実行

```bash
pnpm e2e            # 全テスト(ヘッドレス)
pnpm e2e:headed     # ブラウザを表示して実行 (HEADED=1)
pnpm e2e:ui         # Playwright UI モード
pnpm e2e:report     # 直近のレポートを表示
```

## 構成

| ファイル | 内容 |
| --- | --- |
| `../playwright.config.ts` | 設定。testDir=`./e2e` |
| `fixtures.ts` | 拡張をロードした persistent context と `extensionId` を提供 |
| `extension.spec.ts` | 拡張のロード/オプション/ポップアップ確認(ログイン不要) |
| `luna-login.spec.ts` | luna-matching.com のログイン依存テスト |

拡張(MV3)は通常の `newContext` では読めないため、`launchPersistentContext`
+ `--load-extension` でロードしている(`fixtures.ts`)。

## luna-matching.com のログイン

ログイン状態は Chrome プロファイルを永続化して再利用する。

1. 一度だけログイン(codegen が起動するので画面でログイン操作する):

   ```bash
   pnpm e2e:login     # --user-data-dir=e2e/.profile でプロファイル保存
   ```

   認証情報は Bitwarden CLI から取り出せる(例 `bw get password luna-matching`)。

2. 以降は同じプロファイルを使って実行:

   ```bash
   E2E_USER_DATA_DIR=e2e/.profile pnpm e2e
   ```

   未ログイン時、ログイン依存テストは自動的に skip される。

## 操作の記録 (codegen)

```bash
pnpm e2e:codegen    # luna-matching.com を開いて操作をコードに書き起こす
```

## メモ

- `e2e/.profile` `e2e/.auth` は gitignore 済み。
- 旧 Python(uv + browser-use)版は Node 版へ移行済みのため削除済み。
