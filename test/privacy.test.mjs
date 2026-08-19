import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const AUTHORED_BUNDLES = ["content.js", "shadow-hook-main.js", "options/options.js", "popup/popup.js"];
const KUROMOJI_START = "/*__FURIGANA_KUROMOJI_START__*/";
const KUROMOJI_END = "/*__FURIGANA_KUROMOJI_END__*/";

// content.js embeds the vendored kuromoji bundle (so Firefox's per-file sandbox
// sees its global). Strip that region before scanning our own code; the
// verifiable klormoji code is still checked separately below.
function stripEmbeddedKuromoji(src) {
    const start = src.indexOf(KUROMOJI_START);
    const end = start === -1 ? -1 : src.indexOf(KUROMOJI_END, start);
    if (start === -1 || end === -1) return src;
    return src.slice(0, start) + src.slice(end + KUROMOJI_END.length);
}

function embeddedKuromoji(src) {
    const start = src.indexOf(KUROMOJI_START);
    const end = start === -1 ? -1 : src.indexOf(KUROMOJI_END, start);
    if (start === -1 || end === -1) throw new Error("embedded kuromoji markers are missing");
    return src.slice(start + KUROMOJI_START.length, end);
}
const FORBIDDEN_IN_AUTHORED = [
    "fetch(",
    "XMLHttpRequest",
    "new WebSocket",
    "WebSocket(",
    "EventSource",
    "sendBeacon",
    "http://",
    "https://",
    "navigator.sendBeacon"
];
const FORBIDDEN_CODE = ["eval(", "new Function"];

