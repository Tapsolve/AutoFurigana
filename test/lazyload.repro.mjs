import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { loadModules, createStorageMock } from "./helpers/load-modules.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let nodeTokenizer = null;
function getNodeTokenizer() {
    if (nodeTokenizer) return Promise.resolve(nodeTokenizer);
    return new Promise((resolve, reject) => {
        require("kuromoji")
            .builder({ dicPath: path.join(ROOT, "node_modules", "kuromoji", "dict") })
            .build((err, tok) => (err ? reject(err) : (nodeTokenizer = tok, resolve(tok))));
    });
}

function waitFor(fn, timeoutMs, intervalMs) {
    const timeout = timeoutMs || 5000;
    const interval = intervalMs || 10;
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function poll() {
            let result;
            try {
                result = fn();
            } catch (err) {
                return reject(err);
            }
            if (result) return resolve(result);
            if (Date.now() - start > timeout) return reject(new Error("timed out waiting for condition"));
            setTimeout(poll, interval);
        })();
    });
}

function countRuby(doc, root) {
    const el = root || doc.body;
    return el.querySelectorAll('ruby[data-local-furigana="1"]').length;
}

async function runScenario(html, options, scenarioFn) {
    const opts = options || {};
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
        url: opts.url || "https://example.com/page",
        pretendToBeVisual: true
    });
    const win = dom.window;

    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.location = { hostname: opts.hostname || "example.com" };
    globalThis.Node = win.Node;
    globalThis.Element = win.Element;
    globalThis.CustomEvent = win.CustomEvent;
    globalThis.MutationObserver = win.MutationObserver;
    globalThis.CSSStyleSheet = win.CSSStyleSheet;
    globalThis.requestIdleCallback = undefined;

    const tokenizer = await getNodeTokenizer();
    globalThis.kuromoji = {
        builder: function () {
            return { build: function (cb) { cb(null, tokenizer); } };
        }
    };

    const storageMock = createStorageMock(opts.settings || {});
    globalThis.browser = {
        storage: { local: storageMock, onChanged: storageMock.onChanged },
        runtime: { getURL: function (p) { return "moz-extension://dummy/" + p; } }
    };

    globalThis.__FURIGANA__ = {};
    const F = loadModules(
        [
            "content/shadow-hook-main.js",
            "shared/browser-api.js",
            "japanese/kana.js",
            "japanese/cache.js",
            "japanese/analyzer.js",
            "japanese/kuromoji-analyzer.js",
            "japanese/furigana.js",
            "content/renderer.js",
            "content/settings.js",
            "content/scheduler.js",
            "content/scanner.js",
            "content/observer.js",
            "content/shadow-dom.js",
            "shared/i18n.js",
            "content/correction.js",
            "content/index.js"
        ],
        globalThis.__FURIGANA__
    );

    try {
        await F.main.init();
        return await scenarioFn(F, win.document, win);
    } finally {
        globalThis.window = undefined;
        globalThis.document = undefined;
        globalThis.location = undefined;
        globalThis.Node = undefined;
        globalThis.Element = undefined;
        globalThis.CustomEvent = undefined;
        globalThis.MutationObserver = undefined;
        globalThis.CSSStyleSheet = undefined;
        globalThis.requestIdleCallback = undefined;
        globalThis.kuromoji = undefined;
        globalThis.browser = undefined;
        globalThis.__FURIGANA__ = undefined;
    }
}

