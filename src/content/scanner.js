(function (F) {
    "use strict";

    var kana = F.kana;

    // Elements whose text is never annotated, plus elements we must not descend into.
    var SKIP_TAGS = new Set([
        "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
        "CODE", "PRE", "KBD", "SAMP", "RUBY", "RT", "RP", "SVG", "MATH",
        "HEAD", "TITLE", "META", "LINK", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT",
        "TEMPLATE", "CANVAS", "VIDEO", "AUDIO", "IMG", "PICTURE", "SOURCE",
        "TRACK", "MAP", "AREA"
    ]);

    // Elements whose children are skipped (also their descendants).
    // RUBY is excluded so publisher-provided furigana is never touched.
    function isSkippedElement(el) {
        var tag = el.tagName;
        return SKIP_TAGS.has(tag);
    }

    // Contenteditable text is never modified while the user may be typing.
    function isInEditable(node) {
        var parent = node.parentElement;
        if (!parent) return false;
        if (parent.isContentEditable) return true;
        return !!parent.closest("[contenteditable]");
    }

    // Creates a resumable TreeWalker cursor. Returning ordinary elements as
    // well as candidate text nodes ensures each batch has a hard traversal
    // limit even on pages with no Japanese text.
    function createScanner(doc, acceptText) {
        var SHOW_ELEMENT = 1;
        var SHOW_TEXT = 4;
        var FILTER_ACCEPT = 1;
        var FILTER_REJECT = 2;
        var FILTER_SKIP = 3;

        function createCursor(root) {
            if (!root) return null;
            var walker;
            try {
                walker = doc.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
                    acceptNode: function (node) {
                        if (node.nodeType === 1) {
                            var el = node;
                            if (isSkippedElement(el)) return FILTER_REJECT;
                            return FILTER_ACCEPT;
                        }
                        if (node.nodeType === 3) {
                            if (!kana.hasKanji(node.nodeValue)) return FILTER_REJECT;
                            if (acceptText && !acceptText(node)) return FILTER_REJECT;
                            return FILTER_ACCEPT;
                        }
                        return FILTER_SKIP;
                    }
                });
            } catch (err) {
                return null;
            }

            var finished = false;
            function nextBatch(maxNodes) {
                if (finished) return { nodes: [], done: true };
                var nodes = [];
                var max = Math.max(1, maxNodes || 100);
                while (nodes.length < max) {
                    var current = walker.nextNode();
                    if (!current) {
                        finished = true;
                        break;
                    }
                    nodes.push(current);
                }
                return { nodes: nodes, done: finished };
            }
            return { nextBatch: nextBatch };
        }

        // Full scan retained for tests and small callers; production uses the
        // resumable cursor through content/index.js.
        function scan(root) {
            var textNodes = [];
            var shadowRoots = [];
            var cursor = createCursor(root);
            if (!cursor) return { textNodes: textNodes, shadowRoots: shadowRoots };
            var batch;
            do {
                batch = cursor.nextBatch(500);
                for (var i = 0; i < batch.nodes.length; i++) {
                    var node = batch.nodes[i];
                    if (node.nodeType === 3) textNodes.push(node);
                    else if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
                }
            } while (!batch.done);
            return { textNodes: textNodes, shadowRoots: shadowRoots };
        }

        return { createCursor: createCursor, scan: scan };
    }

    F.scanner = {
        SKIP_TAGS: SKIP_TAGS,
        isSkippedElement: isSkippedElement,
        isInEditable: isInEditable,
        createScanner: createScanner
    };
})(globalThis.__FURIGANA__);
