import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { loadModules } from "./helpers/load-modules.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const F = loadModules(["japanese/kana.js", "japanese/cache.js", "japanese/furigana.js"]);

let tokenizer = null;
function getTokenizer() {
    if (tokenizer) return Promise.resolve(tokenizer);
    return new Promise((resolve, reject) => {
        require("kuromoji")
            .builder({ dicPath: path.join(ROOT, "node_modules", "kuromoji", "dict") })
            .build((err, tok) => {
                if (err) return reject(err);
                tokenizer = tok;
                resolve(tok);
            });
    });
}

function segmentsFor(word) {
    return getTokenizer().then((tok) => F.furigana.convert(word, tok));
}

function plainOf(segments) {
    return segments.map((s) => (s.type === "ruby" ? s.base : s.text)).join("");
}

function readingOf(segments) {
    return segments.map((s) => (s.type === "ruby" ? s.reading : s.text)).join("");
}

function assertSegments(word, expected) {
    return segmentsFor(word).then((segments) => {
        const norm = segments.map((s) => ({
            type: s.type,
            base: s.base,
            text: s.text,
            reading: s.reading
        }));
        if (JSON.stringify(norm) !== JSON.stringify(expected)) {
            throw new Error(
                `segments mismatch for "${word}"\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(norm)}`
            );
        }
        return segments;
    });
}

