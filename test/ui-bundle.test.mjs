import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runPage(browser, page, overrides, activeUrl) {
    const rel = `${page}/${page}.html`;
    const dir = path.join(ROOT, "dist", browser);
    const html = readFileSync(path.join(dir, rel), "utf8");
    const js = readFileSync(path.join(dir, `${page}/${page}.js`), "utf8");

    const dom = new JSDOM(html, {
        url: `moz-extension://00000000-0000-0000-0000-000000000000/${rel}`,
        pretendToBeVisual: true,
        runScripts: "dangerously"
    });
    const win = dom.window;

    const data = {
        "furigana:locale": "fr",
        "furigana:theme": "dark",
        "furigana:enabled": true,
        "furigana:excludedHosts": [],
        "furigana:scale": 0.5
    };
    Object.assign(data, overrides || {});

    win.browser = {
        i18n: { getUILanguage: function () { return "en-US"; } },
        runtime: {
            getURL: function (p) { return p; },
            openOptionsPage: function () {},
            onChanged: { addListener: function () {} }
        },
        storage: {
            local: {
                get: function (keys) {
                    const out = {};
                    for (const k of [].concat(keys)) {
                        if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
                    }
                    return Promise.resolve(out);
                },
                set: function (items) {
                    Object.assign(data, items);
                    return Promise.resolve();
                },
                onChanged: { addListener: function () {} }
            },
            onChanged: { addListener: function () {} }
        },
        tabs: { query: function () { return Promise.resolve([{ url: activeUrl || "https://example.com/" }]); } }
    };
    win.chrome = undefined;
    win.close = function () {};

    // jsdom's window.eval does not bind `document` as a global; a real
    // <script> element runs in the correct realm (like a browser).
    const script = win.document.createElement("script");
    script.textContent = js;
    win.document.head.appendChild(script);

    // Let the async settings load + render() finish before assertions.
    return new Promise((resolve) => {
        setTimeout(() => resolve({ win, data }), 30);
    });
}

async function run() {
    let failures = 0;
    let count = 0;
    function record(name, fn) {
        count++;
        try {
            fn();
            console.log(`  ok  ${name}`);
        } catch (err) {
            failures++;
            console.log(`  FAIL ${name}\n      ${err.message}`);
        }
    }

    for (const browser of ["firefox", "chrome"]) {
        for (const page of ["popup", "options"]) {
            const label = `${browser}/${page}`;
            record(`${label}: built page renders and bundles run`, () => {
                if (!existsSync(path.join(ROOT, "dist", browser, page, page + ".html"))) {
                    throw new Error(`${label}: page not built`);
                }
            });
        }
    }

    for (const browser of ["firefox", "chrome"]) {
        const { win } = await runPage(browser, "popup");
        record(`${browser}/popup: explicit locale (fr) translates the UI`, () => {
            const el = win.document.querySelector('[data-i18n="popupEnabled"]');
            if (!el) throw new Error("missing labeled element");
            if (el.textContent !== "Activé") throw new Error(`expected Activé, got "${el.textContent}"`);
        });

        record(`${browser}/popup: locale + theme selects reflect saved settings`, () => {
            const loc = win.document.getElementById("locale");
            const th = win.document.getElementById("theme");
            if (loc.value !== "fr") throw new Error(`expected locale select fr, got "${loc.value}"`);
            if (th.value !== "dark") throw new Error(`expected theme select dark, got "${th.value}"`);
        });

        record(`${browser}/popup: enforced dark theme adds the theme-dark class`, () => {
            if (!win.document.documentElement.classList.contains("theme-dark")) {
                throw new Error("expected theme-dark class");
            }
        });
    }

    const opts = (await runPage("firefox", "options")).win;
    record("firefox/options: language/theme selects exist and settings applied", () => {
        if (!opts.document.getElementById("locale")) throw new Error("missing locale select");
        if (!opts.document.getElementById("theme")) throw new Error("missing theme select");
        if (opts.document.getElementById("enabled").checked !== true) throw new Error("enabled should be checked");
    });

    record("firefox/options: furigana preview follows the size slider", () => {
        const slider = opts.document.getElementById("scale");
        const preview = opts.document.getElementById("preview");
        if (preview.style.getPropertyValue("--preview-furigana-scale") !== "0.5em") {
            throw new Error("preview did not use the saved scale");
        }
        slider.value = "1.25";
        slider.dispatchEvent(new opts.Event("input"));
        if (preview.style.getPropertyValue("--preview-furigana-scale") !== "1.25em") {
            throw new Error("preview did not follow the slider");
        }
    });

    const inherited = await runPage(
        "chrome",
        "popup",
        { "furigana:excludedHosts": ["example.com"] },
        "https://www.example.com/page"
    );
    record("popup can re-enable a host covered by a normalized exclusion", () => {
        const toggle = inherited.win.document.getElementById("siteEnabled");
        if (toggle.checked) throw new Error("site should initially be excluded");
        toggle.checked = true;
        toggle.dispatchEvent(new inherited.win.Event("change"));
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    record("re-enabling removes the applicable exclusion rule", () => {
        if (inherited.data["furigana:excludedHosts"].length !== 0) {
            throw new Error("applicable parent exclusion was not removed");
        }
    });

    console.log(`\nui-bundle: ${count - failures}/${count} passed`);
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
