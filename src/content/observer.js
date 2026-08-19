(function (F) {
    "use strict";

    // Single MutationObserver per document/open-shadow-root.
    // The callback is deliberately cheap: it classifies mutations and enqueues
    // candidate nodes into the scheduler, returning immediately.
    function createObserver(target, handler) {
        var observer = null;
        var observed = false;

        function onMutations(records) {
            for (var i = 0; i < records.length; i++) {
                var m = records[i];
                if (m.type === "childList") {
                    var added = m.addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        var node = added[j];
                        if (node.nodeType === 1 && node.shadowRoot) {
                            handler.onShadowRoot && handler.onShadowRoot(node.shadowRoot);
                        }
                        handler.onChildAdded && handler.onChildAdded(node);
                    }
                } else if (m.type === "characterData") {
                    handler.onTextChanged && handler.onTextChanged(m.target);
                }
            }
        }

        function observe() {
            if (observer && !observed && target) {
                observer.observe(target, { childList: true, subtree: true, characterData: true });
                observed = true;
            }
        }

        function connect() {
            if (observer) {
                observe();
            } else if (typeof MutationObserver === "function") {
                observer = new MutationObserver(onMutations);
                observe();
            }
        }

        function disconnect() {
            if (observer && observed) {
                observer.disconnect();
                observed = false;
            }
        }

        return { connect: connect, disconnect: disconnect };
    }

    F.observer = { createObserver: createObserver };
})(globalThis.__FURIGANA__);