async function run() {
    let failures = 0;
    let count = 0;

    function record(name, fn) {
        count++;
        return Promise.resolve()
            .then(fn)
            .then(
                () => console.log(`  ok  ${name}`),
                (err) => {
                    failures++;
                    console.log(`  FAIL ${name}\n      ${err.message}`);
                }
            );
    }

    // Spec section 36 word list with expected segment output.
    const wordCases = [
        ["今日", [{ type: "ruby", base: "今日", reading: "きょう" }]],
        ["日本", [{ type: "ruby", base: "日本", reading: "にっぽん" }]],
        ["日本語", [{ type: "ruby", base: "日本語", reading: "にほんご" }]],
        [
            "東京都",
            [
                { type: "ruby", base: "東京", reading: "とうきょう" },
                { type: "ruby", base: "都", reading: "と" }
            ]
        ],
        ["大人", [{ type: "ruby", base: "大人", reading: "おとな" }]],
        [
            "一人",
            [
                { type: "ruby", base: "一", reading: "いち" },
                { type: "ruby", base: "人", reading: "にん" }
            ]
        ],
        [
            "一日",
            [
                { type: "ruby", base: "一", reading: "いち" },
                { type: "ruby", base: "日", reading: "にち" }
            ]
        ],
        ["明日", [{ type: "ruby", base: "明日", reading: "あした" }]],
        ["昨日", [{ type: "ruby", base: "昨日", reading: "きのう" }]],
        [
            "生きる",
            [
                { type: "ruby", base: "生", reading: "い" },
                { type: "text", text: "きる" }
            ]
        ],
        [
            "生まれる",
            [
                { type: "ruby", base: "生", reading: "う" },
                { type: "text", text: "まれる" }
            ]
        ],
        ["先生", [{ type: "ruby", base: "先生", reading: "せんせい" }]],
        ["学生", [{ type: "ruby", base: "学生", reading: "がくせい" }]],
        [
            "食べる",
            [
                { type: "ruby", base: "食", reading: "た" },
                { type: "text", text: "べる" }
            ]
        ],
        [
            "行った",
            [
                { type: "ruby", base: "行", reading: "い" },
                { type: "text", text: "った" }
            ]
        ],
        [
            "行う",
            [
                { type: "ruby", base: "行", reading: "おこな" },
                { type: "text", text: "う" }
            ]
        ],
        [
            "重なる",
            [
                { type: "ruby", base: "重", reading: "かさ" },
                { type: "text", text: "なる" }
            ]
        ],
        [
            "取り扱う",
            [
                { type: "ruby", base: "取", reading: "と" },
                { type: "text", text: "り" },
                { type: "ruby", base: "扱", reading: "あつか" },
                { type: "text", text: "う" }
            ]
        ],
        [
            "申し込む",
            [
                { type: "ruby", base: "申", reading: "もう" },
                { type: "text", text: "し" },
                { type: "ruby", base: "込", reading: "こ" },
                { type: "text", text: "む" }
            ]
        ],
        ["時々", [{ type: "ruby", base: "時々", reading: "ときどき" }]],
        [
            "一ヶ月",
            [
                { type: "ruby", base: "一", reading: "いち" },
                { type: "ruby", base: "ヶ月", reading: "かげつ" }
            ]
        ],
        [
            "取れたら",
            [
                { type: "ruby", base: "取", reading: "と" },
                { type: "text", text: "れたら" }
            ]
        ],
        [
            "繋ごう",
            [
                { type: "ruby", base: "繋", reading: "つな" },
                { type: "text", text: "ごう" }
            ]
        ]
    ];

    console.log("Furigana alignment (spec section 36):");
    for (const [word, expected] of wordCases) {
        await record(`word: ${word}`, () => assertSegments(word, expected));
    }

    // Every annotated string must reconstruct its exact original surface.
    const roundTripStrings = [
        "Hello 世界！",
        "日本語を勉強する。",
        "3人の学生が東京へ行った。",
        "🎌日本語のテスト！",
        "「日本語」は面白い。",
        "すごく疲れた。",
        "食べ物と飲み物",
        "明日は晴れるかな？",
        "半角カタカナテスト: ｶﾞﾝﾊﾞｯﾃ！",
        "𠮷田さんは元気。",
        "今日の天気は良い。",
        "全角ーとASCII123abc混在。",
        "、。！？…「」（）・ー"
    ];
    console.log("Round-trip (plain text preserved):");
    await record("supplementary-plane kanji are detected", () => {
        if (!F.kana.hasKanji("𠮷田")) throw new Error("supplementary-plane kanji was missed");
    });
    for (const str of roundTripStrings) {
        await record(`round-trip: ${str}`, () =>
            segmentsFor(str).then((segments) => {
                const plain = plainOf(segments);
                if (plain !== str) {
                    throw new Error(`"${str}" reconstructed as "${plain}"`);
                }
            })
        );
    }

    console.log("Reading/okurigana invariants:");
    // For every string, no ruby may cover a reading span that is empty,
    // and readings must be hiragana.
    const invariantStrings = [
        "今日",
        "生きる",
        "食べる",
        "取り扱う",
        "日本語を勉強する。",
        "駅まで歩く",
        "私は毎朝コーヒーを飲む"
    ];
    for (const str of invariantStrings) {
        await record(`invariant: ${str}`, () =>
            segmentsFor(str).then((segments) => {
                for (const s of segments) {
                    if (s.type === "ruby") {
                        if (!s.reading || !/^[\u3041-\u3096]+$/.test(s.reading)) {
                            throw new Error(`bad reading "${s.reading}" for base "${s.base}"`);
                        }
                    }
                }
                // readingOf must never contain kanji
                const rd = readingOf(segments);
                if (F.kana.hasKanji(rd)) {
                    throw new Error(`reading output still contains kanji: "${rd}"`);
                }
            })
        );
    }

    // Chunking (spec section 10).
    console.log("Chunking:");
    await record("chunk small text", () => {
        const chunks = F.furigana.splitChunks("今日は良い天気です。", 1024);
        if (chunks.length !== 1 || chunks[0] !== "今日は良い天気です。") {
            throw new Error("small text should be a single chunk");
        }
    });
    await record("chunk large text at punctuation", () => {
        const longText = "今日は東京へ行った。".repeat(80); // 2400 chars, boundaries every ~10 chars
        const chunks = F.furigana.splitChunks(longText, 256);
        if (chunks.length < 3) throw new Error("expected multiple chunks");
        if (chunks.join("") !== longText) throw new Error("chunks must reassemble to the original");
        for (const c of chunks) {
            if (c.length > 256 + 20) throw new Error(`chunk too long: ${c.length}`);
        }
    });
    await record("chunk boundary chars include 。！？… newline", () => {
        const text = "あ".repeat(300) + "。\n" + "い".repeat(300);
        const chunks = F.furigana.splitChunks(text, 256);
        if (chunks.join("") !== text) throw new Error("reassembly failed");
    });

    // LRU cache (spec section 16).
    console.log("Cache:");
    await record("LRU eviction order", () => {
        const cache = F.cache.createLRU(3);
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3);
        cache.get("a");
        cache.set("d", 4);
        if (cache.has("a") !== true) throw new Error("a should be kept (recently used)");
        if (cache.has("b") !== false) throw new Error("b should have been evicted");
        if (cache.size() !== 3) throw new Error("size should be 3");
    });

    // Reading lookup + user corrections (feature: click-to-correct).
    console.log("Reading lookup + corrections:");
    await record("lookup candidates for 金玉 include きんたま", () =>
        getTokenizer().then((tok) => {
            const readings = F.furigana.lookupReadings(tok, "金玉");
            if (!readings.includes("きんぎょく")) throw new Error(`missing きんぎょく: ${readings.join(" ")}`);
            if (!readings.includes("きんたま")) throw new Error(`missing きんたま: ${readings.join(" ")}`);
        })
    );
    await record("lookup candidates for 大人 include おとな and たいじん", () =>
        getTokenizer().then((tok) => {
            const readings = F.furigana.lookupReadings(tok, "大人");
            if (!readings.includes("おとな")) throw new Error(`missing おとな: ${readings.join(" ")}`);
            if (!readings.includes("たいじん")) throw new Error(`missing たいじん: ${readings.join(" ")}`);
        })
    );
    await record("lookup is empty for an unknown surface", () =>
        getTokenizer().then((tok) => {
            const readings = F.furigana.lookupReadings(tok, "仮名文字なし");
            if (!Array.isArray(readings) || readings.length !== 0) {
                throw new Error(`expected no readings, got ${JSON.stringify(readings)}`);
            }
        })
    );
    await record("applyOverrides rewrites only matching ruby segments", () => {
        const segments = [
            { type: "ruby", base: "金玉", reading: "きんぎょく" },
            { type: "text", text: "と" },
            { type: "ruby", base: "大人", reading: "おとな" }
        ];
        const out = F.furigana.applyOverrides(segments, { 金玉: "きんたま" });
        const first = out.find((s) => s.type === "ruby" && s.base === "金玉");
        if (!first || first.reading !== "きんたま") throw new Error("override not applied");
        const adult = out.find((s) => s.type === "ruby" && s.base === "大人");
        if (!adult || adult.reading !== "おとな") throw new Error("unrelated ruby was rewritten");
        // The cache must stay pure: the input segments are untouched.
        if (segments[0].reading !== "きんぎょく") throw new Error("input segments were mutated");
    });
    await record("applyOverrides drops an empty-string correction", () => {
        const out = F.furigana.applyOverrides([{ type: "ruby", base: "金玉", reading: "きんぎょく" }], { 金玉: "" });
        if (out[0].reading !== "きんぎょく") throw new Error("empty correction should fall back to the dictionary");
    });
    await record("applyOverrides splices a whole-word correction across split rubies", () => {
        // 一人 is tokenised by kuromoji as 一 + 人; the override key spans both.
        const segments = [
            { type: "ruby", base: "一", reading: "いち" },
            { type: "ruby", base: "人", reading: "にん" },
            { type: "text", text: "で" }
        ];
        const out = F.furigana.applyOverrides(segments, { 一人: "ひとり" });
        if (out.length !== 2) throw new Error(`expected 2 segments, got ${out.length}: ${JSON.stringify(out)}`);
        if (out[0].type !== "ruby" || out[0].base !== "一人" || out[0].reading !== "ひとり") {
            throw new Error(`whole-word override not spliced: ${JSON.stringify(out)}`);
        }
        if (out[1].text !== "で") throw new Error(`trailing text lost: ${JSON.stringify(out)}`);
        if (segments.length !== 3 || segments[0].base !== "一") throw new Error("input segments were mutated");
    });
    await record("whole-word override splices only at segment boundaries", () => {
        // Key "食べ" ends mid-segment (inside the べる text node) so it must not
        // splice even though its start aligns with a ruby boundary.
        const segments = [
            { type: "ruby", base: "食", reading: "た" },
            { type: "text", text: "べる" }
        ];
        const out = F.furigana.applyOverrides(segments, { 食べ: "たべ" });
        if (out.length !== 2) throw new Error(`non-boundary key must not be spliced: ${JSON.stringify(out)}`);
        if (out[0].type !== "ruby" || out[0].base !== "食") throw new Error("segments must be untouched");
        if (out[1].type !== "text" || out[1].text !== "べる") throw new Error("text must be untouched");
    });

    console.log(`\nfurigana: ${count - failures}/${count} passed`);
    return failures === 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    run().then(
        (ok) => process.exit(ok ? 0 : 1),
        (err) => {
            console.error(err);
            process.exit(1);
        }
    );
}

export { run };
