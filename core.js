/* Flexi Expenses core: Supabase client, state, helpers, router, modal/toast */
const CFG = window.EXPENSEHUB_CONFIG;
const sb = supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const App = { user: null, workspaces: [], ws: null, me: null, members: [], cats: [], rules: [] };
const VIEWS = {};
const ACTIONS = {};

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv');
const isoDate = d => new Date(d).toLocaleDateString('sv');
const dfmt = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const dtfmt = d => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
function money(n, cur) {
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || App.ws?.currency || 'GBP' }).format(+n || 0); }
  catch (e) { return (+n || 0).toFixed(2); }
}
const sum = (a, f = x => x) => a.reduce((t, x) => t + (+f(x) || 0), 0);
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
function fail(e) { console.error(e); toast(e?.message || String(e), 'err'); }
const wrap = fn => async (...a) => { try { return await fn(...a); } catch (e) { fail(e); } };

const isManager = () => ['admin', 'approver', 'finance'].includes(App.me?.role);
const isFinance = () => ['admin', 'finance'].includes(App.me?.role);
const isAdmin = () => App.me?.role === 'admin';
const member = id => App.members.find(m => m.user_id === id);
const memberName = id => { const m = member(id); return m ? (m.display_name || m.email) : 'Unknown'; };
const cat = id => App.cats.find(c => c.id === id);
const catName = id => cat(id)?.name || 'Uncategorised';

const FLAG_LABELS = {
  no_receipt: 'No receipt', over_limit: 'Over spend limit', over_category_limit: 'Over category limit',
  possible_duplicate: 'Possible duplicate', old_expense: 'Older than 60 days',
  vat_no_receipt: 'VAT claimed, no receipt', vat_invoice_needed: 'Over £250: needs VAT invoice + supplier VAT no.', receipt_unclear: 'Receipt may be unclear'
};
const pill = s => `<span class="pill ${esc(s)}">${esc(s)}</span>`;
const flagHTML = f => (f || []).map(x => `<span class="flag" title="${esc(FLAG_LABELS[x] || x)}">⚠ ${esc(FLAG_LABELS[x] || x)}</span>`).join('');

function toCSV(rows) {
  const qt = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + rows.map(r => r.map(qt).join(',')).join('\r\n');
}
function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- toast / modal / dialogs ---------- */
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), type === 'err' ? 5000 : 2600);
}
function modal(html, opts = {}) {
  const m = $('#modal'); $('#mc').className = 'mc' + (opts.wide ? ' wide' : '');
  $('#mc').oninput = null; $('#mc').innerHTML = html; m.classList.add('on'); document.body.classList.add('noscroll');
  setTimeout(() => $('#mc [autofocus]')?.focus(), 30);
}
function closeModal() { $('#modal').classList.remove('on'); document.body.classList.remove('noscroll'); $('#mc').innerHTML = ''; }
function confirmBox(msg, okLabel = 'Confirm', danger = false) {
  return new Promise(res => {
    const d = $('#dialog'); d.innerHTML = `<div class="dc"><p>${esc(msg)}</p><div class="row end"><button class="btn ghost" data-d="0">Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-d="1">${esc(okLabel)}</button></div></div>`;
    d.classList.add('on');
    d.onclick = e => { const b = e.target.closest('[data-d]'); if (!b && e.target !== d) return; d.classList.remove('on'); d.onclick = null; res(b?.dataset.d === '1'); };
  });
}
function askText(title, label, placeholder = '', okLabel = 'OK', allowEmpty = false) {
  return new Promise(res => {
    const d = $('#dialog'); d.innerHTML = `<div class="dc"><h3>${esc(title)}</h3><label>${esc(label)}</label><textarea id="askv" rows="3" placeholder="${esc(placeholder)}"></textarea><div class="row end" style="margin-top:12px"><button class="btn ghost" data-d="0">Cancel</button><button class="btn" data-d="1">${esc(okLabel)}</button></div></div>`;
    d.classList.add('on'); setTimeout(() => $('#askv').focus(), 30);
    d.onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; const v = $('#askv').value.trim(); d.classList.remove('on'); d.onclick = null; res(b.dataset.d === '1' && (v || allowEmpty) ? v : null); };
  });
}

