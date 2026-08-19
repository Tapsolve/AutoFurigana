// Control: mainichi.jp homepage scroll WITHOUT the extension.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 390, height: 844 },
    locale: "ja-JP",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
});
const page = await context.newPage();
try {
    await page.goto("https://mainichi.jp/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.log("goto:", e.message));
    await page.waitForTimeout(5000);
    const probe = () => page.evaluate(() => ({
        y: (document.scrollingElement || document.documentElement).scrollTop,
        h: (document.scrollingElement || document.documentElement).scrollHeight,
        li: document.querySelectorAll("li").length,
        links: document.querySelectorAll('a[href*="/articles/"]').length,
        h3: document.querySelectorAll("h3").length,
        moreBtn: !!document.querySelector(".link-more"),
        morelist: !!document.getElementById("morelist")
    }));
    console.log("BEFORE (no ext):", JSON.stringify(await probe(), null, 2));
    for (let i = 0; i < 30; i++) {
        await page.evaluate(() => { const t = document.scrollingElement || document.documentElement; t.scrollTop = Math.min(t.scrollHeight, t.scrollTop + 1500); });
        await page.waitForTimeout(600);
    }
    await page.waitForTimeout(5000);
    console.log("AFTER  (no ext):", JSON.stringify(await probe(), null, 2));
} finally {
    await context.close();
}
process.exit(0);