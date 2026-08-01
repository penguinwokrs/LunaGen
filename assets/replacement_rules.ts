/**
 * プロンプトに適用するデフォルト置換ルール。
 *
 * 目的は「安全フィルタでブロックされる語」を穏当な語に置き換えること
 * （background.ts の handleGenerateMessage がプロンプト組み立ての最後に適用する）。
 *
 * 2026-08-01 実APIで全28語を検証した結果、デフォルト値は空になった。
 * - 条件: 本番と同じ DEFAULT_PROMPT・safetySettings(4カテゴリ BLOCK_NONE)、置換未適用
 * - 各語を相手プロフィールの自然な位置に埋め、gemini-2.5-flash / gemini-3.5-flash で
 *   8回ずつ（28語×16回=448試行）実行 → ブロック 0件、文中拒否 0件、対照群も 0/16
 * - 陽性対照（safetySettings で無効化できない領域）は gemini-3.5-flash で 8/8 が
 *   PROHIBITED_CONTENT としてブロックされ、判定ロジックが機能することは確認済み
 * 検証ハーネス: evals/verify-replacement-rules.ts
 *
 * つまり従来の28語は安全フィルタ回避としては効いておらず、相手の文言を歪めて
 * 生成品質を下げるだけだったため削除した。
 * 出力の語調をやわらげる目的（例: 露骨な俗語が本文に生で出るのを防ぐ）で
 * ルールが必要な場合は、ユーザーが設定画面から追加できる。
 */
export const replacementRules: { from: string; to: string }[] = []
