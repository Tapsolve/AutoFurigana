"use strict";

// Firefox smoke test driving geckodriver over raw HTTP (W3C WebDriver).
// Installs the XPI as a temporary extension via /moz/addon/install (no
// signature requirement), then checks furigana on a local Japanese page.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const geckodriver = require("geckodriver");

const ROOT = path.resolve(__dirname, "..");
const XPI = process.env.FURIGANA_XPI
    ? path.resolve(process.env.FURIGANA_XPI)
    : path.join(ROOT, "dist", "autofurigana-firefox.xpi");
const FIREFOX_BIN = process.env.FIREFOX_BIN;
const PORT = 4444;
const BASE = `http://127.0.0.1:${PORT}`;

async function raw(method, urlPath, body) {
    const res = await fetch(BASE + urlPath, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { "Content-Type": "application/json" }
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch (err) {
        json = null;
    }
    if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status}: ${text}`);
    return json;
}

function serve() {
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

(async () => {
    const geckoBin = await geckodriver.download();
    const driverProc = spawn(geckoBin, ["--host", "127.0.0.1", "--port", String(PORT), "--log", "debug"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
    });
    let driverOut = "";
    driverProc.stdout.on("data", (d) => (driverOut += d));
    driverProc.stderr.on("data", (d) => (driverOut += d));
    await new Promise((r) => setTimeout(r, 1500));

    let sid;
    try {
        const alwaysMatch = {
            browserName: "firefox",
            acceptInsecureCerts: true,
            "moz:firefoxOptions": { args: ["-headless"] }
        };
        if (FIREFOX_BIN) alwaysMatch["moz:firefoxOptions"].binary = FIREFOX_BIN;
        const session = await raw("POST", "/session", { capabilities: { alwaysMatch } });
        sid = session.value.sessionId;

        const addonBase64 = fs.readFileSync(XPI).toString("base64");
        const addonResult = await raw("POST", `/session/${sid}/moz/addon/install`, {
            addon: addonBase64,
            temporary: true
        });
        console.log("installed temporary add-on id:", addonResult.value);

        const { server, url } = await serve();
        try {
            await raw("POST", `/session/${sid}/url`, { url });
            await new Promise((r) => setTimeout(r, 5000));
            const script =
                'var el = document.documentElement; var sr = document.getElementById("shadow-host").shadowRoot; return { rubies: document.querySelectorAll(\'ruby[data-local-furigana="1"]\').length, staticHTML: document.getElementById("static").innerHTML, dynamicHTML: document.getElementById("dynamic").innerHTML, shadowHTML: sr ? sr.innerHTML : null, probe: el.getAttribute("furiProbe"), err: el.getAttribute("furiErr"), init: el.getAttribute("furiInit"), initFail: el.getAttribute("furiInitFail"), tok: el.getAttribute("furiTok"), tokFail: el.getAttribute("furiTokFail"), hook: el.getAttribute("furiHook"), dictUrl: el.getAttribute("furiDictUrl"), dictFetch: el.getAttribute("furiDictFetch") };';
            const result = await raw("POST", `/session/${sid}/execute/sync`, {
                script,
                args: []
            });
            const v = result.value || result;
            console.log("ruby count:", v.rubies);
            console.log("static:  ", v.staticHTML);
            console.log("dynamic: ", v.dynamicHTML);
            console.log("shadow:  ", v.shadowHTML);
            console.log("probe:", v.probe);
            if (v.err) console.log("console.error:", v.err);
            console.log("hook:", v.hook, "| init:", v.init, v.initFail, "| tok:", v.tok, v.tokFail);
            console.log("dictUrl:", v.dictUrl, "| dictFetch:", v.dictFetch);
            const jsErrors = driverOut.split("\n").filter((l) => /content\.js:/.test(l));
            if (jsErrors.length) {
                console.log("firefox JS errors (content.js):");
                for (const l of jsErrors.slice(0, 8)) console.log("  " + l.trim());
            }
            const okStatic = v.staticHTML.includes("ruby");
            const okDynamic = v.dynamicHTML.includes("ruby");
            const okShadow = v.shadowHTML && v.shadowHTML.includes("ruby");
            console.log(okStatic && okDynamic && okShadow ? "FIREFOX SMOKE PASSED" : "FIREFOX SMOKE FAILED");
            process.exitCode = okStatic && okDynamic && okShadow ? 0 : 1;
        } finally {
            server.close();
        }
    } finally {
        if (sid) await raw("DELETE", `/session/${sid}`).catch(() => {});
    }
    driverProc.kill();
    process.exit(process.exitCode || 0);
})().catch((err) => {
    console.error("error:", err);
    process.exit(1);
});
