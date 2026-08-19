(function (F) {
    "use strict";

    // Settings are stored in the browser's local extension storage.
    // Keys are individual so popup/options/content-script writes never clobber
    // each other. No page text, tokenization results, or URLs are ever stored.
    var KEY_ENABLED = "furigana:enabled";
    var KEY_EXCLUDED = "furigana:excludedHosts";
    var KEY_SCALE = "furigana:scale";
    var KEY_LOCALE = "furigana:locale";
    var KEY_THEME = "furigana:theme";

    var DEFAULTS = {
        enabled: true,
        excludedHosts: [],
        scale: 0.5,
        locale: "auto",
        theme: "auto"
    };

    function normalizeHost(value) {
        var raw = String(value || "").trim().toLowerCase();
        if (!raw) return "";
        try {
            raw = new URL(raw.indexOf("://") !== -1 ? raw : "http" + "://" + raw).hostname;
        } catch (err) {
            return "";
        }
        return raw.replace(/^www\./, "").replace(/\.$/, "");
    }

    function normalizeScale(value) {
        return typeof value === "number" && Number.isFinite(value)
            ? Math.min(2, Math.max(0.1, value))
            : DEFAULTS.scale;
    }

    function load() {
        var area = F.storageArea();
        if (!area) return Promise.resolve(DEFAULTS);
        return area.get([KEY_ENABLED, KEY_EXCLUDED, KEY_SCALE, KEY_LOCALE, KEY_THEME]).then(function (items) {
            return {
                enabled: typeof items[KEY_ENABLED] === "boolean" ? items[KEY_ENABLED] : DEFAULTS.enabled,
                excludedHosts: Array.isArray(items[KEY_EXCLUDED])
                    ? items[KEY_EXCLUDED].map(normalizeHost).filter(Boolean)
                    : DEFAULTS.excludedHosts,
                scale: normalizeScale(items[KEY_SCALE]),
                locale: typeof items[KEY_LOCALE] === "string" ? items[KEY_LOCALE] : DEFAULTS.locale,
                theme: typeof items[KEY_THEME] === "string" ? items[KEY_THEME] : DEFAULTS.theme
            };
        });
    }

    function set(key, value) {
        var area = F.storageArea();
        if (!area) return Promise.resolve();
        var patch = {};
        patch[key] = value;
        return area.set(patch);
    }

    // A hostname is excluded when it equals an entry or is a subdomain of one.
    function isHostExcluded(hostname, excludedHosts) {
        if (!hostname || !Array.isArray(excludedHosts)) return false;
        var h = normalizeHost(hostname);
        for (var i = 0; i < excludedHosts.length; i++) {
            var entry = normalizeHost(excludedHosts[i]);
            if (!entry) continue;
            if (h === entry || h.endsWith("." + entry)) return true;
        }
        return false;
    }

    F.settings = {
        KEY_ENABLED: KEY_ENABLED,
        KEY_EXCLUDED: KEY_EXCLUDED,
        KEY_SCALE: KEY_SCALE,
        KEY_LOCALE: KEY_LOCALE,
        KEY_THEME: KEY_THEME,
        DEFAULTS: DEFAULTS,
        load: load,
        set: set,
        normalizeHost: normalizeHost,
        normalizeScale: normalizeScale,
        isHostExcluded: isHostExcluded
    };
})(globalThis.__FURIGANA__);
