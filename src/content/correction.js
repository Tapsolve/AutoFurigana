(function (F) {
    "use strict";

    // Click-to-correct popup.
    //
    // Clicking a furigana annotation opens a small menu near the word listing
    // every reading the bundled IPADIC dictionary knows for that exact surface
    // (kuromoji only reports its single Viterbi choice, which can be the wrong
    // reading, e.g. 金玉 -> きんぎょく instead of きんたま). The user can pick
    // another reading or type one manually. The choice is persisted as a
    // base -> reading override; the content orchestrator applies it to every
    // rendering of that word and re-renders the page on storage change.

    var RUBY_SELECTOR = 'ruby[data-local-furigana="1"]';
    var IGNORE_ATTR = F.renderer.IGNORE_ATTR;
    var POPUP_CLASS = "af-correction-popup";

    var state = {
        running: false,
        enabled: true,
        popup: null,
        handleClick: null,
        handleKey: null,
        // hooks provided by the orchestrator
        getTokenizer: null,
        getOverrides: null,
        setOverride: null,
        getLocale: null
    };

    var FALLBACK = {
        correctionAlternatives: "Alternative readings",
        correctionCurrent: "Current",
        correctionCustomPlaceholder: "Type a reading (hiragana)\u2026",
        correctionApply: "Apply",
        correctionReset: "Use dictionary reading",
        correctionWord: "Word"
    };

    function i18n(key) {
        if (F.i18n && typeof F.i18n.get === "function") {
            var pref = state.getLocale ? state.getLocale() : "auto";
            var value = F.i18n.get(key, pref);
            if (value) return value;
        }
        return FALLBACK[key] || "";
    }

    function baseOf(ruby) {
        var out = "";
        var children = ruby.childNodes;
        for (var i = 0; i < children.length; i++) {
            var node = children[i];
            if (node.nodeType === 1 && (node.tagName === "RT" || node.tagName === "RP")) continue;
            out += node.textContent != null ? node.textContent : "";
        }
        return out;
    }

    function readingOf(ruby) {
        var rt = ruby.querySelector ? ruby.querySelector("rt") : null;
        return rt ? rt.textContent : "";
    }

    function close() {
        if (state.popup && state.popup.parentNode) {
            state.popup.parentNode.removeChild(state.popup);
        }
        state.popup = null;
    }

    function hasOverride(base) {
        return !!(state.getOverrides && state.getOverrides()[base]);
    }

    function position(popup, anchor) {
        var rect = anchor.getBoundingClientRect();
        var width = popup.offsetWidth || 240;
        var height = popup.offsetHeight || 180;
        var left = Math.min(rect.left, Math.max(0, (globalThis.innerWidth || width) - width - 8));
        var top = rect.bottom + 4;
        if (top + height > (globalThis.innerHeight || height) - 8) {
            top = Math.max(8, rect.top - height - 4);
        }
        popup.style.left = Math.round(left) + "px";
        popup.style.top = Math.round(top) + "px";
    }

    function makeButton(doc, text, className, onClick) {
        var btn = doc.createElement("button");
        btn.type = "button";
        btn.className = className;
        btn.textContent = text;
        btn.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            onClick();
        });
        return btn;
    }

    function loadCandidates(base, current, group, listEl, doc) {
        listEl.textContent = "";
        if (!state.getTokenizer) return;

        var hasCurrent = false;
        var collected = [];
        var groupCandidates = [];
        function add(value) {
            if (!value) return;
            if (value === current) {
                hasCurrent = true;
                return;
            }
            if (collected.indexOf(value) === -1) collected.push(value);
        }
        add(current);

        function render() {
            listEl.textContent = "";
            if (hasCurrent) {
                listEl.appendChild(
                    makeButton(doc, current + " (" + i18n("correctionCurrent") + ")", "af-correction-item af-correction-current", function () {
                        applyReading(base, current);
                    })
                );
            }
            // Whole-word reading for a word the splitter broke into characters
            // (e.g. 一人 -> 一 + 人). Show it as its own labelled section.
            if (group && groupCandidates.length) {
                var wordLabel = doc.createElement("div");
                wordLabel.className = "af-correction-label";
                wordLabel.textContent = group.base + " (" + i18n("correctionWord") + ")";
                listEl.appendChild(wordLabel);
                for (var gi = 0; gi < groupCandidates.length; gi++) {
                    (function (reading) {
                        listEl.appendChild(
                            makeButton(doc, reading, "af-correction-item af-correction-word-item", function () {
                                applyReading(group.base, reading);
                            })
                        );
                    })(groupCandidates[gi]);
                }
            }
            if (collected.length) {
                var label = doc.createElement("div");
                label.className = "af-correction-label";
                label.textContent = i18n("correctionAlternatives");
                listEl.appendChild(label);
                for (var i = 0; i < collected.length; i++) {
                    (function (reading) {
                        listEl.appendChild(
                            makeButton(doc, reading, "af-correction-item", function () {
                                applyReading(base, reading);
                            })
                        );
                    })(collected[i]);
                }
            }
            if (!hasCurrent && !collected.length && !(group && groupCandidates.length)) {
                var none = doc.createElement("div");
                none.className = "af-correction-empty";
                none.textContent = current || base;
                listEl.appendChild(none);
            }
        }

        // Synchronous first pass with the currently displayed reading.
        render();

        // Dictionary lookup is async (the tokenizer may still be loading);
        // append extra candidates whenever they arrive.
        state.getTokenizer().then(
            function (tokenizer) {
                try {
                    var readings = F.furigana.lookupReadings(tokenizer, base);
                } catch (err) {
                    readings = [];
                }
                var changed = false;
                for (var i = 0; i < readings.length; i++) {
                    if (readings[i] !== current && collected.indexOf(readings[i]) === -1) {
                        collected.push(readings[i]);
                        changed = true;
                    }
                }
                if (group) {
                    try {
                        var wordReadings = F.furigana.lookupReadings(tokenizer, group.base);
                    } catch (err) {
                        wordReadings = [];
                    }
                    for (var j = 0; j < wordReadings.length; j++) {
                        if (groupCandidates.indexOf(wordReadings[j]) === -1) {
                            groupCandidates.push(wordReadings[j]);
                            changed = true;
                        }
                    }
                }
                if (changed) render();
            },
            function () {
                // Ignore: the popup still works for manual correction.
            }
        );
    }

    function buildPopup(ruby, group) {
        var doc = ruby.ownerDocument || globalThis.document;
        var base = group ? group.base : baseOf(ruby);
        var current = readingOf(ruby);

        var popup = doc.createElement("div");
        popup.className = POPUP_CLASS;
        popup.setAttribute(IGNORE_ATTR, "1");
        popup.setAttribute("role", "menu");
        popup.setAttribute("aria-label", base);

        var header = doc.createElement("div");
        header.className = "af-correction-header";
        var title = doc.createElement("span");
        title.className = "af-correction-base";
        title.textContent = base;
        header.appendChild(title);
        var currentReading = doc.createElement("span");
        currentReading.className = "af-correction-reading";
        currentReading.textContent = current;
        header.appendChild(currentReading);
        popup.appendChild(header);

        var list = doc.createElement("div");
        list.className = "af-correction-list";
        popup.appendChild(list);

        var customWrap = doc.createElement("div");
        customWrap.className = "af-correction-custom";
        var input = doc.createElement("input");
        input.type = "text";
        input.className = "af-correction-input";
        input.placeholder = i18n("correctionCustomPlaceholder");
        input.setAttribute("autocomplete", "off");
        input.setAttribute("spellcheck", "false");
        input.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.keyCode === 13) {
                event.preventDefault();
                applyInput();
            }
        });
        customWrap.appendChild(input);
        customWrap.appendChild(makeButton(doc, i18n("correctionApply"), "af-correction-apply", function () {
            applyInput();
        }));
        popup.appendChild(customWrap);

        if (hasOverride(base)) {
            popup.appendChild(makeButton(doc, i18n("correctionReset"), "af-correction-reset", function () {
                clearOverride(base);
            }));
        }

        function applyInput() {
            applyReading(base, input.value);
        }

        (doc.body || doc.documentElement).appendChild(popup);
        loadCandidates(base, current, group, list, doc);
        position(popup, ruby);
        return popup;
    }

    function applyReading(base, reading) {
        var hira = reading ? F.kana.toHiragana(String(reading).trim()) : "";
        if (!hira) return;
        if (state.setOverride) state.setOverride(base, hira);
        close();
    }

    function clearOverride(base) {
        if (state.setOverride) state.setOverride(base, "");
        close();
    }

    function open(ruby) {
        if (!state.running || !state.enabled) return;
        if (!ruby || !ruby.isConnected || !ruby.querySelector("rt")) return;
        close();
        state.popup = buildPopup(ruby, F.renderer.rubyGroup(ruby));
    }

    function onDocumentClick(event) {
        if (!state.running || !state.enabled) return;
        var path = event.composedPath ? event.composedPath() : [event.target];
        var target = path[0];
        if (!target) return;
        if (state.popup && (target === state.popup || state.popup.contains(target))) return;

        close();

        var ruby = null;
        for (var i = 0; i < path.length; i++) {
            var el = path[i];
            if (el && el.nodeType === 1 && typeof el.closest === "function") {
                var found = el.closest(RUBY_SELECTOR);
                if (found) {
                    ruby = found;
                    break;
                }
            }
        }
        if (!ruby) return;
        if (typeof event.preventDefault === "function") event.preventDefault();
        open(ruby);
    }

    function onKeyDown(event) {
        if (!state.running || !state.enabled) return;
        if (event.key === "Escape" || event.key === "Esc" || event.keyCode === 27) {
            close();
        }
    }

    function start(opts) {
        if (state.running) return;
        opts = opts || {};
        state.running = true;
        state.getTokenizer = opts.getTokenizer || null;
        state.getOverrides = opts.getOverrides || null;
        state.setOverride = opts.setOverride || null;
        state.getLocale = opts.getLocale || null;
        state.enabled = typeof opts.getEnabled === "function" ? !!opts.getEnabled() : true;

        state.handleClick = onDocumentClick;
        state.handleKey = onKeyDown;
        var doc = globalThis.document;
        if (doc && typeof doc.addEventListener === "function") {
            doc.addEventListener("click", state.handleClick, true);
        }
        if (typeof globalThis.addEventListener === "function") {
            globalThis.addEventListener("keydown", state.handleKey, true);
        }
    }

    function setEnabled(value) {
        state.enabled = !!value;
        if (!state.enabled) close();
    }

    function stop() {
        if (!state.running) return;
        state.running = false;
        close();
        var doc = globalThis.document;
        if (doc && typeof doc.removeEventListener === "function" && state.handleClick) {
            doc.removeEventListener("click", state.handleClick, true);
        }
        if (typeof globalThis.removeEventListener === "function" && state.handleKey) {
            globalThis.removeEventListener("keydown", state.handleKey, true);
        }
        state.handleClick = null;
        state.handleKey = null;
        state.getTokenizer = null;
        state.getOverrides = null;
        state.setOverride = null;
        state.getLocale = null;
    }

    F.correction = {
        start: start,
        stop: stop,
        setEnabled: setEnabled,
        isOpen: function () {
            return !!state.popup && !!state.popup.parentNode;
        }
    };
})(globalThis.__FURIGANA__);