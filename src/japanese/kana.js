(function (F) {
    "use strict";

    // Kanji-like characters for furigana splitting:
    // CJK unified (4E00-9FFF), CJK extension A (3400-4DBF), CJK compatibility (F900-FAFF),
    // plus the iteration marks 々 (U+3005) and 〆 (U+3006) which belong to a preceding kanji word.
    var KANJI_RE = /[\p{Script=Han}\u3005\u3006]/u;

    var HIRAGANA_BEGIN = 0x3041;
    var HIRAGANA_END = 0x3096;
    var KATAKANA_BEGIN = 0x30a1;
    var KATAKANA_END = 0x30f6;

    function isKanjiChar(ch) {
        return ch !== undefined && ch.length > 0 && KANJI_RE.test(ch);
    }

    function hasKanji(str) {
        if (!str) return false;
        for (var ch of str) {
            if (KANJI_RE.test(ch)) return true;
        }
        return false;
    }

    function inRange(code, begin, end) {
        return code >= begin && code <= end;
    }

    function isHiraganaChar(ch) {
        if (!ch) return false;
        var c = ch.charCodeAt(0);
        return inRange(c, HIRAGANA_BEGIN, HIRAGANA_END) || inRange(c, 0x3099, 0x309c); // voiced marks ゙゚゛゜
    }

    function isKatakanaChar(ch) {
        if (!ch) return false;
        var c = ch.charCodeAt(0);
        return inRange(c, KATAKANA_BEGIN, KATAKANA_END);
    }

    function isKanaChar(ch) {
        return isHiraganaChar(ch) || isKatakanaChar(ch);
    }

    // Katakana -> Hiragana (offset between the two blocks is 0x60).
    function toHiragana(str) {
        if (!str) return "";
        var out = "";
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (inRange(c, KATAKANA_BEGIN, KATAKANA_END)) {
                out += String.fromCharCode(c - 0x60);
            } else {
                out += str[i];
            }
        }
        return out;
    }

    function toKatakana(str) {
        if (!str) return "";
        var out = "";
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (inRange(c, HIRAGANA_BEGIN, HIRAGANA_END)) {
                out += String.fromCharCode(c + 0x60);
            } else {
                out += str[i];
            }
        }
        return out;
    }

    F.kana = {
        KANJI_RE: KANJI_RE,
        isKanjiChar: isKanjiChar,
        hasKanji: hasKanji,
        isHiraganaChar: isHiraganaChar,
        isKatakanaChar: isKatakanaChar,
        isKanaChar: isKanaChar,
        toHiragana: toHiragana,
        toKatakana: toKatakana
    };
})(globalThis.__FURIGANA__);
