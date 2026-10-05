/* Flexi Expenses extras: notifications, VAT summary, card statement matching, saved journeys, merchant memory.
   Everything here fails quietly if the 07 database update has not been run yet. */

/* ---------- notifications ---------- */
const NT = { rows: [], timer: null };
const ago = ts => { const s = Math.max(1, Math.round((Date.now() - new Date(ts)) / 1000)); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
async function loadNotifs() {
  if (!App.ws || !App.user || !navigator.onLine) return;
  try { NT.rows = await q(sb.from('exp_notifications').select('*').eq('workspace_id', App.ws.id).eq('user_id', App.user.id).order('created_at', { ascending: false }).limit(30)); } catch (e) { NT.rows = []; }
  drawBell();
}
function drawBell() {
  const b = $('#bellBtn'); if (!b) return;
  if (!b.dataset.ready) { b.innerHTML = ic('bell', 20) + '<b class="bellN" id="bellN" hidden></b>'; b.dataset.ready = '1'; }
  const n = NT.rows.filter(r => !r.read_at).length, c = $('#bellN'); if (!c) return;
  c.textContent = n > 9 ? '9+' : n; c.hidden = !n;
}
function startNotifs() {
  drawBell(); loadNotifs(); clearInterval(NT.timer); NT.timer = setInterval(loadNotifs, 60000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadNotifs(); });
ACTIONS.openBell = async () => {
  await loadNotifs();
  modal(`<div class="row between"><h2>Notifications</h2><button class="btn ghost sm" data-act="close">${ic('x', 14)}</button></div>
  ${NT.rows.length ? NT.rows.map(n => `<div class="item" data-act="openNotif" data-id="${n.id}" style="cursor:pointer"><div class="grow"><b>${esc(n.title)}</b>${n.read_at ? '' : ' <span class="flag" style="margin:0">new</span>'}<span class="sub">${esc(n.body || '')}</span><span class="sub">${ago(n.created_at)}</span></div></div>`).join('')
    : '<div class="empty">Nothing yet. You will see approvals, rejections and payments here.</div>'}
  ${NT.rows.some(n => !n.read_at) ? '<div class="row end" style="margin-top:10px"><button class="btn ghost sm" data-act="readAllNotifs">Mark all as read</button></div>' : ''}`);
};
ACTIONS.openNotif = async t => {
  const n = NT.rows.find(x => x.id === t.dataset.id); if (!n) return;
  if (!n.read_at) { n.read_at = new Date().toISOString(); drawBell(); sb.from('exp_notifications').update({ read_at: n.read_at }).eq('id', n.id).then(() => { }); }
  closeModal(); if (n.link) location.hash = n.link;
};
ACTIONS.readAllNotifs = async () => {
  const ids = NT.rows.filter(n => !n.read_at).map(n => n.id), now = new Date().toISOString();
  NT.rows.forEach(n => { n.read_at = n.read_at || now; }); drawBell(); closeModal();
  if (ids.length) { try { await sb.from('exp_notifications').update({ read_at: now }).in('id', ids); } catch (e) { /* offline */ } }
};

/* ---------- merchant memory: what the team usually files a merchant under ---------- */
const mkey = m => (m || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
function ruleFor(merchant) {
  const m = (merchant || '').toLowerCase(); if (!m) return null;
  const r = (App.rules || []).find(r => m.includes(r.match_text.toLowerCase())); if (r) return { category_id: r.category_id, billable: r.billable };
  const mk = mkey(merchant); if (mk.length < 3) return null;
  let l = App.learned?.[mk];                                                      // exact, else the closest known name ("Screwfix" ~ "Screwfix Direct Ltd")
  if (!l) l = Object.values(App.learned || {}).filter(x => x.merchant_key.length >= 4 && (mk.includes(x.merchant_key) || x.merchant_key.includes(mk))).sort((a, b) => b.merchant_key.length - a.merchant_key.length)[0];
  return l ? { category_id: l.category_id, billable: l.billable } : null;
}
async function loadLearned() {
  const ws = App.ws?.id; App.learned = {};
  try { (await q(sb.from('exp_merchant_cats').select('*').eq('workspace_id', ws))).forEach(r => { if (App.ws?.id === ws) App.learned[r.merchant_key] = r; }); } catch (e) { /* not set up yet or offline */ }
}
async function learnMerchant(merchant, category_id, billable) {
  const k = mkey(merchant); if (!k || !category_id || !navigator.onLine || /^(receipt to read|per diem)$/.test(k)) return;
  if ((App.rules || []).some(r => k.includes(r.match_text.toLowerCase()))) return;       // an admin rule already covers it
  const cur = App.learned?.[k]; if (cur && cur.category_id === category_id) return;
  App.learned = App.learned || {}; App.learned[k] = { merchant_key: k, category_id, billable: !!billable };
  try { await sb.from('exp_merchant_cats').upsert({ workspace_id: App.ws.id, merchant_key: k, category_id, billable: !!billable, updated_at: new Date().toISOString() }); } catch (e) { /* best effort */ }
}

/* ---------- saved journeys ---------- */
const JN = { rows: null, ws: null };
async function loadJourneys() {
  if (JN.rows && JN.ws === App.ws.id) return JN.rows;
  try { JN.rows = await q(sb.from('exp_journeys').select('*').eq('workspace_id', App.ws.id).eq('user_id', App.user.id).order('name')); } catch (e) { JN.rows = []; }
  JN.ws = App.ws.id; return JN.rows;
}
function fillJourneys() {
  const s = $('#x_jn'); if (!s) return;
  s.innerHTML = '<option value="">Saved journeys…</option>' + (JN.rows || []).map(j => `<option value="${j.id}">${esc(j.name)} · ${j.miles} mi</option>`).join('');
}
const _drawExpenseForm = drawExpenseForm;
drawExpenseForm = function () {
  _drawExpenseForm.apply(this, arguments);
  if (X.kind === 'mileage' && !X.id && $('#x_jn')) loadJourneys().then(() => { fillJourneys(); const sel = $('#x_jn'); if (sel) sel.onchange = jnChosen; });
};
function jnChosen() {
  const j = (JN.rows || []).find(x => x.id === $('#x_jn').value); $('#x_jndel').hidden = !j; if (!j) return;
  $('#x_from').value = j.from_loc; $('#x_to').value = j.to_loc; $('#x_miles').value = j.miles; $('#x_miles').dispatchEvent(new Event('input', { bubbles: true }));
  const n = $('#x_distnote'); if (n) n.textContent = 'Saved journey filled in. Tick "round trip" if you came back too.';
}
ACTIONS.jnSave = async () => {
  const from = ($('#x_from').value || '').trim(), to = ($('#x_to').value || '').trim(), miles = parseFloat($('#x_miles').value);
  if (!from || !to || !(miles > 0)) return toast('Fill in from, to and miles first', 'err');
  const name = await askText('Name this journey', 'Name', 'e.g. Depot to Leeds site', 'Save'); if (!name) return;
  try { await q(sb.from('exp_journeys').insert({ workspace_id: App.ws.id, user_id: App.user.id, name: name.trim().slice(0, 60), from_loc: from, to_loc: to, miles })); JN.rows = null; await loadJourneys(); fillJourneys(); toast('Journey saved'); } catch (e) { fail(e); }
};
ACTIONS.jnDel = async () => {
  const id = $('#x_jn').value; if (!id || !await confirmBox('Delete this saved journey?', 'Delete', true)) return;
  try { await q(sb.from('exp_journeys').delete().eq('id', id)); JN.rows = null; await loadJourneys(); fillJourneys(); $('#x_jndel').hidden = true; } catch (e) { fail(e); }
};

/* ---------- VAT summary ---------- */
const VT = { preset: 'quarter', from: '', to: '' };
function vatRange(p) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  if (p === 'lastq') { const qs = Math.floor(m / 3) * 3 - 3; return [isoDate(new Date(y, qs, 1)), isoDate(new Date(y, qs + 3, 0))]; }
  if (p === 'custom') return [VT.from || isoDate(new Date(y, m, 1)), VT.to || isoDate(n)];
  return presetRange(p);
}
const vatBase = e => (parseFloat(e.vat_amount) || 0) * (parseFloat(e.fx_rate) || 1);
function vatRisk(e) {
  const f = e.flags || [];
  if (!e.receipt_path) return 'No receipt';
  if (f.includes('vat_invoice_needed')) return 'Needs a full VAT invoice';
  if (f.includes('vat_no_receipt')) return 'VAT claimed, no receipt';
  if (f.includes('receipt_unclear')) return 'Receipt unclear';
  return '';
}
VIEWS.vat = async el => {
  const [from, to] = vatRange(VT.preset);
  await fetchExpenses({ from, to });
  let inv = []; try { inv = await q(sb.from('exp_invoices').select('number,client_name,issue_date,vat,total,status').eq('workspace_id', App.ws.id).gte('issue_date', from).lte('issue_date', to).in('status', ['sent', 'paid'])); } catch (e) { /* offline */ }
  const rows = EX.rows.filter(e => e.kind === 'expense' && expStatus(e) !== 'rejected' && vatBase(e) > 0);
  const ok = rows.filter(e => !vatRisk(e)), risky = rows.filter(e => vatRisk(e));
  const reclaim = sum(ok, vatBase), atRisk = sum(risky, vatBase), output = sum(inv, i => parseFloat(i.vat) || 0);
  const byCat = {}; rows.forEach(e => { const k = catName(e.category_id) || 'Uncategorised', o = byCat[k] = byCat[k] || { n: 0, gross: 0, rec: 0, risk: 0 }; o.n++; o.gross += +e.amount_base; if (vatRisk(e)) o.risk += vatBase(e); else o.rec += vatBase(e); });
  const opt = (arr, cur) => arr.map(([k, n]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${n}</option>`).join('');
  VT.rows = rows;
  el.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="toolbar" style="margin:0">
    <select id="v_preset">${opt([['quarter', 'This quarter'], ['lastq', 'Last quarter'], ['month', 'This month'], ['last', 'Last month'], ['tax', 'This tax year (6 Apr)'], ['year', 'This calendar year'], ['custom', 'Custom range']], VT.preset)}</select>
    ${VT.preset === 'custom' ? `<input type="date" id="v_from" value="${from}"><input type="date" id="v_to" value="${to}">` : ''}
    <button class="btn ghost" data-act="vatCsv">Export detail</button></div>
    <p class="sub" style="margin:8px 0 0">${dfmt(from)} to ${dfmt(to)}${App.ws.vat_number ? ' · VAT no. ' + esc(App.ws.vat_number) : ' · add your VAT number in Settings'}</p></div>
  <div class="grid">${stat('VAT you can reclaim', money(reclaim), `${ok.length} expenses with a receipt`)}${stat('VAT at risk', money(atRisk), `${risky.length} expenses to fix first`)}${stat('VAT on your sales', money(output), `${inv.length} invoices sent or paid`)}${stat('Estimated VAT to pay', money(output - reclaim), output - reclaim < 0 ? 'refund due' : 'sales VAT minus reclaim')}</div>
  ${risky.length ? `<h3 class="sec">Fix these to reclaim ${money(atRisk)}</h3><div class="card nopad">${risky.slice(0, 40).map(e => `<div class="item" data-act="openExpense" data-id="${e.id}"><div class="grow"><b>${esc(e.merchant || e.kind)}</b><span class="sub">${dfmt(e.expense_date)} · ${esc(memberName(e.user_id))} · ${esc(vatRisk(e))}</span></div><div class="right"><div class="amt">${money(vatBase(e))}</div><span class="sub">VAT</span></div></div>`).join('')}</div>` : ''}
  <h3 class="sec">By category</h3><div class="card nopad"><table><tr><th>Category</th><th class="r">Items</th><th class="r">Spend</th><th class="r">VAT reclaimable</th><th class="r">VAT at risk</th></tr>
    ${Object.entries(byCat).sort((a, b) => b[1].rec - a[1].rec).map(([k, o]) => `<tr><td>${esc(k)}</td><td class="r">${o.n}</td><td class="r">${money(o.gross)}</td><td class="r">${money(o.rec)}</td><td class="r">${o.risk ? money(o.risk) : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="sub">No expenses with VAT in this period.</td></tr>'}</table></div>
  <p class="sub" style="margin-top:12px">An estimate to help with your VAT return, based on expense dates. Mileage and expenses with no VAT are left out. Have your accountant check the figures before filing.</p>`;
  const bind = (id, k) => { const n = $(id); if (n) n.onchange = e => { VT[k] = e.target.value; rerender(); }; };
  bind('#v_preset', 'preset'); bind('#v_from', 'from'); bind('#v_to', 'to');
};
ACTIONS.vatCsv = () => download(`vat-${today()}.csv`, toCSV([['Date', 'Employee', 'Supplier', 'Category', 'Gross (base)', 'VAT (base)', 'Supplier VAT no.', 'Receipt', 'Status', 'Issue'],
  ...(VT.rows || []).map(e => [e.expense_date, memberName(e.user_id), e.merchant, catName(e.category_id), (+e.amount_base).toFixed(2), vatBase(e).toFixed(2), e.supplier_vat_no || '', e.receipt_path || '', expStatus(e), vatRisk(e) || 'OK'])]));

/* ---------- card statement matching ---------- */
const ST = { lines: [], exps: [], tab: 'unmatched' };
function parseCSVText(text) {
  const rows = []; let row = [], f = '', inq = false; text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inq = false; } else f += c; }
    else if (c === '"') inq = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
function parseStmtDate(s) {
  s = (s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/))) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/))) { const mo = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(m[2].toLowerCase()); if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
  return null;
}
const stmtNum = s => { s = String(s || '').trim(); if (!s) return null; const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s) || /\bDR\b/i.test(s); const n = parseFloat(s.replace(/[^0-9.]/g, '')); return isNaN(n) ? null : (neg ? -n : n); };
function parseStatement(text) {
  const rows = parseCSVText(text); if (rows.length < 2) throw new Error('That file looks empty.');
  const hi = rows.findIndex(r => r.some(c => /date/i.test(c))); if (hi < 0) throw new Error('Could not find a Date column in that file.');
  const head = rows[hi].map(c => c.trim().toLowerCase());
  const find = (re, not = -1) => head.findIndex((h, i) => i !== not && re.test(h));
  const di = find(/date/), ds = find(/desc|detail|narrat|merchant|payee|name|reference|transaction/, di);
  const ai = find(/^amount|^value|amount \(/), out = find(/paid out|money out|debit|withdraw|^out$/);
  if (ai < 0 && out < 0) throw new Error('Could not find an Amount (or Paid out) column in that file.');
  const lines = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseStmtDate(r[di]); if (!date) continue;
    const amt = ai >= 0 ? stmtNum(r[ai]) : (stmtNum(r[out]) != null ? Math.abs(stmtNum(r[out])) : null);
    if (!amt) continue;
    lines.push({ line_date: date, description: (r[ds >= 0 ? ds : (di === 0 ? 1 : 0)] || '').trim().slice(0, 200), amount: amt });
  }
  if (ai >= 0) { const neg = lines.filter(l => l.amount < 0); return (neg.length ? neg : lines.filter(l => l.amount > 0)).map(l => ({ ...l, amount: Math.abs(l.amount) })); }
  return lines;
}
const nameSim = (a, b) => {
  const t = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2), A = t(a), B = t(b);
  if (!A.length || !B.length) return 0; return B.filter(w => A.some(x => x.includes(w) || w.includes(x))).length / B.length;
};
function matchStatements(lines, exps) {
  const used = new Set(lines.filter(l => l.status === 'matched' && l.expense_id).map(l => l.expense_id)), out = [];
  const cand = exps.filter(e => e.kind !== 'mileage' && e.payment_method === 'company_card');
  for (const l of lines.filter(l => l.status === 'unmatched')) {
    let best = null, bs = 1e9;
    for (const e of cand) {
      if (used.has(e.id)) continue;
      const tol = e.currency === App.ws.currency ? 0.011 : Math.max(0.5, l.amount * 0.04);
      if (Math.abs(+e.amount_base - +l.amount) > tol) continue;
      const dd = Math.abs((new Date(l.line_date) - new Date(e.expense_date)) / 864e5); if (dd > 6) continue;
      const s = dd - nameSim(l.description, e.merchant) * 3;
      if (s < bs) { bs = s; best = e; }
    }
    if (best) { used.add(best.id); out.push({ line: l, exp: best }); }
  }
  return out;
}
async function loadStatements() {
  ST.lines = await q(sb.from('exp_statement_lines').select('*').eq('workspace_id', App.ws.id).order('line_date', { ascending: false }).limit(3000));
  const ds = ST.lines.map(l => l.line_date).sort(), d = (s, n) => isoDate(new Date(new Date(s).getTime() + n * 864e5));
  await fetchExpenses(ds.length ? { from: d(ds[0], -10), to: d(ds[ds.length - 1], 10) } : {});
  ST.exps = EX.rows;
}
async function runMatching() {
  const m = matchStatements(ST.lines, ST.exps);
  for (let i = 0; i < m.length; i += 10) await Promise.all(m.slice(i, i + 10).map(x => q(sb.from('exp_statement_lines').update({ status: 'matched', expense_id: x.exp.id }).eq('id', x.line.id))));
  return m.length;
}
VIEWS.statements = async el => {
  try { await loadStatements(); } catch (e) {
    if (isNetErr(e)) throw e;
    el.innerHTML = '<div class="card empty">Card matching needs the latest database update (07_features.sql). Ask an admin to run it in Supabase.</div>'; return;
  }
  const L = ST.lines, matchedIds = new Set(L.filter(l => l.status === 'matched').map(l => l.expense_id));
  const un = L.filter(l => l.status === 'unmatched'), mt = L.filter(l => l.status === 'matched'), ig = L.filter(l => l.status === 'ignored');
  const lo = L.length ? L.map(l => l.line_date).sort()[0] : '9999', hi2 = L.length ? L.map(l => l.line_date).sort().pop() : '0000';
  const noLine = L.length ? ST.exps.filter(e => e.payment_method === 'company_card' && e.kind !== 'mileage' && !matchedIds.has(e.id) && e.expense_date >= lo && e.expense_date <= hi2) : [];
  const tabs = [['unmatched', `No receipt yet (${un.length})`], ['matched', `Matched (${mt.length})`], ['noline', `Not on statement (${noLine.length})`], ['ignored', `Ignored (${ig.length})`]];
  const expOf = id => ST.exps.find(e => e.id === id);
  const body = ST.tab === 'unmatched' ? (un.length ? `<table><tr><th>Date</th><th>Statement line</th><th class="r">Amount</th><th></th></tr>${un.map(l => `<tr><td>${dfmt(l.line_date)}</td><td>${esc(l.description || '')}</td><td class="r">${money(l.amount)}</td><td class="r"><a href="#" data-act="stmtMatch" data-id="${l.id}">match…</a> · <a href="#" data-act="stmtIgnore" data-id="${l.id}">ignore</a></td></tr>`).join('')}</table>` : '<div class="empty">Every statement line has a receipt. 🎉</div>')
    : ST.tab === 'matched' ? (mt.length ? `<table><tr><th>Date</th><th>Statement line</th><th class="r">Amount</th><th>Expense</th><th></th></tr>${mt.map(l => { const e = expOf(l.expense_id); return `<tr><td>${dfmt(l.line_date)}</td><td>${esc(l.description || '')}</td><td class="r">${money(l.amount)}</td><td>${e ? `<a href="#" data-act="openExpense" data-id="${e.id}">${esc(e.merchant || e.kind)}</a> · ${esc(memberName(e.user_id))}` : '—'}</td><td class="r"><a href="#" data-act="stmtUnmatch" data-id="${l.id}">unmatch</a></td></tr>`; }).join('')}</table>` : '<div class="empty">Nothing matched yet.</div>')
    : ST.tab === 'noline' ? (noLine.length ? `<table><tr><th>Date</th><th>Expense</th><th>Employee</th><th class="r">Amount</th></tr>${noLine.map(e => `<tr><td>${dfmt(e.expense_date)}</td><td><a href="#" data-act="openExpense" data-id="${e.id}">${esc(e.merchant || e.kind)}</a></td><td>${esc(memberName(e.user_id))}</td><td class="r">${money(e.amount_base)}</td></tr>`).join('')}</table><p class="sub" style="padding:10px 14px">Company-card expenses in the statement period that are not on the statement. They may be on a later one, or the wrong payment method was chosen.</p>` : '<div class="empty">All company-card expenses are on the statement.</div>')
    : (ig.length ? `<table><tr><th>Date</th><th>Statement line</th><th class="r">Amount</th><th></th></tr>${ig.map(l => `<tr><td>${dfmt(l.line_date)}</td><td>${esc(l.description || '')}</td><td class="r">${money(l.amount)}</td><td class="r"><a href="#" data-act="stmtRestore" data-id="${l.id}">restore</a></td></tr>`).join('')}</table>` : '<div class="empty">Nothing ignored.</div>');
  el.innerHTML = `<div class="card" style="margin-bottom:12px"><h3>Match your card statement</h3>
    <p class="sub">Upload the company card or bank statement as a CSV. Each spend line is matched to an expense by amount, date and name, so you can see what is missing a receipt. Bank fees, refunds and payments in are left out.</p>
    <div class="row wrap gap"><button class="btn" data-act="stmtPick">${ic('upload', 16)} Upload statement (CSV)</button>${un.length ? '<button class="btn ghost" data-act="stmtRematch">Re-run matching</button>' : ''}${L.length ? '<button class="btn ghost" data-act="stmtCsv">Export unmatched</button>' : ''}</div>
    <input type="file" id="st_file" accept=".csv,text/csv,text/plain" hidden></div>
  <div class="grid">${stat('Statement lines', L.length)}${stat('Matched', mt.length, L.length ? Math.round(mt.length / L.length * 100) + '%' : '')}${stat('No receipt yet', un.length, money(sum(un, l => +l.amount)))}${stat('Not on statement', noLine.length, 'card expenses')}</div>
  <div class="seg" style="margin:12px 0">${tabs.map(([k, n]) => `<button data-act="stmtTab" data-v="${k}" class="${ST.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
  <div class="card nopad">${body}</div>`;
  $('#st_file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) stmtUpload(f); };
};
ACTIONS.stmtPick = () => $('#st_file').click();
ACTIONS.stmtTab = t => { ST.tab = t.dataset.v; rerender(); };
async function stmtUpload(file) {
  try {
    const lines = parseStatement(await file.text()); if (!lines.length) return toast('No spend lines found in that file', 'err');
    const key = l => `${l.line_date}|${(l.description || '').toLowerCase()}|${(+l.amount).toFixed(2)}`, seen = {};
    await loadStatements(); ST.lines.forEach(l => { seen[key(l)] = (seen[key(l)] || 0) + 1; });
    const mine = {}, fresh = lines.filter(l => { const k = key(l); mine[k] = (mine[k] || 0) + 1; return mine[k] > (seen[k] || 0); });
    if (!fresh.length) return toast('Those lines are already uploaded');
    const batch = file.name.slice(0, 60) + ' ' + today();
    for (let i = 0; i < fresh.length; i += 200) await q(sb.from('exp_statement_lines').insert(fresh.slice(i, i + 200).map(l => ({ ...l, workspace_id: App.ws.id, batch }))));
    await loadStatements(); const n = await runMatching(); await loadStatements();
    toast(`${fresh.length} lines added, ${n} matched automatically`); rerender();
  } catch (e) { fail(e); }
}
ACTIONS.stmtRematch = wrap(async () => { await loadStatements(); const n = await runMatching(); toast(n ? `${n} more matched` : 'Nothing new to match'); rerender(); });
ACTIONS.stmtIgnore = wrap(async (t, ev) => { ev.preventDefault(); await q(sb.from('exp_statement_lines').update({ status: 'ignored', expense_id: null }).eq('id', t.dataset.id)); rerender(); });
ACTIONS.stmtRestore = wrap(async (t, ev) => { ev.preventDefault(); await q(sb.from('exp_statement_lines').update({ status: 'unmatched' }).eq('id', t.dataset.id)); rerender(); });
ACTIONS.stmtUnmatch = wrap(async (t, ev) => { ev.preventDefault(); await q(sb.from('exp_statement_lines').update({ status: 'unmatched', expense_id: null }).eq('id', t.dataset.id)); rerender(); });
ACTIONS.stmtMatch = (t, ev) => {
  ev.preventDefault(); const l = ST.lines.find(x => x.id === t.dataset.id); if (!l) return;
  const taken = new Set(ST.lines.filter(x => x.status === 'matched').map(x => x.expense_id));
  const c = ST.exps.filter(e => e.kind !== 'mileage' && !taken.has(e.id) && Math.abs(+e.amount_base - +l.amount) <= Math.max(1, l.amount * 0.05) && Math.abs((new Date(l.line_date) - new Date(e.expense_date)) / 864e5) <= 30)
    .sort((a, b) => Math.abs(+a.amount_base - l.amount) - Math.abs(+b.amount_base - l.amount)).slice(0, 25);
  modal(`<div class="row between"><h2>Match to an expense</h2><button class="btn ghost sm" data-act="close">${ic('x', 14)}</button></div>
  <p class="sub">${dfmt(l.line_date)} · ${esc(l.description || '')} · <b>${money(l.amount)}</b></p>
  ${c.length ? c.map(e => `<div class="item" data-act="stmtLink" data-line="${l.id}" data-exp="${e.id}" style="cursor:pointer"><div class="grow"><b>${esc(e.merchant || e.kind)}</b><span class="sub">${dfmt(e.expense_date)} · ${esc(memberName(e.user_id))} · ${esc(e.payment_method.replace('_', ' '))}</span></div><div class="right"><div class="amt">${money(e.amount_base)}</div></div></div>`).join('') : '<div class="empty">No expense with a similar amount and date. The receipt may not have been submitted yet.</div>'}`);
};
ACTIONS.stmtLink = wrap(async t => { await q(sb.from('exp_statement_lines').update({ status: 'matched', expense_id: t.dataset.exp }).eq('id', t.dataset.line)); closeModal(); rerender(); });
ACTIONS.stmtCsv = () => download(`unmatched-card-lines-${today()}.csv`, toCSV([['Date', 'Description', 'Amount'], ...ST.lines.filter(l => l.status === 'unmatched').map(l => [l.line_date, l.description, (+l.amount).toFixed(2)])]));

/* ---------- schema probe: the 08 update (inbox, trip budgets, guidance, email alerts) ---------- */
const HAS = { v8: (() => { try { return localStorage.getItem('eh_v8') === '1'; } catch (e) { return false; } })() };
async function probeSchema() {
  const was = HAS.v8;
  try { const r = await sb.from('exp_trips').select('budget').limit(1); HAS.v8 = !r.error; try { localStorage.setItem('eh_v8', HAS.v8 ? '1' : '0'); } catch (e) { } } catch (e) { /* offline: keep what we knew */ }
  if (HAS.v8 !== was) { renderShell(); refreshBadges(); }
}

/* ---------- receipt inbox (receipts emailed in by the Apps Script) ---------- */
VIEWS.inbox = async el => {
  let rows = [];
  try { rows = await q(sb.from('exp_expenses').select('*').eq('workspace_id', App.ws.id).eq('user_id', App.user.id).eq('needs_review', true).order('created_at', { ascending: false })); } catch (e) { if (isNetErr(e)) throw e; }
  rows.forEach(r => { if (!EX.rows.find(x => x.id === r.id)) EX.rows.push(r); });
  const addr = App.ws.inbox_email;
  el.innerHTML = `<div class="card" style="margin-bottom:12px"><h3>Email your receipts</h3>
    <p class="sub">${addr ? `Forward any receipt, e-receipt or invoice from your work email to <b>${esc(addr)}</b>. Photos, PDFs and email bodies all work. It appears here already read, ready for you to check.` : 'Your admin has not set up a receipt email address yet (Settings → Workspace policy).'}</p>
    ${addr ? `<div class="row wrap gap"><a class="btn ghost" href="mailto:${esc(addr)}">${ic('mail', 16)} Start an email</a></div>` : ''}</div>
  <div class="card nopad">${rows.length ? rows.map(e => `<div class="item" data-act="inboxOpen" data-id="${e.id}"><div class="thumb" style="--c:#df0a1e">${ic('mail', 20)}</div><div class="grow"><b>${esc(e.merchant || 'Emailed receipt')}</b><span class="sub">Received ${dfmt(e.created_at)} · tap to read and check</span></div><div class="right"><span class="pill check">to check</span></div></div>`).join('')
    : '<div class="empty">Nothing waiting. Receipts you email in will show up here.</div>'}</div>`;
};
ACTIONS.inboxOpen = t => openExpense(t.dataset.id);
const _openExpense = openExpense;
openExpense = async function (id) {
  await _openExpense.apply(this, arguments);
  if (id && X && X.needs_review && !X.file && X.receipt_path && !(parseFloat(X.amount) > 0)) readStoredReceipt();
};
async function readStoredReceipt() {
  const out = $('#x_ocr'); if (!out) return;
  out.textContent = 'Reading the emailed receipt…';
  try {
    const { data, error } = await sb.storage.from('exp-receipts').download(X.receipt_path); if (error || !data) throw error || new Error('Could not open the receipt');
    const ext = (X.receipt_path.match(/\.(\w{2,4})$/)?.[1] || 'jpg').toLowerCase(), type = ext === 'pdf' ? 'application/pdf' : (data.type && data.type !== 'application/octet-stream' ? data.type : 'image/' + (ext === 'jpg' ? 'jpeg' : ext));
    X._readFile = new File([data], 'receipt.' + ext, { type });
    await ACTIONS.xScan(); delete X._readFile;
  } catch (e) { delete X._readFile; if ($('#x_ocr')) $('#x_ocr').textContent = 'Could not read it automatically — fill in the details from the receipt.'; }
}
ACTIONS.xReadStored = () => readStoredReceipt();

/* ---------- pack buttons ---------- */
ACTIONS.anPack = () => { const l = (AN.rows || []).filter(e => !e.needs_review); exportPack(l, `${$('#a_preset')?.selectedOptions[0]?.text || 'Selection'} (${rangeLabel(l)})`, true); };
