const SUPABASE_URL = 'https://fmejfxejsrmjvexfizgj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtZWpmeGVqc3JtanZleGZpemdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjA1MjQsImV4cCI6MjA5MTkzNjUyNH0.A8Eu-3Uj-i06U0DsDt-pbGu1tQJXdjZaTyz797PsOEU';
const SEYATA_BASE = 'https://syatacrm.co.il/S-TCFreeFit';
const SEYATA_AGENT_MAP = {
  '1765965703808025': 'נטלי לוי',
  '1776064811620332': 'עדן ארבני',
  '1767597713200425': 'אושרית עזריה',
  '1777281114324896': 'רווית מורדכייב',
  '1766313896188966': 'אליסיה ברדה',
  '1779188818326557': 'אריאל אזייב',
  '1781160362213129': 'אבישג בן לולו',
};
const CX_BASE = 'https://movement.3cx.eu:5001';
const CX_AGENTS = {
  'נטלי לוי':       '8286',
  'אושרית עזריה':   '8282',
  'רווית מורדכייב': '8234',
  'עדן ארבני':      '8271',
  'אריאל אזייב':    '8213',
  'אבישג בן לולו':  '8291',
};

const isSeyata = location.href.includes('syatacrm.co.il');
const is3CX    = location.href.includes('3cx.eu');
let cx_token = null;

if (is3CX) {
  chrome.storage.local.get(['cx_token'], (data) => {
    if (data.cx_token) { cx_token = data.cx_token; }
  });
}

// Helper: PATCH only specific fields (never overwrites other fields)
async function supabasePatch(date, agentName, fields) {
  const url = SUPABASE_URL + '/rest/v1/daily_stats?date=eq.' + date + '&agent_name=eq.' + encodeURIComponent(agentName);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(fields)
  });
  return res.status;
}

// Helper: INSERT new row
async function supabaseInsert(row) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/daily_stats', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify([row])
  });
  return res.status;
}

// Helper: check if row exists
async function supabaseExists(date, agentName) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/daily_stats?date=eq.' + date + '&agent_name=eq.' + encodeURIComponent(agentName) + '&select=id', {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  const data = await res.json();
  return data && data.length > 0;
}

// ════════════════════════════
// SEYATA SYNC — updates ONLY sales fields
// ════════════════════════════
async function syncSales() {
  try {
    const today = new Date();
    const dateStr = today.getFullYear().toString() +
      String(today.getMonth()+1).padStart(2,'0') +
      String(today.getDate()).padStart(2,'0');
    const todayStr = today.toISOString().slice(0, 10);

    // Filter by BOTH ResponseDate AND change_date = today to avoid old sales
    const res = await fetch(SEYATA_BASE + '/api/mn_Service_Requests?sr_StatusReason=2&sr_ResponseDate=' + dateStr + '&sr_change_date=' + dateStr + '&_limit=500');
    if (!res.ok) throw new Error('Seyata error: ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid response');

    const salesByAgent = {};
    data.forEach(r => {
      const name = SEYATA_AGENT_MAP[String(r.sr_sub_Treatment)];
      if (!name) return;
      if (!salesByAgent[name]) salesByAgent[name] = { leads: 0, renewals: 0 };
      if (r.sr_Accepted === 3) salesByAgent[name].renewals++;
      else salesByAgent[name].leads++;
    });

    let total = 0;
    for (const [name, s] of Object.entries(salesByAgent)) {
      const total_sales = s.leads + s.renewals;
      const exists = await supabaseExists(todayStr, name);
      if (exists) {
        // PATCH only sales — never touch calls/hours
        await supabasePatch(todayStr, name, { leads: s.leads, renewals: s.renewals, total_sales });
      } else {
        // INSERT new row with calls=0 hours=0
        await supabaseInsert({ date: todayStr, agent_name: name, calls: 0, hours: 0, leads: s.leads, renewals: s.renewals, hmo: 0, total_sales, daily_leads: 0 });
      }
      total += total_sales;
    }

    const detail = Object.entries(salesByAgent).map(([n,s])=>n.split(' ')[0]+':'+(s.leads+s.renewals)).join(' | ');
    chrome.storage.local.set({ lastSaleSync: new Date().toLocaleTimeString('he-IL'), lastSaleCount: total, lastSaleAgents: detail, lastSaleError: '' });
    console.log('[FreeFit] ✅ Sales:', detail);
  } catch(e) {
    chrome.storage.local.set({ lastSaleError: e.message });
    console.error('[FreeFit] Sales error:', e.message);
  }
}

