/**
 * LunaのユーザーJSONからプロフィールテキストを抽出する
 * 
 * @param u APIから取得したユーザーオブジェクト
 * @returns 抽出されたテキスト
 */
export function extractProfileFromJSON(u: any): string {
    if (!u) return ""

    let text = ""
    if (u.name) text += `名前: ${u.name}\n`
    if (u.age) text += `年齢: ${u.age}\n`
    if (u.relationship_text) text += `目的: ${u.relationship_text}\n`

    // 自己紹介 (複数のプロパティ名をサポート)
    const intro = u.profile || u.introduction
    if (intro) text += `\n【自己紹介】\n${intro}\n`

    // 嗜好・プレイスタイル
    const prefs = u.text_my_like || u.preference || u.preferences || u.style
    if (prefs) {
        text += `\n【嗜好・プレイスタイル】\n${typeof prefs === "string" ? prefs : JSON.stringify(prefs, null, 2)}\n`
    }

    // 求める条件
    const reqs = u.conditions_text || u.requirement || u.requirements || u.condition
    if (reqs) {
        text += `\n【求める条件】\n${typeof reqs === "string" ? reqs : JSON.stringify(reqs, null, 2)}\n`
    }

    // NG
    const ng = u.text_my_ng || u.ng || u.not_good || u.dislike
    if (ng) {
        text += `\n【NGなこと・拒否】\n${typeof ng === "string" ? ng : JSON.stringify(ng, null, 2)}\n`
    }

    // 数値データのマッピング (例: 支配欲)
    if (u.q_dom !== undefined) {
        const domMap: any = { 1: "なし", 2: "微弱", 3: "中", 4: "強", 5: "最強" }
        text += `\n支配欲(Dom): ${domMap[u.q_dom] || u.q_dom}`
    }

    return text.trim() || JSON.stringify(u, null, 2)
}

