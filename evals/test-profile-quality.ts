/**
 * プロフィール生成の実LLM評価ハーネス
 *
 * 本番と同じ buildProfilePrompt / 400字リトライ / 嗜好保全リトライ /
 * safetySettings(BLOCK_NONE) を使い、実プロフィール+合成プロフィールで
 * 4欄×3テイストを生成して自動チェック+LLM審査を行う。
 *
 * 前提: ~/.gemini_api_key にAPIキー（このファイルはコミットしない）
 * 実プロフィール(me.json)があれば使い、無ければ合成プロフィールのみで実行。
 *
 * 実行: リポジトリルートから実行すること（出力先パスがルート相対のため）
 *   pnpm exec esbuild evals/test-profile-quality.ts --bundle --packages=external \
 *     --platform=node --format=esm --outfile=test-results/profile-eval/eval.bundle.mjs
 *   node test-results/profile-eval/eval.bundle.mjs
 * モデル変更: EVAL_MODEL=gemini-2.5-flash node test-results/profile-eval/eval.bundle.mjs
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateText } from "ai"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"

import { replacementRules } from "../assets/replacement_rules"
import { PROFILE_TASTES } from "../profile-prompts"
import {
    buildProfilePrompt,
    checkKinkPreservation,
    enforceLength,
    resolveAudience,
    type ProfileFieldType,
    type TasteId
} from "../utils/profile-field"

const OUT_DIR = "test-results/profile-eval"
mkdirSync(OUT_DIR, { recursive: true })

const apiKey = readFileSync(process.env.HOME + "/.gemini_api_key", "utf8").trim()
const google = createGoogleGenerativeAI({ apiKey })
const MODEL = process.env.EVAL_MODEL || "gemini-3.5-flash"

const log = (...a: any[]) => console.log("[eval]", ...a)

// ---- 本番 generateWithGemini と同じ設定で1回生成 ----
async function callGemini(prompt: string): Promise<string> {
    let retries = 0
    while (true) {
        try {
            const { text } = await generateText({
                model: google(MODEL),
                prompt,
                providerOptions: {
                    google: {
                        safetySettings: [
                            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                        ]
                    } as any
                }
            })
            return text || ""
        } catch (e: any) {
            const msg = e?.message || String(e)
            if (/429|quota|RESOURCE_EXHAUSTED|503|Overloaded/i.test(msg) && retries < 4) {
                retries++
                const wait = Math.pow(2, retries) * 2000
                log(`rate/overload -> wait ${wait}ms (${retries}/4)`)
                await new Promise((r) => setTimeout(r, wait))
                continue
            }
            throw e
        }
    }
}

// ---- 本番 handleGenerateProfile と同じパイプライン ----
interface GenResult {
    text: string
    warning?: string
    refused?: boolean
    retries: { length: number; kink: boolean }
}

async function generateProfile(
    fieldType: ProfileFieldType,
    taste: TasteId,
    currentText: string,
    myRaw: any
): Promise<GenResult> {
    const audience = resolveAudience(myRaw)
    const prompt = buildProfilePrompt({ fieldType, taste, currentText, myRaw, audience })
    // 本番同様、プロフィール生成では置換ルールをプロンプトに適用しない（保全チェック照合のみ）
    const rules = replacementRules as { from: string; to: string }[]

    const CAP = 400
    const candidates: string[] = []
    let refused = false
    try {
        candidates.push(await callGemini(prompt))
    } catch (e: any) {
        return { text: "", refused: true, retries: { length: 0, kink: false } }
    }

    let lengthRetries = 0
    while (candidates[candidates.length - 1].length > CAP && lengthRetries < 2) {
        lengthRetries++
        const len = candidates[candidates.length - 1].length
        const retryPrompt = `${prompt}\n\n【再生成指示】前回の出力は${len}文字で上限400を超えています。優先度の低い内容（推奨事項に相当する部分）から削り、400字以内に収めてください。`
        candidates.push(await callGemini(retryPrompt))
    }

    let text = enforceLength(candidates, CAP)
    let kinkRetried = false
    let kinkWarning: string | undefined
    const preservationMode = audience === "men" ? ("strict" as const) : ("lenient" as const)
    if (fieldType === "kink") {
        const check = checkKinkPreservation(currentText || "", text, rules, preservationMode)
        if (!check.ok) {
            kinkRetried = true
            const retryPrompt = `${prompt}\n\n【再生成指示】元の文にある嗜好（${check.missing.join("、")}）が出力から欠落しています。これらを（穏当な言い換えでもよいので）保持したまま書き直してください。400字以内厳守。`
            const next = await callGemini(retryPrompt)
            const recheck = checkKinkPreservation(currentText || "", next, rules, preservationMode)
            if (recheck.ok && next.length <= CAP) {
                text = next
            } else {
                kinkWarning = `保全失敗: ${check.missing.join("、")}`
            }
        }
    }
    const warning = text.length > CAP ? `400字超過(${text.length})` : kinkWarning
    return { text, warning, refused, retries: { length: lengthRetries, kink: kinkRetried } }
}

// ---- 被験者 ----
// 実プロフィールは任意（ローカル調査データがある場合のみ）
const ME_PATH = "test-results/profile-research/out/me.json"
let realMe: any = null
if (existsSync(ME_PATH)) {
    const meJson = JSON.parse(readFileSync(ME_PATH, "utf8"))
    realMe = meJson.user
    // 本番のキャッシュ経路（content.tsx / getMyProfileRaw）と同じ area_text 補完
    if (meJson.area_list && realMe.area && !realMe.area_text) {
        realMe.area_text = meJson.area_list[String(realMe.area)]
    }
}

const SUBJECTS: {
    id: string
    label: string
    myRaw: any
    fields: { fieldType: ProfileFieldType; currentText: string }[]
}[] = [
    ...(realMe
        ? [{
            id: "real",
            label: "実プロフィール（男性・読者=女性）",
            myRaw: realMe,
            fields: [
                { fieldType: "intro" as const, currentText: realMe.profile || "" },
                { fieldType: "kink" as const, currentText: realMe.text_my_like || "" },
                { fieldType: "conditions" as const, currentText: realMe.conditions_text || "" },
                { fieldType: "ng" as const, currentText: realMe.text_my_ng || "" }
            ]
        }]
        : []),
    {
        id: "weak-male",
        label: "合成: 弱い男性プロフィール（平均的な短文層）",
        myRaw: {
            sex: 2,
            conditions_sex: "1",
            age: "40代前半",
            area: 13,
            relationship_text: "SMパートナー",
            my_type: "A",
            q_sex: 4, q_pain: 2, q_dom: 5, q_restraint: 4, q_shame: 3, q_pleasure: 4, q_reliance: 2,
            profile: "よろしくお願いします。",
            text_my_like: "・言葉責め\n・スパンキング\n・首絞め",
            conditions_text: "",
            text_my_ng: ""
        },
        fields: [
            { fieldType: "intro", currentText: "よろしくお願いします。" },
            { fieldType: "kink", currentText: "・言葉責め\n・スパンキング\n・首絞め" },
            { fieldType: "conditions", currentText: "" }
        ]
    },
    {
        id: "female-sub",
        label: "合成: サブ女性プロフィール（読者=男性）",
        myRaw: {
            sex: 1,
            conditions_sex: "2",
            age: "20代後半",
            relationship_text: "恋愛相手,SMパートナー",
            my_type: "K",
            q_sex: 3, q_pain: 3, q_dom: 1, q_restraint: 4, q_shame: 4, q_pleasure: 4, q_reliance: 4,
            profile:
                "最近サブかもしれないと気づきました。日常は普通の会社員です。読書とカフェ巡りが好き。優しくリードしてくれる方がいたら嬉しいです。信頼できるまでは時間をかけたいタイプです。",
            text_my_like: "興味: 拘束、言葉責め、命令。未経験なので少しずつ教えてほしいです。",
            conditions_text: "優しい人。怖い人は苦手です。",
            text_my_ng: "痛いのは苦手。既婚者NG。"
        },
        fields: [
            { fieldType: "intro", currentText: "最近サブかもしれないと気づきました。日常は普通の会社員です。読書とカフェ巡りが好き。優しくリードしてくれる方がいたら嬉しいです。信頼できるまでは時間をかけたいタイプです。" },
            { fieldType: "conditions", currentText: "優しい人。怖い人は苦手です。" }
        ]
    }
]

// ---- 自動チェック ----
interface Check { name: string; pass: boolean; note?: string }
function runChecks(
    fieldType: ProfileFieldType,
    currentText: string,
    out: GenResult,
    audience: "women" | "men"
): Check[] {
    const t = out.text
    const checks: Check[] = []
    checks.push({ name: "生成成功", pass: !out.refused && t.length > 0 })
    checks.push({ name: "400字以内", pass: t.length <= 400, note: `${t.length}字` })
    checks.push({
        name: "連絡先なし",
        // 「NGライン」等の一般語を誤検知しないよう、連絡手段の文脈に限定
        pass: !/\bLINE\b|ＬＩＮＥ|ライン(交換|のID|で連絡|教え)|カカオ|テレグラム|メアド|メールアドレス|DM|@[a-zA-Z0-9_]{3,}/i.test(t)
    })
    checks.push({ name: "ロマンチック定型句なし", pass: !/運命|特別な存在|あなただけ/.test(t) })
    checks.push({ name: "卑屈定型句なし", pass: !/僕なんかで|私なんかで/.test(t) })
    checks.push({ name: "欄ラベル混入なし", pass: !/^【|^#/.test(t.trim()) })
    checks.push({ name: "Markdown記法なし", pass: !/\*\*|^#|\n#|^\* |\n\* |^- |\n- /.test(t) })
    checks.push({ name: "前置き混入なし", pass: !/^(はい、|以下|改善案|承知)/.test(t.trim()) })
    if (fieldType === "kink" && currentText) {
        const mode = audience === "men" ? ("strict" as const) : ("lenient" as const)
        const c = checkKinkPreservation(currentText, t, replacementRules as any, mode)
        checks.push({ name: `嗜好語保全(${mode})`, pass: c.ok, note: c.missing.join("、") || undefined })
    }
    if (fieldType === "ng") {
        checks.push({ name: "全面受容なし", pass: !/NG(は)?ありません|何でもできます/.test(t) })
    }
    if ((currentText || "").trim().length < 30) {
        // 空欄フォールバック時: プレースホルダの形式确认（存在は任意、形式が正しいか）
        checks.push({
            name: "捏造疑いの具体名詞なし(目視要)",
            pass: true,
            note: /〔要記入/.test(t) ? "プレースホルダあり" : "プレースホルダなし(目視確認)"
        })
    }
    return checks
}

// ---- LLM審査（テイスト間の書き分け + 捏造検査）----
async function judge(
    subjectLabel: string,
    fieldType: ProfileFieldType,
    sourceData: string,
    currentText: string,
    outputs: { taste: TasteId; text: string }[]
): Promise<any> {
    const prompt = `あなたは生成文章の監査担当です。マッチングサイトのプロフィール改善AIの出力3案を検査してください。

# 元データ（この範囲の事実のみ使用可。安全配慮・すり合わせ意思などの「姿勢の言語化」の追加は許容）
${sourceData}

# 対象欄の元の本文
${currentText || "（空欄）"}

# 出力3案
${outputs.map((o) => `## 案${o.taste}\n${o.text}`).join("\n\n")}

# 検査項目（JSONのみで回答）
{
  "distinct": <3案が構造・語り口で明確に区別できるか true/false>,
  "distinct_note": "<一言>",
  "fabrications": [{"taste": "<solid|story|light>", "claim": "<元データにない事実の記述>"}],
  "consent_issues": [{"taste": "...", "quote": "<同意軽視・危険と読める表現>"}],
  "quality_note": "<日本語の自然さ・AIっぽさについて一言>"
}
姿勢の言語化（NGは事前確認します・まずはお話から等）と、元データの言い換えは捏造に含めないこと。JSON以外を出力しない。`
    const raw = await callGemini(prompt)
    try {
        const m = raw.match(/\{[\s\S]*\}/)
        return m ? JSON.parse(m[0]) : { parse_error: raw.slice(0, 200) }
    } catch {
        return { parse_error: raw.slice(0, 200) }
    }
}

// ---- メイン ----
import { extractProfileFromJSON } from "../utils/profile"

const results: any[] = []
for (const subject of SUBJECTS) {
    const sourceData = extractProfileFromJSON(subject.myRaw) || "（なし）"
    for (const field of subject.fields) {
        const outputs: { taste: TasteId; result: GenResult }[] = []
        for (const taste of PROFILE_TASTES) {
            log(`gen: ${subject.id}/${field.fieldType}/${taste.id}`)
            const r = await generateProfile(field.fieldType, taste.id, field.currentText, subject.myRaw)
            outputs.push({ taste: taste.id, result: r })
            await new Promise((r2) => setTimeout(r2, 1500))
        }
        log(`judge: ${subject.id}/${field.fieldType}`)
        const j = await judge(
            subject.label,
            field.fieldType,
            sourceData,
            field.currentText,
            outputs.map((o) => ({ taste: o.taste, text: o.result.text }))
        )
        await new Promise((r2) => setTimeout(r2, 1500))
        results.push({
            subject: subject.id,
            subjectLabel: subject.label,
            fieldType: field.fieldType,
            currentText: field.currentText,
            outputs: outputs.map((o) => ({
                taste: o.taste,
                text: o.result.text,
                warning: o.result.warning,
                retries: o.result.retries,
                checks: runChecks(field.fieldType, field.currentText, o.result, resolveAudience(subject.myRaw))
            })),
            judge: j
        })
        writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2))
    }
}

// ---- レポート生成 ----
let md = `# プロフィール生成 実LLM評価レポート (${MODEL})\n\n`
let totalChecks = 0
let failedChecks = 0
const failures: string[] = []
for (const r of results) {
    for (const o of r.outputs) {
        for (const c of o.checks) {
            totalChecks++
            if (!c.pass) {
                failedChecks++
                failures.push(`- ${r.subject}/${r.fieldType}/${o.taste}: **${c.name}** ${c.note || ""}`)
            }
        }
    }
    if (r.judge?.distinct === false) failures.push(`- ${r.subject}/${r.fieldType}: **書き分け不明瞭** ${r.judge.distinct_note || ""}`)
    for (const f of r.judge?.fabrications || []) failures.push(`- ${r.subject}/${r.fieldType}/${f.taste}: **捏造疑い** ${f.claim}`)
    for (const ci of r.judge?.consent_issues || []) failures.push(`- ${r.subject}/${r.fieldType}/${ci.taste}: **同意表現の懸念** ${ci.quote}`)
}
md += `## サマリ\n- 自動チェック: ${totalChecks - failedChecks}/${totalChecks} pass\n- 指摘事項:\n${failures.length ? failures.join("\n") : "なし"}\n\n---\n\n`
for (const r of results) {
    md += `## ${r.subjectLabel} / ${r.fieldType}\n\n元の本文(${(r.currentText || "").length}字): ${r.currentText ? r.currentText.slice(0, 100) + (r.currentText.length > 100 ? "…" : "") : "（空欄）"}\n\n`
    md += `審査: distinct=${r.judge?.distinct} ${r.judge?.distinct_note || ""} / 品質: ${r.judge?.quality_note || "-"}\n\n`
    for (const o of r.outputs) {
        const failed = o.checks.filter((c: Check) => !c.pass).map((c: Check) => c.name)
        md += `### ${o.taste} (${o.text.length}字${o.warning ? ` / ⚠${o.warning}` : ""}${failed.length ? ` / ❌${failed.join(",")}` : " / ✅"})\n\n\`\`\`\n${o.text}\n\`\`\`\n\n`
    }
    md += "---\n\n"
}
writeFileSync(`${OUT_DIR}/report.md`, md)
log(`DONE: checks ${totalChecks - failedChecks}/${totalChecks} pass, failures ${failures.length}`)
log(`report: ${OUT_DIR}/report.md`)
