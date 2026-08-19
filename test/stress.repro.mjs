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
    const timeout = timeoutMs || 25000;
    const interval = intervalMs || 15;
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function poll() {
            let result;
            try { result = fn(); } catch (err) { return reject(err); }
            if (result) return resolve(Date.now() - start);
            if (Date.now() - start > timeout) return reject(new Error("timed out waiting"));
            setTimeout(poll, interval);
        })();
    });
}

function countRuby(doc) {
    return doc.querySelectorAll('ruby[data-local-furigana="1"]').length;
}

async function run() {
    // Huge document whose analysis backlog takes a long time to drain.
    const many = [];
    for (let i = 0; i < 2500; i++) many.push(`<p>遅延文章${i}を分析する。</p>`);
    const html = many.join("");

    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: "https://example.com/page", pretendToBeVisual: true });
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.location = { hostname: "example.com" };
    globalThis.Node = win.Node;
    globalThis.Element = win.Element;
    globalThis.CustomEvent = win.CustomEvent;
    globalThis.MutationObserver = win.MutationObserver;
    globalThis.CSSStyleSheet = win.CSSStyleSheet;
    globalThis.requestIdleCallback = undefined;

    const tokenizer = await getNodeTokenizer();
    const builds = [];
    globalThis.kuromoji = {
        builder: function () {
            return {
                build: function (cb) {
                    setTimeout(() => {
                        const t = {
                            tokenize(text) {
                                const then = Date.now();
                                while (Date.now() - then < 5) { /* ~5ms per tokenize, simulating real cost */ }
                                return tokenizer.tokenize(text);
                            }
                        };
                        cb(null, t);
                    }, 10);
                }
            };
        }
    };

    const storageMock = createStorageMock({});
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

        // Give the initial scan a moment to start.
        await new Promise((r) => setTimeout(r, 300));

        // Fresh content arrives (lazy load) before the backlog drains.
        const fresh = win.document.createElement("p");
        fresh.textContent = "新しい記事のタイトル。";
        win.document.body.appendChild(fresh);

        const freshRubyAt = await waitFor(() => {
            const rt = fresh.querySelector ? fresh.querySelector("rt") : null;
            return rt ? rt.textContent : null;
        });
        const totalRuby = countRuby(win.document);
        console.log(`fresh content annotated after ~${freshRubyAt}ms (${totalRuby} ruby total at that point)`);
    } finally {
        globalThis.window = undefined; globalThis.document = undefined; globalThis.location = undefined;
        globalThis.Node = undefined; globalThis.Element = undefined; globalThis.CustomEvent = undefined;
        globalThis.MutationObserver = undefined; globalThis.CSSStyleSheet = undefined;
        globalThis.requestIdleCallback = undefined; globalThis.kuromoji = undefined;
        globalThis.browser = undefined; globalThis.__FURIGANA__ = undefined;
    }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    run().then(
        () => process.exit(0),
        (err) => { console.error(err); process.exit(1); }
    );
}