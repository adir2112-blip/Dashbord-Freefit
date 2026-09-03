// Background service worker

const CX_BASE = 'https://movement.3cx.eu:5001';
const CX_USER = '1adirlev@targetcall.co.il';
const CX_PASS = 't1YuBY2gKo';
const SUPABASE_URL = 'https://fmejfxejsrmjvexfizgj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtZWpmeGVqc3JtanZleGZpemdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjA1MjQsImV4cCI6MjA5MTkzNjUyNH0.A8Eu-3Uj-i06U0DsDt-pbGu1tQJXdjZaTyz797PsOEU';

const CX_AGENTS = {
  'נטלי לוי':       '8286',
  'אושרית עזריה':   '8282',
  'רווית מורדכייב': '8234',
  'עדן ארבני':      '8271',
  'אריאל אזייב':    '8213',
};

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

let cx_token = null;

// Sync sales from Seyata directly (no open tab required)
async function syncSalesFromBackground() {
  try {
    const today = new Date();
    const dateStr = today.getFullYear().toString() +
      String(today.getMonth()+1).padStart(2,'0') +
      String(today.getDate()).padStart(2,'0');
    const todayStr = today.toISOString().slice(0, 10);

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

    const exRes = await fetch(SUPABASE_URL+'/rest/v1/daily_stats?date=eq.'+todayStr, {
      headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'return=representation'}
    });
    const existData = await exRes.json();
    const existMap = {};
    (existData||[]).forEach(r => existMap[r.agent_name] = r);

    let total = 0;
    for (const [name, s] of Object.entries(salesByAgent)) {
      const total_sales = s.leads + s.renewals;
      const ex = existMap[name];
      if (ex) {
        await fetch(SUPABASE_URL+'/rest/v1/daily_stats?date=eq.'+todayStr+'&agent_name=eq.'+encodeURIComponent(name), {
          method:'PATCH',
          headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},
          body: JSON.stringify({ leads: s.leads, renewals: s.renewals, total_sales })
        });
      } else {
        await fetch(SUPABASE_URL+'/rest/v1/daily_stats', {
          method:'POST',
          headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},
          body: JSON.stringify([{ date:todayStr, agent_name:name, calls:0, hours:0, leads:s.leads, renewals:s.renewals, hmo:0, total_sales, daily_leads:0 }])
        });
      }
      total += total_sales;
    }

    const detail = Object.entries(salesByAgent).map(([n,s])=>n.split(' ')[0]+':'+(s.leads+s.renewals)).join(' | ');
    await chrome.storage.local.set({ lastSaleSync: new Date().toLocaleTimeString('he-IL'), lastSaleCount: total, lastSaleAgents: detail, lastSaleError: '' });
    console.log('[FreeFit BG] ✅ Sales synced:', detail);
  } catch(e) {
    console.error('[FreeFit BG] Sales error:', e.message);
    await chrome.storage.local.set({ lastSaleError: e.message });
  }
}

// Get token from storage or login
async function getCXToken() {
  // Try stored token first
  const stored = await chrome.storage.local.get(['cx_token']);
  if (stored.cx_token) {
    cx_token = stored.cx_token;
    return cx_token;
  }
  return null;
}

// Login to get new token
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
      cx_token = 'Bearer ' + data.access_token;
      await chrome.storage.local.set({ cx_token });
      console.log('[FreeFit BG] New 3CX token obtained ✓');
      return cx_token;
    }
  } catch(e) {
    console.log('[FreeFit BG] Login error:', e.message);
  }
  return null;
}

