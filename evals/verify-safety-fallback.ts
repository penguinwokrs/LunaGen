/**
 * 安全ブロック時のフォールバックを実機で検証する
 *
 * Gemini は BLOCK_NONE を指定しても、設定で無効化できない PROHIBITED_CONTENT で
 * 生成を拒むことがある。そのとき設定したフォールバック先へ切り替わるかを、
 * 実際にブロックされる相手のプロフィールで確認する。
 *
 * 実行: リポジトリルートから
 *   pnpm exec esbuild evals/verify-safety-fallback.ts --bundle --packages=external \
 *     --platform=node --format=esm --outfile=test-results/fb/verify.mjs
 *   CF_ACCT=<アカウントID> CF_TOKEN=<APIトークン> node test-results/fb/verify.mjs <相手のユーザーID>
 *
 * 前提: ~/.gemini_api_key / e2e/.profile が Luna にログイン済み / pnpm build 済み
 *
 * 【重要】相手のプロフィールは他人の個人情報。メモリ上でのみ扱い、保存もログ出力もしない。
 *
 * ## 落とし穴（実際に踏んだもの）
 *
 * 1. **毎回まっさらなプロファイルで拡張を起動する。** MV3 の service worker は
 *    プロファイルに常駐し、build を更新しても古いコードが動き続ける。
 *    これで「フォールバックが動かない」と誤診した。
 * 2. **本番と同じプロンプトを組み立てる。** 簡略化した材料を渡すとブロックが再現せず、
 *    検証にならない。content script と同じ buildMessagePrompt / extractProfileFromJSON を使う。
 * 3. **安全ブロックは揺れる。** 同じ入力でも通ることがあるので、none の側は複数回試して
 *    ブロックが起きることを確認してから、フォールバック側の判定を読む。
 */
import { chromium } from "@playwright/test"
import { readFileSync } from "node:fs"

import { formatCardsSection } from "../utils/cards"
import { generateDemandSupplyHint } from "../utils/demand-supply"
import { extractProfileFromJSON } from "../utils/profile"

const EXT = "build/chrome-mv3-prod"
const userId = process.argv[2]
const CF_ACCT = process.env.CF_ACCT
const CF_TOKEN = process.env.CF_TOKEN
const ATTEMPTS = Number(process.env.ATTEMPTS || 3)

if (!userId || !CF_ACCT || !CF_TOKEN) {
    console.error("使い方: CF_ACCT=... CF_TOKEN=... node <bundle> <相手のユーザーID>")
    process.exit(1)
}

async function fetchCase(id: string) {
    const ctx = await chromium.launchPersistentContext("e2e/.profile", { channel: "chromium", headless: true })
    const page = await ctx.newPage()
    const out: any = {}
    page.on("response", async (res) => {
        const u = res.url()
        if (!u.includes("luna-matching.com/api/")) return
        let j: any
        try { j = await res.json() } catch { return }
        if (u.includes(`/api/user/show/${id}`) || u.includes(`/api/user/service/show/${id}`)) {
            out.target = j.user ?? j
            out.targetRaw = j
        }
        if (u.includes("/api/user/get/me")) out.me = j.user ?? j
        if (u.includes(`/card/get/${id}`)) {
            const names = ((j?.user_card_list ?? j?.card_list)?.data || []).map((c: any) => c.name).filter(Boolean)
            if (u.includes("/your/")) out.ownCards = names
            if (u.includes("/common/")) out.commonCards = names
        }
    })
    await page.goto(`https://luna-matching.com/user/show/${id}`, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(4000)
    await ctx.close()
    return out
}

async function runCase(payload: any, fallbackProvider: string) {
    const ctx = await chromium.launchPersistentContext("", {
        channel: "chromium", headless: true,
        args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
    })
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 20000 }))
    const page = await ctx.newPage()
    await page.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1500)

    const out = await page.evaluate(async ([pl, fb]: [any, string]) => {
        // Plasmo の Storage は値を JSON 文字列で持つので seed 側も合わせる
        const ser = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, JSON.stringify(v)]))
        await chrome.storage.local.set(ser({
            aiProvider: "gemini",
            geminiModel: "gemini-3.5-flash",
            cloudflareAccountId: pl.acct,
            cloudflareModel: "@cf/zai-org/glm-4.7-flash",
            fallbackProvider: fb,
            isDebugEnabled: true
        }))
        await chrome.storage.sync.set(ser({ geminiApiKey: pl.gk, cloudflareApiToken: pl.tok }))
        await new Promise((r) => setTimeout(r, 400))

        const res: any = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: "generate_message",
                myProfile: pl.myProfile,
                targetProfile: pl.targetProfile,
                targetName: pl.targetName,
                demandSupplyHint: pl.hint
            }, resolve)
        })
        const raw = await chrome.storage.local.get("debugLogs")
        let arr: any = raw.debugLogs
        if (typeof arr === "string") { try { arr = JSON.parse(arr) } catch {} }
        const logs: string[] = (arr || []).map((l: any) => `${l.level}: ${l.message}`)
        return {
            ok: !res?.error,
            blocked: /PROHIBITED_CONTENT|安全フィルタ/.test(String(res?.error ?? "")),
            error: res?.error ? String(res.error).slice(0, 60) : null,
            length: res?.text ? res.text.length : 0,
            // 文字数だけ見ていたせいで「本文ではなく解析文が返っている」のを
            // 見落とした（2026-08-03）。生成物は必ず目で見て確認すること。
            text: res?.text ?? null,
            fallbackUsed: res?.fallbackUsed ?? null,
            fbLogs: logs.filter((t) => /Fallback|Falling back/i.test(t)).slice(0, 2).map((t) => t.slice(0, 90))
        }
    }, [payload, fallbackProvider] as [any, string])

    await ctx.close()
    return out
}

