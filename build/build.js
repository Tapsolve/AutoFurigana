"use strict";

// Build script for the AutoFurigana extension.
//
// Produces two self-contained unpacked extensions:
//   dist/firefox/   (Firefox MV3, gecko-specific manifest)
//   dist/chrome/    (Chrome MV3, chrome-specific manifest)
//
// Everything is bundled inside the extension package: JS, dictionary, CSS,
// icons. No runtime code is fetched from anywhere.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SRC = path.join(ROOT, "src");
const NODE_MODULES = path.join(ROOT, "node_modules");

const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const CONTENT_MODULE_ORDER = [
    "shared/browser-api.js",
    "<locales>",
    "shared/i18n.js",
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
    "content/correction.js",
    "content/index.js"
];

const PAGE_MODULES = {
    "options/options.js": [
        "shared/browser-api.js",
        "<locales>",
        "shared/i18n.js",
        "content/settings.js",
        "options/options.js"
    ],
    "popup/popup.js": [
        "shared/browser-api.js",
        "<locales>",
        "shared/i18n.js",
        "content/settings.js",
        "popup/popup.js"
    ]
};

// Inlines _locales/*/messages.json into the bundle as `F.i18nData`. The UI
// translates from this bundled data instead of the browser's i18n API, so
// Chrome and Firefox (which can pick different locales for getMessage) always
// show the same language. Also enables the manual language picker.
function localesDataModule() {
    const data = {};
    for (const entry of fs.readdirSync(path.join(SRC, "_locales"))) {
        const p = path.join(SRC, "_locales", entry, "messages.json");
        if (fs.statSync(p).isFile()) {
            data[entry] = JSON.parse(fs.readFileSync(p, "utf8"));
        }
    }
    return `(function (F) {\n    "use strict";\n    F.i18nData = ${JSON.stringify(data)};\n})(globalThis.__FURIGANA__);\n`;
}

const BUNDLE_HEADER = `(function () {\n    "use strict";\n    const F = (globalThis.__FURIGANA__ = globalThis.__FURIGANA__ || {});\n`;
const BUNDLE_TRAILER = `})(globalThis.__FURIGANA__);\n`;

// kuromoji's browser bundle is appended directly to content.js so its exports
// land on the SAME global as our content script. Firefox executes each
// content_scripts file in a separate sandbox, and inside that sandbox `window`
// is an Xray wrapper where expando writes (window.kuromoji = ...) are dropped
// while `globalThis` is the writable sandbox global. We therefore shadow
// window/self/global with globalThis so the UMD attaches where we can read it.
const KUROMOJI_PROLOGUE = `(function () {
    var window = globalThis;
    var self = globalThis;
    var global = globalThis;
    // kuromoji's browserify path.join mangles "moz-extension://id/dict/" +
    // filename into "moz-extension:id/dict/file" (it drops the empty segment,
    // i.e. the "//"). Build files directly from the extension URL instead.
    function __furigana_join(base, name) {
        var F = globalThis.__FURIGANA__;
        if (F && typeof F.getExtensionURL === "function" && typeof name === "string") {
            return F.getExtensionURL("dict/" + name);
        }
        return base + name;
    }
`;
const KUROMOJI_EPILOGUE = `
})();
`;
const KUROMOJI_START = "/*__FURIGANA_KUROMOJI_START__*/\n";
const KUROMOJI_END = "\n/*__FURIGANA_KUROMOJI_END__*/\n";

