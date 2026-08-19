"use strict";

// Packages the built extension directories into installable archives:
//   dist/autofurigana-firefox.xpi   (zip with .xpi extension, for Firefox)
//   dist/autofurigana-chrome.zip    (unpacked-style zip, for Chrome)
//
// Uses adm-zip (battle-tested, pure JS) so the archives are accepted by
// Firefox's strict ZIP parser and by addons.mozilla.org.

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const pairs = [
    ["firefox", "autofurigana-firefox.xpi"],
    ["chrome", "autofurigana-chrome.zip"]
];
const only = process.argv.slice(2);

fs.mkdirSync(DIST, { recursive: true });
for (const [browser, name] of pairs) {
    if (only.length && only.indexOf(browser) === -1) continue;
    const dir = path.join(DIST, browser);
    if (!fs.existsSync(path.join(dir, "manifest.json"))) {
        console.log(`[pack] ${browser}: no built output, run "npm run build" first`);
        continue;
    }
    const zip = new AdmZip();
    zip.addLocalFolder(dir, "");
    const outFile = path.join(DIST, name);
    // Some AV/file watchers briefly lock the previous archive; drop it first.
    fs.rmSync(outFile, { force: true });
    zip.writeZip(outFile);
    console.log(`[pack] ${outFile} (${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB)`);
}
