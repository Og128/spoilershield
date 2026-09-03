// SpoilerShield — youtube.js
// Depends on shared.js (loaded first by manifest).
// Runs at document_start; all body-dependent work waits for ytBoot().

// ---------------------------------------------------------------------------
// Card selectors
// ---------------------------------------------------------------------------

const CARD_TAGS = [
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-rich-item-renderer",
  "yt-lockup-view-model"           // homepage 2024+ card design
];

const CARD_SELECTORS = CARD_TAGS.join(", ");

// Narrowed variants so the browser filters out already-handled cards natively,
// instead of us walking every card on the page on every pass.
const UNPROCESSED_CARDS = CARD_TAGS
  .map(t => `${t}:not([data-sp-processed])`).join(", ");
const UNPROCESSED_CHANNEL_CARDS = CARD_TAGS
  .map(t => `${t}:not([data-sp-channel-processed])`).join(", ");

// ---------------------------------------------------------------------------
// Title helpers
//
// Target the inner span when present so YouTube doesn't re-render the span with
// the original text after we overwrite it. Titles are tracked on the *card*
// (data-sp-title-label / data-sp-original-title) so a re-render of the card's
// internals can't lose them, and so we can put the real title back.
// ---------------------------------------------------------------------------

function ytTitleEl(card) {
  return card.tagName === "YT-LOCKUP-VIEW-MODEL"
    ? (card.querySelector("h3 a") || card.querySelector("h3"))
    : card.querySelector("#video-title");
}

// Resolve the innermost element that actually holds the title text.
//
// Never write to an element that *wraps* a link: setting textContent replaces
// all children, which deletes the <a> and leaves the title unclickable. This
// matters because we run at document_start, so we routinely see a card before
// YouTube has finished building it and ytTitleEl falls back to the bare <h3>.
// Preferring span, then a, then the element itself keeps the link intact in
// every case — and self-heals once YouTube fills the card in.
function ytTitleTarget(titleEl) {
  return titleEl.querySelector("span") || titleEl.querySelector("a") || titleEl;
}

function ytWriteTitle(titleEl, text) {
  const target = ytTitleTarget(titleEl);
  // Skip no-op writes — each one is a DOM mutation that wakes our own observer.
  if (target.textContent !== text) target.textContent = text;
}

function ytApplyTitle(card, titleEl, originalTitle, label) {
  if (!card.dataset.spOriginalTitle) card.dataset.spOriginalTitle = originalTitle;
  card.dataset.spTitleLabel = label;
  ytWriteTitle(titleEl, label);
}

// Put every rewritten title back and forget it. Used when the extension is
// disabled and before re-evaluating after a rules change.
function ytRestoreTitles() {
  document.querySelectorAll("[data-sp-title-label]").forEach(card => {
    const el       = ytTitleEl(card);
    const original = card.dataset.spOriginalTitle;
    if (el && original) ytWriteTitle(el, original);
    delete card.dataset.spTitleLabel;
    delete card.dataset.spOriginalTitle;
  });
}

// Re-pin labels on cards YouTube has re-rendered back to the real title.
// Runs on every pass, so it must never throw: one null element used to abort
// the whole pass and stop channel-page handling for the rest of the page's life.
function ytReapplyTitles() {
  document.querySelectorAll("[data-sp-title-label]").forEach(card => {
    const el = ytTitleEl(card);
    if (!el) return;

    const label   = card.dataset.spTitleLabel;
    const current = ytTitleTarget(el).textContent.trim();
    if (current === label) return;

    // YouTube put its own text back. Only record it as the original if we don't
    // already have one — otherwise a stale label could become the "original"
    // and the real title would be lost for good.
    if (current && !card.dataset.spOriginalTitle) {
      card.dataset.spOriginalTitle = current;
    }
    ytWriteTitle(el, label);
  });
}

// ---------------------------------------------------------------------------
// Helpers — extract data from a video card element
// ---------------------------------------------------------------------------

