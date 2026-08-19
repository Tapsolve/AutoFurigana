// Reproduces the "scroll + lazy load" scenario in a real Chromium browser.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME_EXT = path.join(ROOT, "dist", "chrome");

const HTML = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>Lazy load test</title></head>
<body style="margin:0">
  <h1>上から</h1>
  <div id="feed"></div>
  <div id="sentinel" style="height:10px"></div>
  <script>
    var n = 0;
    function addItems(count) {
      for (var i = 0; i < count; i++) {
        n++;
        var p = document.createElement("p");
        p.style.height = "120px";
        p.textContent = (n % 2 ? "遅延読み込み日本語テキスト" : "明日は東京へ行く予定") + " " + n;
        document.getElementById("feed").appendChild(p);
      }
    }
    addItems(4);
    var io = new IntersectionObserver(function (entries) {
      for (const e of entries) {
        if (e.isIntersecting) {
          io.disconnect();
          // simulate async fetch before insertion
          setTimeout(function () {
            addItems(6);
          }, 150);
          // re-arm for next scroll
          setTimeout(function () {
            io.observe(document.getElementById("sentinel"));
          }, 400);
        }
      }
    }, { rootMargin: "200px" });
    io.observe(document.getElementById("sentinel"));
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

const messages = [];
const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 900, height: 600 },
    args: [`--disable-extensions-except=${CHROME_EXT}`, `--load-extension=${CHROME_EXT}`]
});
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") messages.push("[err] " + m.text()); });
page.on("pageerror", (e) => messages.push("[pageerror] " + e.message));

const { server, url } = await serve();
try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    let result = await page.evaluate(() => {
        const rubies = document.querySelectorAll('ruby[data-local-furigana="1"]');
        const rtTexts = [...document.querySelectorAll("rt")].map((r) => r.textContent);
        const ps = [...document.querySelectorAll("#feed p")].map((p) => p.innerHTML.slice(0, 90));
        return { ruby: rubies.length, pCount: document.querySelectorAll("#feed p").length, ps, rt: rtTexts };
    });
    console.log("BEFORE SCROLL:");
    console.log("  pCount:", result.pCount, "ruby:", result.ruby);
    console.log("  ", JSON.stringify(result.ps.slice(0, 4), null, 0));

    // Scroll to bottom to trigger the lazy load.
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(1500);
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(2500);

    result = await page.evaluate(() => {
        const rubies = document.querySelectorAll('ruby[data-local-furigana="1"]');
        const ps = [...document.querySelectorAll("#feed p")].map((p) => p.innerHTML.slice(0, 90));
        let unannotated = 0;
        for (const p of document.querySelectorAll("#feed p")) {
            if (!p.innerHTML.includes("ruby")) unannotated++;
        }
        return { ruby: rubies.length, pCount: document.querySelectorAll("#feed p").length, unannotated, ps };
    });
    console.log("AFTER SCROLL:");
    console.log("  pCount:", result.pCount, "ruby:", result.ruby, "unannotated paragraphs:", result.unannotated);
    for (let i = 0; i < result.ps.length; i++) {
        const mark = result.ps[i].includes("ruby") ? "OK " : "NO ";
        console.log("  " + mark + i + ": " + result.ps[i]);
    }
    if (messages.length) {
        console.log("console errors:");
        for (const m of messages.slice(0, 10)) console.log("  " + m);
    }
} finally {
    server.close();
    await context.close();
}
process.exit(0);