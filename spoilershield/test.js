// SpoilerShield — test.js
// Run with: node --test
//
// No dependencies, no build step. Loads content/shared.js into a sandboxed
// context (stubbing the `browser` global it expects at load time) so the
// three pure functions — spParseDuration, spClassifyTitle, spMatchRules —
// can be called directly, plus spIsLive and spNormaliseRule.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function loadShared() {
  const code = fs.readFileSync(path.join(__dirname, "content/shared.js"), "utf8");
  const sandbox = {
    browser: {
      storage: {
        sync:  { get: async () => ({}), set: async () => {} },
        local: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener: () => {} }
      }
    },
    console,
    setTimeout,
    Date
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "content/shared.js" });
  return sandbox;
}

const { spParseDuration, spClassifyTitle, spMatchRules, spIsLive, spNormaliseRule } = loadShared();

function rule(overrides) {
  return spNormaliseRule({
    id: "1", sport: "NBA", enabled: true,
    keywords: ["lakers"], channels: ["espn"],
    actions: { blurThumbnail: true, rewriteTitle: true },
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// spParseDuration
// ---------------------------------------------------------------------------

test("spParseDuration — M:SS", () => {
  assert.equal(spParseDuration("4:32"), 272);
});

test("spParseDuration — H:MM:SS", () => {
  assert.equal(spParseDuration("1:02:03"), 3723);
});

test("spParseDuration — empty or unparseable input returns 0", () => {
  assert.equal(spParseDuration(""), 0);
  assert.equal(spParseDuration(undefined), 0);
  assert.equal(spParseDuration("LIVE"), 0);
});

// ---------------------------------------------------------------------------
// spIsLive
// ---------------------------------------------------------------------------

test("spIsLive detects LIVE / EN DIRECT badges, case-insensitive", () => {
  assert.equal(spIsLive("LIVE"), true);
  assert.equal(spIsLive("live"), true);
  assert.equal(spIsLive("EN DIRECT"), true);
});

test("spIsLive is false for real durations or empty text", () => {
  assert.equal(spIsLive("4:32"), false);
  assert.equal(spIsLive(""), false);
  assert.equal(spIsLive(undefined), false);
});

// ---------------------------------------------------------------------------
// spClassifyTitle
// ---------------------------------------------------------------------------

test("spClassifyTitle — highlight keyword wins regardless of duration", () => {
  assert.equal(spClassifyTitle("Match Highlights", 9000, "NBA"), "Highlight — NBA");
});

test("spClassifyTitle — press/interview keyword", () => {
  assert.equal(spClassifyTitle("Post-game press conference", 600, "NBA"), "Press — NBA");
});

test("spClassifyTitle — duration bucketing", () => {
  assert.equal(spClassifyTitle("Random title", 30, "NBA"), null);
  assert.equal(spClassifyTitle("Random title", 600, "NBA"), "Short video — NBA");
  assert.equal(spClassifyTitle("Random title", 3000, "NBA"), "Medium video — NBA");
  assert.equal(spClassifyTitle("Random title", 6000, "NBA"), "Long video — NBA");
});

// ---------------------------------------------------------------------------
// spMatchRules
// ---------------------------------------------------------------------------

test("spMatchRules — matches by channel", () => {
  const settings = { enabled: true, defaults: {} };
  const result = spMatchRules([rule()], settings, "ESPN", "Some game");
  assert.ok(result);
  assert.equal(result.actions.blurThumbnail, true);
});

test("spMatchRules — matches by keyword", () => {
  const settings = { enabled: true, defaults: {} };
  const result = spMatchRules([rule()], settings, "Random Channel", "Lakers recap");
  assert.ok(result);
});

test("spMatchRules — no match returns null", () => {
  const settings = { enabled: true, defaults: {} };
  assert.equal(spMatchRules([rule()], settings, "Random Channel", "Unrelated title"), null);
});

test("spMatchRules — disabled globally returns null", () => {
  const settings = { enabled: false, defaults: {} };
  assert.equal(spMatchRules([rule()], settings, "ESPN", "Some game"), null);
});

test("spMatchRules — disabled rule is ignored", () => {
  const settings = { enabled: true, defaults: {} };
  assert.equal(spMatchRules([rule({ enabled: false })], settings, "ESPN", "Some game"), null);
});

test("spMatchRules — global switch off overrides a matching rule (regression: #10)", () => {
  const settings = { enabled: true, defaults: { blurThumbnail: false } };
  const result = spMatchRules([rule()], settings, "ESPN", "Some game");
  assert.equal(result.actions.blurThumbnail, false);
  assert.equal(result.actions.rewriteTitle, true);
});

test("spMatchRules — missing defaults key stays permissive, not disabled", () => {
  // Settings saved before the "defaults gate every rule" change lack these
  // keys entirely — `undefined` must not be treated the same as `false`.
  const settings = { enabled: true, defaults: {} };
  const result = spMatchRules([rule()], settings, "ESPN", "Some game");
  assert.equal(result.actions.blurThumbnail, true);
});

// ---------------------------------------------------------------------------
// spNormaliseRule — tolerance of malformed stored/imported data
// ---------------------------------------------------------------------------

test("spNormaliseRule — drops non-string entries and trims whitespace", () => {
  const r = spNormaliseRule({
    id: "1", sport: "NBA", enabled: true,
    keywords: ["  Lakers  ", 42, null, ""],
    channels: ["ESPN"],
    actions: { blurThumbnail: true }
  });
  assert.deepEqual(r.keywords, ["Lakers"]);
  assert.deepEqual(r.lcKeywords, ["lakers"]);
});

test("spNormaliseRule — missing/garbage fields don't throw", () => {
  assert.doesNotThrow(() => spNormaliseRule({}));
  assert.equal(spNormaliseRule(null), null);
  assert.equal(spNormaliseRule("garbage"), null);
});
