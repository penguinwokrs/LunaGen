/**
 * LunaのユーザーJSONからプロフィールテキストを抽出する
 * 
 * @param u APIから取得したユーザーオブジェクト
 * @returns 抽出されたテキスト
 */
export function extractProfileFromJSON(u: any): string {
    if (!u) return ""

    // Handle nested data if it exists
    const data = u.user || u.profile || u.member || u

    let text = ""
    if (data.name || data.nickname) text += `名前: ${data.name || data.nickname}\n`
    if (data.age) text += `年齢: ${data.age}\n`
    if (data.relationship_text || data.relationship) text += `目的: ${data.relationship_text || data.relationship}\n`
    if (data.work_text || data.work) text += `職業: ${data.work_text || data.work}\n`
    if (data.residence_text || data.residence) text += `居住地: ${data.residence_text || data.residence}\n`

    // 自己紹介 (複数のプロパティ名をサポート)
    const intro = data.profile || data.introduction || data.intro || data.body
    if (intro) text += `\n【自己紹介】\n${intro}\n`

    // 嗜好・プレイスタイル
    const prefs = data.text_my_like || data.preference || data.preferences || data.style || data.play_style
    if (prefs) {
        text += `\n【嗜好・プレイスタイル】\n${typeof prefs === "string" ? prefs : JSON.stringify(prefs, null, 2)}\n`
    }

    // 求める条件
    const reqs = data.conditions_text || data.requirement || data.requirements || data.condition || data.target_condition
    if (reqs) {
        text += `\n【求める条件】\n${typeof reqs === "string" ? reqs : JSON.stringify(reqs, null, 2)}\n`
    }

    // NG
    const ng = data.text_my_ng || data.ng || data.not_good || data.dislike || data.bad_point
    if (ng) {
        text += `\n【NGなこと・拒否】\n${typeof ng === "string" ? ng : JSON.stringify(ng, null, 2)}\n`
    }

    // 数値データのマッピング (例: 支配欲)
    if (data.q_dom !== undefined) {
        const domMap: any = { 1: "なし", 2: "微弱", 3: "中", 4: "強", 5: "最強" }
        text += `\n支配欲(Dom): ${domMap[data.q_dom] || data.q_dom}`
    }
    if (data.q_sub !== undefined) {
        const subMap: any = { 1: "なし", 2: "微弱", 3: "中", 4: "強", 5: "最強" }
        text += `\n被支配欲(Sub): ${subMap[data.q_sub] || data.q_sub}`
    }

    const result = text.trim()
    if (!result && Object.keys(data).length > 0) {
        // 何も抽出できなかったがデータがある場合は、主要なキーを除外してダンプする
        return JSON.stringify(data, null, 2)
    }

    return result
}