// ════════════════════════════
// 3CX SYNC — updates ONLY calls/hours fields
// ════════════════════════════
async function syncCalls() {
  if (!cx_token) {
    const data = await new Promise(r => chrome.storage.local.get(['cx_token'], r));
    if (data.cx_token) cx_token = data.cx_token;
  }
  if (!cx_token) {
    chrome.storage.local.set({ lastCallError: 'אין Token — לחץ על User Activity ב-3CX' });
    return;
  }
  try {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const fromStr = new Date(from.getTime()-3*3600000).toISOString();
    const toStr   = new Date(from.getTime()+21*3600000).toISOString();
    const todayStr = today.toISOString().slice(0,10);

    let detail = '';
    // First, get all existing rows for today to preserve sales data
    const allExistRes = await fetch(SUPABASE_URL+'/rest/v1/daily_stats?date=eq.'+todayStr, {
      headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'return=representation'}
    });
    const allExist = await allExistRes.json();
    const existMap = {};
    (allExist||[]).forEach(r => existMap[r.agent_name] = r);

    for (const [name, ext] of Object.entries(CX_AGENTS)) {
      const url = CX_BASE+`/xapi/v1/ReportUserActivity/Pbx.GetUserActivity(`+
        `clientTimeZone='Asia%2FJerusalem',periodFrom=${encodeURIComponent(fromStr)},`+
        `periodTo=${encodeURIComponent(toStr)},groupNumber='',extensionDns='${ext}',`+
        `waitInterval='0%3A00%3A0',includeQueueCalls=true,callArea=2,groupingType=0)?%24top=100&%24skip=0`;

      const res = await fetch(url, { headers: { 'Accept':'application/json','Cache-Control':'no-store','Authorization':cx_token } });
      if (res.status===401) { cx_token=null; chrome.storage.local.remove('cx_token'); chrome.storage.local.set({lastCallError:'Token פג — נווט ב-3CX'}); return; }

      const d = await res.json();
      const activeHours = (d.value||[]).filter(r=>r.AnsweredCount>0);
      const calls = (d.value||[]).reduce((s,r)=>s+(r.AnsweredCount||0),0);
      let hours = 0;
      if (activeHours.length > 0) {
        const first = new Date(activeHours[0].DateTimeInterval);
        const last  = new Date(activeHours[activeHours.length-1].DateTimeInterval);
        hours = parseFloat(((last-first)/3600000 + 1).toFixed(1));
      }

      const ex = existMap[name];
      if (ex) {
        // Row exists — DELETE and re-INSERT preserving sales data
        await fetch(SUPABASE_URL+'/rest/v1/daily_stats?date=eq.'+todayStr+'&agent_name=eq.'+encodeURIComponent(name), {
          method:'DELETE', headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'return=minimal'}
        });
        await supabaseInsert({
          date: todayStr, agent_name: name,
          calls, hours,
          leads: ex.leads||0, renewals: ex.renewals||0, hmo: ex.hmo||0,
          total_sales: ex.total_sales||0, daily_leads: ex.daily_leads||0
        });
      } else {
        // No row — INSERT fresh
        await supabaseInsert({ date: todayStr, agent_name: name, calls, hours, leads:0, renewals:0, hmo:0, total_sales:0, daily_leads:0 });
      }
      detail += (detail?'|':'') + name.split(' ')[0]+':'+calls+'שיחות/'+hours+'ש';
    }

    chrome.storage.local.set({ lastCallSync: new Date().toLocaleTimeString('he-IL'), lastCallDetail: detail, lastCallError: '' });
    console.log('[FreeFit] ✅ Calls:', detail);
  } catch(e) {
    chrome.storage.local.set({ lastCallError: e.message });
    console.error('[FreeFit] Calls error:', e.message);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action==='sync')      { syncSales().then(()=>sendResponse({ok:true})).catch(e=>sendResponse({ok:false,error:e.message})); return true; }
  if (msg.action==='syncCalls') { syncCalls().then(()=>sendResponse({ok:true})).catch(e=>sendResponse({ok:false,error:e.message})); return true; }
});

if (isSeyata) { syncSales(); console.log('[FreeFit] Seyata ready ✓'); }
if (is3CX) {
  console.log('[FreeFit] 3CX ready ✓');
  // Auto-refresh token every 30 minutes by making a User Activity request
  setInterval(async () => {
    if (!cx_token) return;
    try {
      const today = new Date();
      const from = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      const fromStr = new Date(from.getTime()-3*3600000).toISOString();
      const toStr   = new Date(from.getTime()+21*3600000).toISOString();
      const url = CX_BASE+`/xapi/v1/ReportUserActivity/Pbx.GetUserActivity(`+
        `clientTimeZone='Asia%2FJerusalem',periodFrom=${encodeURIComponent(fromStr)},`+
        `periodTo=${encodeURIComponent(toStr)},groupNumber='',extensionDns='8286',`+
        `waitInterval='0%3A00%3A0',includeQueueCalls=true,callArea=2,groupingType=0)?%24top=1&%24skip=0`;
      const res = await fetch(url, { headers: {'Accept':'application/json','Cache-Control':'no-store','Authorization':cx_token} });
      if (res.status === 401) {
        cx_token = null;
        chrome.storage.local.remove('cx_token');
        console.log('[FreeFit] Token expired — waiting for renewal');
      } else {
        console.log('[FreeFit] Token still valid ✓');
        // Also sync calls while we're at it
        syncCalls();
      }
    } catch(e) { console.log('[FreeFit] Token refresh error:', e.message); }
  }, 30 * 60 * 1000); // every 30 minutes
}
