# プロフィール改善機能（AI生成・テイスト3択）設計書

- 日付: 2026-07-20
- ステータス: 承認済み（UI案B / 4欄対象 / テイスト3案確定 / 実装まで進行）
- 根拠資料: `test-results/profile-research/out/`（gitignore領域）
  - `discussion-report.md` … 多段議論の最終版・執筆原則マトリクス（15エージェント: 4分析→6ペルソナ→統合→3反証→最終化）
  - `corpus.json` … Luna実機コーパス（女性134名・男性60名、匿名化済み）
  - `design-proposal.md` … 承認済み設計提案

## 1. 目的

Luna のプロフィール編集画面（`/user/mod`）の自由記述4欄（自己紹介・性癖嗜好・相手に求める条件・NGなこと）に AI 生成ボタンを設置し、**保存済みの内容の方向性・事実を維持したまま**、いいねが返りやすい文章へ改善した候補を**テイスト違い3択**（堅実/物語/軽快）で提示して選ばせる。

- 男性ユーザー → 女性からいいねが返りやすい内容へ / 女性ユーザー → 男性からいいねが来やすい内容へ
- 原則セットの選択は自分の `sex` ではなく **`conditions_sex`（求める相手の性別）＝読者** で決める:
  - `conditions_sex` に `"1"`（女性）を含む → 読者=女性 → **「女性に読まれる」原則セット**（discussion-report の 1-A/B/C。従来の呼称「男性ユーザー向け」）
  - それ以外 → 読者=男性 → **「男性に読まれる」原則セット**（同 1-D/E/F。従来の呼称「女性ユーザー向け」）

## 2. 実機調査で確定した前提（2026-07-20 時点）

| 項目 | 値 |
|---|---|
| 編集ページ | `https://luna-matching.com/user/mod`（SPA・ページ遷移なし） |
| 編集UI | 各欄「編集する」→ 全画面オーバーレイ。開いた欄の textarea のみ DOM に出現 |
| maxLength | 4欄すべて 400 |
| 欄の判別 | textarea placeholder（下表）。フォールバック: オーバーレイ内見出しテキスト |
| 保存 | サイト純正「保存する」ボタン（拡張は insertText まで。保存APIは叩かない） |
| 自分のデータ | 既存 `myProfileRaw`（storage.local）に全フィールド（q_*・my_type・conditions_sex 等）がキャッシュ済み |

| fieldType | placeholder（部分一致キー） | 見出し | APIフィールド |
|---|---|---|---|
| `intro` | 「自分について」 | 自己紹介 | `profile` |
| `kink` | 「性癖・嗜好の詳細」 | 性癖・嗜好の詳細 | `text_my_like` |
| `conditions` | 「相手に求める条件の詳細」 | 相手に求める条件 | `conditions_text` |
| `ng` | 「跡が残ること」 | NGなこと | `text_my_ng` |

## 3. アーキテクチャ

```
content.tsx（/user/mod 分岐）
  └─ ProfileImproveButton（textarea 直下に注入: [✨ AIで改善]）
       └─ クリック → ProfileImprovePanel（シャドウDOMモーダル）を document.body に生成
            ├─ テイスト3種を並列リクエスト（chrome.runtime.sendMessage × 3）
            │    → background.ts action: "generate_profile"
            ├─ カード3枚（堅実/物語/軽快）: 本文・文字数バッジ・[この案を使う]・[♻ 再生成]
            └─ [この案を使う] → insertText(textarea, text) → モーダル閉→ ユーザーがサイトの「保存する」
```

### 3.1 content.tsx の変更
- `processDom()` に `/user/mod` 分岐を追加。`location.pathname === "/user/mod"` のとき:
  - 既存のメッセージ用 `GenerateButton` は注入しない（現状の isTargetPage 条件は変更なし）
  - 出現した textarea の placeholder から fieldType を判別し、`ProfileImproveButton` を注入
  - 判別不能な textarea には注入しない（安全側）
- 注入・後始末は既存の `injectedButtons` Map / `cleanupDetachedButtons()` パターンを共用