function ytGetCardData(card) {
  const isLockup = card.tagName === "YT-LOCKUP-VIEW-MODEL";
  const titleEl  = ytTitleEl(card);

  // New lockup design used on the homepage (2024+)
  if (isLockup) {
    const h3         = card.querySelector("h3");
    const durationEl = card.querySelector("badge-shape");
    const thumbEl    = card.querySelector("yt-thumbnail-view-model");
    const metaEl     = card.querySelector("yt-content-metadata-view-model");

    return {
      title:       h3         ? h3.textContent.trim()                           : "",
      channel:     metaEl     ? metaEl.textContent.trim().split("\n")[0].trim() : "",
      durationTxt: durationEl ? durationEl.textContent.trim()                   : "",
      titleEl,
      thumbEl,
      durationEl
    };
  }

  // Legacy card structure (ytd-*-renderer)
  const channelEl  = card.querySelector("ytd-channel-name, yt-formatted-string.ytd-channel-name");
  const durationEl = card.querySelector("span.ytd-thumbnail-overlay-time-status-renderer");
  const thumbEl    = card.querySelector("ytd-thumbnail img");

  return {
    title:       titleEl    ? titleEl.textContent.trim()    : "",
    channel:     channelEl  ? channelEl.textContent.trim()  : "",
    durationTxt: durationEl ? durationEl.textContent.trim() : "",
    titleEl,
    thumbEl,
    durationEl
  };
}

// ---------------------------------------------------------------------------
// Channel page — apply actions to every card based on the page-level channel name.
// YouTube doesn't embed the channel name inside individual cards on channel pages,
// so per-card matching can't work there. Instead we read the header once and
// blanket-apply if a rule matches.
// ---------------------------------------------------------------------------

function ytProcessChannelPage() {
  if (!/^\/((@|channel\/|c\/|user\/).)/i.test(location.pathname)) return;

  // Bail before touching the header if there's nothing new to handle.
  const cards = document.querySelectorAll(UNPROCESSED_CHANNEL_CARDS);
  if (!cards.length) return;

  const channelName =
    document.querySelector("yt-dynamic-text-view-model")?.textContent.trim() ||
    document.querySelector("#channel-name yt-formatted-string")?.textContent.trim() ||
    "";
  if (!channelName) return;

  const result = spMatchRules(spCache.rules, spCache.settings, "youtube", channelName, "");
  if (!result) return;

  const { actions, matchedRules } = result;
  const sport = matchedRules[0].sport;

  cards.forEach(card => {
    card.dataset.spChannelProcessed = "true";

    const { title, durationTxt, titleEl, thumbEl, durationEl } = ytGetCardData(card);

    if (actions.blurThumbnail && thumbEl) {
      thumbEl.classList.add("sp-thumbnail");
      card.classList.add("sp-blur-thumbnail");
    }
    if (actions.hideDuration && durationEl) {
      durationEl.classList.add("sp-duration");
      card.classList.add("sp-hide-duration");
    }
    if (actions.rewriteTitle && titleEl && title) {
      const label = spClassifyTitle(title, spParseDuration(durationTxt), sport);
      if (label) ytApplyTitle(card, titleEl, title, label);
    }
  });
}

// ---------------------------------------------------------------------------
// Process a single video card
// ---------------------------------------------------------------------------

function ytProcessCard(card) {
  const { title, channel, durationTxt, titleEl, thumbEl, durationEl } = ytGetCardData(card);

  // YouTube populates card content lazily (especially on the homepage).
  // Don't mark as processed until the title is present — it's needed for keyword
  // matching and rewriting. The observer will retry on the next mutation.
  if (!title) return;

  card.dataset.spProcessed = "true";

  const result = spMatchRules(spCache.rules, spCache.settings, "youtube", channel, title);
  if (!result) return;

  const { actions, matchedRules } = result;
  const durationSecs = spParseDuration(durationTxt);
  const sport        = matchedRules[0].sport;

  // Mark semantic sp-* classes on sub-elements so CSS rules can target them
  if (durationEl) durationEl.classList.add("sp-duration");
  if (thumbEl)    thumbEl.classList.add("sp-thumbnail");

  // Apply scoped action classes to the card container
  if (actions.hideDuration)  card.classList.add("sp-hide-duration");
  if (actions.blurThumbnail) card.classList.add("sp-blur-thumbnail");

  // Title rewrite
  let titleLabel = null;
  if (actions.rewriteTitle && titleEl) {
    titleLabel = spClassifyTitle(title, durationSecs, sport);
    if (titleLabel) ytApplyTitle(card, titleEl, title, titleLabel);
  }

  spLog({
    platform:       "youtube",
    url:            location.href,
    originalTitle:  title,
    channelName:    channel,
    matchedRuleId:  matchedRules[0].id,
    actionsApplied: Object.entries(actions).filter(([, v]) => v).map(([k]) => k),
    titleLabel
  });
}