// Crude JS comment stripper (handles // and /* */ but not strings).
function stripComments(src) {
    let out = "";
    let i = 0;
    let inString = null;
    while (i < src.length) {
        const c = src[i];
        const n = src[i + 1];
        if (inString) {
            out += c;
            if (c === "\\") {
                out += n || "";
                i += 2;
                continue;
            }
            if (c === inString) inString = null;
            i++;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inString = c;
            out += c;
            i++;
            continue;
        }
        if (c === "/" && n === "/") {
            while (i < src.length && src[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && n === "*") {
            i += 2;
            while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
            i += 2;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

function checkBundle(browserDir, relPath, forbid, allow) {
    const abs = path.join(browserDir, relPath);
    let src = readFileSync(abs, "utf8");
    if (relPath === "content.js") src = stripEmbeddedKuromoji(src);
    const violations = [];
    for (const pat of forbid) {
        let idx = src.indexOf(pat);
        while (idx !== -1) {
            let ok = false;
            if (allow) {
                for (const a of allow) {
                    if (idx >= a.index && idx < a.index + a.pattern.length) {
                        ok = true;
                        break;
                    }
                }
            }
            if (!ok) {
                const ctx = src.slice(Math.max(0, idx - 40), idx + 60).replace(/\s+/g, " ");
                violations.push(`${pat} near ...${ctx}...`);
            }
            idx = src.indexOf(pat, idx + 1);
        }
    }
    return violations;
}

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

async function run() {
    let failures = 0;
    let count = 0;

    function record(name, fn) {
        count++;
        try {
            const result = fn();
            if (result && typeof result.then === "function") {
                return result.then(
                    () => console.log(`  ok  ${name}`),
                    (err) => {
                        failures++;
                        console.log(`  FAIL ${name}\n      ${err.message}`);
                    }
                );
            }
            console.log(`  ok  ${name}`);
        } catch (err) {
            failures++;
            console.log(`  FAIL ${name}\n      ${err.message}`);
        }
    }

    const browsers = ["firefox", "chrome"];

    for (const browser of browsers) {
        const dir = path.join(ROOT, "dist", browser);

        console.log(`Privacy scan (${browser}):`);

        await record("authored bundles have no network APIs / URLs", () => {
            for (const rel of AUTHORED_BUNDLES) {
                const v = checkBundle(dir, rel, FORBIDDEN_IN_AUTHORED);
                if (v.length) throw new Error(`${rel}: ${v.join(" | ")}`);
            }
        });

        await record("authored bundles have no eval / new Function", () => {
            for (const rel of AUTHORED_BUNDLES) {
                const v = checkBundle(dir, rel, FORBIDDEN_CODE);
                if (v.length) throw new Error(`${rel}: ${v.join(" | ")}`);
            }
        });

        await record("kuromoji bundle has no http(s) outside comments", () => {
            const src = embeddedKuromoji(readFileSync(path.join(dir, "content.js"), "utf8"));
            const code = stripComments(src);
            for (const pat of ["http://", "https://"]) {
                if (code.includes(pat)) {
                    throw new Error(`"${pat}" found in non-comment code`);
                }
            }
        });

        await record("kuromoji bundle's only XHR is the local dict loader", () => {
            const src = embeddedKuromoji(readFileSync(path.join(dir, "content.js"), "utf8"));
            const matches = src.split("XMLHttpRequest").length - 1;
            // The loader code is the only legitimate use: it reads .gz files
            // from the extension's own dict/ directory.
            if (matches !== 1) throw new Error(`expected exactly 1 XMLHttpRequest reference, found ${matches}`);
            const loader = src.slice(src.indexOf("XMLHttpRequest"), src.indexOf("XMLHttpRequest") + 400);
            if (!/responseType\s*=\s*"arraybuffer"/.test(loader)) {
                throw new Error("unexpected XHR usage");
            }
        });

        await record("dictionary is bundled (12 .gz files)", () => {
            const dictDir = path.join(dir, "dict");
            const files = readdirSync(dictDir).filter((f) => f.endsWith(".gz"));
            if (files.length !== 12) throw new Error(`expected 12 dictionary files, found ${files.length}`);
        });

        await record("manifest requests only necessary permissions", () => {
            const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
            const perms = manifest.permissions || [];
            const allowed = new Set(["storage", "activeTab"]);
            for (const p of perms) {
                if (!allowed.has(p)) throw new Error(`unexpected permission: ${p}`);
            }
            if (!manifest.content_scripts || manifest.content_scripts.length !== 2) {
                throw new Error("expected MAIN-world bridge and isolated content script declarations");
            }
            const bridge = manifest.content_scripts.find((entry) => entry.world === "MAIN");
            const cs = manifest.content_scripts.find((entry) => (entry.js || []).includes("content.js"));
            if (!bridge || !bridge.js.includes("shadow-hook-main.js")) throw new Error("missing MAIN-world shadow bridge");
            if (bridge.run_at !== "document_start") throw new Error("shadow bridge must run at document_start");
            if (!cs) throw new Error("missing isolated content script");
            if (cs.matches && !cs.matches.includes("<all_urls>")) throw new Error("content script should match <all_urls>");
            if (cs.all_frames !== true) throw new Error("content script should run in all frames");
            if (cs.run_at !== "document_idle") throw new Error("content script should run at document_idle");
        });

        await record("no remote permissions (host_permissions)", () => {
            const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
            if (manifest.host_permissions && manifest.host_permissions.length) {
                throw new Error("host_permissions should not be needed");
            }
        });

        await record("no extra files that could contain page data", () => {
            const all = walk(dir);
            const allowedPrefixes = [
                path.join(dir, "manifest.json"),
                path.join(dir, "content.js"),
                path.join(dir, "shadow-hook-main.js"),
                path.join(dir, "content.css"),
                path.join(dir, "dict"),
                path.join(dir, "icons"),
                path.join(dir, "options"),
                path.join(dir, "popup"),
                path.join(dir, "_locales")
            ];
            for (const f of all) {
                const ok = allowedPrefixes.some((p) => f === p || f.startsWith(p + path.sep));
                if (!ok) throw new Error(`unexpected file: ${f}`);
            }
        });
    }

    console.log(`\nprivacy: ${count - failures}/${count} passed`);
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
