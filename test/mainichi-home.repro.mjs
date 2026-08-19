// Mainichi.jp homepage: scroll-triggered article loading with the extension loaded.
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
    await page.waitForTimeout(6000);

    const probe = () => page.evaluate(() => {
        const count = () => document.querySelectorAll('ruby[data-local-furigana="1"]').length;
        const h3 = [...document.querySelectorAll("h3")];
        const h3NoRuby = h3.filter((x) => !x.querySelector("ruby"));
        const articleLinks = document.querySelectorAll('a[href*="/articles/"]').length;
        const liTotal = document.querySelectorAll("li").length;
        return {
            ruby: count(),
            h3: h3.length,
            h3NoRuby: h3NoRuby.length,
            h3NoRubySample: h3NoRuby.slice(0, 5).map((x) => x.textContent.trim().slice(0, 30)),
            hasMorelist: !!document.getElementById("morelist"),
            morelistChildren: document.getElementById("morelist") ? document.getElementById("morelist").childElementCount : -1,
            articleLinks,
            liTotal,
            scrollY: window.scrollY,
            docHeight: document.documentElement.scrollHeight,
            bodyLen: document.body.innerHTML.length
        };
    });

    const before = await probe();
    const scroller = await page.evaluate(() => {
        const docOverflow = getComputedStyle(document.documentElement).overflowY;
        const htmlScroll = document.scrollingElement;
        const candidates = [...document.querySelectorAll("html, body, main, #main, .l-wrapper, .main-contents, [class*=main]")];
        const scrollables = candidates
            .filter((el) => el.scrollHeight > el.clientHeight + 50)
            .map((el) => ({ tag: el.tagName, id: el.id, cls: (el.className.baseVal !== undefined ? el.className.baseVal : el.className).toString().slice(0, 50), overflowY: getComputedStyle(el).overflowY, sh: el.scrollHeight, ch: el.clientHeight }));
        return { docOverflow, htmlScrollTag: htmlScroll ? htmlScroll.tagName : null, scrollables: scrollables.slice(0, 8) };
    });
    console.log("SCROLLER INFO:", JSON.stringify(scroller, null, 2));
    console.log("BEFORE SCROLL:", JSON.stringify(before, null, 2));

    // Scroll whatever container actually scrolls.
    await page.evaluate(() => {
        const html = document.scrollingElement;
        const doc = document.documentElement;
        let target = null;
        const candidates = [...document.querySelectorAll("html, body, main, #main, .main-contents, [class*=main]")];
        for (const el of candidates) {
            if (el.scrollHeight > el.clientHeight + 50) { target = el; break; }
            if (target) break;
        }
        const t = target || html || doc;
        const step = () => { t.scrollTop += 2500; };
        window.__scrollStep = step;
    });
    for (let i = 0; i < 14; i++) {
        await page.evaluate(() => { const t = document.scrollingElement || document.documentElement; t.scrollTop += 3000; });
        await page.waitForTimeout(700);
    }
    await page.waitForTimeout(5000);

    const after = await probe();
    console.log("\nAFTER SCROLL:", JSON.stringify(after, null, 2));

    console.log("\nSUMMARY: ruby before:", before.ruby, "after:", after.ruby, "| h3 before:", before.h3, "after:", after.h3, "| h3 without ruby after:", after.h3NoRuby, "| article links before/after:", before.articleLinks, after.articleLinks, "| li before/after:", before.liTotal, after.liTotal);
} finally {
    await context.close();
}
process.exit(0);