const c = await fetchCase(userId)
if (!c.target) {
    console.error("相手のプロフィールを取得できませんでした（ログイン切れの可能性）")
    process.exit(1)
}

// content script とまったく同じ材料を作る。簡略化するとブロックが再現しない
const payload = {
    gk: readFileSync(process.env.HOME + "/.gemini_api_key", "utf8").trim(),
    acct: CF_ACCT,
    tok: CF_TOKEN,
    targetName: c.target.name || "ゲスト",
    myProfile: extractProfileFromJSON(c.me),
    targetProfile: extractProfileFromJSON(c.target, c.targetRaw) + formatCardsSection(c.ownCards || []),
    hint: generateDemandSupplyHint(c.me, c.target, {}, c.commonCards || [])
}

console.log(
    `相手 ${userId}: 自己紹介 ${String(c.target.profile || "").length}字 / ` +
    `カード ${(c.ownCards || []).length}件 / 共通 ${(c.commonCards || []).length}件`
)
console.log(`プロフィール文 ${payload.targetProfile.length}字 / ヒント ${payload.hint.length}字\n`)

console.log(`=== fallbackProvider = none （ブロックが起きるかを ${ATTEMPTS} 回確認）===`)
let blockedCount = 0
for (let i = 1; i <= ATTEMPTS; i++) {
    const r = await runCase(payload, "none")
    if (r.blocked) blockedCount++
    console.log(`  ${i}回目: ${r.ok ? `生成OK (${r.length}字)` : r.blocked ? "★安全ブロック" : `エラー: ${r.error}`}`)
}
console.log(`  → ${blockedCount}/${ATTEMPTS} 回ブロック\n`)

if (blockedCount === 0) {
    console.log("この相手ではブロックが再現しなかったため、フォールバックの検証はできない。")
    console.log("別の相手で試すか、ATTEMPTS を増やすこと。")
    process.exit(0)
}

console.log(`=== fallbackProvider = cloudflare （${ATTEMPTS} 回）===`)
let fellBack = 0
for (let i = 1; i <= ATTEMPTS; i++) {
    const r = await runCase(payload, "cloudflare")
    if (r.fallbackUsed) fellBack++
    console.log(`  ${i}回目: ${r.ok ? `生成OK (${r.length}字)` : `エラー: ${r.error}`} / fallbackUsed=${r.fallbackUsed ?? "なし"}`)
    if (r.text) console.log(`      本文: ${r.text.replace(/\n/g, " ⏎ ")}`)
    r.fbLogs.forEach((l: string) => console.log(`      ${l}`))
}
console.log(`  → ${fellBack}/${ATTEMPTS} 回フォールバック\n`)
console.log("期待する挙動: none でブロックが起き、cloudflare 側では生成が通って fallbackUsed=cloudflare になる")