function bundleWithKuromoji(files) {
    let kuromojiSrc = fs.readFileSync(
        path.join(NODE_MODULES, "kuromoji", "build", "kuromoji.js"),
        "utf8"
    );
    // Kuromoji's Lodash dependency has a dynamic-code fallback for finding the
    // global object. WebExtensions already provide globalThis, and Firefox
    // treats the Function constructor like eval, so remove that fallback from
    // the packaged bundle.
    let globalFallbacks = 0;
    kuromojiSrc = kuromojiSrc.replace(
        /\bFunction\s*\(\s*(['"])return this\1\s*\)\s*\(\s*\)/g,
        function () {
            globalFallbacks++;
            return "globalThis";
        }
    );
    if (globalFallbacks !== 1) {
        throw new Error(`Expected one Kuromoji dynamic global fallback, found ${globalFallbacks}`);
    }
    kuromojiSrc = kuromojiSrc.replace(
        /path\.join\(dic_path/g,
        "__furigana_join(dic_path"
    );
    return (
        bundle(files) +
        "\n" +
        KUROMOJI_START +
        KUROMOJI_PROLOGUE +
        kuromojiSrc +
        KUROMOJI_EPILOGUE +
        KUROMOJI_END
    );
}

function bundle(files) {
    const parts = [BUNDLE_HEADER];
    for (const rel of files) {
        if (rel === "<locales>") {
            parts.push(`\n/* ===== _locales (embedded messages) ===== */\n`);
            parts.push(localesDataModule());
            continue;
        }
        const content = fs.readFileSync(path.join(SRC, rel), "utf8");
        parts.push(`\n/* ===== ${rel} ===== */\n`);
        parts.push(content);
    }
    parts.push(BUNDLE_TRAILER);
    return parts.join("\n");
}

function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) {
        const src = path.join(from, entry);
        const dest = path.join(to, entry);
        if (fs.statSync(src).isDirectory()) {
            copyDir(src, dest);
        } else {
            fs.copyFileSync(src, dest);
        }
    }
}

// ---------------------------------------------------------------------
// Icon generation (pure Node, no external deps).
// Draws a rounded gradient square with two white "annotation" bars.
// ---------------------------------------------------------------------
function makeIcon(size) {
    const buf = Buffer.alloc(size * size * 4);
    const s = size;
    const margin = Math.max(1, Math.round(s * 0.05));
    const corner = Math.max(1, Math.round(s * 0.2));
    const c1 = [59, 130, 246]; // #3b82f6
    const c2 = [30, 64, 175]; // #1e40af

    function insideRoundRect(x, y, x0, y0, x1, y1, r) {
        if (x < x0 || x > x1 || y < y0 || y > y1) return false;
        const cx = Math.max(x0 + r, Math.min(x1 - r, x));
        const cy = Math.max(y0 + r, Math.min(y1 - r, y));
        const dx = x - cx;
        const dy = y - cy;
        return dx * dx + dy * dy <= r * r + 0.5;
    }

    function insideBar(x, y, x0, y0, x1, y1, r) {
        if (x < x0 || x > x1 || y < y0 || y > y1) return false;
        const px = Math.max(x0 + r, Math.min(x1 - r, x));
        const py = Math.max(y0 + r, Math.min(y1 - r, y));
        const dx = x - px;
        const dy = y - py;
        return dx * dx + dy * dy <= r * r + 0.5;
    }

    // Annotation bars (proportions of the icon size).
    const barTop = { x0: s * 0.34, y0: s * 0.32, x1: s * 0.66, y1: s * 0.40, r: s * 0.04 };
    const barBase = { x0: s * 0.24, y0: s * 0.62, x1: s * 0.76, y1: s * 0.74, r: s * 0.05 };

    for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
            const fx = x + 0.5;
            const fy = y + 0.5;
            const idx = (y * s + x) * 4;

            if (!insideRoundRect(fx, fy, margin, margin, s - margin, s - margin, corner)) {
                buf[idx + 3] = 0;
                continue;
            }

            let r, g, b;
            if (
                insideBar(fx, fy, barTop.x0, barTop.y0, barTop.x1, barTop.y1, barTop.r) ||
                insideBar(fx, fy, barBase.x0, barBase.y0, barBase.x1, barBase.y1, barBase.r)
            ) {
                r = 255;
                g = 255;
                b = 255;
            } else {
                const t = (fy - margin) / (s - 2 * margin);
                r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
                g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
                b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
            }

            buf[idx] = r;
            buf[idx + 1] = g;
            buf[idx + 2] = b;
            buf[idx + 3] = 255;
        }
    }
    return encodePng(buf, size, size);
}

function encodePng(rgba, width, height) {
    function chunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeBuf = Buffer.from(type, "ascii");
        const crcBody = Buffer.concat([typeBuf, data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(crcBody), 0);
        return Buffer.concat([len, typeBuf, data, crc]);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0; // filter: none
        rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }
    const idat = zlib.deflateSync(raw, { level: 9 });

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", idat),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

let CRC_TABLE = null;
function crc32(buf) {
    if (!CRC_TABLE) {
        CRC_TABLE = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c;
        }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------
function buildBrowser(browser) {
    const out = path.join(DIST, browser);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });

    // manifest
    const manifest = JSON.parse(
        fs.readFileSync(path.join(SRC, "manifest", browser + ".json"), "utf8")
    );
    manifest.version = PACKAGE.version;
    if (!manifest.description) manifest.description = PACKAGE.description;
    fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

    // content script bundle (kuromoji embedded so Firefox sees its globals)
    fs.writeFileSync(path.join(out, "content.js"), bundleWithKuromoji(CONTENT_MODULE_ORDER));
    fs.copyFileSync(
        path.join(SRC, "content", "shadow-hook-main.js"),
        path.join(out, "shadow-hook-main.js")
    );

    // page bundles + their static files
    for (const [rel, modules] of Object.entries(PAGE_MODULES)) {
        const abs = path.join(out, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, bundle(modules));
    }
    for (const dir of ["options", "popup"]) {
        fs.copyFileSync(
            path.join(SRC, dir, dir + ".html"),
            path.join(out, dir, dir + ".html")
        );
        fs.copyFileSync(
            path.join(SRC, dir, dir + ".css"),
            path.join(out, dir, dir + ".css")
        );
    }

    // content CSS
    fs.copyFileSync(path.join(SRC, "styles", "furigana.css"), path.join(out, "content.css"));

    // localised UI messages (browser picks the best match for its language)
    copyDir(path.join(SRC, "_locales"), path.join(out, "_locales"));

    // dictionary (from the extension package, loaded locally)
    copyDir(path.join(NODE_MODULES, "kuromoji", "dict"), path.join(out, "dict"));

    // icons
    fs.mkdirSync(path.join(out, "icons"), { recursive: true });
    for (const size of [16, 32, 48, 128]) {
        fs.writeFileSync(path.join(out, "icons", `icon${size}.png`), makeIcon(size));
    }

    const dictMB = (fs.readdirSync(path.join(out, "dict")).reduce(
        (acc, f) => acc + fs.statSync(path.join(out, "dict", f)).size,
        0
    ) / 1048576).toFixed(1);

    console.log(`[build] ${browser}: ${out} (dictionary ~${dictMB} MB)`);
    return out;
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const which = targets.length ? targets : ["firefox", "chrome"];

// A full build is a clean release build. Targeted builds preserve the other
// browser's output while still replacing their own directory atomically.
if (!targets.length) fs.rmSync(DIST, { recursive: true, force: true });

for (const browser of which) {
    buildBrowser(browser);
}
console.log("[build] done");
