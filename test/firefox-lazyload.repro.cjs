"use strict";

// Firefox lazy-load-on-scroll reproduction via geckodriver over raw HTTP.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const geckodriver = require("geckodriver");

const ROOT = path.resolve(__dirname, "..");
const XPI = path.join(ROOT, "dist", "autofurigana-firefox.xpi");
const FIREFOX_BIN = process.env.FIREFOX_BIN || "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const PORT = 4445;
const BASE = `http://127.0.0.1:${PORT}`;

async function raw(method, urlPath, body) {
    const res = await fetch(BASE + urlPath, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { "Content-Type": "application/json" }
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
    if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status}: ${text}`);
    return json;
}

function serve() {
    const HTML = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>Lazy test</title></head>
<body style="margin:0">
  <div id="feed"></div>
  <div id="sentinel" style="height:10px"></div>
  <script>
    var n = 0;
    function addItems(count) {
      for (var i = 0; i < count; i++) {
        n++;
        var p = document.createElement("p");
        p.style.height = "120px";
        p.textContent = (n % 2 ? "遅延読み込み日本語テキスト" : "明日は東京へ行く予定") + n;
        document.getElementById("feed").appendChild(p);
      }
    }
    addItems(4);
    var io = new IntersectionObserver(function (entries) {
      for (const e of entries) {
        if (e.isIntersecting) {
          io.disconnect();
          setTimeout(function () { addItems(6); }, 150);
          setTimeout(function () { io.observe(document.getElementById("sentinel")); }, 400);
        }
      }
    }, { rootMargin: "200px" });
    io.observe(document.getElementById("sentinel"));
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

const state = (sid) => ({ url: async (u) => raw("POST", `/session/${sid}/url`, { url: u }),
    exec: async (script, args) => (await raw("POST", `/session/${sid}/execute/sync`, { script, args })).value
});

(async () => {
    const geckoBin = await geckodriver.download();
    const driverProc = spawn(geckoBin, ["--host", "127.0.0.1", "--port", String(PORT), "--log", "debug"], {
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true
    });
    driverProc.stderr.on("data", () => {});
    await new Promise((r) => setTimeout(r, 1500));

    let sid;
    try {
        const session = await raw("POST", "/session", {
            capabilities: {
                alwaysMatch: { browserName: "firefox", acceptInsecureCerts: true, "moz:firefoxOptions": { binary: FIREFOX_BIN, args: ["-headless"] } }
            }
        });
        sid = session.value.sessionId;

        const addonBase64 = fs.readFileSync(XPI).toString("base64");
        await raw("POST", `/session/${sid}/moz/addon/install`, { addon: addonBase64, temporary: true });
        console.log("installed temporary add-on");

        const { server, url } = await serve();
        try {
            const s = state(sid);
            await s.url(url);
            await new Promise((r) => setTimeout(r, 2500));
            let r = await s.exec(
                'return { ruby: document.querySelectorAll(\'ruby[data-local-furigana="1"]\').length, p: document.querySelectorAll("#feed p").length };', []
            );
            console.log("BEFORE scroll: pCount:", r.p, "ruby:", r.ruby);

            await s.exec("window.scrollTo(0, 20000);", []);
            await new Promise((r) => setTimeout(r, 1500));
            await s.exec("window.scrollTo(0, 40000);", []);
            await new Promise((r) => setTimeout(r, 3000));

            r = await s.exec(
                'var ps=[...document.querySelectorAll("#feed p")]; var bad=ps.filter(function(p){return p.innerHTML.indexOf("ruby")===-1;}).length; return { ruby: document.querySelectorAll(\'ruby[data-local-furigana="1"]\').length, p: ps.length, bad: bad, html: document.body.innerHTML.slice(0,400) };', []
            );
            console.log("AFTER scroll: pCount:", r.p, "ruby:", r.ruby, "unannotated:", r.bad);
            console.log("body start:", r.html && r.html.replace(/<[^>]+>/g, " ").slice(0, 160));

            // realistic check: scroll to bottom, wait, all p's should have ruby
            let ok = Number(r.ruby) >= 5 && Number(r.bad) === 0;
            console.log(ok ? "FIREFOX LAZYLOAD PASSED" : "FIREFOX LAZYLOAD FAILED");
            process.exitCode = ok ? 0 : 1;
        } finally {
            server.close();
        }
    } finally {
        if (sid) await raw("DELETE", `/session/${sid}`).catch(() => {});
    }
    driverProc.kill();
    process.exit(process.exitCode || 0);
})().catch((err) => { console.error("error:", err); process.exit(1); });