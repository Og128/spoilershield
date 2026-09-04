// SpoilerShield — popup.js
"use strict";

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "log") renderLog();
  });
});

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

const masterToggle = document.getElementById("master-toggle");
const defCheckboxes = {
  hideDuration:    document.getElementById("def-hideDuration"),
  hideProgressBar: document.getElementById("def-hideProgressBar"),
  hideChapters:    document.getElementById("def-hideChapters"),
  blurThumbnail:   document.getElementById("def-blurThumbnail"),
  rewriteTitle:    document.getElementById("def-rewriteTitle")
};

async function loadSettings() {
  const { settings } = await browser.storage.sync.get("settings");
  if (!settings) return;
  masterToggle.checked = settings.enabled;
  const d = settings.defaults || {};
  for (const [key, el] of Object.entries(defCheckboxes)) {
    el.checked = !!d[key];
  }
}

async function saveSettings() {
  const { settings } = await browser.storage.sync.get("settings");
  const updated = {
    ...(settings || {}),
    enabled: masterToggle.checked,
    defaults: Object.fromEntries(Object.entries(defCheckboxes).map(([k, el]) => [k, el.checked]))
  };
  await browser.storage.sync.set({ settings: updated });
}

masterToggle.addEventListener("change", saveSettings);
Object.values(defCheckboxes).forEach(el => el.addEventListener("change", saveSettings));

// ---------------------------------------------------------------------------
// Rules tab — list rendering
// ---------------------------------------------------------------------------

let allRules = [];

async function loadRules() {
  const data = await browser.storage.sync.get("rules");
  allRules = Array.isArray(data.rules) ? data.rules : [];
  renderRules();
}

const rulesStatus = document.getElementById("rules-status");

function showRulesStatus(message, type) {
  rulesStatus.textContent = message;
  rulesStatus.className = `status-banner ${type}`;
}

function clearRulesStatus() {
  rulesStatus.className = "status-banner hidden";
}

// Everything below builds DOM nodes rather than assigning innerHTML. Rule text
// is user-supplied, and AMO's linter flags dynamic innerHTML on sight
// (UNSAFE_VAR_ASSIGNMENT). Using textContent makes escaping structural instead
// of something a future edit could forget.
function makeEl(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text)      node.textContent = opts.text;
  if (opts.title)     node.title = opts.title;
  return node;
}

function emptyState(list, message) {
  list.replaceChildren(makeEl("li", { className: "empty-state", text: message }));
}

function renderRules() {
  const list = document.getElementById("rules-list");

  if (!allRules.length) {
    emptyState(list, 'No rules yet. Click "+ Add rule" to create one.');
    return;
  }

  const items = allRules.map(rule => {
    const li = makeEl("li", { className: "rule-item" });
    li.dataset.id = rule.id;

    const keywords = rule.keywords || [];
    const channels = rule.channels || [];
    const kwTrunc  = keywords.join(", ").slice(0, 40) || "—";
    const chTrunc  = channels.join(", ").slice(0, 40) || "—";

    const toggle = makeEl("input", { className: "rule-toggle", title: "Enable/disable" });
    toggle.type    = "checkbox";
    toggle.checked = !!rule.enabled;
    toggle.addEventListener("change", async e => {
      rule.enabled = e.target.checked;
      if (!(await persistRules())) await loadRules();
    });

    const meta = makeEl("div", { className: "rule-meta" });
    meta.append(
      makeEl("span", { text: `🔑 ${kwTrunc}`, title: keywords.join(", ") }),
      makeEl("span", { text: `📺 ${chTrunc}`, title: channels.join(", ") })
    );

    const edit = makeEl("button", { className: "btn-icon edit-rule", text: "✏️", title: "Edit" });
    edit.addEventListener("click", () => openRuleForm(rule));

    const buttons = makeEl("div", { className: "rule-actions-btns" });

    // Two-step inline confirm instead of confirm() — a blocking native dialog
    // is unreliable in an extension popup, which can lose focus or get torn
    // down while it's open (see the "popup needed two clicks" entry in
    // AUDIT.md for the same class of popup-lifecycle fragility).
    function showDeleteConfirm() {
      const label = makeEl("span", { className: "confirm-label", text: "Delete?" });
      const yes   = makeEl("button", { className: "btn-icon danger", text: "✓", title: `Confirm delete "${rule.sport}"` });
      const no    = makeEl("button", { className: "btn-icon", text: "✕", title: "Cancel" });

      yes.addEventListener("click", async () => {
        allRules = allRules.filter(r => r.id !== rule.id);
        if (await persistRules()) {
          renderRules();
        } else {
          await loadRules();
        }
      });
      no.addEventListener("click", () => buttons.replaceChildren(edit, del));

      buttons.replaceChildren(label, no, yes);
    }

    const del = makeEl("button", { className: "btn-icon danger delete-rule", text: "🗑️", title: "Delete" });
    del.addEventListener("click", showDeleteConfirm);

    buttons.append(edit, del);

    li.append(
      toggle,
      makeEl("div", { className: "rule-sport", text: rule.sport || "?" }),
      meta,
      buttons
    );
    return li;
  });

  list.replaceChildren(...items);
}

