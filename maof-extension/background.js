// Background service worker — Maof Fireberry + 3CX sync

// FB_TOKEN, CX_USER, CX_PASS come from config.js (gitignored — see config.example.js)
importScripts('config.js');

const FB_BASE  = 'https://api.fireberry.com';
const FB_SALE_OBJECT_TYPE = 33;          // AccountProduct ("רכישה")
const FB_AGENT_FIELD      = 'pcfsystemfield27';   // "נציג מבצע רכישה"
const FB_DATE_FIELD       = 'pcfsystemfield68';   // "תאריך רכישה"
const FB_STATUS_FIELD     = 'pcfsystemfield29';   // "סטטוס רכישה"
const FB_SOLD_STATUS      = 1;            // "נמכר והועבר למימוש"

const CX_BASE = 'https://movement.3cx.eu:5001';
const SUPABASE_URL = 'https://fmejfxejsrmjvexfizgj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtZWpmeGVqc3JtanZleGZpemdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjA1MjQsImV4cCI6MjA5MTkzNjUyNH0.A8Eu-3Uj-i06U0DsDt-pbGu1tQJXdjZaTyz797PsOEU';

// מעוף מכירות — שם נציגה (כפי שמופיע ב-Fireberry, מרווחים נוקו) → שלוחת 3CX
const MAOF_AGENTS = {
  'נוי ביטון':   '8238',
  'סופי אלחסוב': '8264',
  'שילת רדר':    '8209',
  'קרן יהודה':   '8256',
};
const MAOF_AGENT_NAMES = Object.keys(MAOF_AGENTS);

function todayIsraelDateStr() {
  const nowIL = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const y = nowIL.getFullYear(), m = String(nowIL.getMonth() + 1).padStart(2, '0'), d = String(nowIL.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function supaGetTodayRow(agentName, todayStr) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/maof_daily_stats?date=eq.' + todayStr + '&agent_name=eq.' + encodeURIComponent(agentName), {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=representation' }
  });
  const rows = await res.json();
  return (rows && rows[0]) || null;
}

async function supaUpsert(agentName, todayStr, fields) {
  const existing = await supaGetTodayRow(agentName, todayStr);
  if (existing) {
    await fetch(SUPABASE_URL + '/rest/v1/maof_daily_stats?date=eq.' + todayStr + '&agent_name=eq.' + encodeURIComponent(agentName), {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(fields)
    });
  } else {
    await fetch(SUPABASE_URL + '/rest/v1/maof_daily_stats', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify([{ date: todayStr, agent_name: agentName, calls: 0, hours: 0, leads: 0, renewals: 0, hmo: 0, total_sales: 0, daily_leads: 0, ...fields }])
    });
  }
}

