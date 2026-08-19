(function (F) {
    "use strict";

    var S = F.settings;

    F.i18n.apply(document);

    var enabledEl = document.getElementById("enabled");
    var correctionEl = document.getElementById("correction");
    var scaleEl = document.getElementById("scale");
    var scaleValueEl = document.getElementById("scaleValue");
    var previewEl = document.getElementById("preview");
    var localeEl = document.getElementById("locale");
    var themeEl = document.getElementById("theme");
    var hostListEl = document.getElementById("hostList");
    var hostEmptyEl = document.getElementById("hostEmpty");
    var newHostEl = document.getElementById("newHost");
    var addFormEl = document.getElementById("addForm");

    var currentTheme = "auto";

    function updateScalePreview(value) {
        var scale = S.normalizeScale(parseFloat(value));
        scaleValueEl.value = scale.toFixed(2);
        previewEl.style.setProperty("--preview-furigana-scale", scale + "em");
    }

    // -----------------------------------------------------------------
    // Theme
    // -----------------------------------------------------------------

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
        currentTheme = saved && (saved === "auto" ? "auto" : saved) || "auto";
        var eff = effectiveTheme(currentTheme);
        var root = document.documentElement;
        root.classList.toggle("theme-dark", eff === "dark");
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

    // -----------------------------------------------------------------
    // Excluded hosts
    // -----------------------------------------------------------------

    function renderHosts(hosts) {
        hostListEl.innerHTML = "";
        hostEmptyEl.style.display = hosts.length ? "none" : "block";
        hosts.slice().sort().forEach(function (h) {
            var li = document.createElement("li");
            li.textContent = h;
            var btn = document.createElement("button");
            btn.className = "remove";
            btn.textContent = "✕";
            btn.addEventListener("click", function () {
                removeHost(h);
            });
            li.appendChild(btn);
            hostListEl.appendChild(li);
        });
    }

    async function render() {
        var s = await S.load();
        enabledEl.checked = !!s.enabled;
        if (correctionEl) correctionEl.checked = !!s.correctionEnabled;
        scaleEl.value = String(s.scale);
        updateScalePreview(s.scale);
        renderHosts(s.excludedHosts);
        F.i18n.apply(document, s.locale);
        if (localeEl) localeEl.value = s.locale;
        applyTheme(s.theme);
    }

    function setEnabled(value) {
        return S.set(S.KEY_ENABLED, !!value);
    }

    function setCorrection(value) {
        return S.set(S.KEY_CORRECTION, !!value);
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

    function addHost(raw) {
        var h = S.normalizeHost(raw);
        if (!h) return Promise.resolve();
        return S.load().then(function (s) {
            var hosts = s.excludedHosts.slice();
            if (hosts.indexOf(h) === -1) hosts.push(h);
            return S.set(S.KEY_EXCLUDED, hosts);
        }).then(render);
    }

    function removeHost(h) {
        return S.load().then(function (s) {
            var hosts = s.excludedHosts.filter(function (x) {
                return x !== h;
            });
            return S.set(S.KEY_EXCLUDED, hosts);
        }).then(render);
    }

    enabledEl.addEventListener("change", function () {
        setEnabled(enabledEl.checked);
    });

    if (correctionEl) {
        correctionEl.addEventListener("change", function () {
            setCorrection(correctionEl.checked);
        });
    }

    scaleEl.addEventListener("input", function () {
        updateScalePreview(scaleEl.value);
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

    addFormEl.addEventListener("submit", function (e) {
        e.preventDefault();
        addHost(newHostEl.value).then(function () {
            newHostEl.value = "";
        });
    });

    F.onStorageChanged(function (changes) {
        if (changes[S.KEY_LOCALE] || changes[S.KEY_THEME] || changes[S.KEY_CORRECTION]) render();
    });

    watchTheme();
    render();
})(globalThis.__FURIGANA__);
