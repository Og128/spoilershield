// SpoilerShield — shared.js
// Rule matcher, title classifier, duration parser, storage cache, logging.
// Loaded before youtube.js on every matching page.

const SP_ACTION_KEYS = [
  "hideDuration",
  "hideProgressBar",
  "hideChapters",
  "blurThumbnail",
  "rewriteTitle"
];

// ---------------------------------------------------------------------------
// Duration parser — "H:MM:SS" or "M:SS" → total seconds
// ---------------------------------------------------------------------------

function spParseDuration(text) {
  if (!text) return 0;
  const parts = text.trim().split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// A live stream shows a "LIVE" badge instead of a duration. Its elapsed time
// only grows, so running it through the same Short/Medium/Long classification
// as a VOD would make the title change while you're watching. Detect it from
// the badge text instead of treating "duration unparseable" as "live" — a
// video whose duration just hasn't loaded yet would otherwise be misread.
function spIsLive(durationTxt) {
  return /^(live|en direct)$/i.test((durationTxt || "").trim());
}

// ---------------------------------------------------------------------------
// Rule normalisation
// Rules can arrive from storage having been hand-edited or imported from
// another install, so every field is coerced to the shape spMatchRules expects.
// Without this a single malformed rule throws inside the MutationObserver
// callback on every pass and silently bricks the extension.
//
// This is also where keywords/channels get pre-lowercased: rules only change
// when storage changes, so doing it once here avoids re-lowercasing every
// keyword for every card on every pass.
// ---------------------------------------------------------------------------

function spStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(s => typeof s === "string" && s.trim())
    .map(s => s.trim());
}

function spNormaliseRule(rule) {
  if (!rule || typeof rule !== "object") return null;

  const keywords = spStringList(rule.keywords);
  const channels = spStringList(rule.channels);

  const actions = {};
  for (const key of SP_ACTION_KEYS) {
    actions[key] = !!(rule.actions && rule.actions[key]);
  }

  return {
    id:      typeof rule.id    === "string" ? rule.id    : "",
    sport:   typeof rule.sport === "string" ? rule.sport : "",
    enabled: rule.enabled !== false,
    keywords,
    channels,
    actions,
    // Precomputed match forms — see comment above.
    lcKeywords: keywords.map(s => s.toLowerCase()),
    lcChannels: channels.map(s => s.toLowerCase())
  };
}

// ---------------------------------------------------------------------------
// Rule matcher
// Returns merged actions object (OR logic) from all matching rules,
// or null if nothing matched.
// ---------------------------------------------------------------------------

function spMatchRules(rules, settings, channelName, rawTitle) {
  if (!settings || !settings.enabled) return null;

  const ch  = (channelName || "").toLowerCase();
  const ttl = (rawTitle    || "").toLowerCase();
  if (!ch && !ttl) return null;

  let matchedRules = null;
  const actions = {
    hideDuration:    false,
    hideProgressBar: false,
    hideChapters:    false,
    blurThumbnail:   false,
    rewriteTitle:    false
  };

  // Single pass: collect matches and merge their actions at the same time.
  for (const rule of rules) {
    if (!rule.enabled) continue;

    const hit =
      (ch  && rule.lcChannels.some(c => ch.includes(c))) ||
      (ttl && rule.lcKeywords.some(k => ttl.includes(k)));
    if (!hit) continue;

    (matchedRules ||= []).push(rule);
    for (const key of SP_ACTION_KEYS) {
      if (rule.actions[key]) actions[key] = true;
    }
  }

  if (!matchedRules) return null;

  // Global switches gate every rule: an action fires only if its rule asks for
  // it AND it isn't switched off in the Settings tab. Previously these settings
  // only pre-filled the new-rule form, so unchecking one appeared to do nothing
  // to rules you'd already created.
  //
  // Explicit `false` only — a key missing from older stored settings means
  // "not configured", which must stay permissive rather than silently
  // disabling everything.
  const globals = settings.defaults;
  if (globals) {
    for (const key of SP_ACTION_KEYS) {
      if (globals[key] === false) actions[key] = false;
    }
  }

  // Everything these rules asked for is switched off globally — nothing to do.
  if (!SP_ACTION_KEYS.some(key => actions[key])) return null;

  return { actions, matchedRules };
}

