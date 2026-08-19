(function (F) {
    "use strict";

    // Minimal cross-browser WebExtension API accessor.
    // Firefox exposes `browser`, Chrome exposes `chrome`.
    // Resolved lazily so the helper also works in environments where the
    // global appears after module evaluation (e.g. tests).
    function resolveAPI() {
        if (
            typeof globalThis.browser !== "undefined" &&
            globalThis.browser &&
            globalThis.browser.runtime
        ) {
            return globalThis.browser;
        }
        if (typeof globalThis.chrome !== "undefined" && globalThis.chrome) {
            return globalThis.chrome;
        }
        return null;
    }

    function storageArea() {
        var api = resolveAPI();
        return (api && api.storage && api.storage.local) || null;
    }

    function getExtensionURL(path) {
        var api = resolveAPI();
        if (api && api.runtime && typeof api.runtime.getURL === "function") {
            return api.runtime.getURL(path);
        }
        return path;
    }

    function onStorageChanged(listener) {
        var api = resolveAPI();
        if (api && api.storage && api.storage.onChanged && typeof api.storage.onChanged.addListener === "function") {
            api.storage.onChanged.addListener(listener);
        }
    }

    // `F.api` is exposed as a lazy getter so callers always resolve the
    // current global (browser/chrome) instead of a stale snapshot.
    Object.defineProperty(F, "api", {
        get: function () {
            return resolveAPI();
        },
        enumerable: true,
        configurable: true
    });
    F.storageArea = storageArea;
    F.getExtensionURL = getExtensionURL;
    F.onStorageChanged = onStorageChanged;
})(globalThis.__FURIGANA__);