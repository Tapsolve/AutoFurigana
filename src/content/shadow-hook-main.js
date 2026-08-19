(function () {
    "use strict";

    // This deliberately tiny bridge runs in the page's MAIN world. The main
    // content bundle remains isolated and receives only a DOM event whose
    // target must expose a real open shadow root.
    var EVENT_NAME = "local-furigana:shadow-root-attached";
    var proto = globalThis.Element && globalThis.Element.prototype;
    if (!proto || typeof proto.attachShadow !== "function") return;

    var original = proto.attachShadow;
    var dispatch = proto.dispatchEvent;
    var CustomEventCtor = globalThis.CustomEvent;
    if (original.__localFuriganaWrapped) return;

    function attachShadow(init) {
        var root = original.call(this, init);
        if (root && root.mode === "open" && dispatch && CustomEventCtor) {
            dispatch.call(this, new CustomEventCtor(EVENT_NAME, { bubbles: true, composed: true }));
        }
        return root;
    }

    Object.defineProperty(attachShadow, "__localFuriganaWrapped", { value: true });
    proto.attachShadow = attachShadow;
})();
