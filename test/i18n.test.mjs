import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = path.join(ROOT, "src", "_locales");
const EXPECTED = ["en", "fr", "zh_CN", "ja", "pt", "es", "nl"];
const BUNDLES = ["popup/popup.html", "options/options.html"];

function keysUsedIn(rel) {
    const src = readFileSync(path.join(ROOT, "src", rel), "utf8");
    const found = new Set();
    const re = /data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) found.add(m[1]);
    return found;
}

// Mirrors the browser's lookup: exact locale first, then language-only prefix.
function lookup(locale, key) {
    const files = ["messages.json"];
    const candidates = [locale];
    const base = locale.split(/[_-]/)[0];
    if (base !== locale) candidates.push(base);
    for (const c of candidates) {
        const p = path.join(LOCALES_DIR, c, "messages.json");
        if (existsSync(p)) {
            const data = JSON.parse(readFileSync(p, "utf8"));
            if (data[key] && typeof data[key].message === "string") return data[key].message;
        }
    }
    return null;
}

async function run() {
    let failures = 0;
    let count = 0;
    function recordAll(name, fn) {
        count++;
        try {
            fn();
            console.log(`  ok  ${name}`);
        } catch (err) {
            failures++;
            console.log(`  FAIL ${name}\n      ${err.message}`);
        }
    }

    recordAll("expected locale folders exist with valid messages.json", () => {
        for (const locale of EXPECTED) {
            const p = path.join(LOCALES_DIR, locale, "messages.json");
            if (!existsSync(p)) throw new Error(`missing ${locale}/messages.json`);
            JSON.parse(readFileSync(p, "utf8"));
        }
    });

    recordAll("all locales have the same message keys as English", () => {
        const en = JSON.parse(readFileSync(path.join(LOCALES_DIR, "en", "messages.json"), "utf8"));
        for (const locale of EXPECTED) {
            const data = JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, "messages.json"), "utf8"));
            const enKeys = Object.keys(en).sort();
            const locKeys = Object.keys(data).sort();
            if (JSON.stringify(enKeys) !== JSON.stringify(locKeys)) {
                throw new Error(
                    `${locale} keys differ:\n  en:  ${enKeys.join(", ")}\n  ${locale}: ${locKeys.join(", ")}`
                );
            }
        }
    });

    recordAll("every data-i18n key used in the UI exists in all locales", () => {
        const used = new Set();
        for (const rel of BUNDLES) {
            for (const k of keysUsedIn(rel)) used.add(k);
        }
        for (const k of used) {
            for (const locale of EXPECTED) {
                if (lookup(locale, k) === null) {
                    throw new Error(`"${k}" not found for locale ${locale}`);
                }
            }
        }
    });

    recordAll("manifest __MSG_ keys exist (extensionName, extensionDescription)", () => {
        for (const k of ["extensionName", "extensionDescription"]) {
            if (lookup("en", k) === null) throw new Error(`missing english message: ${k}`);
        }
    });

    recordAll("built dist contains _locales for both browsers", () => {
        for (const browser of ["firefox", "chrome"]) {
            const out = path.join(ROOT, "dist", browser, "_locales");
            if (!existsSync(out)) throw new Error(`${browser}: dist/_locales not built`);
            const dirs = readdirSync(out);
            for (const locale of EXPECTED) {
                if (!dirs.includes(locale)) throw new Error(`${browser}: missing ${locale}`);
            }
        }
    });

    recordAll("built bundles embed messages from every locale", () => {
        for (const browser of ["firefox", "chrome"]) {
            for (const rel of ["popup/popup.js", "options/options.js"]) {
                const abs = path.join(ROOT, "dist", browser, rel);
                const src = readFileSync(abs, "utf8");
                for (const locale of EXPECTED) {
                    const data = JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, "messages.json"), "utf8"));
                    const hint = data.optionsLanguageHint && data.optionsLanguageHint.message;
                    if (!hint) throw new Error(`${locale}: missing optionsLanguageHint`);
                    if (src.indexOf(hint) === -1) {
                        throw new Error(`${browser}/${rel}: ${locale} messages not embedded`);
                    }
                }
            }
        }
    });

    console.log(`\ni18n: ${count - failures}/${count} passed`);
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