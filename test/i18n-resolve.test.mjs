import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { loadModules } from "./helpers/load-modules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Minimal bundled locale data representative of _locales/*/messages.json.
const LOCALES = {
    en: {
        hello: { message: "Hello" },
        missingHere: { message: "Only in en" }
    },
    fr: {
        hello: { message: "Bonjour" }
    },
    zh_CN: {
        hello: { message: "你好" }
    },
    pt: {
        hello: { message: "Olá" }
    }
};

function makeNamespace(browserLang) {
    const ns = {};
    globalThis.__FURIGANA__ = ns;
    globalThis.browser = browserLang
        ? { i18n: { getUILanguage: function () { return browserLang; } } }
        : undefined;
    // loadModules evaluates src/shared/i18n.js into the namespace
    loadModules(["shared/i18n.js"], ns);
    ns.i18nData = LOCALES;
    return ns;
}

function resetGlobals() {
    globalThis.__FURIGANA__ = undefined;
    globalThis.browser = undefined;
    globalThis.chrome = undefined;
    globalThis.document = undefined;
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

    record("auto follows the browser UI language (fr)", () => {
        const ns = makeNamespace("fr");
        if (ns.i18n.resolvedLocale("auto") !== "fr") throw new Error("expected fr");
        if (ns.i18n.get("hello", "auto") !== "Bonjour") throw new Error("expected Bonjour");
    });

    record("auto matches region tags to bundled folder (zh-CN -> zh_CN)", () => {
        const ns = makeNamespace("zh-CN");
        if (ns.i18n.resolvedLocale("auto") !== "zh_CN") throw new Error("expected zh_CN");
        if (ns.i18n.get("hello", "auto") !== "你好") throw new Error("expected 你好");
    });

    record("auto falls back to the language base (pt-BR -> pt)", () => {
        const ns = makeNamespace("pt-BR");
        if (ns.i18n.resolvedLocale("auto") !== "pt") throw new Error("expected pt");
        if (ns.i18n.get("hello", "auto") !== "Olá") throw new Error("expected Olá");
    });

    record("auto with an unsupported language defaults to en", () => {
        const ns = makeNamespace("de-DE");
        if (ns.i18n.resolvedLocale("auto") !== "en") throw new Error("expected en");
        if (ns.i18n.get("hello", "auto") !== "Hello") throw new Error("expected Hello");
    });

    record("Firefox: neutral en-US UI falls back to the navigator language (fr)", () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", {
            value: { language: "fr" },
            configurable: true,
            writable: true
        });
        try {
            const ns = makeNamespace("en-US");
            if (ns.i18n.resolvedLocale("auto") !== "fr") throw new Error("expected fr from navigator");
            if (ns.i18n.get("hello", "auto") !== "Bonjour") throw new Error("expected Bonjour");
        } finally {
            if (original) Object.defineProperty(globalThis, "navigator", original);
            else delete globalThis.navigator;
        }
    });

    record("genuine English browser stays English (en-US UI, en navigator)", () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", {
            value: { language: "en-US" },
            configurable: true,
            writable: true
        });
        try {
            const ns = makeNamespace("en-US");
            if (ns.i18n.resolvedLocale("auto") !== "en") throw new Error("expected en");
        } finally {
            if (original) Object.defineProperty(globalThis, "navigator", original);
            else delete globalThis.navigator;
        }
    });

    record("getUILanguage dominates navigator when it names a bundled locale", () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", {
            value: { language: "en" },
            configurable: true,
            writable: true
        });
        try {
            const ns = makeNamespace("fr");
            if (ns.i18n.resolvedLocale("auto") !== "fr") throw new Error("expected fr");
        } finally {
            if (original) Object.defineProperty(globalThis, "navigator", original);
            else delete globalThis.navigator;
        }
    });

    record("explicit locale overrides the browser language", () => {
        const ns = makeNamespace("en-US");
        if (ns.i18n.get("hello", "ja") !== "Hello") throw new Error("ja is bundled? no - expect en fallback");
        if (ns.i18n.get("hello", "fr") !== "Bonjour") throw new Error("expected Bonjour from explicit fr");
    });

    record("unknown explicit locale falls back to the browser language", () => {
        const ns = makeNamespace("en-US");
        if (ns.i18n.resolvedLocale("xx") !== "en") throw new Error("expected en");
    });

    record("get returns null for a missing key (keeps HTML fallback)", () => {
        const ns = makeNamespace("fr");
        if (ns.i18n.get("doesNotExist", "auto") !== null) throw new Error("expected null");
    });

    record("no browser API -> navigator.language fallback works", () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", {
            value: { language: "fr-FR" },
            configurable: true,
            writable: true
        });
        try {
            const ns = makeNamespace(null);
            if (ns.i18n.resolvedLocale("auto") !== "fr") throw new Error("expected fr from navigator");
        } finally {
            if (original) Object.defineProperty(globalThis, "navigator", original);
            else delete globalThis.navigator;
        }
    });

    record("apply() translates the UI and sets <html lang>", () => {
        const dom = new JSDOM('<!DOCTYPE html><html><body><h1 data-i18n="hello">Hello</h1></body></html>');
        globalThis.document = dom.window.document;
        const ns = makeNamespace("fr");
        ns.i18n.apply(globalThis.document, "auto");
        const h1 = globalThis.document.querySelector("h1");
        if (h1.textContent !== "Bonjour") throw new Error(`expected Bonjour, got ${h1.textContent}`);
        if (globalThis.document.documentElement.getAttribute("lang") !== "fr") {
            throw new Error("expected lang=fr");
        }
    });

    record("apply() uses explicit zh_CN and renders a valid lang tag", () => {
        const dom = new JSDOM('<!DOCTYPE html><html><body><h1 data-i18n="hello">Hello</h1></body></html>');
        globalThis.document = dom.window.document;
        const ns = makeNamespace("en-US");
        ns.i18n.apply(globalThis.document, "zh_CN");
        const h1 = globalThis.document.querySelector("h1");
        if (h1.textContent !== "你好") throw new Error("expected 你好");
        if (globalThis.document.documentElement.getAttribute("lang") !== "zh-CN") {
            throw new Error("expected lang=zh-CN");
        }
    });

    resetGlobals();
    console.log(`\ni18n-resolve: ${count - failures}/${count} passed`);
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