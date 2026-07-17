import { formatKinkSection } from "./kink-analysis"

/**
 * LunaのユーザーJSONからプロフィールテキストを抽出する
 *
 * @param u APIから取得したユーザーオブジェクト
 * @param rawResponse APIレスポンス全体（age_list, area_list等のルックアップテーブル用）
 * @returns 抽出されたテキスト
 */
export function extractProfileFromJSON(u: any, rawResponse?: any): string {
    if (!u) return ""

    // ネストされたユーザーオブジェクトがあれば取り出す。
    // ただし `profile` は自己紹介文（文字列）のフィールド名でもあるため、
    // ネスト用のラッパーとして扱ってよいのは「オブジェクトの場合」だけ。
    // ここで文字列の自己紹介を data に採用してしまうと、name/age 等を含む
    // 本来のユーザーオブジェクトが失われ、抽出結果が自己紹介文だけに退化する。
    const asObject = (v: any) =>
        v && typeof v === "object" && !Array.isArray(v) ? v : null
    const data = asObject(u.user) || asObject(u.profile) || asObject(u.member) || u

    // Lookup tables from the raw API response
    const ageList = rawResponse?.age_list
    const areaList = rawResponse?.area_list
    const sexList = rawResponse?.sex_list

    let text = ""
    if (data.name || data.nickname) text += `名前: ${data.name || data.nickname}\n`
    if (data.age) {
        const age = Number(data.age)
        if (age >= 18 && age <= 99) {
            text += `年齢: ${age}歳\n`
        } else {
            const ageDisplay = ageList?.[String(data.age)]
            text += `年齢: ${ageDisplay || "非公開"}\n`
        }
    }
    if (data.sex) {
        const sexDisplay = sexList?.[String(data.sex)]
        if (sexDisplay) text += `性別: ${sexDisplay}\n`
    }
    if (data.area) {
        const areaDisplay = areaList?.[String(data.area)]
        if (areaDisplay) text += `居住地: ${areaDisplay}\n`
    }
    if (data.relationship_text || data.relationship) text += `目的: ${data.relationship_text || data.relationship}\n`
    if (data.work_text || data.work) text += `職業: ${data.work_text || data.work}\n`

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

    // 嗜好分析（全q_*フィールド + my_typeの象限分類）
    const kinkSection = formatKinkSection(data)
    if (kinkSection) {
        text += kinkSection
    }

    const result = text.trim()
    if (!result && Object.keys(data).length > 0) {
        // 何も抽出できなかったがデータがある場合は、主要なキーを除外してダンプする
        return JSON.stringify(data, null, 2)
    }

    return result
}

