function loadStatus() {
  chrome.storage.local.get([
    'lastSaleSync','lastSaleCount','lastSaleAgents','lastSaleError',
    'lastCallSync','lastCallDetail','lastCallError','cx_token'
  ], (d) => {
    if (d.lastSaleSync) document.getElementById('lastSaleSync').textContent = d.lastSaleSync;
    if (d.lastSaleCount !== undefined) document.getElementById('lastSaleCount').textContent = d.lastSaleCount + ' מכירות';
    if (d.lastSaleAgents) document.getElementById('lastSaleAgents').textContent = d.lastSaleAgents;
    document.getElementById('lastSaleError').textContent = d.lastSaleError ? '❌ ' + d.lastSaleError : '';
    if (d.lastCallSync) document.getElementById('lastCallSync').textContent = d.lastCallSync;
    if (d.lastCallDetail) document.getElementById('lastCallDetail').textContent = d.lastCallDetail;
    document.getElementById('lastCallError').textContent = d.lastCallError ? '❌ ' + d.lastCallError : '';
    document.getElementById('cxTokenStatus').textContent = d.cx_token ? '🔑 Token פעיל' : '⚠️ פתח 3CX ונווט בין דפים';
  });
}

async function injectAndSend(url, action) {
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length === 0) return false;
  const tabId = tabs[0].id;
  // Inject content script first (handles SPA case)
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch(e) { /* already injected */ }
  // Wait a bit then send message
  await new Promise(r => setTimeout(r, 500));
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { action }, response => {
      resolve(response);
    });
  });
}

async function syncSeyata() {
  const tabs = await chrome.tabs.query({ url: 'https://syatacrm.co.il/*' });
  if (tabs.length === 0) { alert('פתח את Seyata בדפדפן תחילה'); return; }
  document.getElementById('btnSeyata').textContent = '⏳ מסנכרן...';
  await injectAndSend('https://syatacrm.co.il/*', 'sync');
  setTimeout(() => {
    loadStatus();
    document.getElementById('btnSeyata').textContent = '🔄 סנכרן מכירות (Seyata)';
  }, 2000);
}

async function syncCX() {
  const tabs = await chrome.tabs.query({ url: 'https://movement.3cx.eu/*' });
  if (tabs.length === 0) { alert('פתח את 3CX בדפדפן תחילה'); return; }
  document.getElementById('btnCX').textContent = '⏳ מסנכרן...';
  await injectAndSend('https://movement.3cx.eu/*', 'syncCalls');
  setTimeout(() => {
    loadStatus();
    document.getElementById('btnCX').textContent = '📞 סנכרן שיחות (3CX)';
  }, 4000);
}

document.getElementById('btnSeyata').addEventListener('click', syncSeyata);
document.getElementById('btnCX').addEventListener('click', syncCX);

loadStatus();
setInterval(loadStatus, 3000);
