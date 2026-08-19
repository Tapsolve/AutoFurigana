(function (F) {
    "use strict";

    // Marker used to recognise our own <ruby> output so the MutationObserver
    // and scanner can skip it (prevents infinite loops and double processing).
    var DATA_ATTR = "data-local-furigana";
    var RUBY_SELECTOR = 'ruby[data-local-furigana="1"]';

    // Marker for our own injected UI (e.g. the correction popup). Its contents
    // contain real kanji text and must never be annotated.
    var IGNORE_ATTR = "data-local-furigana-ignore";
    var IGNORE_SELECTOR = '[data-local-furigana-ignore="1"]';

    // True when a node sits inside one of our own UI containers.
    function isInsideIgnored(node) {
        if (!node) return false;
        var el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) return false;
        try {
            return !!el.closest(IGNORE_SELECTOR);
        } catch (err) {
            return false;
        }
    }

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
                ruby.setAttribute("title", seg.base + "（" + seg.reading + "）");
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

    // The plain (non-rt/rp) text of one of our ruby elements, i.e. its base.
    function baseText(ruby) {
        if (!ruby) return "";
        var out = "";
        var children = ruby.childNodes;
        for (var i = 0; i < children.length; i++) {
            var node = children[i];
            if (node.nodeType === 1 && (node.tagName === "RT" || node.tagName === "RP")) continue;
            out += node.textContent != null ? node.textContent : "";
        }
        return out;
    }

    // Adjacent run of our ruby elements that together form one word. Kuromoji
    // splits some words into single-kanji tokens (一人 -> 一 + 人); grouping the
    // consecutive rubies lets the correction UI offer whole-word readings
    // (e.g. 一人 -> ひとり). Returns { nodes, base } or null when the ruby has no
    // neighbouring our-rubies.
    function rubyGroup(ruby) {
        if (!ruby || !ruby.parentNode || ruby.nodeType !== 1) return null;
        var parent = ruby.parentNode;
        var nodes = [];
        for (var i = 0; i < parent.childNodes.length; i++) nodes.push(parent.childNodes[i]);
        var start = nodes.indexOf(ruby);
        if (start === -1) return null;
        function isMine(node) {
            return node && node.nodeType === 1 && node.getAttribute && node.getAttribute(DATA_ATTR) === "1";
        }
        var left = start;
        while (left > 0 && isMine(nodes[left - 1])) left--;
        var right = start + 1;
        while (right < nodes.length && isMine(nodes[right])) right++;
        if (right - left <= 1) return null;
        var joined = "";
        for (var j = left; j < right; j++) joined += baseText(nodes[j]);
        return { nodes: nodes.slice(left, right), base: joined };
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
        IGNORE_ATTR: IGNORE_ATTR,
        buildFragment: buildFragment,
        isInsideIgnored: isInsideIgnored,
        isInsideOurRuby: isInsideOurRuby,
        isInsideAnyRuby: isInsideAnyRuby,
        baseText: baseText,
        rubyGroup: rubyGroup,
        unwrapRuby: unwrapRuby,
        unwrapAllInRoot: unwrapAllInRoot
    };
})(globalThis.__FURIGANA__);
