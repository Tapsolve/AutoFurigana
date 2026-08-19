(function (F) {
    "use strict";

    // Marker used to recognise our own <ruby> output so the MutationObserver
    // and scanner can skip it (prevents infinite loops and double processing).
    var DATA_ATTR = "data-local-furigana";
    var RUBY_SELECTOR = 'ruby[data-local-furigana="1"]';

    // Builds a DocumentFragment from structured segments.
    //   { type:"text", text }                    -> text node
    //   { type:"ruby", base, reading }           -> <ruby data-local-furigana="1">base<rt>reading</rt></ruby>
    function buildFragment(segments, doc) {
        var frag = doc.createDocumentFragment();
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            if (seg.type === "ruby") {
                var ruby = doc.createElement("ruby");
                ruby.setAttribute(DATA_ATTR, "1");
                ruby.appendChild(doc.createTextNode(seg.base));
                var rt = doc.createElement("rt");
                rt.textContent = seg.reading;
                ruby.appendChild(rt);
                frag.appendChild(ruby);
            } else {
                frag.appendChild(doc.createTextNode(seg.text));
            }
        }
        return frag;
    }

    // True when a node is inside one of our own ruby elements.
    function isInsideOurRuby(node) {
        if (!node || !node.parentElement) return false;
        return !!node.parentElement.closest(RUBY_SELECTOR);
    }

    // True when a node is inside ANY ruby element (including publisher ruby).
    function isInsideAnyRuby(node) {
        if (!node || !node.parentElement) return false;
        return !!node.parentElement.closest("ruby");
    }

    // Remove one of our ruby elements, restoring the base text as a plain text node.
    function unwrapRuby(ruby) {
        var parent = ruby.parentNode;
        if (!parent) return;
        var base = [];
        for (var i = 0; i < ruby.childNodes.length; i++) {
            var child = ruby.childNodes[i];
            if (child.nodeType === 1 && (child.tagName === "RT" || child.tagName === "RP")) continue;
            base.push(child);
        }
        ruby.replaceWith.apply(ruby, base);
    }

    // Remove every ruby element we created inside `root` (used when the
    // extension is disabled for a page).
    function unwrapAllInRoot(root) {
        var rubies = root.querySelectorAll ? root.querySelectorAll(RUBY_SELECTOR) : [];
        var count = 0;
        for (var i = rubies.length - 1; i >= 0; i--) {
            unwrapRuby(rubies[i]);
            count++;
        }
        return count;
    }

    F.renderer = {
        DATA_ATTR: DATA_ATTR,
        RUBY_SELECTOR: RUBY_SELECTOR,
        buildFragment: buildFragment,
        isInsideOurRuby: isInsideOurRuby,
        isInsideAnyRuby: isInsideAnyRuby,
        unwrapRuby: unwrapRuby,
        unwrapAllInRoot: unwrapAllInRoot
    };
})(globalThis.__FURIGANA__);
