(function (F) {
    "use strict";

    // Localisation helper.
    //
    // Localisation helper.
    //
    // Message text is embedded at build time as `F.i18nData` (a map of
    // locale -> messages.json). Translation therefore never depends on
    // browser-specific `i18n.getMessage` behaviour: Chrome and Firefox both
    // localize from the exact same bundled data, so the UI cannot drift
    // between browsers (previously Firefox's getMessage could fall back to the
    // default locale, leaving the UI in English).
    //
    // Language selection:
    //   "auto"   -> follow the browser UI language via getUILanguage() /
    //               navigator.language, best bundled locale wins.
    //   <code>   -> always use that bundled locale (en, fr, ja, zh_CN, pt,
    //               es, nl), independent of the browser's language.

    function i18nAPI() {
        if (
            typeof globalThis.browser !== "undefined" &&
            globalThis.browser &&
            globalThis.browser.i18n
        ) {
            return globalThis.browser.i18n;
        }
        if (typeof globalThis.chrome !== "undefined" && globalThis.chrome && globalThis.chrome.i18n) {
            return globalThis.chrome.i18n;
        }
        return null;
    }

    // Preferred language tag, e.g. "fr", "en-US", "zh-CN".
    //
    // Firefox can report the neutral "en-US" UI language from getUILanguage()
    // even though the browser's language is, say, French: that happens when
    // the localisation pack for the requested language is missing from the
    // build. navigator.language then carries the user's real preference, so a
    // bundled non-English navigator language wins over an "en-US" UI report.
    function detectLang() {
        var ui = null;
        var nav = null;
        var a = i18nAPI();
        try {
            if (a && typeof a.getUILanguage === "function") {
                var l = a.getUILanguage();
                if (l) ui = String(l);
            }
        } catch (err) {
            // ignore
        }
        try {
            if (typeof globalThis.navigator !== "undefined" && globalThis.navigator.language) {
                nav = String(globalThis.navigator.language);
            }
        } catch (err) {
            // ignore
        }
        var uiMatch = ui ? bestLocale(ui) : null;
        var navMatch = nav ? bestLocale(nav) : null;
        var isEnglishDefault = function (tag) {
            if (!tag) return false;
            var t = String(tag).trim().toLowerCase();
            return t === "en" || t.indexOf("en_") === 0 || t.indexOf("en-") === 0;
        };
        if (uiMatch && !isEnglishDefault(ui)) return uiMatch;
        if (navMatch) return navMatch;
        return ui || nav || "en";
    }

    // Normalize so a browser tag can be matched against bundled folder names:
    // "zh-CN" -> "zh_CN", "pt-BR" -> "pt_BR".
    function normalizeLocale(loc) {
        var s = String(loc || "").trim().toLowerCase();
        if (!s) return "";
        return s.replace(/-/g, "_");
    }

    function data() {
        return F.i18nData || null;
    }

    // Best bundled locale for a language preference, matched case-insensitively
    // (the browser may report "zh-CN" while the bundled folder is "zh_CN").
    // Exact match first, then the two-letter base, then "en".
    function bestLocale(pref) {
        var d = data();
        if (!d) return "en";
        var n = normalizeLocale(pref);
        var key, k;
        if (n) {
            for (k in d) {
                if (normalizeLocale(k) === n) return k;
            }
            var base = n.split("_")[0];
            for (k in d) {
                if (normalizeLocale(k) === base) return k;
            }
        }
        return d.en ? "en" : Object.keys(d)[0];
    }

    // The locale to use for `pref`; `pref` may be a concrete locale name or
    // the special value "auto".
    function resolvedLocale(pref) {
        if (!pref || pref === "auto") return bestLocale(detectLang());
        return bestLocale(pref);
    }

    // Message lookup for `key` in the locale chosen for `pref`. Returns null
    // when unavailable so callers keep the embedded English HTML fallback.
    function get(key, pref) {
        var d = data();
        if (!d) return null;
        var loc = resolvedLocale(pref);
        if (d[loc] && d[loc][key] && typeof d[loc][key].message === "string") {
            return d[loc][key].message;
        }
        if (d.en && d.en[key] && typeof d.en[key].message === "string") {
            return d.en[key].message;
        }
        return null;
    }

    // The <html lang> value matching the locale actually in use.
    function htmlLang(pref) {
        var loc = resolvedLocale(pref);
        return loc === "zh_CN" ? "zh-CN" : loc;
    }

    // Fills every element inside `root` that carries a data-i18n* attribute
    // and sets the document <html lang> to the locale in effect.
    function apply(root, pref) {
        root = root || globalThis.document;
        if (!root) return;
        try {
            var elems = root.querySelectorAll
                ? root.querySelectorAll("[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]")
                : [];
            for (var i = 0; i < elems.length; i++) {
                var el = elems[i];
                if (el.hasAttribute("data-i18n")) {
                    var value = get(el.getAttribute("data-i18n"), pref);
                    if (value) el.textContent = value;
                }
                if (el.hasAttribute("data-i18n-placeholder")) {
                    var ph = get(el.getAttribute("data-i18n-placeholder"), pref);
                    if (ph) el.setAttribute("placeholder", ph);
                }
                if (el.hasAttribute("data-i18n-title")) {
                    var title = get(el.getAttribute("data-i18n-title"), pref);
                    if (title) el.setAttribute("title", title);
                }
                if (el.hasAttribute("data-i18n-aria-label")) {
                    var aria = get(el.getAttribute("data-i18n-aria-label"), pref);
                    if (aria) el.setAttribute("aria-label", aria);
                }
            }
        } catch (err) {
            // ignore
        }
        try {
            var doc = root.nodeType === 9 ? root : root.ownerDocument;
            if (doc && doc.documentElement) {
                doc.documentElement.setAttribute("lang", htmlLang(pref));
            }
        } catch (err) {
            // ignore
        }
    }

    function availableLocales() {
        var d = data();
        return d ? Object.keys(d) : [];
    }

    F.i18n = {
        lang: detectLang,
        detectLang: detectLang,
        bestLocale: bestLocale,
        resolvedLocale: resolvedLocale,
        availableLocales: availableLocales,
        get: get,
        apply: apply
    };
})(globalThis.__FURIGANA__);