// ---------------------------------------------------------------------------
// Title classifier
// Input: raw title string + duration in seconds.
// Output: label string or null.
// ---------------------------------------------------------------------------

function spClassifyTitle(rawTitle, durationSecs, sportName) {
  const t = (rawTitle || "").toLowerCase();

  let category = null;

  if (/highlights?|r[eé]sum[eé]/.test(t)) {
    category = "Highlight";
  } else if (/interview|press conference|conf[eé]rence de presse|conf de presse|media day/.test(t)) {
    category = "Press";
  } else if (durationSecs >= 5400) {
    category = "Long video";
  } else if (durationSecs > 1200 && durationSecs < 5400) {
    category = "Medium video";
  } else if (durationSecs >= 60 && durationSecs <= 1200) {
    category = "Short video";
  }

  if (!category) return null;
  return `${category} — ${sportName}`;
}

// ---------------------------------------------------------------------------
// Logging — buffered.
//
// This used to do a read-modify-write of the whole log array per matched card.
// On a page with 30 matches that meant 30 concurrent storage round-trips that
// each read the same pre-mutation array and then overwrote one another, so
// entries were lost and it was the heaviest thing in the hot path.
//
// Now entries queue in memory and a single serialised flush writes them as a
// batch. spLogFlushing guarantees only one read-modify-write is ever in flight.
// ---------------------------------------------------------------------------

const SP_LOG_MAX      = 50;
const SP_LOG_FLUSH_MS = 1000;

let spLogQueue    = [];
let spLogTimer    = null;
let spLogFlushing = false;

function spLog(entry) {
  spLogQueue.push({ timestamp: new Date().toISOString(), ...entry });
  if (spLogTimer === null) {
    spLogTimer = setTimeout(spFlushLog, SP_LOG_FLUSH_MS);
  }
}

async function spFlushLog() {
  spLogTimer = null;
  if (spLogFlushing || !spLogQueue.length) return;

  spLogFlushing = true;
  const batch = spLogQueue.splice(0);

  try {
    const data = await browser.storage.local.get("log");
    const log  = Array.isArray(data.log) ? data.log : [];
    // Queue is chronological; the stored log is newest-first.
    const merged = batch.reverse().concat(log);
    if (merged.length > SP_LOG_MAX) merged.length = SP_LOG_MAX;
    await browser.storage.local.set({ log: merged });
  } catch (_) {
    // Non-fatal — storage may be unavailable.
  } finally {
    spLogFlushing = false;
    // Anything queued while we were writing gets picked up on the next tick.
    if (spLogQueue.length && spLogTimer === null) {
      spLogTimer = setTimeout(spFlushLog, SP_LOG_FLUSH_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Storage cache — keeps a live copy of rules + settings so content scripts
// don't have to await storage on every mutation callback.
//
// spReady resolves once the first read completes. Platform scripts MUST wait
// on it before their first pass: processing against an empty ruleset marks
// every card as handled, and nothing re-visits a card once it's marked.
// ---------------------------------------------------------------------------

const spCache = {
  rules:    [],
  settings: { enabled: true, defaults: {} }
};

function spSetRules(value) {
  spCache.rules = Array.isArray(value)
    ? value.map(spNormaliseRule).filter(Boolean)
    : [];
}

async function spRefreshCache() {
  try {
    const data = await browser.storage.sync.get(["rules", "settings"]);
    spSetRules(data.rules);
    if (data.settings) spCache.settings = data.settings;
  } catch (err) {
    console.warn("SpoilerShield: could not read stored rules, continuing with none.", err);
  }
  return spCache;
}

const spReady = spRefreshCache();

// Stay in sync when the user changes settings/rules from the popup.
// Registered before the platform scripts' own listeners (shared.js loads
// first), so the cache is always current by the time they reprocess.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.rules)    spSetRules(changes.rules.newValue);
  if (changes.settings) spCache.settings = changes.settings.newValue ?? spCache.settings;
});
