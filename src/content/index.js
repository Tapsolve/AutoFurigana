(function (F) {
    "use strict";

    // ---------------------------------------------------------------------
    // Main content-script orchestrator.
    //
    // Pipeline (per spec section 34):
    //   DOM mutation -> cheap eligibility check -> contains kanji? ->
    //   queue + deduplicate -> small processing batch -> extract text ->
    //   cache hit? -> (miss) Kuromoji -> tokens -> furigana alignment ->
    //   cache -> segments -> DocumentFragment -> native <ruby><rt> ->
    //   single DOM replacement.
    // ---------------------------------------------------------------------

    var kana = F.kana;
    var renderer = F.renderer;
    var settings = F.settings;
    var schedulerMod = F.scheduler;
    var scannerMod = F.scanner;
    var observerMod = F.observer;
    var shadowDom = F.shadowDom;
    var analyzerMod = F.analyzer;
    var kuromojiMod = F.kuromojiAnalyzer;
    var furigana = F.furigana;
    var correctionMod = F.correction;

    var CACHE_SIZE = 3000;
    var TEXT = 3;
    var ELEMENT = 1;

    // True for the <ruby> elements this extension injected (its own output).
    function isOurRubyElement(node) {
        if (!node || node.nodeType !== ELEMENT) return false;
        return node.getAttribute && node.getAttribute(renderer.DATA_ATTR) === "1";
    }

    // State machine for the content script.
    var state = {
        running: false,
        settings: settings.DEFAULTS,
        enabledOnPage: false,
        processedNodes: new WeakSet(),
        freshNodes: new WeakSet(),
        cache: F.cache.createLRU(CACHE_SIZE),
        analyzer: null,
        scanner: null,
        scheduler: null,
        scanCursors: new WeakMap(),
        observers: new Map(),
        shadowRootsSeen: new WeakSet(),
        analysisRun: null
    };

    // ---------------------------------------------------------------------
    // Settings / enable-disable
    // ---------------------------------------------------------------------

    function currentHostname() {
        return (globalThis.location && location.hostname) || "";
    }

    function computeEnabledOnPage(s) {
        return !!s.enabled && !settings.isHostExcluded(currentHostname(), s.excludedHosts);
    }

    function applyScaleVar(s) {
        var doc = globalThis.document;
        if (doc && doc.documentElement) {
            doc.documentElement.style.setProperty("--local-furigana-scale", String(s.scale) + "em");
        }
    }

    async function loadSettings() {
        var s = await settings.load();
        state.settings = s;
        state.enabledOnPage = computeEnabledOnPage(s);
        applyScaleVar(s);
        return s;
    }

    async function reloadSettings() {
        var wasEnabled = state.enabledOnPage;
        var s = await loadSettings();
        if (state.enabledOnPage !== wasEnabled) {
            if (state.enabledOnPage) {
                start();
            } else {
                stop();
            }
        }
    }

    // Storage change handler shared by every setting: reloads settings, then
    // applies whatever the change requires (re-enable/disable, correction
    // popup on/off, and re-rendering corrected words).
    async function handleSettingsChange(changes) {
        // Capture the previously loaded override map before reloading; the
        // storage change payload may omit oldValue/newValue, so the in-memory
        // value is the reliable "before" snapshot.
        var prevOverrides = (state.settings && state.settings.overrides) || {};
        var wasEnabled = state.enabledOnPage;
        var s = await loadSettings();
        if (state.enabledOnPage !== wasEnabled) {
            if (state.enabledOnPage) {
                start();
            } else {
                stop();
            }
        }
        if (!state.running) return;
        if (changes[settings.KEY_CORRECTION] && correctionMod && correctionMod.setEnabled) {
            correctionMod.setEnabled(state.settings.correctionEnabled);
        }
        if (changes[settings.KEY_OVERRIDES]) {
            var change = changes[settings.KEY_OVERRIDES];
            var oldMap = (change && change.oldValue) || prevOverrides;
            var newMap = (change && change.newValue) || state.settings.overrides || {};
            reconcileOverrides(oldMap, newMap);
        }
    }

    // ---------------------------------------------------------------------
    // Shadow DOM
    // ---------------------------------------------------------------------

    var SHADOW_SHEET = null;

    function shadowStyles() {
        return "ruby[data-local-furigana=\"1\"] > rt{font-size:var(--local-furigana-scale,0.5em);user-select:none}";
    }

    function adoptStylesInto(root) {
        try {
            if (!root || !root.adoptedStyleSheets) return;
            if (!SHADOW_SHEET && typeof CSSStyleSheet === "function") {
                SHADOW_SHEET = new CSSStyleSheet();
                SHADOW_SHEET.replaceSync(shadowStyles());
            }
            if (SHADOW_SHEET && root.adoptedStyleSheets.indexOf(SHADOW_SHEET) === -1) {
                root.adoptedStyleSheets = [SHADOW_SHEET].concat(root.adoptedStyleSheets);
            }
        } catch (err) {
            // Ignore: shadow styling is a progressive enhancement.
        }
    }

    function onOpenShadowRoot(root) {
        if (!state.running) return;
        if (!root || root.mode !== "open") return;
        if (state.shadowRootsSeen.has(root)) return;
        state.shadowRootsSeen.add(root);
        adoptStylesInto(root);
        observeRoot(root);
        state.scheduler.enqueue(root);
    }

    // ---------------------------------------------------------------------
    // Observers
    // ---------------------------------------------------------------------

    function observeRoot(root) {
        var handler = {
            onChildAdded: handleChildAdded,
            onTextChanged: handleTextChanged,
            onShadowRoot: onOpenShadowRoot
        };
        var obs = observerMod.createObserver(root, handler);
        obs.connect();
        state.observers.set(root, obs);
    }

    function isInsideRt(node) {
        var parent = node && node.parentElement;
        if (!parent) return false;
        return parent.tagName === "RT" || !!parent.closest("rt");
    }

    // Page inserted something inside one of our ruby elements: unwrap it and
    // reprocess the base text so the latest value gets the correct annotation.
    function reprocessRuby(ruby) {
        if (!ruby || !ruby.parentNode) return;
        var base = [];
        for (var i = 0; i < ruby.childNodes.length; i++) {
            var child = ruby.childNodes[i];
            if (child.nodeType === ELEMENT && (child.tagName === "RT" || child.tagName === "RP")) continue;
            base.push(child);
        }
        ruby.replaceWith.apply(ruby, base);
        for (var j = 0; j < base.length; j++) {
            state.processedNodes.delete(base[j]);
            enqueue(base[j]);
        }
    }

    function handleChildAdded(node) {
        if (!state.running) return;
        // Our own injected ruby is our output, not new page content.
        if (isOurRubyElement(node)) return;
        state.freshNodes.add(node);
        enqueue(node, true);
    }

    function handleTextChanged(node) {
        if (!state.running) return;
        if (node.nodeType !== TEXT) return;
        state.freshNodes.add(node);
        if (renderer.isInsideOurRuby(node)) {
            if (!isInsideRt(node)) {
                var ruby = node.parentElement.closest(renderer.RUBY_SELECTOR);
                reprocessRuby(ruby);
            }
            return;
        }
        if (renderer.isInsideAnyRuby(node)) return; // publisher ruby: untouched
        state.processedNodes.delete(node);
        if (kana.hasKanji(node.nodeValue)) enqueue(node, true);
    }

    // Cheap eligibility filter before anything expensive happens.
    // `fresh` marks MutationObserver discoveries = newly loaded content.
    function enqueue(node, fresh) {
        if (!state.running) return;
        // Never touch our own injected UI (e.g. the correction popup).
        if (renderer.isInsideIgnored(node)) {
            state.processedNodes.add(node);
            return;
        }
        if (node.nodeType === TEXT) {
            var text = node.nodeValue;
            if (!kana.hasKanji(text)) {
                state.processedNodes.add(node);
                return;
            }
            if (renderer.isInsideOurRuby(node)) {
                if (!isInsideRt(node)) {
                    var ruby = node.parentElement.closest(renderer.RUBY_SELECTOR);
                    reprocessRuby(ruby);
                }
                return;
            }
            if (renderer.isInsideAnyRuby(node)) return;
            if (scannerMod.isInEditable(node)) return;
            if (state.processedNodes.has(node)) return;
            state.scheduler.enqueue(node, fresh);
        } else if (node.nodeType === ELEMENT) {
            if (renderer.isInsideOurRuby(node)) {
                var rub = node.closest(renderer.RUBY_SELECTOR);
                reprocessRuby(rub);
                return;
            }
            if (renderer.isInsideAnyRuby(node)) return;
            state.scheduler.enqueue(node, fresh);
        }
    }

    // ---------------------------------------------------------------------
    // Processing
    // ---------------------------------------------------------------------

    function acceptText(node) {
        if (state.processedNodes.has(node)) return false;
        if (renderer.isInsideIgnored(node)) return false;
        if (renderer.isInsideAnyRuby(node)) return false;
        if (scannerMod.isInEditable(node)) return false;
        return true;
    }

    function processNode(node) {
        if (!node || !node.isConnected) return;
        if (node.nodeType === TEXT) {
            processTextNode(node, state.freshNodes.has(node));
            return;
        }
        if (node.nodeType !== ELEMENT) return;

        var fresh = state.freshNodes.has(node);
        var cursor = state.scanCursors.get(node);
        if (!cursor) {
            if (node.shadowRoot) onOpenShadowRoot(node.shadowRoot);
            cursor = state.scanner.createCursor(node);
            if (!cursor) return;
            state.scanCursors.set(node, cursor);
        }
        var batch = cursor.nextBatch(100);
        for (var i = 0; i < batch.nodes.length; i++) {
            var current = batch.nodes[i];
            if (current.nodeType === TEXT) processTextNode(current, fresh);
            else if (current.shadowRoot) onOpenShadowRoot(current.shadowRoot);
        }
        if (batch.done) state.scanCursors.delete(node);
        return batch.done;
    }

function isFreshText(tn) {
    // The walker may visit a freshly-added subtree before the scheduler gets
    // to that subtree's own cursor. Recognise it here so lazy-loaded text is
    // prioritised no matter which scan path touches it first.
    var el = tn.parentElement;
    var depth = 0;
    while (el && depth < 12) {
        if (state.freshNodes.has(el)) return true;
        el = el.parentElement;
        depth++;
    }
    return false;
}

function processTextNode(tn, fresh) {
    if (state.processedNodes.has(tn)) return;
    if (renderer.isInsideIgnored(tn)) {
        state.processedNodes.add(tn);
        return;
    }
    var original = tn.nodeValue;
    if (!kana.hasKanji(original)) {
        state.processedNodes.add(tn);
        return;
    }
    state.processedNodes.add(tn); // reserve: avoid re-queueing while analyzing
    var chunks = furigana.splitChunks(original);
    enqueueAnalysis(tn, original, chunks, fresh || isFreshText(tn));
}

    // ---------------------------------------------------------------------
    // Analysis (serialized, one text node at a time)
    // ---------------------------------------------------------------------

    function enqueueAnalysis(node, original, chunks, fresh) {
        var run = state.analysisRun;
        if (!run) return;
        var job = { node: node, original: original, chunks: chunks };
        if (fresh) {
            // Newly loaded content must not wait behind an enormous backlog
            // of earlier text: put it at the front of the queue.
            run.queue.unshift(job);
        } else {
            run.queue.push(job);
        }
        pumpAnalysis(run);
    }

    async function pumpAnalysis(run) {
        if (!run || run.analyzing) return;
        run.analyzing = true;
        try {
            while (run.queue.length > 0) {
                var job = run.queue.shift();
                await processAnalysisJob(run, job);
            }
        } finally {
            run.analyzing = false;
        }
    }

    function analyzeChunk(run, chunk) {
        var cached = run.cache.get(chunk);
        if (cached) return Promise.resolve(cached);
        return run.analyzer.getTokenizer().then(function (tokenizer) {
            var segments = furigana.convert(chunk, tokenizer);
            run.cache.set(chunk, segments);
            return segments;
        });
    }

    async function processAnalysisJob(run, job) {
        var node = job.node;
        // Race protection: node may have been removed or its text changed.
        if (state.analysisRun !== run || !node || !node.isConnected || node.nodeValue !== job.original) return;
        try {
            var all = [];
            for (var i = 0; i < job.chunks.length; i++) {
                var segs = await analyzeChunk(run, job.chunks[i]);
                for (var j = 0; j < segs.length; j++) all.push(segs[j]);
            }
            if (state.analysisRun !== run || !node.isConnected || node.nodeValue !== job.original || !state.running) return;
            var overrides = (state.settings && state.settings.overrides) || {};
            var annotated = furigana.applyOverrides(all, overrides);
            var doc = node.ownerDocument || globalThis.document;
            var frag = renderer.buildFragment(annotated, doc);
            node.replaceWith(frag);
        } catch (err) {
            // Never block the queue; the node stays un-annotated.
            if (typeof console !== "undefined" && console.error) console.error(err);
        }
    }

    // ---------------------------------------------------------------------
    // Start / stop
    // ---------------------------------------------------------------------

    function collectShadowRoots(root, found) {
        found = found || [];
        if (!root || !root.querySelectorAll) return found;
        try {
            var all = root.querySelectorAll("*");
            for (var i = 0; i < all.length; i++) {
                if (all[i].shadowRoot) {
                    found.push(all[i].shadowRoot);
                    collectShadowRoots(all[i].shadowRoot, found);
                }
            }
        } catch (err) {
            // ignore
        }
        return found;
    }

    // Every root the extension annotates: the document plus every open shadow
    // root reachable from it.
    function pageRoots() {
        var roots = [globalThis.document];
        try {
            var shadowRoots = collectShadowRoots(globalThis.document.documentElement);
            roots.push.apply(roots, shadowRoots);
        } catch (err) {
            // ignore
        }
        return roots;
    }

    // Unwrap every our-ruby element in `nodes` (adjacent rubies forming one
    // word) and re-analyse their combined text as a single text node. Needed
    // for whole-word corrections: kuromoji re-splits the word (e.g. 一人 ->
    // 一 + 人), then applyOverrides() splices it back with the correction.
    function reprocessGroup(group) {
        if (!group || !group.nodes || !group.nodes.length) return;
        var parent = group.nodes[0].parentNode;
        if (!parent) return;
        var doc = group.nodes[0].ownerDocument || globalThis.document;
        var text = doc.createTextNode(group.base);
        parent.insertBefore(text, group.nodes[0]);
        for (var i = 0; i < group.nodes.length; i++) parent.removeChild(group.nodes[i]);
        state.processedNodes.delete(text);
        enqueue(text);
    }

    // Unwrap + re-analyse every rendered ruby whose base changed in the
    // override map, so live readings match saved corrections (or fall back to
    // the dictionary default when a correction is removed).
    function reconcileOverrides(oldMap, newMap) {
        var all = {};
        var base;
        for (base in oldMap || {}) all[base] = true;
        for (base in newMap || {}) all[base] = true;
        var keys = Object.keys(all);
        if (!keys.length) return;
        var roots = pageRoots();
        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            for (var i = 0; i < roots.length; i++) {
                var rubies = roots[i].querySelectorAll ? roots[i].querySelectorAll(renderer.RUBY_SELECTOR) : [];
                for (var j = 0; j < rubies.length; j++) {
                    var ruby = rubies[j];
                    if (renderer.baseText(ruby) === key) {
                        // The word renders as a single ruby token.
                        reprocessRuby(ruby);
                        continue;
                    }
                    var group = renderer.rubyGroup(ruby);
                    if (group && group.base === key && group.nodes.length > 1) {
                        // The word was split into several ruby tokens.
                        reprocessGroup(group);
                    }
                }
            }
        }
    }

    function start() {
        if (state.running) return;
        state.running = true;
        state.processedNodes = new WeakSet();
        state.freshNodes = new WeakSet();
        state.cache = F.cache.createLRU(CACHE_SIZE);
        state.scanCursors = new WeakMap();
        state.shadowRootsSeen = new WeakSet();
        state.observers = new Map();
        state.analyzer = analyzerMod.createAnalyzer(function () {
            return kuromojiMod.createKuromojiTokenizer(F.getExtensionURL("dict/"));
        });
        state.analysisRun = {
            analyzer: state.analyzer,
            cache: state.cache,
            queue: [],
            analyzing: false
        };
        state.scanner = scannerMod.createScanner(globalThis.document, acceptText);
        state.scheduler = schedulerMod.createScheduler(processNode, { budgetMs: 4, idleTimeout: 250 });

        if (correctionMod && correctionMod.start) {
            correctionMod.start({
                getTokenizer: function () {
                    return state.analyzer ? state.analyzer.getTokenizer() : Promise.resolve(null);
                },
                getOverrides: function () {
                    return (state.settings && state.settings.overrides) || {};
                },
                getLocale: function () {
                    return state.settings ? state.settings.locale : "auto";
                },
                getEnabled: function () {
                    return !state.settings || state.settings.correctionEnabled !== false;
                },
                setOverride: function (base, reading) {
                    var overrides = Object.assign({}, (state.settings && state.settings.overrides) || {});
                    if (reading) overrides[base] = reading;
                    else delete overrides[base];
                    return settings.set(settings.KEY_OVERRIDES, overrides);
                }
            });
        }

        observeRoot(globalThis.document.documentElement);
        state.scheduler.enqueue(globalThis.document.documentElement);
    }

    function stop() {
        if (!state.running) return;
        state.running = false;

        if (correctionMod && correctionMod.stop) correctionMod.stop();

        state.observers.forEach(function (obs) {
            try {
                obs.disconnect();
            } catch (err) {
                // ignore
            }
        });
        state.observers.clear();

        if (state.scheduler) state.scheduler.stop();
        if (state.analysisRun) state.analysisRun.queue.length = 0;
        state.analysisRun = null;
        state.scanCursors = new WeakMap();

        // Remove every annotation we added.
        var roots = [globalThis.document];
        var shadowRoots = collectShadowRoots(globalThis.document.documentElement);
        roots.push.apply(roots, shadowRoots);
        for (var i = 0; i < roots.length; i++) {
            try {
                renderer.unwrapAllInRoot(roots[i]);
            } catch (err) {
                // ignore
            }
        }

        state.processedNodes = new WeakSet();
        state.freshNodes = new WeakSet();
        state.cache = F.cache.createLRU(CACHE_SIZE);
        state.analyzer = null;
        state.scanner = null;
        state.scheduler = null;
    }

    // ---------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------

    var loadPromise = null;

    function init() {
        // Idempotent: concurrent callers share the same startup run.
        if (!loadPromise) {
            loadPromise = (async function () {
                shadowDom.installShadowHook(onOpenShadowRoot);

                F.onStorageChanged(function (changes, areaName) {
                    if (areaName !== "local") return;
                    var relevant =
                        changes[settings.KEY_ENABLED] ||
                        changes[settings.KEY_EXCLUDED] ||
                        changes[settings.KEY_SCALE] ||
                        changes[settings.KEY_OVERRIDES] ||
                        changes[settings.KEY_CORRECTION];
                    if (!relevant) return;
                    handleSettingsChange(changes).catch(function (err) {
                        if (typeof console !== "undefined" && console.error) console.error(err);
                    });
                });

                await loadSettings();
                if (state.enabledOnPage) {
                    start();
                } else {
                    applyScaleVar(state.settings);
                }
            })();
        }
        return loadPromise;
    }

    F.main = { init: init, start: start, stop: stop, reloadSettings: reloadSettings };

    // Auto-start when the bundle runs as a content script (browser/chrome API
    // present), so the script works without an explicit caller.
    if (F.api) {
        init().catch(function (err) {
            if (typeof console !== "undefined" && console.error) console.error(err);
        });
    }
})(globalThis.__FURIGANA__);
