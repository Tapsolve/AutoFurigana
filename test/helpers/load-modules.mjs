import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Evaluates the extension's plain-JS modules (which share the global
// namespace `globalThis.__FURIGANA__`) inside Node.
export function loadModules(relativePaths, namespace) {
    const ns = namespace || {};
    globalThis.__FURIGANA__ = ns;
    for (const rel of relativePaths) {
        const src = readFileSync(path.join(ROOT, "src", rel), "utf8");
        // eslint-disable-next-line no-new-func
        new Function(src)();
    }
    return globalThis.__FURIGANA__;
}

// Minimal WebExtension storage mock (in-memory).
export function createStorageMock(initial) {
    const data = Object.assign({}, initial || {});
    const listeners = [];
    return {
        async get(keys) {
            const out = {};
            const keysArr = Array.isArray(keys) ? keys : [keys];
            for (const k of keysArr) {
                if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
            }
            return out;
        },
        async set(items) {
            for (const k of Object.keys(items)) data[k] = items[k];
            for (const fn of listeners) fn(items, "local");
        },
        async remove(keys) {
            for (const k of [].concat(keys)) delete data[k];
        },
        onChanged: {
            addListener(fn) {
                listeners.push(fn);
            }
        }
    };
}

export function deepFreeze(obj) {
    if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        for (const k of Object.keys(obj)) deepFreeze(obj[k]);
    }
    return obj;
}