async function persistRules() {
  try {
    await browser.storage.sync.set({ rules: allRules });
    clearRulesStatus();
    return true;
  } catch (err) {
    console.error("SpoilerShield: failed to save rules", err);
    showRulesStatus(
      "Couldn't save — rule storage is full (8KB limit). Delete a rule or " +
      "shorten keywords/channels, then try again.",
      "error"
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rule form
// ---------------------------------------------------------------------------

const ruleForm     = document.getElementById("rule-form");
const rfTitle      = document.getElementById("rule-form-title");
const rfSport      = document.getElementById("rf-sport");
const rfSportError = document.getElementById("rf-sport-error");
const rfKeywords   = document.getElementById("rf-keywords");
const rfChannels   = document.getElementById("rf-channels");
const rfActions    = {
  hideDuration:    document.getElementById("rf-hideDuration"),
  hideProgressBar: document.getElementById("rf-hideProgressBar"),
  hideChapters:    document.getElementById("rf-hideChapters"),
  blurThumbnail:   document.getElementById("rf-blurThumbnail"),
  rewriteTitle:    document.getElementById("rf-rewriteTitle")
};

let editingRuleId = null;

async function openRuleForm(existingRule) {
  editingRuleId = existingRule ? existingRule.id : null;
  rfTitle.textContent = existingRule ? "Edit rule" : "New rule";

  if (existingRule) {
    rfSport.value    = existingRule.sport || "";
    rfKeywords.value = (existingRule.keywords || []).join(", ");
    rfChannels.value = (existingRule.channels || []).join(", ");
    for (const [key, el] of Object.entries(rfActions)) {
      el.checked = !!(existingRule.actions || {})[key];
    }
  } else {
    // Pre-fill actions from settings.defaults
    rfSport.value = rfKeywords.value = rfChannels.value = "";
    const { settings } = await browser.storage.sync.get("settings");
    const d = (settings || {}).defaults || {};
    for (const [key, el] of Object.entries(rfActions)) {
      el.checked = !!d[key];
    }
  }

  rfSportError.classList.add("hidden");
  ruleForm.classList.remove("hidden");
  rfSport.focus();
}

// Clear the validation message as soon as the user starts fixing it, rather
// than leaving a stale "required" error up after they've typed something.
rfSport.addEventListener("input", () => rfSportError.classList.add("hidden"));

function closeRuleForm() {
  ruleForm.classList.add("hidden");
  editingRuleId = null;
}

document.getElementById("btn-add-rule").addEventListener("click", () => openRuleForm(null));
document.getElementById("rf-cancel").addEventListener("click", closeRuleForm);

document.getElementById("rf-save").addEventListener("click", async () => {
  const sport    = rfSport.value.trim();
  const keywords = rfKeywords.value.split(",").map(s => s.trim()).filter(Boolean);
  const channels = rfChannels.value.split(",").map(s => s.trim()).filter(Boolean);
  const actions  = Object.fromEntries(Object.entries(rfActions).map(([k, el]) => [k, el.checked]));

  if (!sport) {
    rfSportError.classList.remove("hidden");
    rfSport.focus();
    return;
  }

  if (editingRuleId) {
    const idx = allRules.findIndex(r => r.id === editingRuleId);
    if (idx !== -1) allRules[idx] = { ...allRules[idx], sport, keywords, channels, actions };
  } else {
    allRules.push({ id: crypto.randomUUID(), enabled: true, sport, keywords, channels, actions });
  }

  if (await persistRules()) {
    renderRules();
    closeRuleForm();
  } else {
    await loadRules();
  }
});

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(allRules, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "spoilershield-rules.json";
  a.click();
  URL.revokeObjectURL(url);
});

// Coerce an imported entry into the exact shape the content scripts expect.
// spMatchRules does rule.channels.some(...) unguarded, so a rule missing that
// field throws inside the MutationObserver callback on every pass — one bad
// import would otherwise brick the extension on every page with no visible
// cause.
const ACTION_KEYS = [
  "hideDuration", "hideProgressBar", "hideChapters", "blurThumbnail", "rewriteTitle"
];

function normaliseImportedRule(raw) {
  if (!raw || typeof raw !== "object") return null;

  const strings = v => Array.isArray(v)
    ? v.filter(s => typeof s === "string" && s.trim()).map(s => s.trim())
    : [];

  const sport = typeof raw.sport === "string" ? raw.sport.trim() : "";
  if (!sport) return null;   // unusable — same check as the form

  const actions = {};
  for (const key of ACTION_KEYS) actions[key] = !!(raw.actions && raw.actions[key]);

  return {
    id:       typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    enabled:  raw.enabled !== false,
    sport,
    keywords: strings(raw.keywords),
    channels: strings(raw.channels),
    actions
  };
}

document.getElementById("import-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text     = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error("Expected a JSON array of rules.");

    const existingIds = new Set(allRules.map(r => r.id));
    const newRules = [];
    let skippedDuplicate = 0;
    let skippedInvalid   = 0;

    for (const raw of imported) {
      const rule = normaliseImportedRule(raw);
      if (!rule)                      { skippedInvalid++;   continue; }
      if (existingIds.has(rule.id))   { skippedDuplicate++; continue; }
      existingIds.add(rule.id);
      newRules.push(rule);
    }

    allRules = [...allRules, ...newRules];
    if (await persistRules()) {
      renderRules();
      const notes = [];
      if (skippedDuplicate) notes.push(`${skippedDuplicate} duplicate(s) skipped`);
      if (skippedInvalid)   notes.push(`${skippedInvalid} invalid entr(ies) skipped`);
      showRulesStatus(
        `Imported ${newRules.length} new rule(s).${notes.length ? " " + notes.join(", ") + "." : ""}`,
        "info"
      );
    } else {
      // persistRules() already surfaced the storage-quota error — don't
      // claim success on top of it.
      await loadRules();
    }
  } catch (err) {
    showRulesStatus(`Import failed: ${err.message}`, "error");
  }
  e.target.value = "";
});

