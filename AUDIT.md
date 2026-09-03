# SpoilerShield — audit backlog

Findings from the 2026-09-03 code audit. Items 1–6 and 11–16 are **done**; what
follows is what we deliberately deferred, kept in original numbering.

Guiding constraint: this is meant to stay a **very lightweight** extension — no
build step, no dependencies, no framework. Prefer fixes that remove work rather
than add it.

---

## Deferred — Twitch (whole platform parked for now)

### 7. Twitch is inert unless you land directly on a VOD URL — *high*
`content/twitch.js:22` throws at the top level to bail out on irrelevant pages,
which means the `history.pushState` patch and the observer below it are never
registered. Content scripts inject once per document and Twitch is a SPA, so
opening `twitch.tv` and clicking through to a VOD does nothing at all. Only a
direct VOD URL works.

**Fix:** always install the navigation listener; move the relevance check inside
the per-pass functions instead of at module top level. Patch `replaceState` too —
React Router uses both.

### 8. Twitch marks cards processed before reading them — *high*
`content/twitch.js:52-56` sets `spProcessed = "true"` unconditionally, before
extracting card data. YouTube's version correctly waits for a title first. Any
lazily-rendered Twitch card is permanently skipped. Mirror the YouTube approach.

### 9. Twitch title rewrites don't stick — *high*
`content/twitch.js:81` assigns `titleEl.textContent` directly. YouTube
deliberately targets the inner `<span>` (`ytWriteTitle`) because React/Polymer
re-render over a naive assignment, and has `ytReapplyTitles` as a second line of
defence. Twitch has neither, so the label flashes and reverts.

Also: the Twitch watch page only implements `hideProgressBar`. `hideDuration` and
`hideChapters` are offered in the UI but do nothing there.

---

## ~~10. "Default actions" doesn't affect existing rules~~ — FIXED
Was: `settings.defaults` only pre-filled the New rule form; `spMatchRules` never
read it, so unchecking a box changed nothing about rules already created.

Now the Settings checkboxes are **global switches that gate every rule**:
an action fires only if the rule asks for it *and* it's enabled globally.
Implemented as a mask at the end of `spMatchRules`. Masking uses `=== false`
so settings stored before this change (missing keys) stay permissive rather
than silently disabling everything. Relabelled "Allowed actions" in the popup,
with a hint line explaining the AND.

---

## Watch — popup sometimes needed two clicks to open (unconfirmed fix)

**Symptom:** clicking the toolbar icon highlighted the Extensions button but no
popup appeared; repeating the click opened it. Happened repeatedly.

**Lead:** Firefox logged *"Layout was forced before the page was fully loaded"*
from `ext-browser-content.js` `_handleDOMChange` — the routine that measures the
popup at `DOMContentLoaded` to size the panel. If `popup.css` hadn't applied by
then it measured an unstyled, widthless document and sized the panel from that.

**Change made:** critical dimensions (box-sizing reset, `width: 360px`,
`min-height: 200px`) inlined in a `<style>` block in `popup/popup.html`'s
`<head>`, ahead of the `<link>`. Inline styles apply during parse, so the
measurement is always correct. **Keep in sync with `popup.css`.**

Also removed `"type": "module"` from the manifest's background entry (an earlier
guess at the cause; `background.js` uses no module syntax, so it's harmless
either way).

**Status: not confirmed.** The symptom disappeared after a reboot that coincided
with the fix, so cause and cure can't be separated. If it recurs, open the popup
inspector via `about:debugging` *before* clicking, and check whether the panel
gets a sane size on the failing click.

---

## Deferred — robustness

### 17. `storage.sync` 8KB-per-item quota, unhandled — *medium*
All rules live under a single `rules` key. Firefox's `QUOTA_BYTES_PER_ITEM` is
8192, and `persistRules()` (`popup/popup.js`) has no `.catch()` — so a large
ruleset fails to save **silently**. At minimum, catch and surface it; better,
split rules across keys or warn as the budget fills.

### 18. `alert()` / `confirm()` in a popup — *medium*
`popup/popup.js` uses them for delete confirmation and import results. These are
unreliable in Firefox extension popups; the popup can detach or dismiss.
Replace with inline UI.

### 19. Live streams never get a rewritten title — *medium*
`spParseDuration` returns `0` for "LIVE" / "EN DIRECT", so `spClassifyTitle`
returns `null` and the title is left intact — on exactly the content most likely
to spoil. Detect the live badge and emit a `Live — <sport>` label.

### 20. Lockup channel extraction is unreliable — *medium*
`content/youtube.js`, `ytGetCardData` lockup branch:
`metaEl.textContent.trim().split("\n")[0]`. `yt-content-metadata-view-model`
holds sibling spans concatenated without newlines, so this likely yields
`"ESPN1.2M views2 days ago"`. Channel rules still match by accident via
`includes()`, but **keyword rules can false-positive on view counts and dates**.
Query the specific span instead.

### 21. Legacy `ytd-channel-name` yields duplicated text — *low*
Often `"ESPNESPN"` (link + tooltip). Matching survives; the Log tab shows
garbage. Cosmetic.

### 22. Fragile watch-page selectors — *medium*
`content/youtube.js`, `ytProcessWatchPage`:
`h1.ytd-video-primary-info-renderer` is long obsolete and
`ytd-channel-name#channel-name` no longer matches current YouTube. Failure is a
silent no-op. Add a fallback chain plus a debug log when nothing resolves.

### 23. Twitch card selectors have bad fallbacks — *low*
`content/twitch.js:32-33` falls back to `p` for the channel and `h2` for the
title — both grab arbitrary elements.

### 24. Unused `activeTab` permission — *low*
Declared in `manifest.json` but never used. Drop it; needless AMO review
friction.

### 25. `uuidV4()` reimplements `crypto.randomUUID()` — *low*
`popup/popup.js`. The implementation is correct, just obsolete. One-line swap.

### 26. `escHtml` doesn't escape `'` — *low*
Safe today because every attribute in the template is double-quoted, but one
single-quoted attribute away from injection via a rule name. Prefer
`textContent` + `createElement` over `innerHTML` for the rule list.

### 27. Two `storage.onChanged` listeners with implicit ordering — *low*
One in `shared.js`, one per platform script. Correct only because manifest load
order registers the cache-updating one first. Fragile; consolidate into a single
listener that updates the cache then notifies the platform script.

### 28. Unhandled promise rejections — *low*
`loadSettings()` / `loadRules()` in `popup/popup.js` are fire-and-forget with no
`.catch()`. (`spRefreshCache` was given a `try/catch` during the fix pass.)

### 29. No linter or tests — *low*
The three pure functions (`spParseDuration`, `spClassifyTitle`, `spMatchRules`)
are trivially testable and would have caught #11. A single `test.js` run under
`node --test` needs no dependencies and no build step.
