/**
 * 口調プリセットの storage 読み書き（content script 用）
 *
 * ToneSelector（表示・選択）と GenerateButton（生成時の解決）の両方から使う。
 * 生成に使う口調は「生成ボタンを押した時点」で読み直す必要がある。React state に
 * 持つと、SPA遷移で同じ textarea が使い回されたときに前の相手の口調で生成してしまう
 * （2026-08-02 のレビューで判明）。
 */
import { Storage } from "@plasmohq/storage"

import { DEFAULT_TONE_PRESETS } from "../../constants"
import {
    NO_TONE,
    lookupPartnerTone,
    rememberPartnerTone,
    resolvePartnerToneKey,
    type PartnerTones,
    type TonePreset
} from "../../utils/tone"

const storage = new Storage({ area: "local" })

/** 現在のページから相手キーを解決する */
export function currentPartnerKey(): string | null {
    return resolvePartnerToneKey(location.href, sessionStorage.getItem("luna_last_viewed_user"))
}

export async function readTonePresets(): Promise<TonePreset[]> {
    return (await storage.get<TonePreset[]>("tonePresets")) || (DEFAULT_TONE_PRESETS as TonePreset[])
}

/**
 * いま生成に使うべき口調IDを、storage から読み直して返す。
 * 相手に記憶があればそれ、無ければ設定画面の既定の口調。
 */
export async function readActiveToneId(): Promise<string> {
    const defaultToneId = (await storage.get<string>("defaultToneId")) || NO_TONE
    const tones = (await storage.get<PartnerTones>("partnerTones")) || {}
    return lookupPartnerTone(tones, currentPartnerKey(), defaultToneId)
}

/**
 * 相手ごとの口調を保存する。キーが取れない画面では保存しない
 * （その入力欄が生きている間だけ有効という扱いにする）。
 */
export async function writeActiveToneId(toneId: string): Promise<void> {
    const key = currentPartnerKey()
    if (!key) return
    const tones = (await storage.get<PartnerTones>("partnerTones")) || {}
    await storage.set("partnerTones", rememberPartnerTone(tones, key, toneId, new Date().toISOString()))
}
