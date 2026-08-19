// Loads mainichi.jp with the extension and reproduces the scroll/より見る bug.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME_EXT = path.join(ROOT, "dist", "chrome");

const messages = [];
const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
    args: [`--disable-extensions-except=${CHROME_EXT}`, `--load-extension=${CHROME_EXT}`]
});
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") messages.push("[err] " + m.text()); });
page.on("pageerror", (e) => messages.push("[pageerror] " + e.message));

try {
    await page.goto("https://mainichi.jp/flash/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    let info = await page.evaluate(() => {
        return {
            rubyCount: document.querySelectorAll('ruby[data-local-furigana="1"]').length,
            h3Count: document.querySelectorAll("h3").length,
            rubyTitles: [...document.querySelectorAll('ruby[data-local-furigana="1"]')].slice(0, 3).map((r) => r.textContent),
            moreBtn: !!document.querySelector(".link-more"),
            morelist: !!document.getElementById("morelist"),
            bodyLen: document.body.innerHTML.length
        };
    });
    console.log("AFTER LOAD:", JSON.stringify(info, null, 2));

    // Click "もっと見る" if present.
    if (info.moreBtn) {
        await page.click(".link-more", { timeout: 5000 }).catch(() => console.log("  click failed"));
        await page.waitForTimeout(4000);
    } else {
        console.log("  no .link-more; will scroll to bottom instead");
        await page.mouse.wheel(0, 40000);
        await page.waitForTimeout(3000);
        await page.mouse.wheel(0, 40000);
        await page.waitForTimeout(4000);
    }

    info = await page.evaluate(() => {
        const rubies = document.querySelectorAll('ruby[data-local-furigana="1"]');
        // Find headlines list items and whether each has ruby
        const items = [...document.querySelectorAll("ul.articlelist li, ul.listtype li, .js-morelist li, li")].filter((li) => li.querySelector("h3") || li.querySelector("a"));
        return {
            rubyCount: rubies.length,
            moreBtnAfter: !!document.querySelector(".link-more"),
            h3total: document.querySelectorAll("h3").length,
            liUnannotated: items.filter((li) => li.querySelector("h3") && !li.querySelector("h3 ruby")).length,
            sample: [...document.querySelectorAll("h3")].slice(-5).map((h) => h.textContent.trim().slice(0, 40)),
            sampleRuby: [...document.querySelectorAll("h3")].slice(-5).map((h) => (h.innerHTML.includes("ruby") ? "RUBY" : "PLAIN"))
        };
    });
    console.log("\nAFTER MORE:", JSON.stringify(info, null, 2));
} finally {
    await context.close();
}
if (messages.length) {
    console.log("\nconsole errors:");
    for (const m of messages.slice(0, 10)) console.log("  " + m);
}
process.exit(0);