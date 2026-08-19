(function (F) {
    "use strict";

    var kana = F.kana;

    // Split a string into alternating runs of kanji-like and non-kanji characters.
    function matchKanaOrKanji(text) {
        if (!text) return [];
        var parts = [];
        var i = 0;
        var len = text.length;
        while (i < len) {
            var isK = kana.isKanjiChar(text[i]);
            var j = i;
            while (j < len && kana.isKanjiChar(text[j]) === isK) j++;
            parts.push(text.slice(i, j));
            i = j;
        }
        return parts;
    }

    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // Kuroshiro-compatible furigana/okurigana alignment for a single token.
    // Produces structured segments: { type:"text", text } | { type:"ruby", base, reading }.
    function tokenToSegments(surface, reading) {
        if (!surface) return [];
        var hasKJ = kana.hasKanji(surface);
        if (!hasKJ) {
            return [{ type: "text", text: surface }];
        }
        if (!reading) {
            return [{ type: "text", text: surface }];
        }

        var hiraReading = kana.toHiragana(reading);

        var pureKanji = true;
        for (var i = 0; i < surface.length; i++) {
            if (!kana.isKanjiChar(surface[i])) {
                pureKanji = false;
                break;
            }
        }
        if (pureKanji) {
            return [{ type: "ruby", base: surface, reading: hiraReading }];
        }

        // Mixed kanji/kana: build a regex where each kanji run becomes a capture
        // group and each kana character is a literal anchor. Matching it against
        // the reading separates per-kanji-run readings (e.g. 食(た)べる).
        var pattern = "";
        var subs = [];
        var lastWasKanji = false;
        for (var ch of surface) {
            if (kana.isKanjiChar(ch)) {
                if (!lastWasKanji) {
                    lastWasKanji = true;
                    pattern += "(.*)";
                    subs.push(ch);
                } else {
                    subs[subs.length - 1] += ch;
                }
            } else {
                lastWasKanji = false;
                subs.push(ch);
                var lit = kana.isKatakanaChar(ch) ? kana.toHiragana(ch) : ch;
                pattern += escapeRegExp(lit);
            }
        }

        var re = new RegExp("^" + pattern + "$");
        var m = re.exec(hiraReading);
        if (m) {
            var segments = [];
            var pick = 1;
            for (var s = 0; s < subs.length; s++) {
                var sub = subs[s];
                if (kana.isKanjiChar(sub[0])) {
                    var readingPart = m[pick] != null ? m[pick] : "";
                    pick++;
                    if (readingPart) {
                        segments.push({ type: "ruby", base: sub, reading: readingPart });
                    } else {
                        segments.push({ type: "text", text: sub });
                    }
                } else {
                    segments.push({ type: "text", text: sub });
                }
            }
            return segments;
        }

        return [{ type: "ruby", base: surface, reading: hiraReading }];
    }

    // Merge adjacent text segments so the renderer creates fewer nodes.
    function mergeSegments(segments) {
        var merged = [];
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            if (seg.type === "text" && merged.length > 0 && merged[merged.length - 1].type === "text") {
                merged[merged.length - 1].text += seg.text;
            } else {
                merged.push({ type: seg.type, text: seg.text, base: seg.base, reading: seg.reading });
            }
        }
        return merged;
    }

    // Tokens from kuromoji -> segments.
    function tokensToSegments(tokens) {
        var segments = [];
        for (var i = 0; i < tokens.length; i++) {
            var t = tokens[i];
            var parts = tokenToSegments(t.surface_form, t.reading);
            for (var j = 0; j < parts.length; j++) {
                segments.push(parts[j]);
            }
        }
        return mergeSegments(segments);
    }

    // Full conversion: text -> segments using a tokenizer (kuromoji tokenize fn).
    function convert(text, tokenizer) {
        if (!text || !tokenizer) return [];
        var tokens = tokenizer.tokenize(text);
        return tokensToSegments(tokens);
    }

    // Chunk large text near Japanese punctuation/newlines.
    var CHUNK_BOUNDARY = new Set(["。", "！", "？", "…", "\n", "」", "、", "．"]);

    function splitChunks(text, maxLen) {
        var max = maxLen || 1024;
        if (!text || text.length <= max) return [text];
        var chunks = [];
        var start = 0;
        var len = text.length;
        while (start < len) {
            var end = Math.min(start + max, len);
            if (end < len) {
                var cut = -1;
                for (var i = end - 1; i > start; i--) {
                    if (CHUNK_BOUNDARY.has(text[i])) {
                        cut = i + 1;
                        break;
                    }
                }
                if (cut > start) end = cut;
            }
            chunks.push(text.slice(start, end));
            start = end;
        }
        return chunks;
    }

    F.furigana = {
        matchKanaOrKanji: matchKanaOrKanji,
        tokenToSegments: tokenToSegments,
        tokensToSegments: tokensToSegments,
        mergeSegments: mergeSegments,
        convert: convert,
        splitChunks: splitChunks
    };
})(globalThis.__FURIGANA__);