// ---------------------------------------------------------------------------
// Log tab
// ---------------------------------------------------------------------------

async function renderLog() {
  const data = await browser.storage.local.get("log");
  const log  = Array.isArray(data.log) ? data.log : [];
  const list = document.getElementById("log-list");

  if (!log.length) {
    emptyState(list, "No log entries yet.");
    return;
  }

  const items = log.map(entry => {
    const li = makeEl("li", { className: "log-item" });
    const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "—";

    const detail = [
      entry.channelName ? `Channel: ${entry.channelName}` : "",
      entry.titleLabel  ? `Label: ${entry.titleLabel}`    : ""
    ].filter(Boolean).join(" · ");

    li.append(
      makeEl("div", { className: "log-time",  text: `${ts} · ${entry.platform || ""}` }),
      makeEl("div", { className: "log-title", text: entry.originalTitle || "—" }),
      makeEl("div", { className: "log-meta",  text: detail }),
      makeEl("div", { className: "log-meta",
                  text: `Actions: ${(entry.actionsApplied || []).join(", ") || "—"}` })
    );
    return li;
  });

  list.replaceChildren(...items);
}

document.getElementById("btn-clear-log").addEventListener("click", async () => {
  await browser.storage.local.set({ log: [] });
  renderLog();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

// Surface failures instead of dying as an unhandled rejection — a popup that
// throws while initialising can fail to paint at all, which looks to the user
// like the button simply didn't respond.
loadSettings().catch(err => console.error("SpoilerShield: failed to load settings.", err));
loadRules().catch(err => console.error("SpoilerShield: failed to load rules.", err));