// ══════════════════════════════════════════
// FIREBERRY — sales sync (no tab needed, pure API token)
// ══════════════════════════════════════════
async function syncSalesFromBackground() {
  try {
    const todayStr = todayIsraelDateStr();
    const body = {
      objectType: FB_SALE_OBJECT_TYPE,
      fields: [{ name: FB_AGENT_FIELD }, { name: FB_DATE_FIELD }, { name: FB_STATUS_FIELD }],
      filter: [{
        type: 'AND',
        conditions: [
          { fieldName: FB_DATE_FIELD, operator: 'between', value: [todayStr + 'T00:00:00.000Z', todayStr + 'T23:59:59.999Z'] },
          { fieldName: FB_STATUS_FIELD, operator: 'eq', value: FB_SOLD_STATUS }
        ]
      }],
      pageSize: 500,
      pageNumber: 1
    };
    const res = await fetch(FB_BASE + '/api/v3/query', {
      method: 'POST',
      headers: { 'tokenid': FB_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Fireberry error: ' + res.status);
    const json = await res.json();
    if (!json.success) throw new Error('Fireberry: ' + (json.message || 'unknown error'));

    const countByAgent = {};
    (json.data || []).forEach(r => {
      const name = (r[FB_AGENT_FIELD + 'name'] || '').trim();
      if (!MAOF_AGENT_NAMES.includes(name)) return; // התעלם מרשומות של פעילויות אחרות באותו Fireberry
      countByAgent[name] = (countByAgent[name] || 0) + 1;
    });

    let total = 0;
    for (const name of MAOF_AGENT_NAMES) {
      const count = countByAgent[name] || 0;
      total += count;
      await supaUpsert(name, todayStr, { leads: count, renewals: 0, hmo: 0, total_sales: count });
    }

    const detail = MAOF_AGENT_NAMES.map(n => n.split(' ')[0] + ':' + (countByAgent[n] || 0)).join(' | ');
    await chrome.storage.local.set({ lastSaleSync: new Date().toLocaleTimeString('he-IL'), lastSaleCount: total, lastSaleAgents: detail, lastSaleError: '' });
    console.log('[Maof BG] ✅ Sales synced:', detail);
    return true;
  } catch (e) {
    console.error('[Maof BG] Sales error:', e.message);
    await chrome.storage.local.set({ lastSaleError: e.message });
    return false;
  }
}

// ══════════════════════════════════════════
// 3CX — calls sync (same tenant as FreeFit, different extensions)
// AnsweredCount from GetUserActivity is already the combined incoming+outgoing
// total per extension — written straight to `calls` (סה"כ שיחות).
// ══════════════════════════════════════════
async function getCXToken() {
  const stored = await chrome.storage.local.get(['cx_token']);
  return stored.cx_token || null;
}

async function loginCX() {
  try {
    const res = await fetch(CX_BASE + '/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=PhoneSystem&grant_type=password&username=${encodeURIComponent(CX_USER)}&password=${encodeURIComponent(CX_PASS)}`
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.access_token) {
      const token = 'Bearer ' + data.access_token;
      await chrome.storage.local.set({ cx_token: token });
      console.log('[Maof BG] New 3CX token obtained ✓');
      return token;
    }
  } catch (e) {
    console.log('[Maof BG] Login error:', e.message);
  }
  return null;
}

async function syncCallsFromBackground() {
  let token = await getCXToken();
  if (!token) token = await loginCX();
  if (!token) { console.log('[Maof BG] Cannot get 3CX token'); return false; }

  try {
    const todayStr = todayIsraelDateStr();
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const fromStr = new Date(from.getTime() - 3 * 3600000).toISOString();
    const toStr = new Date(from.getTime() + 21 * 3600000).toISOString();

    const callsByAgent = {};
    const hoursByAgent = {};

    for (const [name, ext] of Object.entries(MAOF_AGENTS)) {
      const url = CX_BASE + `/xapi/v1/ReportUserActivity/Pbx.GetUserActivity(` +
        `clientTimeZone='Asia%2FJerusalem',periodFrom=${encodeURIComponent(fromStr)},` +
        `periodTo=${encodeURIComponent(toStr)},groupNumber='',extensionDns='${ext}',` +
        `waitInterval='0%3A00%3A0',includeQueueCalls=true,callArea=2,groupingType=0)?%24top=100&%24skip=0`;

      let res = await fetch(url, { headers: { 'Accept': 'application/json', 'Cache-Control': 'no-store', 'Authorization': token } });
      if (res.status === 401) {
        await chrome.storage.local.remove('cx_token');
        token = await loginCX();
        if (!token) return false;
        res = await fetch(url, { headers: { 'Accept': 'application/json', 'Cache-Control': 'no-store', 'Authorization': token } });
      }
      const d = await res.json();
      const active = (d.value || []).filter(r => r.AnsweredCount > 0);
      callsByAgent[name] = (d.value || []).reduce((s, r) => s + (r.AnsweredCount || 0), 0);
      if (active.length > 0) {
        const first = new Date(active[0].DateTimeInterval), last = new Date(active[active.length - 1].DateTimeInterval);
        hoursByAgent[name] = parseFloat(((last - first) / 3600000 + 1).toFixed(1));
      } else hoursByAgent[name] = 0;
    }

    for (const name of MAOF_AGENT_NAMES) {
      const calls = callsByAgent[name] || 0;
      const hours = hoursByAgent[name] || 0;
      await supaUpsert(name, todayStr, { calls, hours });
    }

    const detail = MAOF_AGENT_NAMES.map(n => n.split(' ')[0] + ':' + (callsByAgent[n] || 0)).join(' | ');
    await chrome.storage.local.set({ lastCallSync: new Date().toLocaleTimeString('he-IL'), lastCallDetail: detail, lastCallError: '' });
    console.log('[Maof BG] ✅ Calls synced:', detail);
    return true;
  } catch (e) {
    console.error('[Maof BG] Calls error:', e.message);
    await chrome.storage.local.set({ lastCallError: e.message });
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'syncSales') { syncSalesFromBackground().then(ok => sendResponse({ ok })); return true; }
  if (msg.action === 'syncCalls') { syncCallsFromBackground().then(ok => sendResponse({ ok })); return true; }
});

chrome.webRequest?.onBeforeSendHeaders?.addListener(
  (details) => {
    const authHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'authorization');
    if (authHeader && authHeader.value.startsWith('Bearer ')) {
      chrome.storage.local.set({ cx_token: authHeader.value });
    }
  },
  { urls: ['https://movement.3cx.eu/*'] },
  ['requestHeaders']
);

async function ensureAlarms() {
  const wanted = { fireberrySync: 10, cxSync: 10, midnightReset: 1 };
  for (const [name, periodInMinutes] of Object.entries(wanted)) {
    const existing = await chrome.alarms.get(name);
    if (!existing) chrome.alarms.create(name, { periodInMinutes });
  }
  console.log('[Maof] Alarms ensured ✓');
}
chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);
ensureAlarms();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'fireberrySync') await syncSalesFromBackground();
  if (alarm.name === 'cxSync') await syncCallsFromBackground();
  if (alarm.name === 'midnightReset') {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) await midnightReset();
  }
});

async function midnightReset() {
  try {
    const todayStr = todayIsraelDateStr();
    const res = await fetch(SUPABASE_URL + '/rest/v1/maof_daily_stats?date=eq.' + todayStr, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal' }
    });
    console.log('[Maof] ✅ Midnight reset complete, status:', res.status);
    await chrome.storage.local.set({ lastMidnightReset: todayStr });
  } catch (e) {
    console.error('[Maof] Midnight reset error:', e.message);
  }
}