// Sync calls from 3CX
async function syncCallsFromBackground() {
  let token = await getCXToken();
  if (!token) {
    token = await loginCX();
    if (!token) {
      console.log('[FreeFit BG] Cannot get 3CX token');
      return;
    }
  }

  try {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const fromStr = new Date(from.getTime()-3*3600000).toISOString();
    const toStr   = new Date(from.getTime()+21*3600000).toISOString();
    const todayStr = today.toISOString().slice(0,10);

    // Get existing rows to preserve sales
    const exRes = await fetch(SUPABASE_URL+'/rest/v1/daily_stats?date=eq.'+todayStr, {
      headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'return=representation'}
    });
    const existData = await exRes.json();
    const existMap = {};
    (existData||[]).forEach(r => existMap[r.agent_name] = r);

    const callsByAgent = {};
    const hoursByAgent = {};

    for (const [name, ext] of Object.entries(CX_AGENTS)) {
      const url = CX_BASE+`/xapi/v1/ReportUserActivity/Pbx.GetUserActivity(`+
        `clientTimeZone='Asia%2FJerusalem',periodFrom=${encodeURIComponent(fromStr)},`+
        `periodTo=${encodeURIComponent(toStr)},groupNumber='',extensionDns='${ext}',`+
        `waitInterval='0%3A00%3A0',includeQueueCalls=true,callArea=2,groupingType=0)?%24top=100&%24skip=0`;

      const res = await fetch(url, { headers:{'Accept':'application/json','Cache-Control':'no-store','Authorization':token} });
      
      if (res.status === 401) {
        // Token expired — login and retry
        cx_token = null;
        await chrome.storage.local.remove('cx_token');
        token = await loginCX();
        if (!token) return;
        const res2 = await fetch(url, { headers:{'Accept':'application/json','Cache-Control':'no-store','Authorization':token} });
        const d2 = await res2.json();
        const active2 = (d2.value||[]).filter(r=>r.AnsweredCount>0);
        callsByAgent[name] = (d2.value||[]).reduce((s,r)=>s+(r.AnsweredCount||0),0);
        if (active2.length>0) {
          const first=new Date(active2[0].DateTimeInterval), last=new Date(active2[active2.length-1].DateTimeInterval);
          hoursByAgent[name] = parseFloat(((last-first)/3600000+1).toFixed(1));
        } else hoursByAgent[name] = 0;
        continue;
      }

      const d = await res.json();
      const active = (d.value||[]).filter(r=>r.AnsweredCount>0);
      callsByAgent[name] = (d.value||[]).reduce((s,r)=>s+(r.AnsweredCount||0),0);
      if (active.length>0) {
        const first=new Date(active[0].DateTimeInterval), last=new Date(active[active.length-1].DateTimeInterval);
        hoursByAgent[name] = parseFloat(((last-first)/3600000+1).toFixed(1));
      } else hoursByAgent[name] = 0;
    }

    // Save to Supabase
    for (const [name, calls] of Object.entries(callsByAgent)) {
      const hours = hoursByAgent[name]||0;
      const ex = existMap[name];
      if (ex) {
        await fetch(SUPABASE_URL+'/rest/v1/daily_stats?date=eq.'+todayStr+'&agent_name=eq.'+encodeURIComponent(name), {
          method:'DELETE', headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'return=minimal'}
        });
        await fetch(SUPABASE_URL+'/rest/v1/daily_stats', {
          method:'POST', headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},
          body: JSON.stringify([{date:todayStr,agent_name:name,calls,hours,leads:ex.leads||0,renewals:ex.renewals||0,hmo:ex.hmo||0,total_sales:ex.total_sales||0,daily_leads:ex.daily_leads||0}])
        });
      } else {
        await fetch(SUPABASE_URL+'/rest/v1/daily_stats', {
          method:'POST', headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},
          body: JSON.stringify([{date:todayStr,agent_name:name,calls,hours,leads:0,renewals:0,hmo:0,total_sales:0,daily_leads:0}])
        });
      }
    }

    const detail = Object.entries(callsByAgent).map(([n,c])=>n.split(' ')[0]+':'+c).join(' | ');
    await chrome.storage.local.set({ lastCallSync: new Date().toLocaleTimeString('he-IL'), lastCallDetail: detail, lastCallError: '' });
    console.log('[FreeFit BG] ✅ Calls synced:', detail);

  } catch(e) {
    console.error('[FreeFit BG] Calls error:', e.message);
    await chrome.storage.local.set({ lastCallError: e.message });
  }
}

// Listen for webRequest to capture token (backup method)
chrome.webRequest?.onBeforeSendHeaders?.addListener(
  (details) => {
    const authHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'authorization');
    if (authHeader && authHeader.value.startsWith('Bearer ')) {
      cx_token = authHeader.value;
      chrome.storage.local.set({ cx_token: authHeader.value });
    }
  },
  { urls: ['https://movement.3cx.eu/*'] },
  ['requestHeaders']
);

function ensureAlarms() {
  chrome.alarms.create('seyataSync',    { periodInMinutes: 10 });
  chrome.alarms.create('cxSync',        { periodInMinutes: 10 });
  chrome.alarms.create('cxReload',      { periodInMinutes: 60 });
  chrome.alarms.create('midnightReset', { periodInMinutes: 1 });
  console.log('[FreeFit] Alarms ensured ✓');
}

// Run on install AND on every browser/extension startup (covers Reload button too)
chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);
ensureAlarms();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'seyataSync') {
    // Runs directly from background — no open Seyata tab required
    await syncSalesFromBackground();
  }

  if (alarm.name === 'cxSync') {
    // Try background sync first (no need for 3CX tab open)
    await syncCallsFromBackground();
  }

  if (alarm.name === 'cxReload') {
    const tabs = await chrome.tabs.query({ url: 'https://movement.3cx.eu/*' });
    if (tabs.length > 0) {
      const tabId = tabs[0].id;
      // Navigate to User Activity page to trigger token refresh
      await chrome.tabs.update(tabId, { url: 'https://movement.3cx.eu:5001/#/reports/userActivity' });
      console.log('[FreeFit] 3CX navigated to User Activity ✓');
      // Wait for page load then sync
      setTimeout(async () => {
        await syncCallsFromBackground();
        console.log('[FreeFit] Auto-sync after navigation complete ✓');
      }, 15000);
    }
  }

  if (alarm.name === 'midnightReset') {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    // Run at 00:00-00:01 Israel time
    if (h === 0 && m === 0) {
      await midnightReset();
    }
  }
});

async function midnightReset() {
  try {
    // Get yesterday's date (we're now in the new day)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    console.log('[FreeFit] Midnight reset — clearing', todayStr, '(keeping', yesterdayStr, ')');

    // Delete today's rows (which are actually yesterday's data carried over)
    const res = await fetch(SUPABASE_URL + '/rest/v1/daily_stats?date=eq.' + todayStr, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=minimal' }
    });
    console.log('[FreeFit] ✅ Midnight reset complete, status:', res.status);
    await chrome.storage.local.set({ lastMidnightReset: todayStr });
  } catch(e) {
    console.error('[FreeFit] Midnight reset error:', e.message);
  }
}
