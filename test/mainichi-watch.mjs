// Watch mainichi.jp homepage mutations during scroll to see what the site adds.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME_EXT = path.join(ROOT, "dist", "chrome");

const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
    args: [`--disable-extensions-except=${CHROME_EXT}`, `--load-extension=${CHROME_EXT}`]
});
const page = await context.newPage();

try {
    await page.goto("https://mainichi.jp/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.log("goto:", e.message));
    await page.waitForTimeout(5000);

    await page.evaluate(() => {
        window.__added = [];
        const obs = new MutationObserver((recs) => {
            for (const r of recs) {
                if (r.type !== "childList") continue;
                for (const n of r.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.closest('ruby[data-local-furigana="1"]')) continue;
                    const txt = (n.textContent || "").trim();
                    if (txt.length < 8) continue;
                    if (!/[\u4E00-\u9FFF]/.test(txt)) continue;
                    const head = n.querySelector ? (n.querySelector("h3, a[href*='/articles/']") ? 1 : 0) : 0;
                    window.__added.push({
                        t: Date.now(),
                        tag: n.tagName,
                        id: n.id || "",
                        cls: ((n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || "").toString().slice(0, 40),
                        head,
                        txt: txt.slice(0, 40),
                        hasRubyWithin: window.__hasRuby(n)
                    });
                }
            }
        });
        window.__hasRuby = (n) => {
            if (n.nodeType !== 1) return false;
            if (n.querySelector('ruby[data-local-furigana="1"]')) return true;
            return false;
        };
        obs.observe(document.body, { childList: true, subtree: true });
    });

    let prevY = -1;
    for (let i = 0; i < 30; i++) {
        await page.evaluate(() => {
            const t = document.scrollingElement || document.documentElement;
            t.scrollTop = Math.min(t.scrollHeight, t.scrollTop + 1500);
        });
        await page.waitForTimeout(600);
        if (i % 5 === 4) {
            const state = await page.evaluate(() => ({
                y: (document.scrollingElement || document.documentElement).scrollTop,
                h: (document.scrollingElement || document.documentElement).scrollHeight,
                addedCount: window.__added.length,
                li: document.querySelectorAll("li").length,
                articleLinks: document.querySelectorAll('a[href*="/articles/"]').length,
                h3: document.querySelectorAll("h3").length,
                ruby: document.querySelectorAll('ruby[data-local-furigana="1"]').length
            }));
            console.log(`step ${i}: y=${state.y} h=${state.h} li=${state.li} links=${state.articleLinks} h3=${state.h3} ruby=${state.ruby} added=${state.addedCount}`);
            if (state.y === prevY && state.y > 3000) break;
            prevY = state.y;
        }
    }

    const added = await page.evaluate(() => window.__added.slice(-25));
    console.log("\nLAST 25 ADDED NODES:");
    for (const a of added) console.log(JSON.stringify(a));
} finally {
    await context.close();
}
process.exit(0);