function ytProcessAllCards() {
  document.querySelectorAll(UNPROCESSED_CARDS).forEach(ytProcessCard);
  ytReapplyTitles();
  ytProcessChannelPage();
}

// ---------------------------------------------------------------------------
// Watch-page player actions
// ---------------------------------------------------------------------------

function ytProcessWatchPage() {
  if (!location.pathname.startsWith("/watch")) return;

  const player = document.getElementById("movie_player");
  if (!player) return;

  // Do this once per video. YouTube mutates the player constantly during
  // playback (timestamp, progress bar), so without this guard the whole
  // selector chain and rule match would re-run several times a second.
  const videoId = new URLSearchParams(location.search).get("v") || "";
  if (player.dataset.spWatchId === videoId) return;

  const titleEl   = document.querySelector("h1.ytd-video-primary-info-renderer, h1 yt-formatted-string");
  const channelEl = document.querySelector("ytd-channel-name#channel-name, #upload-info ytd-channel-name");
  const title     = titleEl   ? titleEl.textContent.trim()   : "";
  const channel   = channelEl ? channelEl.textContent.trim() : "";

  // Metadata not populated yet — retry on the next pass rather than caching a miss.
  if (!title && !channel) return;
  player.dataset.spWatchId = videoId;

  const result = spMatchRules(spCache.rules, spCache.settings, "youtube", channel, title);
  if (!result) return;

  const { actions } = result;

  // Mark semantic classes on player sub-elements
  const progressBar = player.querySelector(".ytp-progress-bar-container");
  const durationEl  = player.querySelector(".ytp-time-duration");
  const timeDisplay = player.querySelector(".ytp-time-display");
  const chapters    = player.querySelectorAll(".ytp-chapter-hover-container, .ytp-chapter-title");

  if (progressBar) progressBar.classList.add("sp-progress");
  if (durationEl)  durationEl.classList.add("sp-duration");
  if (timeDisplay) timeDisplay.classList.add("sp-time-display");
  chapters.forEach(el => el.classList.add("sp-chapter"));

  if (actions.hideProgressBar) player.classList.add("sp-hide-progress");
  if (actions.hideChapters)    player.classList.add("sp-hide-chapters");
  if (actions.hideDuration) {
    player.classList.add("sp-hide-duration");
    ytFixRemainingTime(player, timeDisplay);
  }
}

// Clicking YouTube's time readout switches it from elapsed to *remaining* time,
// so "0:01" becomes "-4:59" — which gives the duration away just as plainly as
// the duration field we hid. CSS blocks the click (see .sp-time-display), but
// that only stops new toggles: the player can load already in remaining mode
// from a previous session, and then the CSS would lock it there.
//
// So if we find a negative readout, toggle it back. Element.click() still
// dispatches even though pointer-events blocks real clicks. The delayed second
// check catches the player restoring the mode after our first pass.
function ytFixRemainingTime(player, timeDisplay) {
  if (!timeDisplay) return;

  const revert = () => {
    const current = player.querySelector(".ytp-time-current");
    if (current && current.textContent.trim().startsWith("-")) timeDisplay.click();
  };

  revert();
  setTimeout(revert, 1000);
}

// ---------------------------------------------------------------------------
// One processing pass
// ---------------------------------------------------------------------------

function ytRunPass() {
  // When the extension is off, actively undo the one change CSS can't revert.
  // Rewritten titles are destructive DOM writes, so without this the master
  // toggle leaves them in place — and ytReapplyTitles would keep re-pinning them.
  if (!spCache.settings.enabled) {
    ytRestoreTitles();
    return;
  }
  ytProcessAllCards();
  ytProcessWatchPage();
}