### 3.2 新規 `utils/profile-field.ts`（純ロジック・テスト対象）
- `detectProfileField(placeholder, headingText): FieldType | null`
- `buildProfilePrompt({ fieldType, taste, currentText, myRaw, audience })`: プロンプト組み立て（§5）
- `enforceLength(candidates, cap=400)`: 400字検証・最良候補選択（`pickNearCap` 相当を共通化）
- `checkKinkPreservation(source, output): { ok, missing[] }`: 嗜好名詞の保全チェック（§5.4）
- `resolveAudience(myRaw): "women" | "men"`: `conditions_sex` から判定

### 3.3 新規 `components/Content/ProfileImproveButton.tsx` / `ProfileImprovePanel.tsx`
- Button: 既存 GenerateButton と同トーンの小型ボタン。ローディング/エラー状態表示
- Panel（モーダル）:
  - `document.body` 直下に host div + **Shadow DOM**（サイトCSSと完全分離）。z-index はサイトオーバーレイより上
  - レイアウト: 幅 ≥900px で3カード横並び、未満は縦積み（スクロール）
  - カード: テイスト名＋一言説明／本文（スクロール可）／`n/400` バッジ／[この案を使う]／[♻ 再生成]
  - 3リクエストは独立。完了したカードから順次表示（1枚失敗しても他は生きる）
  - 閉じる: ✕・キャンセルボタン・ESC・バックドロップクリック。開いている間は body スクロールロック
  - [この案を使う] 後に小さくトースト「⚠ サイトの『保存する』を押すと反映されます」
  - 部分失敗カード: エラーメッセージ＋[♻ 再生成]（APIキー未設定はオプション画面への誘導文言）

### 3.4 background.ts の変更
- 新 action `generate_profile`: `{ fieldType, taste, currentText, myProfileRaw }`
  - プロンプト組み立ては `utils/profile-field.ts` に委譲（background はプロバイダ呼び出しと再試行のみ）
  - 生成 → 400字超過なら短縮リトライ（最大2回）→ `enforceLength` で最良候補
  - `kink` 欄のみ `checkKinkPreservation` → 不合格なら1回だけ再生成 → なお不合格なら `warning` を付けて返す（UI で警告バッジ）
  - replacementRules を既存同様プロンプトへ適用
  - 戻り値: `{ text, warning? }` または `{ error }`
- 既存 `generateWithGemini/OpenAI/Ollama` をそのまま利用（プロバイダ選択も既存設定に従う）

### 3.5 myProfileRaw が無い場合のフォールバック
- Panel 起動時に `myProfileRaw` が空なら、content script から `fetch("https://luna-matching.com/api/user/get/me")` で取得して storage に保存（既存 `getMyProfile()` と同じ手順）。それも失敗したらモーダル内にエラー表示

## 4. テイスト定義（確定・constants.ts に定数化）

| id | UI表示名 | 一言説明 | 指示の要点 |
|---|---|---|---|
| `solid` | 堅実 | 安心感重視の整理型 | 箇条書き・見出し中心、敬体。安全・合意シグナルを各欄前半に。形容詞→検証可能な行動記述。例外: kink欄の「なぜ好きか」1文は散文のまま保持 |
| `story` | 物語 | 由来を語る散文型 | 散文2〜3段落、一文40〜60字。由来・興奮構造を性格/生活文脈で語る。**因果の新設禁止・過去の特定相手エピソード禁止・性的描写の解像度は元文以下** |
| `light` | 軽快 | 短文でテンポ良く | 一文30字以下中心・改行多め。**男性ユーザーは敬体維持**。ユーモアは生活面限定1箇所。kink欄は合意・加減の一文を前半に。絵文字量は元文継承 |

3案とも事実・安全記述・具体性の密度は同一。変えるのは語り口と構造のみ。

## 5. プロンプト設計（constants.ts）

