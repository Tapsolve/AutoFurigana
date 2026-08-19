# AutoFurigana

AutoFurigana adds furigana above Japanese kanji on web pages. It works fully
offline, with no data collection or internet requests.

**Furigana** is the small Japanese text written above kanji to show how to read
them. Japanese learners and anyone reading unfamiliar kanji use it constantly.

![Before and after enabling AutoFurigana](docs/images/furigana_explanation.png)

It is available for **Firefox** and **Chrome**. Both versions are built from the
same code and behave the same.

## What it does

- Installs once, then every Japanese web page you visit gets reading
  annotations automatically.
- Works on normal pages, but also on "app" sites that load text later
  (Twitter, YouTube comments, news apps, infinite-scroll pages).
- Shows the *correct* reading for the context: 今日 is read きょう, but a
  single-character-per-word reader would get it wrong. AutoFurigana
  understands whole sentences, not just single characters.
- Lets you turn it on/off, disable it for a specific site, and choose the
  furigana size (0.1x to 2x).
- When the automatic reading is wrong, click the furigana to pick another
  reading for that word (e.g. 金玉 きんぎょく → きんたま, or 一人 when the
  splitter renders it 一・人 instead of ひとり) or type your own.
  Corrections are remembered per word, on every page.
- Speaks your language. The extension interface follows the browser's UI
  language by default, or you can pick a fixed language (English, French,
  Chinese, Japanese, Portuguese, Spanish, Dutch) in one click.
- Has a light and a dark theme, following your browser/operating system or a
  fixed choice.

  ## 100% Offline 100% Local 100% Private
  
- It **never** sends your data anywhere. **No internet requests, no analytics, no
  ads, nothing leaves your computer.**
- It **never** stores what you read. **Everything is forgotten the moment you close
  the page.**
- It **doesn't** change the page's design — it just adds small readings above the
  kanji, using the page's own font style.

## Why it's private

**Everything runs on your own device:**

- The Japanese dictionary (~17 MB) is bundled *inside* the extension.
- The reading engine runs inside your browser.
- Your settings are saved in the browser's local extension storage, on your
  machine.

Nothing about the pages you visit is ever sent to a server. The extension does
not even ask for internet access.

## How it works

When a page loads, the extension quietly does this:

1. **Looks** at the text on the page and finds the parts that contain kanji.
2. **Understands** each sentence with a Japanese word-splitting engine
   (kuromoji + the IPADIC dictionary). It figures out where words begin and
   end, like a dictionary that knows grammar.
3. **Picks a reading** for each kanji based on the surrounding words — 今日 is
   read きょう and 日本 as にほん and 食べる as たべる, not a
   character-by-character guess.
4. **Places the reading** as native `<ruby>` text directly above each kanji,
   using the same small-annotation style Japanese books and news sites use.
5. **Keeps watching.** If a site adds new text (scrolling feeds, chat, search
   results), the new text gets annotated too.
6. **Skips** text you're typing into, and never touches furigana a website
   already provides.
7. **Lets you fix mistakes.** Click any furigana to correct the reading — you
   get every reading the dictionary knows for that word, or you can type one.
   The correction is applied to that word everywhere it appears.

To make sure it feels instant, the extension does all of this in small chunks
so scrolling stays smooth, and it remembers what it already read so it doesn't
do the same work twice.

## Install

The extensions are currently distributed as source code on GitHub. To try them:

### Firefox

1. `npm install && npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…** and select `dist/firefox/manifest.json`

### Chrome / Edge

1. `npm install && npm run build:chrome`
2. Open `chrome://extensions`
3. Enable **Developer mode**, click **Load unpacked**, and select `dist/chrome`

## Build & test

```bash
npm install
npm run build            # builds both the Firefox and Chrome versions
npm test                 # builds everything, then runs fast automated suites
npm run test:release     # packages and smoke-tests real Chromium + Firefox
```

The build produces two folders — `dist/firefox` and `dist/chrome` — each a
complete, ready-to-load version of the extension.

The current builds require Chrome 111+ or Firefox 128+. Firefox release XPIs
must be signed through addons.mozilla.org before normal installation.

## Repository layout

```
src/manifest/   browser-specific settings (Firefox vs Chrome)
src/_locales/   UI translations (en, fr, zh_CN, ja, pt, es, nl)
src/content/    the script that runs on every page
src/japanese/   word-splitting, readings, and the alignment logic
src/popup/      the toolbar popup (on/off, per-site, size)
src/options/    the advanced options page
build/          bundling + packaging scripts
test/           automated tests (word lists, DOM behavior, privacy, i18n)
```

## User controls

- **Toolbar popup**: master on/off switch, on/off for the current site only,
  the furigana size slider, the interface language, and the theme.
- **Options page**: the same controls plus a language/theme picker, a list of
  sites you've disabled, a preview, and a toggle for the click-to-correct
  feature.

## Known limits

- Kanji inside images, videos, games, and the browser's own interface can't be
  annotated.
- The readings come from a dictionary, so unusual names, slang, and deliberately
  playful readings can be wrong. Click the furigana to correct any word.
- Websites that already include their own furigana are left exactly as they are.

Developed by **TapSolve**.
