// Chromium smoke test. Firefox uses firefox-selenium-smoke.cjs because
// Playwright cannot reliably install a temporary WebExtension XPI.
//
// Usage: node test/browser-smoke.mjs

import http from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const CHROME_EXT = path.join(DIST, "chrome");

const HTML = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>Furigana test</title></head>
<body>
  <p id="static">今日は日本語を勉強します。東京へ行きます。</p>
  <div id="dynamic"></div>
  <div id="shadow-host"></div>
  <script>
    setTimeout(function () {
      document.getElementById("dynamic").textContent = "明日は大阪へ行く。";
    }, 800);
    setTimeout(function () {
      var root = document.getElementById("shadow-host").attachShadow({ mode: "open" });
      root.innerHTML = "<p>日本語の影</p>";
    }, 1200);
  </script>
</body></html>`;

function serve() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML);
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            resolve({ server, url: `http://127.0.0.1:${server.address().port}/test.html` });
        });
    });
}

async function probe(page, label) {
    await page.waitForTimeout(4500);
    const result = await page.evaluate(() => {
        const rubies = document.querySelectorAll('ruby[data-local-furigana="1"]');
        const staticText = document.getElementById("static");
        const dynamicText = document.getElementById("dynamic");
        const shadowRoot = document.getElementById("shadow-host").shadowRoot;
        return {
            rubyCount: rubies.length,
            staticHTML: staticText ? staticText.innerHTML.slice(0, 200) : null,
            dynamicHTML: dynamicText ? dynamicText.innerHTML.slice(0, 200) : null,
            bodyHTML: document.body.innerHTML.slice(0, 600),
            shadowHTML: shadowRoot ? shadowRoot.innerHTML : null
        };
    });
    result.label = label;
    return result;
}

async function runChromium() {
    console.log("== chromium ==");
    if (!existsSync(CHROME_EXT)) {
        console.log("  missing dist/chrome; run: npm run build:chrome");
        return null;
    }
    const context = await chromium.launchPersistentContext("", {
        channel: "chromium",
        headless: true,
        viewport: { width: 900, height: 600 },
        args: [
            `--disable-extensions-except=${CHROME_EXT}`,
            `--load-extension=${CHROME_EXT}`
        ]
    });
    const page = await context.newPage();
    return runOnPage(page, "chromium", context);
}

async function runOnPage(page, label, context) {
    const messages = [];
    page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") {
            messages.push(`[${msg.type()}] ${msg.text()}`);
        }
    });
    page.on("pageerror", (err) => messages.push(`[pageerror] ${err.message}`));

    let extId = null;
    page.on("request", (req) => {
        const m = /^chrome-extension:\/\/([^/]+)\//.exec(req.url());
        if (m && !extId) extId = m[1];
    });

    const { server, url } = await serve();
    try {
        await page.goto(url, { waitUntil: "load" });
        const result = await probe(page, label);
        result.scale = await checkScaleChange(page, context, extId);
        result.console = messages;
        return result;
    } finally {
        server.close();
        await context.close();
    }
}

async function checkScaleChange(page, context, extId) {
    const readRatio = () =>
        page.evaluate(() => {
            const rt = document.querySelector('ruby[data-local-furigana="1"] > rt');
            const ruby = document.querySelector('ruby[data-local-furigana="1"]');
            if (!rt || !ruby) return null;
            const rtSize = parseFloat(getComputedStyle(rt).fontSize);
            const rubySize = parseFloat(getComputedStyle(ruby).fontSize);
            return rubySize ? rtSize / rubySize : null;
        });
    await page.waitForTimeout(2000);
    const before = await readRatio();
    if (!extId) return { before, after: null, note: "no extension id captured" };
    const extPage = await context.newPage();
    try {
        await extPage.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: "load" });
        await extPage.evaluate(() => chrome.storage.local.set({ "furigana:scale": 0.8 }));
    } finally {
        await extPage.close();
    }
    await page.waitForTimeout(1000);
    const after = await readRatio();
    return { before, after };
}

const results = {};
const tasks = [];
tasks.push(runChromium().then((r) => (results.chromium = r)));
await Promise.all(tasks);

for (const [name, r] of Object.entries(results)) {
    if (!r) continue;
    const okStatic = r.staticHTML && r.staticHTML.includes("ruby");
    const okDynamic = r.dynamicHTML && r.dynamicHTML.includes("ruby");
    const okShadow = r.shadowHTML && r.shadowHTML.includes("ruby");
    console.log(`\n---- ${name} ----`);
    console.log(`ruby count: ${r.rubyCount}`);
    console.log(`static: ${okStatic ? "OK" : "MISS"}\n  ${r.staticHTML}`);
    console.log(`dynamic: ${okDynamic ? "OK" : "MISS"}\n  ${r.dynamicHTML}`);
    console.log(`shadow: ${okShadow ? "OK" : "MISS"}\n  ${r.shadowHTML}`);
    console.log(`body: ${r.bodyHTML}`);
    console.log(`size ratio before/after scale 0.8: ${JSON.stringify(r.scale || null)}`);
    if (r.console && r.console.length) {
        console.log("console:");
        for (const m of r.console.slice(0, 15)) console.log(`  ${m}`);
    } else {
        console.log("console: (no errors)");
    }
    Object.defineProperty(results, name + ":pass", { value: okStatic && okDynamic && okShadow });
}

const pass = Object.entries(results)
    .filter(([k]) => !k.endsWith(":pass") && results[k])
    .every(([k]) => results[k + ":pass"]);
console.log(`\n${pass ? "SMOKE TEST PASSED" : "SMOKE TEST FAILED"}`);
process.exit(pass ? 0 : 1);
