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
    var KEY_OVERRIDES = "furigana:overrides";
    var KEY_CORRECTION = "furigana:correctionEnabled";

    var DEFAULTS = {
        enabled: true,
        excludedHosts: [],
        scale: 0.5,
        locale: "auto",
        theme: "auto",
        overrides: {},
        correctionEnabled: true
    };

    // Corrections are stored as base -> reading (hiragana). A key whose value
    // is an empty string means "no correction" and is dropped.
    function normalizeOverrides(value) {
        var out = {};
        if (!value || typeof value !== "object") return out;
        for (var base in value) {
            if (!Object.prototype.hasOwnProperty.call(value, base)) continue;
            var reading = String(value[base] || "").trim();
            if (reading) out[base] = reading;
        }
        return out;
    }

    function getOverride(overrides, base) {
        if (!overrides || !base) return null;
        return Object.prototype.hasOwnProperty.call(overrides, base) ? overrides[base] : null;
    }

    function hasOverride(overrides, base) {
        var value = getOverride(overrides, base);
        return value != null && value !== "";
    }

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
        return area
            .get([KEY_ENABLED, KEY_EXCLUDED, KEY_SCALE, KEY_LOCALE, KEY_THEME, KEY_OVERRIDES, KEY_CORRECTION])
            .then(function (items) {
                return {
                    enabled: typeof items[KEY_ENABLED] === "boolean" ? items[KEY_ENABLED] : DEFAULTS.enabled,
                    excludedHosts: Array.isArray(items[KEY_EXCLUDED])
                        ? items[KEY_EXCLUDED].map(normalizeHost).filter(Boolean)
                        : DEFAULTS.excludedHosts,
                    scale: normalizeScale(items[KEY_SCALE]),
                    locale: typeof items[KEY_LOCALE] === "string" ? items[KEY_LOCALE] : DEFAULTS.locale,
                    theme: typeof items[KEY_THEME] === "string" ? items[KEY_THEME] : DEFAULTS.theme,
                    overrides: normalizeOverrides(items[KEY_OVERRIDES]),
                    correctionEnabled:
                        typeof items[KEY_CORRECTION] === "boolean"
                            ? items[KEY_CORRECTION]
                            : DEFAULTS.correctionEnabled
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
        KEY_OVERRIDES: KEY_OVERRIDES,
        KEY_CORRECTION: KEY_CORRECTION,
        DEFAULTS: DEFAULTS,
        load: load,
        set: set,
        normalizeHost: normalizeHost,
        normalizeScale: normalizeScale,
        normalizeOverrides: normalizeOverrides,
        getOverride: getOverride,
        hasOverride: hasOverride,
        isHostExcluded: isHostExcluded
    };
})(globalThis.__FURIGANA__);
