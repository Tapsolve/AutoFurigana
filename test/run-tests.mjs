// Test runner: builds the extensions, then runs all test suites.
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run as runFurigana } from "./furigana.test.mjs";
import { run as runDom } from "./dom.test.mjs";
import { run as runPrivacy } from "./privacy.test.mjs";
import { run as runI18n } from "./i18n.test.mjs";
import { run as runI18nResolve } from "./i18n-resolve.test.mjs";
import { run as runUiBundle } from "./ui-bundle.test.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("== Build ==");
execSync(`node "${path.join(ROOT, "build", "build.js")}"`, { stdio: "inherit", cwd: ROOT });

console.log("\n== Furigana alignment ==");
const furiganaOk = await runFurigana();

console.log("\n== DOM integration ==");
const domOk = await runDom();

console.log("\n== Privacy / offline ==");
const privacyOk = await runPrivacy();

console.log("\n== i18n / localisation ==");
const i18nOk = await runI18n();

console.log("\n== i18n locale resolution ==");
const i18nResolveOk = await runI18nResolve();

console.log("\n== UI bundles (built popup/options) ==");
const uiBundleOk = await runUiBundle();

const ok = furiganaOk && domOk && privacyOk && i18nOk && i18nResolveOk && uiBundleOk;
console.log(`\n${ok ? "ALL TESTS PASSED" : "TESTS FAILED"}`);
process.exit(ok ? 0 : 1);