/* ---------- files: compress, upload, signed urls ---------- */
function compressImage(file, max = 2400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('Could not compress image')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}
/* Legibility check: resolution, brightness and sharpness (Laplacian variance) of a photo. Returns {ok, problems[]} */
async function checkReceiptImage(file) {
  if (!file || !file.type.startsWith('image/') || file.type === 'image/heic') return { ok: true, problems: [] };
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const problems = [], long = Math.max(img.width, img.height);
      if (long < 1000) problems.push('The photo is low resolution — move closer or use a higher camera setting.');
      const k = Math.min(1, 700 / long), w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
      try {
        const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h); let sum = 0;
        for (let i = 0; i < w * h; i++) { g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2]; sum += g[i]; }
        const mean = sum / (w * h); let lv = 0, n = 0;
        for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) { const i = yy * w + xx, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; lv += l * l; n++; }
        lv /= n;
        if (mean < 55) problems.push('The photo is very dark — use better light.');
        if (lv < 40) problems.push('The photo looks blurry — hold steady and retake.');
      } catch (e) { /* cannot analyse; skip */ }
      resolve({ ok: !problems.length, problems });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ ok: true, problems: [] }); };
    img.src = url;
  });
}
const sha256Hex = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
async function uploadReceipt(file, prefix = '') {
  let body = file, ext = (file.name.split('.').pop() || 'bin').toLowerCase(), type = file.type;
  if (file.type.startsWith('image/') && file.type !== 'image/heic') { body = await compressImage(file); ext = 'jpg'; type = 'image/jpeg'; }
  const path = `${App.ws.id}/${App.user.id}/${prefix}${uuid()}.${ext}`;
  const { error } = await sb.storage.from('exp-receipts').upload(path, body, { contentType: type, upsert: false });
  if (error) throw error;
  try { uploadReceipt.last = { path, hash: await sha256Hex(body) }; } catch (e) { uploadReceipt.last = { path, hash: null }; }
  return path;
}
const _signed = {};
async function signedUrl(path) {
  const c = _signed[path]; if (c && c.exp > Date.now()) return c.url;
  const { data, error } = await sb.storage.from('exp-receipts').createSignedUrl(path, 3600);
  if (error) throw error;
  _signed[path] = { url: data.signedUrl, exp: Date.now() + 3000 * 1000 };
  return data.signedUrl;
}
async function viewFile(path, meta = '') {
  try {
    const url = await signedUrl(path);
    modal(`<div class="row between"><h2>Attachment</h2><button class="btn ghost sm" data-act="close">Close</button></div>
      ${/\.pdf$/i.test(path) ? `<iframe src="${url}" style="width:100%;height:70vh;border:0"></iframe>` : `<img src="${url}" style="max-width:100%;border-radius:10px">`}
      <p style="margin-top:10px"><a href="${url}" target="_blank" rel="noopener">Open in new tab</a></p>${meta}`, { wide: true });
  } catch (e) { fail(e); }
}

