(function (F) {
    "use strict";

    // Builds a kuromoji tokenizer that loads its IPADIC dictionary files from the
    // extension package. The dictionary load uses the loader bundled inside
    // kuromoji's browser build; build/build.js rewrites kuromoji's own
    // path.join(dic_path, file) into __furigana_join(dic_path, file) so the file
    // URLs resolve correctly against the extension origin in both Firefox and
    // Chrome.
    function createKuromojiTokenizer(dicPath) {
        return new Promise(function (resolve, reject) {
            var k = globalThis.kuromoji;
            if (!k || typeof k.builder !== "function") {
                reject(new Error("kuromoji bundle is not available"));
                return;
            }
            try {
                k.builder({ dicPath: dicPath }).build(function (err, tokenizer) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(tokenizer);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    F.kuromojiAnalyzer = { createKuromojiTokenizer: createKuromojiTokenizer };
})(globalThis.__FURIGANA__);