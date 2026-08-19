// Drive mainichi's own morelink.js loader on /flash/ and check annotation of inserted articles.
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
    await page.goto("https://mainichi.jp/flash/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.log("goto:", e.message));
    await page.waitForTimeout(6000);

    const probe = () => page.evaluate(() => {
        const items = [...document.querySelectorAll(".js-morelist li, #latestlist-wrap li, section.latestlist li, ul.latestlist li")];
        const allLis = [...document.querySelectorAll("li")];
        const h3 = [...document.querySelectorAll("h3")];
        const countRuby = () => document.querySelectorAll('ruby[data-local-furigana="1"]').length;
        return {
            ruby: countRuby(),
            morelist: document.querySelectorAll("#morelist li").length,
            visibleLis: allLis.length,
            h3: h3.length,
            h3NoRuby: h3.filter((x) => !x.querySelector("ruby")).length,
            moreBtnVisible: !!document.querySelector(".link-more") && getComputedStyle(document.querySelector(".link-more")).display !== "none",
            moreBtnAt: document.querySelector(".link-more") ? document.querySelector(".link-more").getBoundingClientRect().top : null
        };
    });

    const before = await probe();
    console.log("BEFORE:", JSON.stringify(before, null, 2));

    // Force-feed articles using the site's own mechanism: click via JS.
    const clicked = await page.evaluate(() => {
        const btn = document.querySelector(".link-more");
        if (!btn) return "no button";
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return "clicked";
    });
    console.log("click result:", clicked);
    await page.waitForTimeout(6000);

    const after = await probe();
    console.log("\nAFTER :", JSON.stringify(after, null, 2));
    console.log("\nSUMMARY ruby before/after:", before.ruby, after.ruby, "| visible li:", before.visibleLis, after.visibleLis, "| h3NoRuby:", before.h3NoRuby, after.h3NoRuby);

    // Check newest (last) articles specifically.
    const tail = await page.evaluate(() => {
        const h3s = [...document.querySelectorAll("h3")];
        return h3s.slice(-8).map((h) => ({ t: h.textContent.trim().slice(0, 26), ruby: h.innerHTML.includes("data-local-furigana") }));
    });
    console.log("tail h3:", JSON.stringify(tail, null, 2));
} finally {
    await context.close();
}
process.exit(0);