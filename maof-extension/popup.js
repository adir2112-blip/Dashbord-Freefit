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

document.getElementById('btnFireberry').addEventListener('click', () => {
  document.getElementById('btnFireberry').textContent = '⏳ מסנכרן...';
  chrome.runtime.sendMessage({ action: 'syncSales' }, () => {
    setTimeout(() => { loadStatus(); document.getElementById('btnFireberry').textContent = '🔄 סנכרן מכירות (Fireberry)'; }, 500);
  });
});

document.getElementById('btnCX').addEventListener('click', () => {
  document.getElementById('btnCX').textContent = '⏳ מסנכרן...';
  chrome.runtime.sendMessage({ action: 'syncCalls' }, () => {
    setTimeout(() => { loadStatus(); document.getElementById('btnCX').textContent = '📞 סנכרן שיחות (3CX)'; }, 500);
  });
});

loadStatus();
setInterval(loadStatus, 3000);
