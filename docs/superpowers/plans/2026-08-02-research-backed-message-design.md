# 研究知見にもとづく初回メッセージ設計の見直し Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** オンラインデーティングの実証研究で支持されている要素のうち、現行プロンプトに欠けているものを取り込み、衝突している点を解消する。

**Architecture:** `constants.ts` の `DEFAULT_PROMPT` の改訂と、それを測るための評価ハーネスの自動チェック追加。コードの構造は変えない。

**Tech Stack:** TypeScript / Vitest / 実LLM評価ハーネス（`evals/test-message-quality.ts`）

## Global Constraints

- コミットメッセージは日本語。**`Co-Authored-By` 行を付けない**。
- `LEGACY_DEFAULT_PROMPT_V1` / `LEGACY_CONTINUOUS_PROMPT_V1` は変更しない（移行判定に完全一致で使う）。
- プロンプトに具体的な話題（食べ物等）を名指ししない。`constants.test.ts` のガードテストが縛っている。
- 変更は1つずつ入れて測る。まとめて入れると何が効いたか分からなくなる。

---

## 調査結果

### 使った文献

| 出典 | 種類 | 規模 |
|---|---|---|
| Khan & Chaudhry (2015) *Evidence Based Medicine* | 系統的レビュー | 3,938件から86研究を統合 |
| Bruch & Newman (2018) *Science Advances* | 大規模行動データ | 米4都市・約18.6万人のメッセージ |
| Huang et al. (2017) *JPSP* | 実験＋スピードデート | 110名・2,000超の会話 |
| CMC自己開示の一連の研究 | 実験 | 対面との比較 |

### 現行設計が既に満たしているもの（裏付けが取れた）

- **短く、相手のプロフィールの具体に触れる**（Khan & Chaudhry: "short personalised messages addressing a trait in their profile"）→ ステップ1と200字制限
- **自己開示の相互性**（Khan & Chaudhry / CMC研究）→ ステップ2。CMCでは対面より自己開示が親密に知覚され、相互性が強く働く
- **自己開示は控えめに**（過度な自己開示は逆効果）→ 「自分の具体を1つ」

### 現行設計に欠けているもの

1. **フォローアップ質問**（Huang et al.）
   質問一般ではなく「相手が言ったことを受けた追加質問」が second date を増やす。機序は **responsiveness（聞いている・理解している・気にかけている）の知覚**。
   現行の「選んだ一節の隣を聞く」は近いが、**相手の言葉を受けたことが伝わる形にせよ**とは書いていない。

2. **具体的な称賛**（Khan & Chaudhry: "extended genuine compliments"）
   現行は容姿への言及を禁止しているだけで、中身への称賛を指示していない。

3. **批判の回避**（Khan & Chaudhry: "avoidance of criticism"）
   現行の禁止事項に無い。「NGに触れない」は別物。

### 現行設計と衝突するもの（ここが重要）

4. **男性は肯定的な語を増やすと返信率がやや下がる**（Bruch & Newman、4都市で一貫、p<0.001）
   上の「具体的な称賛」と正面から緊張する。**統合の仕方**: 称賛は入れるが、一般的な賛辞や肯定語の増量ではなく、**検証可能な具体1点に限る**。

5. **男性は長文にしても返信率が上がらない**（女性は上がる）
   200字制限は妥当。一方 **プレミアムの490〜500字は研究的に根拠が弱い**。長く書くこと自体に payoff が無いなら、文字数を埋めるために話題を作るリスクだけが残る。

### 最大の留保

Bruch & Newman は「メッセージ内容の工夫による payoff の差は小さい（the variation in payoff for different strategies is fairly small）」と結論している。**プロンプト改善の天井は低い可能性がある。**
また全研究が米国の一般向けマッチングサービスで、SM特化・日本語・選択式カードのある Luna に外挿できる保証はない。

---

### Task 1: フォローアップ性と responsiveness を問いの条件に加える

