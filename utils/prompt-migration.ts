/**
 * プロンプトテンプレートの移行判定
 *
 * 拡張を更新したとき、保存済みプロンプトが旧デフォルトのままの
 * ユーザー（＝一度も編集していない）だけを新デフォルトへ追従させる。
 * 自分で編集した人の内容は絶対に上書きしない。
 */

/**
 * 更新すべき値を返す。更新不要なら null。
 *
 * **未設定（undefined/null/空文字）のときは書き込まない。**
 * 生成時は `storage.get("promptTemplate") || DEFAULT_PROMPT` とフォールバックするので、
 * 一度も編集していないユーザーは何もしなくても常に最新のデフォルトを使う。
 * ここで書き込むと「常に最新」から「その時点の文面で固定」に変わってしまい、
 * 次にデフォルトを更新したとき legacy と一致せず「編集済み」と誤判定されて
 * 恒久的に取り残される（2026-08-02 のレビューで判明）。
 * Plasmo の Storage.get は JSON パース失敗時も undefined を返すため、
 * 「読めなかった」と「未設定」を区別できない。書き込まないことでその穴も塞ぐ。
 *
 * デフォルトは複数世代ありうる（V1, V2, …）。過去のどの版と一致しても移行する。
 * 直前の1世代しか見ないと、1つ前の版を保存済みのユーザーが「編集済み」と誤判定されて
 * 恒久的に取り残される。DEFAULT_PROMPT を更新するときは、必ず直前の文面を
 * LEGACY_..._V{n} として保存し、この配列に足すこと。
 *
 * @param stored 現在 storage に入っている値
 * @param legacies 過去のデフォルト（完全一致で「未編集」と判定する）
 * @param next 新しいデフォルト
 */
export function migratePrompt(
  stored: string | undefined | null,
  legacies: string[],
  next: string
): string | null {
  if (stored === undefined || stored === null || stored === "") return null
  if (legacies.includes(stored)) return next
  return null
}