function ytResetAll() {
  document.querySelectorAll("[data-sp-processed], [data-sp-channel-processed]").forEach(el => {
    delete el.dataset.spProcessed;
    delete el.dataset.spChannelProcessed;
    el.classList.remove("sp-hide-duration", "sp-blur-thumbnail");
  });

  const player = document.getElementById("movie_player");
  if (player) {
    delete player.dataset.spWatchId;
    player.classList.remove("sp-hide-progress", "sp-hide-chapters", "sp-hide-duration");
  }

  // Restore before re-evaluating: anything still matching gets re-labelled in
  // the same pass, anything no longer matching keeps its real title.
  ytRestoreTitles();
}

// ---------------------------------------------------------------------------
// MutationObserver — throttled, with a guaranteed max wait.
//
// A pure debounce starves on YouTube: the DOM mutates continuously during
// playback, so the timer was reset forever and the pass could simply never run.
// This schedules at most one pass per THROTTLE_MS and runs immediately if the
// last pass is already older than MAX_WAIT_MS. It also does no timer churn —
// once a pass is scheduled, further mutations are free.
// ---------------------------------------------------------------------------

const YT_THROTTLE_MS = 150;
const YT_MAX_WAIT_MS = 500;

let ytTimer   = null;
let ytLastRun = 0;

function ytFirePass() {
  ytTimer   = null;
  ytLastRun = Date.now();
  ytRunPass();
}

function ytSchedulePass() {
  if (Date.now() - ytLastRun >= YT_MAX_WAIT_MS) {
    if (ytTimer !== null) { clearTimeout(ytTimer); ytTimer = null; }
    ytFirePass();
    return;
  }
  if (ytTimer !== null) return;   // already scheduled — nothing to do
  ytTimer = setTimeout(ytFirePass, YT_THROTTLE_MS);
}

// childList + subtree is enough — attributes: true causes YouTube's constant
// Polymer attribute mutations to swamp the observer for no benefit.
const ytObserver = new MutationObserver(ytSchedulePass);

// ---------------------------------------------------------------------------
// SPA navigation — re-run on every yt-navigate-finish.
// The observer watches document.body, which survives SPA navigation, so it
// never needs restarting.
// ---------------------------------------------------------------------------

function ytOnNavigate() {
  const player = document.getElementById("movie_player");
  if (player) {
    delete player.dataset.spWatchId;
    player.classList.remove("sp-hide-progress", "sp-hide-chapters", "sp-hide-duration");
  }
  ytRunPass();
}

window.addEventListener("yt-navigate-finish", ytOnNavigate);

// yt-page-data-updated fires when YouTube has finished populating card content
// (including titles on the homepage). More reliable than MutationObserver for
// the initial render because it fires after YouTube's own rendering cycle.
window.addEventListener("yt-page-data-updated", () => ytRunPass());

// Re-run when settings / rules are toggled from the popup.
// shared.js registers its listener first, so spCache is already current here.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  ytResetAll();
  ytRunPass();
});

// ---------------------------------------------------------------------------
// Boot
//
// Nothing may run until the ruleset has loaded: processing against an empty
// cache marks every card as handled, and no pass ever re-visits a marked card.
// That single race meant every card present at initial load was silently
// skipped until the user happened to change a setting.
// ---------------------------------------------------------------------------

const YT_FAILSAFE_MS = 3000;

function ytClearPreemptiveBlur() {
  document.documentElement.classList.remove("sp-init");
  document.documentElement.classList.add("sp-ready");
}

function ytWhenDomReady(fn) {
  if (document.body) { fn(); return; }
  document.addEventListener("DOMContentLoaded", fn, { once: true });
}

// Blur candidate thumbnails from first paint (see youtube-preempt.css).
document.documentElement.classList.add("sp-init");

// A storage failure or a hung read must never leave the page blurred.
const ytFailsafe = setTimeout(ytClearPreemptiveBlur, YT_FAILSAFE_MS);

Promise.all([spReady, new Promise(ytWhenDomReady)]).then(() => {
  clearTimeout(ytFailsafe);
  ytLastRun = Date.now();
  ytRunPass();
  ytClearPreemptiveBlur();
  ytObserver.observe(document.body, { childList: true, subtree: true });
});
