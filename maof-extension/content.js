// Content script — runs on movement.3cx.eu only, to capture/refresh the 3CX auth token.
// Fireberry sync needs no page/tab at all (pure API token from background.js).

console.log('[Maof] 3CX content script ready ✓');

// Keep the token fresh by pinging every 30 minutes while a 3CX tab is open
setInterval(() => {
  chrome.storage.local.get(['cx_token'], (data) => {
    if (data.cx_token) console.log('[Maof] 3CX token present ✓');
  });
}, 30 * 60 * 1000);
