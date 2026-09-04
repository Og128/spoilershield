# SpoilerShield — audit backlog

Findings from the 2026-09-03 code audit. Items 1–6 and 11–16 are **done**; what
follows is what we deliberately deferred, kept in original numbering.

Guiding constraint: this is meant to stay a **very lightweight** extension — no
build step, no dependencies, no framework. Prefer fixes that remove work rather
than add it.

---

## ~~Twitch (whole platform parked for now)~~ — REMOVED
Was: items 7–9 tracked bugs in the unshipped `wip/twitch.js` (inert until a
direct VOD URL, cards marked processed before read, title rewrites not
sticking). Twitch support has been dropped entirely rather than fixed —
`wip/twitch.js` is deleted, and the `platforms` field that existed only to
let it return later is gone from the rule shape, `spMatchRules`, and the
popup. YouTube-only, for real now.

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

## ~~17. `storage.sync` 8KB-per-item quota, unhandled~~ — FIXED
Was: all rules live under a single `rules` key. Firefox's `QUOTA_BYTES_PER_ITEM`
is 8192, and `persistRules()` had no `.catch()` — so a large ruleset failed to
save **silently**.

Now `persistRules()` catches the rejection, shows it in a status banner
(`#rules-status` in `popup/popup.html`), and returns `true`/`false`. Every
caller reloads from storage on failure so the UI can't show a change that
wasn't actually persisted.

## ~~18. `alert()` / `confirm()` in a popup~~ — FIXED
Was: `popup/popup.js` used them for delete confirmation and import results —
unreliable in Firefox extension popups, which can lose focus or get torn down
while a blocking native dialog is open.

Replaced with inline UI: delete is a two-step confirm/cancel row swapped into
the rule item itself; the sport-required check is a `.field-error` under the
input; import success/failure use the same `#rules-status` banner as #17
(`.info` / `.error` variants).

## ~~19. Live streams never get a rewritten title~~ — FIXED
Was: `spParseDuration` returns `0` for "LIVE" / "EN DIRECT", so
`spClassifyTitle` returned `null` and the title was left intact — on exactly
the content most likely to spoil.

Added `spIsLive(durationTxt)` (`content/shared.js`) to detect the badge text
directly rather than inferring "live" from an unparseable duration. Live cards
get `[LIVE] <channel>` instead of running through the Short/Medium/Long
classifier — deliberately not duration-based, since elapsed time on a live
stream only grows, and a duration-based label would change mid-stream.

## ~~22. Fragile watch-page selectors~~ — FIXED
Was: `h1.ytd-video-primary-info-renderer` and `ytd-channel-name#channel-name`
alone, both stale against current YouTube markup — failure was a silent no-op.

Now `ytProcessWatchPage` tries a fallback chain of selectors (newer markup
first, old ones kept as last resort) via `ytQueryFirst()`. If nothing resolves
for ~3 seconds straight (20 throttled passes) it logs once via
`console.debug` instead of staying silent, so a future YouTube redesign is
diagnosable instead of invisible.

## ~~24. Unused `activeTab` permission~~ — Already gone
`manifest.json`'s `permissions` is just `["storage"]` — this was already
removed before this pass, entry was stale.

## ~~25. `uuidV4()` reimplements `crypto.randomUUID()`~~ — FIXED
`popup/popup.js`: swapped both call sites (new rule, import) to
`crypto.randomUUID()` and deleted the custom implementation. Same call
shape (synchronous, same two sites), so no behavior change — rule
activation still doesn't require a page reload, since that comes from the
`storage.onChanged` listener in `shared.js`, untouched by this change.

## 29. No linter or tests — PARTIALLY ADDRESSED
Added `spoilershield/test.js` — `node --test`, zero dependencies. Covers
`spParseDuration`, `spClassifyTitle`, `spMatchRules`, `spIsLive`, and
`spNormaliseRule`'s tolerance of malformed data (17 tests, all passing).
Linting (`web-ext lint`) was already run manually each session; not wired
into CI.

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

### ~~23. Twitch card selectors have bad fallbacks~~ — REMOVED
Was in `content/twitch.js`, deleted with the rest of Twitch support.

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
