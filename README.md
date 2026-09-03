# SpoilerShield

A Firefox extension that hides sports spoilers on YouTube — durations, progress
bars, chapter markers, thumbnails and titles — based on rules you define.

You pick the channels and keywords that matter (a team name, a competition, a
sports channel), and SpoilerShield rewrites matching videos so the result isn't
given away before you watch. A three-hour match and a two-minute highlight look
identical until you press play.

## Install

Not yet on addons.mozilla.org. To run it locally:

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…**
3. Select `spoilershield/manifest.json`

Temporary add-ons are removed when Firefox closes.

## Usage

Nothing happens until you create a rule — with no rules, every page is left
untouched.

Open the toolbar popup → **Rules** → **+ Add rule**:

| Field | Meaning |
|---|---|
| Sport | Label shown in place of the real title, e.g. `Football` |
| Keywords | Comma-separated; matched against the video title |
| Channels | Comma-separated; matched against the channel name |
| Actions | What to hide for videos this rule matches |

A video matches if **any** keyword or **any** channel matches. Where several
rules match, their actions are combined.

The **Settings** tab holds global switches: an action runs only if it's enabled
there *and* on the matching rule. The **Log** tab shows the last 50 matches,
which is the quickest way to tell whether a rule is firing.

## Actions

| Action | Effect |
|---|---|
| Hide duration | Blanks the duration on cards and in the player. Also makes the player's time readout inert, since clicking it reveals remaining time (`-4:59`) and gives the length away |
| Hide progress bar | Removes the player's seek bar |
| Hide chapters | Removes chapter markers and titles |
| Blur thumbnail | Blurs the thumbnail on cards |
| Rewrite title | Replaces the title with a neutral label — `Highlight — Football`, `Long video — Football` — derived from keywords in the title and the video's length |

## Privacy

No data leaves your browser. Rules and settings live in `storage.sync`; the
match log lives in `storage.local`. There are no network requests, no analytics,
and no remote code. The only permissions requested are `storage` and access to
`youtube.com`.

## Development

Plain JavaScript, CSS and HTML — no build step, no dependencies, no framework.
Keeping it that way is deliberate.

```sh
npx web-ext lint  --source-dir spoilershield                        # AMO linter
npx web-ext run   --source-dir spoilershield                        # auto-reloading dev profile
npx web-ext build --source-dir spoilershield --artifacts-dir dist   # package for AMO
```

### Layout

```
spoilershield/
  manifest.json
  background.js            seeds default settings on install
  content/
    shared.js              rule matching, title classifier, storage cache, logging
    youtube.js             card + player handling, SPA navigation, observer
    spoilershield.css      the actual hiding
    youtube-preempt.css    blurs thumbnails from first paint until rules load
  popup/                   settings, rule editor, log
wip/                       Twitch support — not shipped, see AUDIT.md
AUDIT.md                   known issues and deferred work
```

### Two things worth knowing before changing the content scripts

**Nothing may run before the ruleset loads.** Content scripts wait on `spReady`.
Processing a card against an empty cache marks it handled, and no later pass
re-visits a marked card — so a card missed at load stays missed.

**The pre-emptive blur is load-bearing.** `youtube.js` runs at `document_start`
and blurs candidate thumbnails via `.sp-init` until the first pass has
classified the page. Without it there's a window where the exact thumbnail the
extension exists to hide is fully visible. A failsafe timer always clears it, so
a storage failure can't leave the page blurred.

`AUDIT.md` records known issues and why deferred work was deferred. Worth
reading before re-diagnosing something.

## Status

YouTube only. Twitch support exists in `wip/` but is not shipped — see
`AUDIT.md` items 7–9 for what's broken.
# spoilershield
