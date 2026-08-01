/**
 * 口調プリセットの判断ロジック（純粋関数）
 *
 * 設定画面・content・background から使う判断をここに集約する。
 * chrome API に触れないためユニットテストできる。
 */
import { TONE_BLOCK_TEMPLATE } from "../constants"
import { resolveCachedPartner } from "./partner"
import { getThreadIdFromUrl, getUserIdFromUrl } from "./url"

/** 「口調を指定しない」を表す ID。既定値でもある。 */
export const NO_TONE = "none"

/** 相手ごとの記憶の上限。超えたら updatedAt の古い順に捨てる。 */
const MAX_PARTNER_TONES = 300

/** プロンプト内で口調ブロックの位置を指定するプレースホルダ */
const TONE_PLACEHOLDER = "{tone_instruction}"

export interface TonePreset {
    id: string
    label: string
    instruction: string
}

export interface PartnerToneEntry {
    toneId: string
    updatedAt: string
}

export type PartnerTones = Record<string, PartnerToneEntry>

/**
 * 相手ごとの記憶に使うキーを決める。
 *
 * URL から決まるものを優先する（URL のユーザーID > URL のスレッドID）。
 * どちらも取れないときだけキャッシュのユーザーIDを見る。
 * どれも取れなければ null（＝保存しない）。
 *
 * キャッシュより URL のスレッドIDを先に見るのは、キーをタイミングに依存させないため。
 * メッセージページでは `resolveCachedPartner` がページ読み込み直後は必ず null を返し
 * （スレッドIDの照合が通らない）、API キャッシュが届いた後は userId を返す。
 * キャッシュを先に見ると同じ相手が `t:` と `u:` の2つのキーに割れ、
 * 「さっき選んだ口調が忘れられている」ように見える（2026-08-02 のレビューで判明）。
 */
export function resolvePartnerToneKey(url: string, cachedPartnerJson: string | null): string | null {
    const urlUserId = getUserIdFromUrl(url)
    if (urlUserId) return `u:${urlUserId}`

    const threadId = getThreadIdFromUrl(url)
    if (threadId) return `t:${threadId}`

    const cached = resolveCachedPartner(cachedPartnerJson, url)
    if (cached?.userId) return `u:${cached.userId}`

    return null
}

/** メニューに出す口調。指示文が空の枠は選べない（選んでも効果が無いため）。 */
export function selectableTones(presets: TonePreset[]): TonePreset[] {
    return presets.filter((t) => t.instruction.trim().length > 0)
}

/** ID から指示文を引く。指定なし・未知のID・空の指示文はすべて null。 */
export function resolveToneInstruction(
    toneId: string | null | undefined,
    presets: TonePreset[]
): string | null {
    if (!toneId || toneId === NO_TONE) return null
    const found = presets.find((t) => t.id === toneId)
    const instruction = found?.instruction.trim()
    return instruction ? instruction : null
}

/** 相手ごとの口調を記録する。キーが無ければ何もしない。上限を超えたら古い順に捨てる。 */
export function rememberPartnerTone(
    tones: PartnerTones,
    key: string | null,
    toneId: string,
    now: string
): PartnerTones {
    if (!key) return tones

    const next: PartnerTones = { ...tones, [key]: { toneId, updatedAt: now } }
    const keys = Object.keys(next)
    if (keys.length <= MAX_PARTNER_TONES) return next

    // 古い順に並べ、上限を超えた分を落とす
    const sorted = keys.sort((a, b) => next[a].updatedAt.localeCompare(next[b].updatedAt))
    for (const k of sorted.slice(0, keys.length - MAX_PARTNER_TONES)) delete next[k]
    return next
}

/** 相手に記憶があればそれを、無ければ既定の口調を返す。 */
export function lookupPartnerTone(
    tones: PartnerTones,
    key: string | null,
    defaultToneId: string
): string {
    if (!key) return defaultToneId
    return tones[key]?.toneId ?? defaultToneId
}

export function buildToneBlock(instruction: string): string {
    return TONE_BLOCK_TEMPLATE.replace("{tone_instruction_body}", instruction)
}

/**
 * プロンプトに口調ブロックを差し込む。
 * プレースホルダがあればその位置、無ければ末尾。指示文が無ければブロックを足さず、
 * プレースホルダだけ取り除く（テンプレートに書いたまま残さないため）。
 */
export function injectToneBlock(prompt: string, instruction: string | null): string {
    if (!instruction) {
        return prompt.includes(TONE_PLACEHOLDER)
            ? prompt.split(TONE_PLACEHOLDER).join("").trimEnd()
            : prompt
    }
    const block = buildToneBlock(instruction)
    return prompt.includes(TONE_PLACEHOLDER)
        ? prompt.split(TONE_PLACEHOLDER).join(block)
        : `${prompt}\n\n${block}`
}
