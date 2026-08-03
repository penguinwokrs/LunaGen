/**
 * Cloudflare Workers AI のモデル特性から出力トークン上限を決める
 *
 * ## 経緯
 *
 * 2026-08-03、フォールバック出力の調査で `@cf/zai-org/glm-4.7-flash` が
 * 143字のメッセージ1本に completion 11,937 トークンを使っていた。
 * ほぼ全部が reasoning（思考過程）で、本文はそのうち数百トークンしかない。
 * 課金は Neuron 換算で 1回あたり約449 Neurons、無料枠 10,000/日 だと
 * 1日22回しか回らない。応答も数分かかる。
 *
 * かといって一律に小さい上限を付けると壊れる。実測で max_tokens=300 にすると
 * reasoning の途中で打ち切られ、**content が空文字**になった（finish=length）。
 * 思考型モデルには思考ぶんの余白が要る。
 *
 * そこで「思考型かどうか」でぶんけて上限を決める。
 */

/**
 * 思考過程を別途出力するモデルの名前パターン。
 *
 * 判定を誤るなら「思考型と見なす」側に倒す。思考型を通常扱いすると
 * 出力が空になるが、逆は上限が緩くなるだけで壊れない。
 */
const REASONING_MODEL_PATTERNS = [
    /glm/i,
    /qwen3/i,
    /gpt-oss/i,
    /kimi/i,
    /deepseek-r/i,
    /magistral/i,
    /nemotron/i,
    /\bthinking\b/i,
    /reason/i
]

/** 思考型モデルに与える思考ぶんの余白（トークン） */
export const REASONING_HEADROOM_TOKENS = 16000

export function isReasoningModel(model: string): boolean {
    if (!model) return false
    return REASONING_MODEL_PATTERNS.some((p) => p.test(model))
}

/**
 * 出力トークンの上限を決める。
 *
 * @param model モデル名
 * @param outputCharLimit 本文の文字数上限（初回200 / プレミアム500 / プロフィール400）
 */
export function cloudflareMaxOutputTokens(model: string, outputCharLimit: number): number {
    // 日本語は1文字あたり1〜2トークン。指示を無視して少し超過する分の余裕も足す
    const body = Math.max(600, Math.ceil(Math.max(0, outputCharLimit) * 2) + 400)
    return isReasoningModel(model) ? body + REASONING_HEADROOM_TOKENS : body
}