/* ---------- FX rates ---------- */
const _fx = {};
async function fxRate(from, to) {
  if (from === to) return 1;
  const k = from + to; if (_fx[k]) return _fx[k];
  const r = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
  if (!r.ok) throw new Error('Could not fetch exchange rate');
  const j = await r.json(); return (_fx[k] = j.rates[to]);
}
const CURRENCIES = ['GBP', 'EUR', 'USD', 'AUD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'AED', 'JPY', 'CNY', 'INR', 'ZAR', 'NZD', 'SGD', 'TRY'];

/* ---------- workspace loading ---------- */
async function loadWorkspaces() {
  const ms = await q(sb.from('exp_members').select('*, exp_workspaces(*)').eq('user_id', App.user.id));
  App.workspaces = ms.map(m => ({ ...m.exp_workspaces, _role: m.role }));
  return App.workspaces;
}
async function selectWorkspace(id) {
  const w = App.workspaces.find(x => x.id === id) || App.workspaces[0];
  if (!w) return false;
  App.ws = w; localStorage.setItem('eh_ws', w.id);
  const [members, cats, rules] = await Promise.all([
    q(sb.from('exp_members').select('*').eq('workspace_id', w.id).order('display_name')),
    q(sb.from('exp_categories').select('*').eq('workspace_id', w.id).order('name')),
    q(sb.from('exp_rules').select('*').eq('workspace_id', w.id))
  ]);
  App.members = members; App.cats = cats; App.rules = rules;
  App.me = members.find(m => m.user_id === App.user.id) || { role: w._role };
  if (typeof OFF !== 'undefined') OFF.saveSnap();
  return true;
}
async function reloadWorkspace() { await loadWorkspaces(); await selectWorkspace(App.ws.id); }

/* ---------- navigation / router ---------- */
/* [id, label, icon, who can see it, group heading]  — who: '' everyone, 'manager' approver/finance/admin, 'finance' finance/admin */
const NAV = [
  ['dashboard', 'Dashboard', '▦', '', ''], ['expenses', 'Expenses', '🧾', '', ''], ['reports', 'Reports', '📄', '', ''], ['approvals', 'Approvals', '✔', 'manager', ''], ['trips', 'Trips', '✈', '', ''],
  ['bills', 'Bills to pay', '💷', 'finance', 'Finance'], ['invoices', 'Invoices', '🧮', 'finance', 'Finance'], ['budgets', 'Budgets', '🎯', 'finance', 'Finance'], ['analytics', 'Analytics', '📊', 'finance', 'Finance'],
  ['team', 'Team', '👥', 'manager', 'Admin'], ['audit', 'Audit log', '🕑', 'manager', 'Admin'], ['settings', 'Settings', '⚙', '', 'Admin']
];
const navAllowed = n => !n[3] || (n[3] === 'manager' && isManager()) || (n[3] === 'finance' && isFinance());
function renderShell() {
  let last = '';
  const items = NAV.filter(navAllowed), groups = new Set(items.map(n => n[4]));
  $('#nav').innerHTML = items.map(n => {
    const head = n[4] !== last && n[4] && (groups.size > 1) ? `<div class="grp">${n[4]}</div>` : ''; last = n[4];
    return head + `<a href="#/${n[0]}" data-nav="${n[0]}"><span class="ic">${n[2]}</span><span>${n[1]}</span><b class="badge" id="b-${n[0]}" hidden></b></a>`;
  }).join('');
  $('#wsname').textContent = App.ws.name;
  $('#whoami').textContent = (App.me.display_name || App.user.email) + ' · ' + App.me.role;
  const sw = $('#wsswitch');
  sw.innerHTML = App.workspaces.map(w => `<option value="${w.id}" ${w.id === App.ws.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('') + '<option value="__new">+ New workspace…</option>';
}
async function route() {
  if (!App.ws) return;
  const name = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
  const v = VIEWS[name] || VIEWS.dashboard;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === name));
  $('#title').textContent = (NAV.find(n => n[0] === name) || NAV[0])[1];
  document.body.classList.remove('menu');
  const el = $('#view'); el.innerHTML = '<div class="empty">Loading…</div>';
  try { await v(el); } catch (e) { el.innerHTML = isNetErr(e) ? `<div class="card"><h3>📴 You're offline</h3><p class="sub">This page needs a connection. You can still add expenses and scan receipts — they are kept on this device and sync automatically when you are back online.</p><button class="btn" data-act="newExpense">+ New expense</button></div>` : `<div class="card"><h3>Something went wrong</h3><p class="sub">${esc(e.message || e)}</p></div>`; console.error(e); }
  refreshBadges();
}
const rerender = () => route();
async function refreshBadges() {
  try {
    const set = (id, n) => { const b = $('#b-' + id); if (b) { b.hidden = !n; b.textContent = n; } };
    if (isManager()) {
      const [r, b] = await Promise.all([
        sb.from('exp_reports').select('id', { count: 'exact', head: true }).eq('workspace_id', App.ws.id).eq('status', 'submitted'),
        sb.from('exp_bills').select('id', { count: 'exact', head: true }).eq('workspace_id', App.ws.id).eq('status', 'pending')]);
      set('approvals', r.count || 0); set('bills', b.count || 0);
    }
  } catch (e) { /* badges are best-effort */ }
}

/* ---------- global events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t) {
    if (t.dataset.act === 'close') return closeModal();
    const fn = ACTIONS[t.dataset.act];
    if (fn) { e.stopPropagation(); Promise.resolve(fn(t, e)).catch(fail); }
    return;
  }
  if (e.target.id === 'modal') closeModal();
  if (e.target.id === 'scrim') document.body.classList.remove('menu');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); $('#dialog').classList.remove('on'); } });
window.addEventListener('hashchange', route);
