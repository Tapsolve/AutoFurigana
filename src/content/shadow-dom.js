(function (F) {
    "use strict";

    // Open Shadow DOM support.
    //
    // 1. A tiny MAIN-world content script patches attachShadow and emits a DOM
    //    event. This isolated script validates the event target before using it.
    // 2. During every scan we also record every `element.shadowRoot` we meet, so
    //    roots that already exist are covered without a full-document rescan.
    //
    // Only *open* shadow roots are supported. Closed roots are never touched.
    var EVENT_NAME = "local-furigana:shadow-root-attached";
    var installed = false;

    function installShadowHook(onOpenRoot) {
        var doc = globalThis.document;
        if (installed || !doc || typeof doc.addEventListener !== "function") return;
        installed = true;
        doc.addEventListener(EVENT_NAME, function (event) {
            try {
                var host = event && event.target;
                var root = host && host.shadowRoot;
                if (root && root.mode === "open" && onOpenRoot) onOpenRoot(root);
            } catch (err) {
                if (typeof console !== "undefined" && console.error) console.error(err);
            }
        }, true);
    }

    F.shadowDom = { installShadowHook: installShadowHook };
})(globalThis.__FURIGANA__);
