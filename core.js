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


/* ---- icon set (inline SVG, inherits text colour) ---- */
const IC = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  trip: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .6 3.2 2.3 3.5 5.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  multi: '<rect x="7" y="6" width="14" height="14" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/><circle cx="14" cy="13" r="2.5"/>',
  car: '<path d="M4 15v-4l2-5h12l2 5v4z"/><path d="M4 11h16M7 18v2M17 18v2M7.5 14.5h.01M16.5 14.5h.01"/>',
  pin: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  clip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.2 17.2a1.7 1.7 0 0 1-2.4-2.4L14 7.6"/>',
  warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  offline: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M3 3l18 18"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  match: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>'
};
const ic = (n, s = 16) => `<svg class="i" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

const FLAG_LABELS = {
  no_receipt: 'No receipt', over_limit: 'Over spend limit', over_category_limit: 'Over category limit',
  possible_duplicate: 'Possible duplicate', old_expense: 'Older than 60 days',
  vat_no_receipt: 'VAT claimed, no receipt', vat_invoice_needed: 'Over £250: needs VAT invoice + supplier VAT no.', receipt_unclear: 'Receipt may be unclear'
};
const pill = s => `<span class="pill ${esc(s)}">${esc(s)}</span>`;
const flagHTML = f => (f || []).map(x => `<span class="flag" title="${esc(FLAG_LABELS[x] || x)}">${ic('warn', 14)} ${esc(FLAG_LABELS[x] || x)}</span>`).join('');

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


/* ---------- receipt thumbnails + full-screen viewer ---------- */
const isPdfPath = p => /\.pdf$/i.test(p || '');
// small tappable receipt picture; fills in by itself once on screen (see hydrateThumbs)
function rcptThumb(path, big) {
  if (!path) return '';
  const cls = 'rth' + (big ? ' big' : '');
  if (isPdfPath(path)) return `<span class="${cls} pdf" data-act="viewRcpt" data-p="${esc(path)}" title="View receipt">PDF</span>`;
  return `<span class="${cls}" data-act="viewRcpt" data-p="${esc(path)}" title="View receipt"><img data-p="${esc(path)}" alt="Receipt" loading="lazy"></span>`;
}
let _hyT = 0;
function hydrateThumbs() {
  clearTimeout(_hyT);
  _hyT = setTimeout(async () => {
    const imgs = [...document.querySelectorAll('img[data-p]:not([src])')]; if (!imgs.length || typeof sb === 'undefined') return;
    const need = [...new Set(imgs.map(i => i.dataset.p))].filter(p => !(_signed[p] && _signed[p].exp > Date.now()));
    try {
      if (need.length) {
        const { data } = await sb.storage.from('exp-receipts').createSignedUrls(need, 3600);
        (data || []).forEach(d => { if (d.signedUrl) _signed[d.path || need[data.indexOf(d)]] = { url: d.signedUrl, exp: Date.now() + 3000 * 1000 }; });
      }
    } catch (e) { /* thumbnails are optional */ }
    imgs.forEach(i => { const c = _signed[i.dataset.p]; if (c) { i.onerror = () => i.parentElement.classList.add('gone'); i.src = c.url; } else i.parentElement.classList.add('gone'); });
  }, 60);
}
new MutationObserver(hydrateThumbs).observe(document.documentElement, { childList: true, subtree: true });
async function viewReceipt(path, src) {
  try {
    const url = src || await signedUrl(path), pdf = isPdfPath(path) || /^blob:.*#pdf$/.test(url);
    closeLightbox();
    const d = document.createElement('div'); d.id = 'lightbox'; d.className = 'lightbox';
    d.innerHTML = `<div class="lbbar"><span class="grow">Receipt</span><a class="btn ghost sm lbbtn" href="${url}" target="_blank" rel="noopener">Open in new tab</a><button class="btn sm" data-lb="x">Close</button></div>
      <div class="lbbody">${pdf ? `<iframe src="${url}"></iframe>` : `<img src="${url}" alt="Receipt" draggable="false">`}</div>
      <div class="lbhint">${pdf ? '' : 'Pinch or double-tap to zoom · tap outside the receipt to close'}</div>`;
    d.addEventListener('click', e => { if (e.target.closest('[data-lb="x"]') || e.target.classList.contains('lbbody') || e.target === d) closeLightbox(); });
    const img = d.querySelector('img'); if (img) { let z = 1; img.addEventListener('dblclick', () => { z = z > 1 ? 1 : 2.2; img.style.transform = `scale(${z})`; img.style.cursor = z > 1 ? 'zoom-out' : 'zoom-in'; }); }
    document.body.appendChild(d); document.body.classList.add('noscroll');
  } catch (e) { fail(e); }
}
function closeLightbox() { const d = document.getElementById('lightbox'); if (d) { d.remove(); if (!$('#modal')?.classList.contains('on')) document.body.classList.remove('noscroll'); } }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('lightbox')) { closeLightbox(); e.stopPropagation(); } }, true);
ACTIONS.viewRcpt = (t, ev) => { ev?.preventDefault(); ev?.stopPropagation(); viewReceipt(t.dataset.p); };

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
  if (typeof loadLearned === 'function') { loadLearned(); loadNotifs(); probeSchema(); }
  return true;
}
async function reloadWorkspace() { await loadWorkspaces(); await selectWorkspace(App.ws.id); }

/* ---------- navigation / router ---------- */
/* [id, label, icon, who can see it, group heading]  — who: '' everyone, 'manager' approver/finance/admin, 'finance' finance/admin */
const NAV = [
  ['dashboard', 'Home', 'dash', '', ''], ['expenses', 'Expenses', 'receipt', '', ''], ['inbox', 'Emailed receipts', 'mail', '', ''], ['reports', 'Reports', 'file', '', ''], ['approvals', 'Approvals', 'check', 'manager', ''], ['trips', 'Trips', 'trip', '', ''],
  ['bills', 'Bills to pay', 'cash', 'finance', 'Finance'], ['invoices', 'Invoices', 'calc', 'finance', 'Finance'], ['budgets', 'Budgets', 'target', 'finance', 'Finance'], ['analytics', 'Analytics', 'chart', 'finance', 'Finance'], ['vat', 'VAT summary', 'percent', 'finance', 'Finance'], ['statements', 'Card matching', 'match', 'finance', 'Finance'],
  ['team', 'Team', 'users', 'manager', 'Admin'], ['audit', 'Audit log', 'clock', 'manager', 'Admin'], ['settings', 'Settings', 'sliders', '', 'Admin']
];
/* Simple view (default): only the everyday pages. "Show all tools" reveals the rest. Remembered per device. */
const SIMPLE_NAV = ['dashboard', 'expenses', 'inbox', 'reports', 'approvals', 'team', 'settings'];
const isSimple = () => { try { return localStorage.getItem('eh_simple') !== '0'; } catch (e) { return true; } };
const navAllowed = n => (n[0] !== 'inbox' || HAS.v8) && (!isSimple() || SIMPLE_NAV.includes(n[0])) && (!n[3] || (n[3] === 'manager' && isManager()) || (n[3] === 'finance' && isFinance()));
function renderShell() {
  let last = '';
  const items = NAV.filter(navAllowed), groups = new Set(items.map(n => n[4]));
  $('#nav').innerHTML = items.map(n => {
    const head = n[4] !== last && n[4] && (groups.size > 1) ? `<div class="grp">${n[4]}</div>` : ''; last = n[4];
    return head + `<a href="#/${n[0]}" data-nav="${n[0]}"><span class="ic">${ic(n[2], 18)}</span><span>${n[1]}</span><b class="badge" id="b-${n[0]}" hidden></b></a>`;
  }).join('') + `<a href="#" data-act="toggleSimple" class="moretools"><span class="ic">${ic(isSimple() ? 'plus' : 'minus', 18)}</span><span>${isSimple() ? 'Show all tools' : 'Show simple view'}</span></a>`;
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
  try { await v(el); } catch (e) { el.innerHTML = isNetErr(e) ? `<div class="card"><h3>${ic('offline', 16)} You're offline</h3><p class="sub">This page needs a connection. You can still add expenses and scan receipts — they are kept on this device and sync automatically when you are back online.</p><button class="btn" data-act="newExpense">+ New expense</button></div>` : `<div class="card"><h3>Something went wrong</h3><p class="sub">${esc(e.message || e)}</p></div>`; console.error(e); }
  refreshBadges();
}
const rerender = () => route();
ACTIONS.toggleSimple = (t, ev) => { ev.preventDefault(); try { localStorage.setItem('eh_simple', isSimple() ? '0' : '1'); } catch (e) { } renderShell(); route(); };
async function refreshBadges() {
  try {
    const set = (id, n) => { const b = $('#b-' + id); if (b) { b.hidden = !n; b.textContent = n; } };
    if (isManager()) {
      const [r, b] = await Promise.all([
        sb.from('exp_reports').select('id', { count: 'exact', head: true }).eq('workspace_id', App.ws.id).eq('status', 'submitted'),
        sb.from('exp_bills').select('id', { count: 'exact', head: true }).eq('workspace_id', App.ws.id).eq('status', 'pending')]);
      set('approvals', r.count || 0); set('bills', b.count || 0);
    }
    if (HAS.v8) { const ib = await sb.from('exp_expenses').select('id', { count: 'exact', head: true }).eq('workspace_id', App.ws.id).eq('user_id', App.user.id).eq('needs_review', true); set('inbox', ib.count || 0); }
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
