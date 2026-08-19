(function (F) {
    "use strict";

    // Lazy single-instance analyzer with an explicit state machine:
    //   uninitialized -> loading -> ready   (back to uninitialized on failure)
    // Multiple concurrent requests share the same initialization promise,
    // so the dictionary is never built twice per content-script context.
    function createAnalyzer(createTokenizer) {
        var promise = null;
        var state = "uninitialized";

        function getTokenizer() {
            if (!promise) {
                state = "loading";
                promise = createTokenizer().then(
                    function (tokenizer) {
                        state = "ready";
                        return tokenizer;
                    },
                    function (err) {
                        promise = null;
                        state = "uninitialized";
                        throw err;
                    }
                );
            }
            return promise;
        }

        return {
            getTokenizer: getTokenizer,
            get state() {
                return state;
            }
        };
    }

    F.analyzer = { createAnalyzer: createAnalyzer };
})(globalThis.__FURIGANA__);
