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
 * @param stored 現在 storage に入っている値
 * @param legacy 直前のデフォルト（完全一致で「未編集」と判定する）
 * @param next 新しいデフォルト
 */
export function migratePrompt(
  stored: string | undefined | null,
  legacy: string,
  next: string
): string | null {
  if (stored === undefined || stored === null || stored === "") return next
  if (stored === legacy) return next
  return null
}