async function main() {
    console.log("Scenario E: insert content WHILE the initial document scan is still in progress.");
    await runScenario("<p>日本語1。</p><p>日本語2。</p><p>日本語3。</p><p>日本語4。</p><p>日本語5。</p><p>日本語6。</p><p>日本語7。</p><p>日本語8。</p><p>日本語9。</p><p>日本語10。</p><p>日本語11。</p><p>日本語12。</p><p>日本語13。</p><p>日本語14。</p><p>日本語15。</p>", {}, async (F, doc, win) => {
        // Insert new content very early, before any ruby exists (scan still running).
        const p = doc.createElement("p");
        p.textContent = "遅延読み込み日本語テキスト。";
        doc.body.appendChild(p);
        await waitFor(() => countRuby(doc) >= 3);
        console.log("  ok, rubies now:", countRuby(doc));
        const texts = [...doc.querySelectorAll("ruby rt")].map((r) => r.textContent);
        console.log("  readings:", texts.join(" | "));
    }).catch((e) => console.log("  FAIL:", e.message));

    console.log("\nScenario F: insert content that itself triggers re-layout of rolled-up text (like content-visibility).");
    await runScenario("<p>日本語。</p>", {}, async (F, doc, win) => {
        await new Promise((r) => setTimeout(r, 300));
        // simulate a real feed: remove and re-insert existing node (move),
        // like many frameworks do when scrolling.
        const p = doc.body.querySelector("p");
        const clone = p.cloneNode(true);
        p.remove();
        doc.body.appendChild(clone);
        await new Promise((r) => setTimeout(r, 300));
        console.log("  ok, rubies now:", countRuby(doc));
        console.log("  first p html:", doc.body.querySelector("p").innerHTML);
    }).catch((e) => console.log("  FAIL:", e.message));

    console.log("\nScenario H: recycled element (virtual list) - textContent replaced repeatedly on same element.");
    await runScenario('<div id="slots"></div>', {}, async (F, doc) => {
        await new Promise((r) => setTimeout(r, 200));
        const slot = doc.createElement("p");
        doc.getElementById("slots").appendChild(slot);
        slot.textContent = "最初の項目";
        await waitFor(() => countRuby(doc) >= 1);
        // emulate virtual scroll recycling: reuse same <p>, change its text each time
        for (let i = 0; i < 3; i++) {
            slot.textContent = "次の日本語項目";
            await waitFor(() => {
                const rt = slot.querySelector("rt");
                return rt && rt.textContent === "つぎ";
            });
        }
        console.log("  ok, final innerHTML:", slot.innerHTML.slice(0, 120));
    }).catch((e) => console.log("  FAIL:", e.message));

    console.log("\nScenario I: rapid burst append of many nodes (simulates Twitter feed).");
    await runScenario('<div id="burst"></div>', {}, async (F, doc) => {
        await new Promise((r) => setTimeout(r, 200));
        const frag = doc.createDocumentFragment();
        for (let i = 0; i < 30; i++) {
            const p = doc.createElement("p");
            p.textContent = "東京のニュースフィード項目。";
            frag.appendChild(p);
        }
        doc.getElementById("burst").appendChild(frag);
        await waitFor(() => countRuby(doc) >= 60);
        console.log("  ok, rubies:", countRuby(doc));
    }).catch((e) => console.log("  FAIL:", e.message));

    console.log("\nScenario J: lazy content inserted later into an existing open shadow root.");
    await runScenario('<div id="host"></div>', {}, async (F, doc) => {
        const host = doc.getElementById("host");
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = "<p>はじめの影。</p>";
        await waitFor(() => countRuby(doc, root) >= 1);
        // simulate later lazy-load inside the shadow root (as user scrolls a web component)
        const p = doc.createElement("p");
        p.textContent = "スクロールで増える日本語。";
        root.appendChild(p);
        await waitFor(() => countRuby(doc, root) >= 3);
        console.log("  ok, rubies in shadow:", countRuby(doc, root));
        console.log("  shadow html:", root.innerHTML.slice(0, 200));
    }).catch((e) => console.log("  FAIL:", e.message));

    console.log("\nScenario G: page sets innerHTML on an already-annotated container.");
    await runScenario('<p id="a">日本語を勉強する。</p><div id="feed"></div>', {}, async (F, doc, win) => {
        await waitFor(() => countRuby(doc) >= 2);
        await new Promise((r) => setTimeout(r, 100));
        const feed = doc.getElementById("feed");
        feed.innerHTML = "<p>新しく追加された東京のニュース。</p>";
        await waitFor(() => countRuby(doc) >= 4);
        console.log("  ok, rubies now:", countRuby(doc));
    }).catch((e) => console.log("  FAIL:", e.message));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().then(
        () => process.exit(0),
        (err) => { console.error(err); process.exit(1); }
    );
}