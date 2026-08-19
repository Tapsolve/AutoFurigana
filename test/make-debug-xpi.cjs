"use strict";

// Builds a debug XPI from dist/firefox by instrumenting content.js:
//  - prepend: global probes written to data attributes (+ console.error capture)
//  - append: hooks that wrap F.main.init / F.analyzer so we can see where the
//            pipeline stops inside the isolated content-script world.

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const ROOT = path.resolve(__dirname, "..");
const SRC_EXT = path.join(ROOT, "dist", "firefox");
const OUT = process.env.FURIGANA_DBG_XPI || path.join(ROOT, "dist", "autofurigana-dbg.xpi");

const PREPEND = `(function (gl) {
    function attr(name, value) {
        try {
            if (gl.document && gl.document.documentElement) {
                gl.document.documentElement.setAttribute(name, String(value).slice(0, 600));
            }
        } catch (e) {}
    }
    var origError = console.error;
    console.error = function () {
        try { attr("furiErr", Array.prototype.slice.call(arguments).map(String).join(" ").slice(0, 600)); } catch (e) {}
        return origError.apply(console, arguments);
    };
    setTimeout(function () {
        var probe = {
            globalKuromoji: typeof gl.kuromoji,
            winKuromoji: (function () { try { return typeof gl.window.kuromoji; } catch (e) { return "ERR:" + e.message; } })(),
            selfKuromoji: (function () { try { return typeof gl.self.kuromoji; } catch (e) { return "ERR:" + e.message; } })(),
            sameAsWindow: gl === gl.window
        };
        attr("furiProbe", JSON.stringify(probe));
    }, 2000);
})(globalThis);
`;

const APPEND = `
;(function (gl) {
    function attr(name, value) {
        try {
            if (gl.document && gl.document.documentElement) {
                gl.document.documentElement.setAttribute(name, String(value).slice(0, 600));
            }
        } catch (e) {}
    }
    var F = gl.__FURIGANA__;
    if (F && F.getExtensionURL) {
        setTimeout(function () {
            var u = F.getExtensionURL("dict/base.dat.gz");
            attr("furiDictUrl", u);
            fetch(u)
                .then(function (r) {
                    return r.arrayBuffer().then(function (ab) {
                        attr("furiDictFetch", "status:" + r.status + " bytes:" + ab.byteLength);
                    });
                })
                .catch(function (e) {
                    attr("furiDictFetch", "ERR:" + (e && e.message));
                });
        }, 1500);
    }
    if (F && F.main && F.main.init) {
        var origInit = F.main.init;
        F.main.init = function () {
            attr("furiInit", "called");
            return origInit.apply(this, arguments).then(
                function () { attr("furiInit", "done"); },
                function (e) { attr("furiInitFail", (e && e.message) || String(e)); throw e; }
            );
        };
    } else { attr("furiHook", "no-F.main"); }
    if (F && F.analyzer && F.analyzer.createAnalyzer) {
        var origCreate = F.analyzer.createAnalyzer;
        F.analyzer.createAnalyzer = function (creator) {
            var a = origCreate.call(this, creator);
            var origGet = a.getTokenizer;
            a.getTokenizer = function () {
                attr("furiTok", "requested");
                return origGet.call(this).then(
                    function (t) { attr("furiTok", "ready"); return t; },
                    function (e) { attr("furiTokFail", (e && e.message) || String(e)); throw e; }
                );
            };
            return a;
        };
    } else { attr("furiHook", "no-F.analyzer"); }
})(globalThis);
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (!fs.existsSync(path.join(SRC_EXT, "manifest.json"))) {
    console.error("dist/firefox not built; run: npm run build:firefox");
    process.exit(1);
}

const zip = new AdmZip();
zip.addLocalFolder(SRC_EXT, "");
const content = fs.readFileSync(path.join(SRC_EXT, "content.js"), "utf8");
zip.updateFile("content.js", Buffer.from(PREPEND + content + APPEND, "utf8"));
zip.writeZip(OUT);
console.log("written", OUT);
