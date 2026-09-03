// SpoilerShield — twitch.js
// VOD-only. Depends on shared.js (loaded first by manifest).

// ---------------------------------------------------------------------------
// Guard — only activate on VOD watch pages
// ---------------------------------------------------------------------------

function twIsVodPage() {
  return /^\/videos\/\d+/.test(location.pathname);
}

// On VOD card feeds (browse/following), we still want to blur cards.
// On any other Twitch page (live, clips, homepage) — do nothing.
function twIsRelevantPage() {
  // VOD watch page
  if (twIsVodPage()) return true;
  // Twitch browse/directory pages that can show VOD cards
  if (/^\/(directory|videos|following)/.test(location.pathname)) return true;
  return false;
}

if (!twIsRelevantPage()) {
  // Exit early — do not set up any observers on irrelevant pages
  throw new Error("SpoilerShield: not a relevant Twitch page, skipping.");
}

// ---------------------------------------------------------------------------
// Helpers — extract data from a VOD card element
// ---------------------------------------------------------------------------

function twGetCardData(card) {
  const titleEl   = card.querySelector('[data-a-target="video-card-title"], h2');
  const channelEl = card.querySelector('[data-a-target="video-card-channel-link"], p');
  const durationEl = card.querySelector('[data-a-target="video-card-length"]');
  const thumbEl   = card.querySelector("img");

  return {
    title:      titleEl   ? titleEl.textContent.trim()   : "",
    channel:    channelEl ? channelEl.textContent.trim()  : "",
    durationTxt: durationEl ? durationEl.textContent.trim() : "",
    titleEl,
    durationEl,
    thumbEl
  };
}

// ---------------------------------------------------------------------------
// Process a single VOD card
// ---------------------------------------------------------------------------

function twProcessCard(card) {
  if (card.dataset.spProcessed === "true") return;
  card.dataset.spProcessed = "true";

  const { title, channel, durationTxt, titleEl, durationEl, thumbEl } = twGetCardData(card);
  if (!title && !channel) return;

  const result = spMatchRules(spCache.rules, spCache.settings, "twitch", channel, title);
  if (!result) return;

  const { actions, matchedRules } = result;
  const durationSecs = spParseDuration(durationTxt);
  const sport        = matchedRules[0].sport;

  // Mark semantic sp-* classes on sub-elements
  if (durationEl) durationEl.classList.add("sp-duration");
  if (thumbEl)    thumbEl.classList.add("sp-thumbnail");

  // Apply scoped action classes to the card container
  if (actions.hideDuration)  card.classList.add("sp-hide-duration");
  if (actions.blurThumbnail) card.classList.add("sp-blur-thumbnail");

  // Title rewrite
  let titleLabel = null;
  if (actions.rewriteTitle && titleEl) {
    titleLabel = spClassifyTitle(title, durationSecs, sport);
    if (titleLabel) {
      if (!titleEl.dataset.spOriginalTitle) {
        titleEl.dataset.spOriginalTitle = title;
      }
      titleEl.textContent = titleLabel;
    }
  }

  spLog({
    platform:      "twitch",
    url:           location.href,
    originalTitle: title,
    channelName:   channel,
    matchedRuleId: matchedRules[0].id,
    actionsApplied: Object.entries(actions).filter(([, v]) => v).map(([k]) => k),
    titleLabel
  });
}

// ---------------------------------------------------------------------------
// Process the VOD watch page player
// ---------------------------------------------------------------------------

function twProcessWatchPage() {
  if (!twIsVodPage()) return;

  const titleEl   = document.querySelector("h2[data-a-target='stream-title'], .tw-title");
  const channelEl = document.querySelector("a[data-a-target='user-display-name'], .channel-info-content h1");
  const title     = titleEl   ? titleEl.textContent.trim()  : "";
  const channel   = channelEl ? channelEl.textContent.trim() : "";

  const result = spMatchRules(spCache.rules, spCache.settings, "twitch", channel, title);
  if (!result) return;

  const { actions } = result;

  const seekBar = document.querySelector('.video-player__seek-bar, [data-a-target="player-seekbar"]');
  if (seekBar) {
    seekBar.classList.add("sp-progress");
    // Scope to nearest player wrapper
    const playerWrapper = seekBar.closest(".video-player") || seekBar.parentElement;
    if (playerWrapper && actions.hideProgressBar) {
      playerWrapper.classList.add("sp-hide-progress");
    }
  }
}

// ---------------------------------------------------------------------------
// Process all unprocessed VOD cards in the document
// ---------------------------------------------------------------------------

const TW_CARD_SELECTOR = 'article[data-a-target="video-tower-card"]';

function twProcessAllCards() {
  document.querySelectorAll(TW_CARD_SELECTOR).forEach(card => {
    if (card.dataset.spProcessed !== "true") twProcessCard(card);
  });
}

// ---------------------------------------------------------------------------
// MutationObserver with 150ms debounce
// ---------------------------------------------------------------------------

let twDebounceTimer = null;

const twObserver = new MutationObserver(() => {
  clearTimeout(twDebounceTimer);
  twDebounceTimer = setTimeout(() => {
    twProcessAllCards();
    twProcessWatchPage();
  }, 150);
});

function twStartObserver() {
  twObserver.disconnect();
  twObserver.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Re-run when storage changes (settings / rules toggled from popup)
// ---------------------------------------------------------------------------

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  document.querySelectorAll("[data-sp-processed]").forEach(el => {
    delete el.dataset.spProcessed;
    el.classList.remove(
      "sp-hide-duration", "sp-blur-thumbnail",
      "sp-hide-progress", "sp-hide-chapters"
    );
  });
  twProcessAllCards();
  twProcessWatchPage();
});

// ---------------------------------------------------------------------------
// Twitch is also a SPA — watch for URL changes via popstate / pushState
// ---------------------------------------------------------------------------

function twOnNavigate() {
  if (!twIsRelevantPage()) return;
  twProcessAllCards();
  twProcessWatchPage();
}

window.addEventListener("popstate", twOnNavigate);

// Patch history.pushState to detect SPA transitions
(function patchPushState() {
  const orig = history.pushState.bind(history);
  history.pushState = function (...args) {
    orig(...args);
    setTimeout(twOnNavigate, 300); // allow React to re-render first
  };
})();

// ---------------------------------------------------------------------------
// Initial run
//
// Gated on spReady for the same reason as youtube.js: running against an empty
// ruleset marks every card as processed and nothing re-visits a marked card.
// ---------------------------------------------------------------------------

spReady.then(() => {
  twProcessAllCards();
  twProcessWatchPage();
  twStartObserver();
});
