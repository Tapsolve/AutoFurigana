(function (F) {
    "use strict";

    var S = F.settings;

    F.i18n.apply(document);

    var enabledEl = document.getElementById("enabled");
    var siteEnabledEl = document.getElementById("siteEnabled");
    var siteRowEl = document.getElementById("siteRow");
    var siteHintEl = document.getElementById("siteHint");
    var scaleEl = document.getElementById("scale");
    var scaleValueEl = document.getElementById("scaleValue");
    var localeEl = document.getElementById("locale");
    var themeEl = document.getElementById("theme");
    var optionsBtnEl = document.getElementById("optionsBtn");

    var currentHost = "";
    var currentExcluded = false;
    var currentTheme = "auto";

    function getTabs() {
        if (F.api && F.api.tabs && typeof F.api.tabs.query === "function") {
            return F.api.tabs.query({ active: true, currentWindow: true });
        }
        return Promise.resolve([]);
    }

    function hostnameOf(url) {
        try {
            var u = new URL(url);
            if (u.protocol === "http:" || u.protocol === "https:") return u.hostname;
        } catch (err) {
            // ignore
        }
        return "";
    }

    async function getCurrentHost() {
        var tabs = await getTabs();
        var tab = tabs && tabs[0];
        return S.normalizeHost(hostnameOf(tab && tab.url));
    }

    function effectiveTheme(theme) {
        if (theme === "dark" || theme === "light") return theme;
        if (typeof globalThis.matchMedia === "function") {
            try {
                if (globalThis.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
            } catch (err) {
                // ignore
            }
        }
        return "light";
    }

    function applyTheme(saved) {
        currentTheme = (saved && (saved === "auto" ? "auto" : saved)) || "auto";
        var eff = effectiveTheme(currentTheme);
        document.documentElement.classList.toggle("theme-dark", eff === "dark");
        if (themeEl) themeEl.value = currentTheme;
    }

    function watchTheme() {
        if (typeof globalThis.matchMedia !== "function") return;
        var mq;
        try {
            mq = globalThis.matchMedia("(prefers-color-scheme: dark)");
        } catch (err) {
            return;
        }
        if (mq.addEventListener) {
            mq.addEventListener("change", function () {
                if (currentTheme === "auto") applyTheme("auto");
            });
        }
    }

    async function render() {
        var s = await S.load();
        enabledEl.checked = !!s.enabled;
        scaleEl.value = String(s.scale);
        scaleValueEl.value = s.scale.toFixed(2);
        F.i18n.apply(document, s.locale);
        if (localeEl) localeEl.value = s.locale;
        applyTheme(s.theme);

        currentHost = await getCurrentHost();
        currentExcluded = S.isHostExcluded(currentHost, s.excludedHosts);

        if (!currentHost) {
            siteRowEl.classList.add("hidden");
            siteHintEl.classList.remove("hidden");
            return;
        }
        siteRowEl.classList.remove("hidden");
        siteHintEl.classList.add("hidden");
        siteEnabledEl.checked = !currentExcluded;
    }

    function setEnabled(value) {
        return S.set(S.KEY_ENABLED, !!value);
    }

    function setScale(value) {
        return S.set(S.KEY_SCALE, S.normalizeScale(parseFloat(value)));
    }

    function setLocale(value) {
        return S.set(S.KEY_LOCALE, value);
    }

    function setTheme(value) {
        return S.set(S.KEY_THEME, value);
    }

    function setSiteEnabled(enabled) {
        if (!currentHost) return Promise.resolve();
        return S.load().then(function (s) {
            var hosts = s.excludedHosts.slice();
            var isExcluded = S.isHostExcluded(currentHost, hosts);
            if (enabled && isExcluded) {
                // Remove every rule that applies to this host. A single
                // excluded-host list cannot represent a child-domain allow
                // override, so making the toggle effective takes precedence.
                hosts = hosts.filter(function (host) {
                    return !S.isHostExcluded(currentHost, [host]);
                });
            } else if (!enabled && !isExcluded) {
                hosts.push(currentHost);
            } else {
                return;
            }
            return S.set(S.KEY_EXCLUDED, hosts);
        });
    }

    enabledEl.addEventListener("change", function () {
        setEnabled(enabledEl.checked);
    });

    siteEnabledEl.addEventListener("change", function () {
        setSiteEnabled(siteEnabledEl.checked).then(render);
    });

    scaleEl.addEventListener("input", function () {
        scaleValueEl.value = scaleEl.value;
        setScale(scaleEl.value);
    });

    if (localeEl) {
        localeEl.addEventListener("change", function () {
            setLocale(localeEl.value).then(function () {
                F.i18n.apply(document, localeEl.value);
            });
        });
    }

    if (themeEl) {
        themeEl.addEventListener("change", function () {
            applyTheme(themeEl.value);
            setTheme(themeEl.value);
        });
    }

    optionsBtnEl.addEventListener("click", function () {
        if (F.api && F.api.runtime && typeof F.api.runtime.openOptionsPage === "function") {
            F.api.runtime.openOptionsPage();
        }
        window.close();
    });

    watchTheme();
    render();
})(globalThis.__FURIGANA__);
