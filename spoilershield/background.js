// SpoilerShield — background service worker
// Initialises default storage on first install.

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;

  const defaults = {
    settings: {
      enabled: true,
      defaults: {
        hideDuration: true,
        hideProgressBar: true,
        hideChapters: true,
        blurThumbnail: true,
        rewriteTitle: true
      }
    },
    rules: []
  };

  const existing = await browser.storage.sync.get(["settings", "rules"]);
  const toSet = {};
  if (!existing.settings) toSet.settings = defaults.settings;
  if (!existing.rules)    toSet.rules    = defaults.rules;

  if (Object.keys(toSet).length) {
    await browser.storage.sync.set(toSet);
  }
});