### 5.1 構成
```
PROFILE_PROMPT_TEMPLATE
  = 共通コンテキスト（Luna・成人間の合意に基づく安全性向上目的・出力は本文のみ）
  + 欄別・読者性別別の執筆原則（{field_principles}: 8セット = 4欄 × 2読者）
  + テイスト指示（{taste_instruction}）
  + 共通ガードレール（§5.3）
  + 自分の構造化データ（{profile_context}: 年代・タイプ・嗜好スコア・求める関係等 + 他欄本文=読み取り専用）
  + 対象欄の現在の本文（{current_text}）
```
- 執筆原則は `discussion-report.md` §1 の必須Do/推奨Do/Don't を各セット10行程度に要約して定数化（ng 欄は Luna 公式Tips の Good/BAD 例から作成: 境界線の明確化・未経験の正直表記・関係性NG・「何でもできます」禁止）
- 字数指示: 「400字以内厳守、目安150〜300字」（男性×自己紹介のみ150〜250字）

### 5.2 空欄フォールバック
- `currentText` が **30字未満** の場合: 構造化データのみから骨子を生成し、埋められない事実は `〔要記入: 職種〕` 形式のプレースホルダで出力するようテンプレートを切替（捏造禁止を「必ず埋める」より優先）

### 5.3 共通ガードレール（プロンプト内蔵 + 一部コード検証）
1. 事実捏造禁止（追加してよいのは安全配慮・擦り合わせ意思等「姿勢の言語化」のみ。由来・動機の新設は不可）
2. 同意・境界線: 同意不要化表現→「合意の範囲で」へ変換。「何でもOK」→「NGは相談で」へ。嗜好の方向性自体は消さない
3. 禁止出力: 連絡先・外部ID／外見条件の要求／ロマンチック定型句／卑屈定型句／金銭要求の冒頭配置
4. NGの中身は削除不可（カテゴリ集約による圧縮のみ可）
5. 400字以内はコード側で検証（§3.4）

### 5.4 嗜好名詞の保全チェック（kink 欄のみ・コード側）
- 元本文の箇条書き行（`・`/`-` 始まり）から名詞キーを抽出し、出力に含まれるか（replacementRules の変換後語も可）を確認
- 目的: セーフティによる「無言の希釈」検知。不合格→1回再生成→なお不合格は警告付き返却

## 6. エラー処理

| ケース | 挙動 |
|---|---|
| APIキー未設定 | カード内エラー＋「設定画面を開く」リンク |
| 生成失敗（1テイストのみ） | 該当カードのみエラー＋再生成ボタン。他カードは正常表示 |
| 400字に収まらない | 最短候補を採用し警告バッジ（発生は稀: 2回リトライ後） |
| myProfileRaw 取得不能 | モーダル内エラー「Lunaにログインした状態でページを再読み込みしてください」 |
| placeholder 不一致（サイト改修） | ボタン非注入（無害に退化）。debugログに記録 |

## 7. テスト

### 7.1 ユニット（Vitest・新規 `utils/profile-field.test.ts` ほか）
- `detectProfileField`: 4欄の placeholder / 見出しフォールバック / 不一致→null
- `resolveAudience`: conditions_sex "1"/"2"/複合/欠損
- `buildProfilePrompt`: 欄×性別×テイストの組み合わせで原則・指示が正しく選択される／30字未満でフォールバックテンプレへ切替
- `enforceLength`: 400以内選択・全超過時は最短
- `checkKinkPreservation`: 保全OK/欠落検出/置換語での許容

### 7.2 実機E2E（`.claude/skills/luna-startup-debug` を拡張）
- `/user/mod` → 自己紹介の「編集する」→ [✨ AIで改善] 注入をアサート＋スクショ
- モーダル起動（APIキー無しプロファイルのためカードはエラー表示になることを確認）＋スクショ
- 既存のメッセージボタン検証が退行していないこと（`/user/mod` ではメッセージ用ボタンが出ない）

## 8. スコープ外（将来）
- 3欄一括生成モード（4軸カバー検査つき）
- プロフィール用プロンプトテンプレートのオプション画面での編集
- 語彙3分類表の本格運用（v1 は replacementRules + 保全チェックで代替）
- 生成候補の差分ハイライト表示
