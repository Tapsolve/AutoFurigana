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
    // Note: globalThis.performance is intentionally left as the environment's
    // own performance; jsdom reads it while creating windows.

    const tokenizer = await getNodeTokenizer();
    let tokenizerBuilds = 0;
    globalThis.kuromoji = {
        builder: function () {
            return {
                build: function (cb) {
                    tokenizerBuilds++;
                    if (typeof opts.tokenizerBuild === "function") {
                        const result = opts.tokenizerBuild(tokenizerBuilds, tokenizer);
                        return setTimeout(() => cb(null, result.tokenizer), result.delay || 0);
                    }
                    cb(null, tokenizer);
                }
            };
        }
    };

    // Set the extension API mock BEFORE loading modules (resolved lazily,
    // but set early to mirror the real environment).
    const storageMock = createStorageMock(opts.settings || {});
    globalThis.browser = {
        storage: {
            local: storageMock,
            onChanged: storageMock.onChanged
        },
        runtime: {
            getURL: function (p) {
                return "moz-extension://dummy/" + p;
            }
        }
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
        return await scenarioFn(F, win.document);
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

function reconstruct(node) {
    if (node.nodeType === 3) return node.textContent; // TEXT_NODE
    if (node.nodeType === 9) return reconstructChildren(node); // DOCUMENT
    if (node.nodeType === 11) return reconstructChildren(node); // DOCUMENT_FRAGMENT / shadow root
    if (node.nodeType === 1) {
        if (node.tagName === "RT" || node.tagName === "RP") return ""; // skip readings
        return reconstructChildren(node);
    }
    return "";
}

function reconstructChildren(node) {
    let out = "";
    for (let i = 0; i < node.childNodes.length; i++) out += reconstruct(node.childNodes[i]);
    return out;
}

function plainText(doc, root) {
    return reconstruct(root || doc.body).replace(/\s+/g, " ").trim();
}

function countRuby(doc, root) {
    const el = root || doc.body;
    return el.querySelectorAll('ruby[data-local-furigana="1"]').length;
}

function findRubyByBase(root, base) {
    const list = root.querySelectorAll('ruby[data-local-furigana="1"]');
    for (const ruby of list) {
        let b = "";
        for (const child of ruby.childNodes) {
            if (child.nodeType === 1 && (child.tagName === "RT" || child.tagName === "RP")) continue;
            b += child.textContent;
        }
        if (b === base) return ruby;
    }
    return null;
}

async function run() {
    let failures = 0;
    let count = 0;

    function record(name, fn) {
        count++;
        return Promise.resolve()
            .then(fn)
            .then(
                () => console.log(`  ok  ${name}`),
                (err) => {
                    failures++;
                    console.log(`  FAIL ${name}\n      ${err.message}`);
                    if (process.env.SHOW_STACK) console.log(err.stack);
                }
            );
    }

    // --- Static text (spec section 37, case 1) ---
    console.log("DOM tests:");
    await record("static paragraph is annotated", () =>
        runScenario("<p>今日は日本語を勉強する。</p>", {}, async (F, doc) => {
            await waitFor(() => countRuby(doc) >= 2);
            if (!doc.body.querySelector("ruby")) throw new Error("no ruby found");
            const readings = [...doc.body.querySelectorAll("rt")].map((r) => r.textContent).join(" ");
            if (!readings.includes("きょう")) throw new Error(`expected きょう reading, got: ${readings}`);
            if (plainText(doc) !== "今日は日本語を勉強する。") {
                throw new Error(`plain text corrupted: "${plainText(doc)}"`);
            }
        })
    );

    // --- Mixed inline elements (spec section 37, case 2) ---
    await record("inline element boundaries are annotated", () =>
        runScenario('<p>今日の<a href="/weather">天気</a>は良い。</p>', {}, async (F, doc) => {
            await waitFor(() => countRuby(doc) >= 2);
            const link = doc.querySelector("a");
            if (!link.querySelector("ruby")) throw new Error("link text was not annotated");
            const rt = link.querySelector("rt");
            if (rt && rt.textContent !== "てんき") throw new Error(`天気 reading was "${rt && rt.textContent}"`);
            if (plainText(doc) !== "今日の天気は良い。") {
                throw new Error(`plain text corrupted: "${plainText(doc)}"`);
            }
        })
    );

    // --- Dynamic insertion via textContent (spec section 37, case 3) ---
    await record("textContent insertion is annotated", () =>
        runScenario('<div id="target"></div>', {}, async (F, doc) => {
            const el = doc.getElementById("target");
            el.textContent = "明日は東京へ行く";
            await waitFor(() => countRuby(doc) >= 3);
            const readings = [...doc.querySelectorAll("rt")].map((r) => r.textContent);
            if (!readings.includes("あした")) throw new Error(`missing あした: ${readings.join(" ")}`);
            if (!readings.includes("とうきょう")) throw new Error(`missing とうきょう: ${readings.join(" ")}`);
            if (plainText(doc) !== "明日は東京へ行く") throw new Error("plain text corrupted");
        })
    );

    // --- appendTextNode (spec section 37, case 4) ---
    await record("appended text node is annotated", () =>
        runScenario('<div id="target">すでに</div>', {}, async (F, doc) => {
            const el = doc.getElementById("target");
            el.append(doc.createTextNode("日本語"));
            await waitFor(() => countRuby(doc) >= 1);
            if (plainText(doc) !== "すでに日本語") throw new Error(`plain text corrupted: "${plainText(doc)}"`);
        })
    );

    // --- Replacement: latest value wins (spec section 37, case 5) ---
    await record("replaced text gets the latest annotation", () =>
        runScenario('<div id="target">初期</div>', {}, async (F, doc) => {
            const el = doc.getElementById("target");
            await waitFor(() => countRuby(doc) >= 1);
            el.textContent = "昨日";
            await waitFor(() => {
                const rt = doc.querySelector("#target rt");
                return rt && rt.textContent === "きのう";
            });
            el.textContent = "今日";
            await waitFor(() => {
                const rt = doc.querySelector("#target rt");
                return rt && rt.textContent === "きょう";
            });
            // must not still say 昨日
            const readings = [...doc.querySelectorAll("#target rt")].map((r) => r.textContent);
            if (readings.includes("きのう")) throw new Error("stale 昨日 reading survived");
            if (plainText(doc) !== "今日") throw new Error(`plain text corrupted: "${plainText(doc)}"`);
        })
    );

    // --- Existing publisher ruby untouched (spec section 25) ---
    await record("existing ruby is left alone", () =>
        runScenario("<ruby>日本<rt>にほん</rt></ruby>", {}, async (F, doc) => {
            // Give any (wrong) processing time to happen.
            await new Promise((r) => setTimeout(r, 150));
            const ruby = doc.querySelector("ruby");
            if (!ruby) throw new Error("ruby missing");
            if (ruby.hasAttribute("data-local-furigana")) throw new Error("existing ruby was modified");
            const rt = ruby.querySelector("rt");
            if (!rt || rt.textContent !== "にほん") throw new Error("existing rt was changed");
        })
    );

    // --- contenteditable untouched (spec section 40) ---
    await record("contenteditable is untouched", () =>
        runScenario('<div contenteditable="true">日本語を入力中</div>', {}, async (F, doc) => {
            await new Promise((r) => setTimeout(r, 150));
            if (countRuby(doc) !== 0) throw new Error("contenteditable was annotated");
        })
    );

    // --- Disabled via settings ---
    await record("disabled extension does nothing", () =>
        runScenario("<p>日本語のテスト</p>", { settings: { "furigana:enabled": false } }, async (F, doc) => {
            await new Promise((r) => setTimeout(r, 150));
            if (countRuby(doc) !== 0) throw new Error("annotated while disabled");
        })
    );

    // --- Site exclusion ---
    await record("excluded site does nothing", () =>
        runScenario("<p>日本語のテスト</p>", { settings: { "furigana:excludedHosts": ["example.com"] } }, async (F, doc) => {
            await new Promise((r) => setTimeout(r, 150));
            if (countRuby(doc) !== 0) throw new Error("annotated on excluded site");
        })
    );

    // --- Open Shadow DOM (spec section 21) ---
    await record("open shadow root content is annotated", () =>
        runScenario('<div id="host"></div>', {}, async (F, doc) => {
            const host = doc.getElementById("host");
            const root = host.attachShadow({ mode: "open" });
            root.innerHTML = "<p>日本語の影</p>";
            await waitFor(() => countRuby(doc, root) >= 1, 5000);
            if (!root.querySelector("ruby")) throw new Error("shadow content not annotated");
            if (plainText(doc, root) !== "日本語の影") throw new Error("shadow plain text corrupted");
        })
    );

    // --- No double annotation on rescan (infinite loop protection) ---
    await record("no duplicate ruby nesting", () =>
        runScenario("<p>日本語を勉強します。</p>", {}, async (F, doc) => {
            await waitFor(() => countRuby(doc) >= 2);
            await new Promise((r) => setTimeout(r, 200));
            const nested = doc.querySelector("ruby ruby");
            if (nested) throw new Error("ruby was nested inside ruby");
        })
    );

    // --- Stop/start while the old tokenizer is still loading ---
    await record("stale analysis cannot cross a stop/start boundary", () => {
        let builds = 0;
        return runScenario("<p>日本語</p>", {
            tokenizerBuild: () => {
                builds++;
                const reading = builds === 1 ? "オールド" : "ニュー";
                return {
                    delay: 180,
                    tokenizer: {
                        tokenize(text) {
                            return [{ surface_form: text, reading }];
                        }
                    }
                };
            }
        }, async (F, doc) => {
            await waitFor(() => builds === 1);
            F.main.stop();
            F.main.start();
            await waitFor(() => builds === 2);
            await waitFor(() => doc.querySelector("rt")?.textContent === "にゅー");
            await new Promise((resolve) => setTimeout(resolve, 100));
            if ([...doc.querySelectorAll("rt")].some((rt) => rt.textContent === "おーるど")) {
                throw new Error("analysis from the stopped run was rendered");
            }
        });
    });

    // --- Saved reading overrides are applied when text is rendered ---
    await record("saved reading override is rendered", () =>
        runScenario(
            "<p>金玉を買った。</p>",
            { settings: { "furigana:overrides": { 金玉: "きんたま" } } },
            async (F, doc) => {
                await waitFor(() => {
                    const ruby = findRubyByBase(doc.body, "金玉");
                    return ruby && ruby.querySelector("rt").textContent === "きんたま";
                });
                if (plainText(doc) !== "金玉を買った。") {
                    throw new Error(`plain text corrupted: "${plainText(doc)}"`);
                }
            }
        )
    );

    // --- Removing an override reverts rendered text to the dictionary reading ---
    await record("removing an override reverts to the dictionary reading", () =>
        runScenario(
            "<p>金玉を買った。</p>",
            { settings: { "furigana:overrides": { 金玉: "きんたま" } } },
            async (F, doc) => {
                await waitFor(() => {
                    const ruby = findRubyByBase(doc.body, "金玉");
                    return ruby && ruby.querySelector("rt").textContent === "きんたま";
                });
                await F.settings.set(F.settings.KEY_OVERRIDES, {});
                await waitFor(() => {
                    const ruby = findRubyByBase(doc.body, "金玉");
                    return ruby && ruby.querySelector("rt").textContent === "きんぎょく";
                });
            }
        )
    );

    // --- Click-to-correct end to end ---
    await record("clicking a ruby offers alternatives and saves a correction", () =>
        runScenario("<p>金玉を買った。</p>", {}, async (F, doc) => {
            await waitFor(() => !!findRubyByBase(doc.body, "金玉"));
            const ruby = findRubyByBase(doc.body, "金玉");

            ruby.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
            await waitFor(() => !!doc.querySelector(".af-correction-popup"));

            const popup = doc.querySelector(".af-correction-popup");
            if (!popup) throw new Error("correction popup did not open");

            // Our own popup UI must never be annotated itself.
            if (popup.querySelector("ruby")) throw new Error("correction popup got annotated");

            await waitFor(() =>
                [...popup.querySelectorAll("button")].some((b) => b.textContent.trim() === "きんたま")
            );
            const alternative = [...popup.querySelectorAll("button")].find((b) => b.textContent.trim() === "きんたま");
            alternative.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));

            await waitFor(() => {
                const rubyAfter = findRubyByBase(doc.body, "金玉");
                return rubyAfter && rubyAfter.querySelector("rt").textContent === "きんたま";
            });
            if (doc.querySelector(".af-correction-popup")) throw new Error("popup did not close after applying");

            const s = await F.settings.load();
            if (!s.overrides || s.overrides["金玉"] !== "きんたま") {
                throw new Error(`override not persisted: ${JSON.stringify(s.overrides)}`);
            }
            if (plainText(doc) !== "金玉を買った。") {
                throw new Error(`plain text corrupted: "${plainText(doc)}"`);
            }
        })
    );

    // --- Manual custom reading via the popup input ---
    await record("a typing a custom reading is saved and applied", () =>
        runScenario("<p>金玉を買った。</p>", {}, async (F, doc) => {
            await waitFor(() => !!findRubyByBase(doc.body, "金玉"));
            findRubyByBase(doc.body, "金玉").dispatchEvent(
                new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, composed: true })
            );
            await waitFor(() => !!doc.querySelector(".af-correction-popup"));
            const input = doc.querySelector(".af-correction-input");
            input.value = "きんたま";
            doc.querySelector(".af-correction-apply").dispatchEvent(
                new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, composed: true })
            );
            await waitFor(() => {
                const rubyAfter = findRubyByBase(doc.body, "金玉");
                return rubyAfter && rubyAfter.querySelector("rt").textContent === "きんたま";
            });
        })
    );

    // --- Correction disabled: clicking does nothing ---
    await record("correction popup is suppressed when disabled", () =>
        runScenario("<p>金玉を買った。</p>", { settings: { "furigana:correctionEnabled": false } }, async (F, doc) => {
            await waitFor(() => !!findRubyByBase(doc.body, "金玉"));
            findRubyByBase(doc.body, "金玉").dispatchEvent(
                new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, composed: true })
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (doc.querySelector(".af-correction-popup")) throw new Error("popup opened while corrections are disabled");
        })
    );

    // --- A whole-word correction splices split rubies back together ---
    await record("a saved whole-word override is applied across split rubies", () =>
        runScenario(
            "<p>一人で。</p>",
            { settings: { "furigana:overrides": { 一人: "ひとり" } } },
            async (F, doc) => {
                await waitFor(() => {
                    const ruby = findRubyByBase(doc.body, "一人");
                    return ruby && ruby.querySelector("rt").textContent === "ひとり";
                });
                if (findRubyByBase(doc.body, "一")) throw new Error("split ruby 一 should no longer exist");
                if (plainText(doc) !== "一人で。") throw new Error(`plain text corrupted: "${plainText(doc)}"`);
            }
        )
    );

    // --- Clicking one kanji of a split word offers the whole-word reading ---
    await record("clicking a split word offers and applies the whole-word reading", () =>
        runScenario("<p>一人で。</p>", {}, async (F, doc) => {
            await waitFor(() => !!findRubyByBase(doc.body, "一") && !!findRubyByBase(doc.body, "人"));
            findRubyByBase(doc.body, "一").dispatchEvent(
                new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, composed: true })
            );
            await waitFor(() => !!doc.querySelector(".af-correction-popup"));

            const popup = doc.querySelector(".af-correction-popup");
            await waitFor(() =>
                [...popup.querySelectorAll(".af-correction-word-item")].some((b) => b.textContent.trim() === "ひとり")
            );
            const wordButton = [...popup.querySelectorAll(".af-correction-word-item")].find(
                (b) => b.textContent.trim() === "ひとり"
            );
            wordButton.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));

            await waitFor(() => {
                const ruby = findRubyByBase(doc.body, "一人");
                return ruby && ruby.querySelector("rt").textContent === "ひとり";
            });
            if (doc.querySelector(".af-correction-popup")) throw new Error("popup did not close after applying");
            if (findRubyByBase(doc.body, "一")) throw new Error("split ruby 一 should no longer exist");
            const s = await F.settings.load();
            if (!s.overrides || s.overrides["一人"] !== "ひとり") {
                throw new Error(`whole-word override not persisted: ${JSON.stringify(s.overrides)}`);
            }
            if (plainText(doc) !== "一人で。") throw new Error(`plain text corrupted: "${plainText(doc)}"`);
        })
    );

    console.log(`\ndom: ${count - failures}/${count} passed`);
    return failures === 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    run().then(
        (ok) => process.exit(ok ? 0 : 1),
        (err) => {
            console.error(err);
            process.exit(1);
        }
    );
}

export { run };