**Files:**
- Modify: `constants.ts`（`DEFAULT_PROMPT` のステップ3）
- Modify: `constants.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: なし（プロンプト文言の変更のみ）

- [ ] **Step 1: ガードテストを追加する**

`constants.test.ts` の `describe("DEFAULT_PROMPT")` に追加する。

```ts
  it("問いが相手の言葉を受けた形であることを求める", () => {
    expect(DEFAULT_PROMPT).toContain("相手が書いた言葉を受けたことが伝わる形にする")
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run constants.test.ts`
Expected: FAIL

- [ ] **Step 3: ステップ3に2行追加する**

`# ステップ3: 答えやすい問いで締める` の項目に、既存の行を消さずに追加する。

```
- 問いは、相手が書いた言葉を受けたことが伝わる形にする（相手の表現を1語でも拾ってから聞く）。
  聞いていること自体より「ちゃんと読んで理解した」と伝わることが効く
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm vitest run`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add constants.ts constants.test.ts
git commit -m "feat(prompt): 問いを相手の言葉を受けたフォローアップ形式にする

Huang et al. (2017, JPSP) の速いデート2,000会話の分析で、フォローアップ質問が
second date の獲得を増やすことが示されている。機序は responsiveness
（聞いている・理解している・気にかけている）の知覚。質問すること自体ではなく
相手の発話を受けたことが伝わる形が効く。"
```

---

### Task 2: 具体的な称賛を1つ許可し、一般的な賛辞は禁止のまま残す

**Files:**
- Modify: `constants.ts`（`DEFAULT_PROMPT` のステップ2と禁止事項）
- Modify: `constants.test.ts`

**Interfaces:**
- Consumes: Task 1 の変更後の `DEFAULT_PROMPT`
- Produces: なし

- [ ] **Step 1: ガードテストを追加する**

```ts
  it("具体的な称賛を1つだけ許し、一般的な賛辞は禁じる", () => {
    expect(DEFAULT_PROMPT).toContain("検証可能な具体1点に限る")
    expect(DEFAULT_PROMPT).toContain("一般的な賛辞")
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run constants.test.ts`
Expected: FAIL

- [ ] **Step 3: ステップ2に称賛の指示を追加する**

```
- 相手の書いたことに感心した点があれば、称賛を1つだけ添えてよい。ただし
  「素敵ですね」「魅力的です」のような一般的な賛辞ではなく、検証可能な具体1点に限る
  （何に、なぜ感心したのかが相手に分かる形）
```

- [ ] **Step 4: 禁止事項に肯定語の増量を追加する**

```
- 称賛や肯定的な言葉を重ねること。褒めるのは1点だけで、あとは事実を淡々と書く
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `pnpm vitest run`
Expected: PASS（全件）

- [ ] **Step 6: コミット**

```bash
git add constants.ts constants.test.ts
git commit -m "feat(prompt): 具体的な称賛を1点だけ許し、肯定語の増量を禁じる

2つの知見の統合。Khan & Chaudhry (2015) の系統的レビュー（86研究）は
genuine compliments を有効な要素に挙げる一方、Bruch & Newman (2018,
Science Advances, 18.6万人) は男性が肯定的な語を増やすと返信率がやや下がると
報告している（4都市で一貫、p<0.001）。称賛は入れるが、一般的な賛辞や
肯定語の増量ではなく検証可能な具体1点に限ることで両立させる。"
```

---

### Task 3: 批判の回避を禁止事項に加える

**Files:**
- Modify: `constants.ts`（禁止事項）
- Modify: `constants.test.ts`

**Interfaces:**
- Consumes: Task 2 の変更後の `DEFAULT_PROMPT`
- Produces: なし

- [ ] **Step 1: ガードテストを追加する**

```ts
  it("相手の選択や書き方への批判・訂正を禁じる", () => {
    expect(DEFAULT_PROMPT).toContain("相手の選択・考え方・書き方を評価したり訂正したりすること")
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `pnpm vitest run constants.test.ts`
Expected: FAIL

- [ ] **Step 3: 禁止事項に1行追加する**

```
- 相手の選択・考え方・書き方を評価したり訂正したりすること（「〜した方がいい」「〜は珍しいですね」等の
  上から目線も含む）
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm vitest run`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add constants.ts constants.test.ts
git commit -m "feat(prompt): 相手への批判・訂正を禁止事項に追加

Khan & Chaudhry (2015) の系統的レビューが avoidance of criticism を
対面に至る要素の1つに挙げている。既存の「NGに触れない」は別物で、
相手の選択や書き方への評価・訂正は塞げていなかった。"
```

---

### Task 4: 評価ハーネスに研究由来の自動チェックを足す

**Files:**
- Modify: `evals/test-message-quality.ts`

**Interfaces:**
- Consumes: `Checks` インターフェース（既存）
- Produces: `Checks` に `hasFollowUpCue` / `complimentCount` / `criticismFound` を追加

- [ ] **Step 1: チェック関数を追加する**

`checkMessage` に3項目を足す。判定は素朴な文字列ベースでよい（LLM審査ではなく決定論側に置くのは、比較のばらつきを減らすため）。

```ts
/** 相手の言葉を受けたことが伝わる合図。Huang et al. の responsiveness に対応 */
const FOLLOW_UP_CUES = ["とのこと", "というお言葉", "と書かれて", "と仰って", "というの", "そうですね", "拝読"]

/** 一般的な賛辞。Bruch & Newman の「肯定語の増量は男性に不利」に対応 */
const GENERIC_COMPLIMENTS = ["素敵", "魅力的", "素晴らし", "すごいです", "尊敬します", "憧れ"]

/** 批判・訂正・上から目線。Khan & Chaudhry の avoidance of criticism に対応 */
const CRITICISM_MARKERS = ["した方がいい", "しない方がいい", "珍しいですね", "意外ですね", "普通は", "ちゃんと"]
```

`Checks` に以下を追加し、`checkMessage` で計算する。

```ts
  hasFollowUpCue: boolean
  genericComplimentsFound: string[]
  criticismFound: string[]
```

```ts
    hasFollowUpCue: FOLLOW_UP_CUES.some((c) => message.includes(c)),
    genericComplimentsFound: GENERIC_COMPLIMENTS.filter((w) => message.includes(w)),
    criticismFound: CRITICISM_MARKERS.filter((w) => message.includes(w)),
```

- [ ] **Step 2: 集計とレポートに追加する**

`summarize` に追加する。

```ts
    followUpRate: rows.filter((r) => r.checks.hasFollowUpCue).length / n,
    genericComplimentMessages: rows.filter((r) => r.checks.genericComplimentsFound.length > 0).length,
    criticismMessages: rows.filter((r) => r.checks.criticismFound.length > 0).length,
```

レポートの表に3行足す。

```
${row("相手の言葉を受けた形の割合", legacy.followUpRate, fresh.followUpRate)}
${row("一般的な賛辞を含む件数", legacy.genericComplimentMessages, fresh.genericComplimentMessages)}
${row("批判・訂正を含む件数", legacy.criticismMessages, fresh.criticismMessages)}
```

- [ ] **Step 3: 型チェックとビルドを確認する**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし

Run: `pnpm vitest run`
Expected: PASS（全件）

- [ ] **Step 4: コミット**

```bash
git add evals/test-message-quality.ts
git commit -m "feat(evals): 研究由来の3項目を自動チェックに追加

フォローアップ形式か（Huang et al.）、一般的な賛辞を含むか
（Bruch & Newman）、批判・訂正を含むか（Khan & Chaudhry）。
LLM審査ではなく決定論側に置く。審査LLMは返信意欲でほぼ全件5点を
付けてしまい判断材料にならなかったため。"
```

---

### Task 5: 効果を測る

**Files:**
- なし（測定のみ）

- [ ] **Step 1: コーパスを収集する**

Run:
```bash
AUTO_SCROLL=1 WITH_CARDS=1 CORPUS_TARGET=40 CORPUS_PER_STRATUM=8 node evals/collect-partner-corpus.mjs
```

**40件以上にすること。** 20件では汎用性の測定がノイズに埋もれ、2回の測定で向きが逆転した実績がある。

- [ ] **Step 2: 旧プロンプト vs 新プロンプトで測る**

Run:
```bash
pnpm exec esbuild evals/test-message-quality.ts --bundle --packages=external \
  --platform=node --format=esm --outfile=test-results/message-eval/eval.bundle.mjs
node test-results/message-eval/eval.bundle.mjs
```

このとき `LEGACY_DEFAULT_PROMPT_V1` との比較になるので、Task 1〜3 の効果だけを見るには
比較対象を「Task 1〜3 適用前の `DEFAULT_PROMPT`」に差し替える必要がある。
**測定前に `constants.ts` の変更前の `DEFAULT_PROMPT` を `LEGACY_DEFAULT_PROMPT_V2` として保存し、
ハーネスの legacy 側をそれに向けること。** これは移行処理にも必要な作業（後述）。

- [ ] **Step 3: 結果を読む**

見るのは新規3項目（フォローアップ率・一般的賛辞・批判）が意図どおり動いたか。
汎用性と返信意欲は**ノイズ床（40件で±4〜8pt）を超えた差でなければ判定しない**。

- [ ] **Step 4: コーパスを削除する**

Run: `rm -rf test-results/message-research`

---

### Task 6: 移行用の LEGACY 定数を更新する

**Files:**
- Modify: `constants.ts`
- Modify: `background.ts`
- Modify: `utils/prompt-migration.test.ts`

Task 1〜3 で `DEFAULT_PROMPT` が変わるため、**変更前の文面を `LEGACY_DEFAULT_PROMPT_V2` として保存し、
移行判定を V1・V2 の両方に対応させる**必要がある。これをやらないと、v1.12.0〜v1.13.x で
`DEFAULT_PROMPT` を保存済みのユーザーが「編集済み」と誤判定されて取り残される。

- [ ] **Step 1: 変更前の DEFAULT_PROMPT を V2 として保存する**

`git show <Task1直前のコミット>:constants.ts` から `DEFAULT_PROMPT` の中身をそのままコピーし、
`LEGACY_DEFAULT_PROMPT_V2` として `constants.ts` に追加する。**1文字も変えないこと。**

- [ ] **Step 2: `migratePrompt` を複数世代対応にする**

`utils/prompt-migration.ts` の `legacy: string` を `legacies: string[]` に変える。

```ts
export function migratePrompt(
  stored: string | undefined | null,
  legacies: string[],
  next: string
): string | null {
  if (stored === undefined || stored === null || stored === "") return null
  if (legacies.includes(stored)) return next
  return null
}
```

- [ ] **Step 3: テストを更新する**

`utils/prompt-migration.test.ts` の呼び出しを配列に変え、「V1でもV2でも移行する」ケースを追加する。

- [ ] **Step 4: `background.ts` の `onInstalled` を更新する**

```ts
{ key: "promptTemplate", legacy: [LEGACY_DEFAULT_PROMPT_V1, LEGACY_DEFAULT_PROMPT_V2], next: DEFAULT_PROMPT }
```

- [ ] **Step 5: 全テストとビルド**

Run: `pnpm vitest run && pnpm build`
Expected: PASS / 成功

- [ ] **Step 6: コミット**

```bash
git add constants.ts utils/prompt-migration.ts utils/prompt-migration.test.ts background.ts
git commit -m "fix(prompt): プロンプト移行を複数世代に対応させる

DEFAULT_PROMPT を更新するたびに直前の文面を LEGACY として保存しないと、
その版を保存済みのユーザーが「編集済み」と誤判定されて恒久的に
取り残される。legacy を配列で受けて V1・V2 の両方から移行できるようにした。"
```

---

## 意図的にやらないこと

- **プレミアムの490〜500字の見直し** — Bruch & Newman は男性の長文に payoff が無いと報告しているが、
  プレミアムメッセージは課金機能であり「長く書ける」こと自体が売りである可能性がある。
  研究知見だけで課金機能の仕様を変えるのは踏み込みすぎ。別途ユーザーの判断を仰ぐ。
- **「早めにデートに誘う」の反映** — 研究は "early move from electronic chat to a date" を挙げるが、
  これは会話が進んだ後の話で、初回メッセージでの誘いを支持するものではない。
  現行の「初回で会う約束をしない」は維持する。会話継続用プロンプトの論点として分離する。
- **プロフィールの70:30ルール** — プロフィール改善機能（`profile-prompts.ts`）側の話であり、
  メッセージ生成のスコープ外。

## この計画の限界

- **効果量が小さい可能性が高い。** Bruch & Newman は内容の工夫による payoff の差は小さいと結論している。
  4項目すべてが意図どおり動いても、返信率が大きく変わる保証はない。
- **外挿の妥当性が不明。** 全研究が米国の一般向けマッチングサービス。SM特化・日本語・
  選択式カードのある Luna に当てはまる保証はない。
- **返信率そのものは測れない。** 手元の評価は審査LLMによる代理指標であり、
  実際の返信率とは別物。真の検証には実際に送って返信を記録する必要がある。
