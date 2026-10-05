/* Expenses: list, filters, bulk actions, add/edit form, receipt scan (OCR), comments, exports */
const EX = { rows: [], reps: {}, trips: [], sel: new Set(), f: { q: '', status: '', cat: '', who: '', from: '', to: '', flagged: false } };

const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
const expStatus = e => e.report_id ? (EX.reps[e.report_id]?.status || 'draft') : 'unreported';
const canEditExpense = e => !e.id || ((e.user_id === App.user.id && ['unreported', 'draft', 'rejected'].includes(expStatus(e))) || isFinance());

async function fetchExpenses(opts = {}) {
  try {
    let qy = sb.from('exp_expenses').select('*').eq('workspace_id', App.ws.id).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000);
    if (opts.from) qy = qy.gte('expense_date', opts.from);
    if (opts.to) qy = qy.lte('expense_date', opts.to);
    const [rows, reps] = await Promise.all([q(qy), q(sb.from('exp_reports').select('id,name,status,user_id').eq('workspace_id', App.ws.id))]);
    EX.rows = rows; EX.reps = Object.fromEntries(reps.map(r => [r.id, r])); EX.stale = false;
    if (!opts.from && !opts.to) OFF.cacheRows(App.ws.id, rows, EX.reps);
  } catch (e) {
    const c = isNetErr(e) && OFF.cachedRows(App.ws.id); if (!c) throw e;
    EX.rows = c.rows; EX.reps = c.reps; EX.stale = true;       // offline: show what we last saw
  }
  return EX.rows;
}

/* ---------- list view ---------- */
VIEWS.expenses = async el => {
  await fetchExpenses(); await OFF.refresh();
  try { EX.trips = await q(sb.from('exp_trips').select('id,name,status,user_id').eq('workspace_id', App.ws.id).order('start_date', { ascending: false })); } catch (e) { if (!isNetErr(e)) throw e; EX.trips = EX.trips || []; }
  el.innerHTML = `${EX.stale ? '<div class="note" style="margin-bottom:10px">Showing the list as it was when you last had a signal.</div>' : ''}${OFF.pendingHTML()}
  <div class="toolbar">
    <input id="f_q" placeholder="Search merchant, notes, customer…" value="${esc(EX.f.q)}">
    <select id="f_status"><option value="">All statuses</option>${['unreported', 'draft', 'submitted', 'approved', 'rejected', 'reimbursed'].map(s => `<option ${EX.f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <select id="f_cat"><option value="">All categories</option>${App.cats.map(c => `<option value="${c.id}" ${EX.f.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    ${isManager() ? `<select id="f_who"><option value="">Everyone</option>${App.members.map(m => `<option value="${m.user_id}" ${EX.f.who === m.user_id ? 'selected' : ''}>${esc(m.display_name || m.email)}</option>`).join('')}</select>` : ''}
    <input id="f_from" type="date" value="${EX.f.from}" title="From"><input id="f_to" type="date" value="${EX.f.to}" title="To">
    <label class="chk"><input type="checkbox" id="f_flag" ${EX.f.flagged ? 'checked' : ''}> Flagged only</label>
  </div>
  <div class="row wrap gap" style="margin-bottom:12px">
    <button class="btn" data-act="newExpense">+ New expense</button>
    <button class="btn ghost" data-act="scanExpense">${ic('camera', 16)} Scan receipt</button>
    <button class="btn ghost" data-act="bulkScan">${ic('multi', 16)} Multiple receipts</button>
    <button class="btn ghost" data-act="newMileage">${ic('car', 16)} Mileage</button>
    <span class="grow"></span>
    <select id="exp_fmt" title="Export format"><option value="generic">Export: CSV</option><option value="xero">Export: Xero</option><option value="quickbooks">Export: QuickBooks</option></select>
    <button class="btn ghost" data-act="exportExp">Export</button>
  </div>
  <div id="bulk" class="bulk" hidden></div>
  <div class="card nopad" id="exlist"></div>`;
  const draw = () => drawExpenseList();
  $('#f_q').oninput = debounce(e => { EX.f.q = e.target.value; draw(); });
  ['status', 'cat', 'who', 'from', 'to'].forEach(k => { const n = $('#f_' + k); if (n) n.onchange = e => { EX.f[k] = e.target.value; draw(); }; });
  $('#f_flag').onchange = e => { EX.f.flagged = e.target.checked; draw(); };
  EX.sel.clear(); draw();
};
function filteredExpenses() {
  const f = EX.f, s = f.q.toLowerCase();
  return EX.rows.filter(e =>
    (!s || [e.merchant, e.notes, e.customer, e.from_loc, e.to_loc].join(' ').toLowerCase().includes(s)) &&
    (!f.status || expStatus(e) === f.status) && (!f.cat || e.category_id === f.cat) && (!f.who || e.user_id === f.who) &&
    (!f.from || e.expense_date >= f.from) && (!f.to || e.expense_date <= f.to) && (!f.flagged || (e.flags || []).length));
}
function expenseRow(e, selectable) {
  const st = expStatus(e), sel = selectable && e.user_id === App.user.id && st === 'unreported';
  const c = cat(e.category_id), foreign = e.currency !== App.ws.currency;
  return `<div class="item" data-act="openExpense" data-id="${e.id}">
    ${sel ? `<input type="checkbox" class="selbox" data-act="selExp" data-id="${e.id}" ${EX.sel.has(e.id) ? 'checked' : ''}>` : selectable ? '<span style="width:18px"></span>' : ''}
    <div class="thumb" style="--c:${esc(c?.color || '#9ca3af')}">${e.kind === 'mileage' ? ic('car', 20) : e.kind === 'per_diem' ? ic('cal', 20) : e.receipt_path ? ic('clip', 20) : ic('receipt', 20)}</div>
    <div class="grow"><b>${esc(e.merchant || (e.kind === 'mileage' ? 'Mileage' : 'Expense'))}</b>
      <span class="sub">${dfmt(e.expense_date)} · ${esc(c?.name || 'Uncategorised')}${isManager() ? ' · ' + esc(memberName(e.user_id)) : ''}${e.billable ? ' · Billable' : ''}</span>
      <div>${flagHTML(e.flags)}</div></div>
    <div class="right"><div class="amt">${money(e.amount_base)}</div>${foreign ? `<div class="sub">${money(e.amount, e.currency)}</div>` : ''}${pill(st)}</div></div>`;
}
function drawExpenseList() {
  const l = filteredExpenses();
  const monthTot = {}; l.forEach(e => { const m = e.expense_date.slice(0, 7); monthTot[m] = (monthTot[m] || 0) + +e.amount_base; });
  let lastM = '';
  const body = l.map(e => { const m = e.expense_date.slice(0, 7), h = m !== lastM ? `<div class="item mhead"><b>${new Date(m + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b><span class="grow"></span><b>${money(monthTot[m])}</b></div>` : ''; lastM = m; return h + expenseRow(e, true); }).join('');
  const unrep = l.filter(e => e.user_id === App.user.id && expStatus(e) === 'unreported').length;
  $('#exlist').innerHTML = l.length ? body + `<div class="item foot"><span class="grow">${l.length} expense(s)${unrep ? ` · <a href="#" data-act="selAllUnreported">select my ${unrep} unsubmitted</a>` : ''}</span><b>${money(sum(l, e => e.amount_base))}</b></div>` : '<div class="empty">No expenses match. Tap “+ New expense” or scan a receipt.</div>';
  drawBulk();
}
function drawBulk() {
  const b = $('#bulk'); if (!b) return;
  b.hidden = !EX.sel.size;
  b.innerHTML = EX.sel.size ? `<b>${EX.sel.size} selected · ${money(sum([...EX.sel], i => EX.rows.find(e => e.id === i)?.amount_base))}</b>
    <button class="btn sm" data-act="addToReport">Add to report</button><button class="btn sm ghost" data-act="bulkDelete">Delete</button><button class="btn sm ghost" data-act="selNone">Clear</button>` : '';
}
ACTIONS.selExp = (t, ev) => { ev.stopPropagation(); t.checked ? EX.sel.add(t.dataset.id) : EX.sel.delete(t.dataset.id); drawBulk(); };
ACTIONS.selNone = () => { EX.sel.clear(); drawExpenseList(); };
ACTIONS.bulkDelete = async () => {
  if (!await confirmBox(`Delete ${EX.sel.size} expense(s)?`, 'Delete', true)) return;
  await q(sb.from('exp_expenses').delete().in('id', [...EX.sel])); toast('Deleted'); rerender();
};
ACTIONS.selAllUnreported = (t, ev) => { ev.preventDefault(); ev.stopPropagation(); filteredExpenses().filter(e => e.user_id === App.user.id && expStatus(e) === 'unreported').forEach(e => EX.sel.add(e.id)); drawExpenseList(); };
ACTIONS.submitAll = () => { EX.sel = new Set(EX.rows.filter(e => e.user_id === App.user.id && expStatus(e) === 'unreported').map(e => e.id)); if (!EX.sel.size) return toast('Nothing to submit', 'err'); ACTIONS.addToReport(); };
ACTIONS.addToReport = async () => {
  const mine = await q(sb.from('exp_reports').select('id,name').eq('workspace_id', App.ws.id).eq('user_id', App.user.id).in('status', ['draft', 'rejected']).order('created_at', { ascending: false }));
  const d = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  modal(`<h2>Add to report</h2>
    <label>Existing report</label><select id="ar_rep"><option value="">— Create a new report —</option>${mine.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
    <label>New report name</label><input id="ar_name" value="Expenses – ${d}">
    <div class="row end" style="margin-top:16px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="doAddToReport">Add</button></div>`);
};
ACTIONS.doAddToReport = wrap(async () => {
  let id = $('#ar_rep').value;
  if (!id) {
    const r = await q(sb.from('exp_reports').insert({ workspace_id: App.ws.id, user_id: App.user.id, name: $('#ar_name').value.trim() || 'Expenses' }).select().single());
    id = r.id;
  }
  await q(sb.from('exp_expenses').update({ report_id: id }).in('id', [...EX.sel]));
  EX.sel.clear(); closeModal(); toast('Added to report'); location.hash = '#/reports';
});

/* ---------- exports ---------- */
function expenseRows(list, fmt) {
  const gl = id => cat(id)?.gl_code || '';
  if (fmt === 'xero') return [['*ContactName', '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', '*Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType', 'Currency'],
    ...list.map(e => [e.merchant || 'Expense', '', memberName(e.user_id), e.expense_date, e.expense_date, e.notes || catName(e.category_id), 1, Number(e.amount_base).toFixed(2), gl(e.category_id), e.vat_amount > 0 ? '20% (VAT on Expenses)' : 'No VAT', App.ws.currency])];
  if (fmt === 'quickbooks') return [['Bill No', 'Supplier', 'Bill Date', 'Due Date', 'Memo', 'Category', 'Description', 'Amount', 'Tax Code'],
    ...list.map(e => ['', e.merchant || 'Expense', e.expense_date, e.expense_date, memberName(e.user_id), catName(e.category_id), e.notes || '', Number(e.amount_base).toFixed(2), e.vat_amount > 0 ? '20% S' : 'No VAT'])];
  return [['Date', 'Merchant', 'Type', 'Category', 'GL code', 'Currency', 'Amount', 'FX rate', 'Amount (' + App.ws.currency + ')', 'VAT', 'Payment', 'Billable', 'Customer', 'Trip', 'Employee', 'Status', 'Report', 'Miles', 'From', 'To', 'Flags', 'Notes', 'Supplier VAT no.', 'Receipt stored (UTC)', 'Receipt SHA-256', 'Receipt file'],
    ...list.map(e => [e.expense_date, e.merchant, e.kind, catName(e.category_id), gl(e.category_id), e.currency, e.amount, e.fx_rate, e.amount_base, e.vat_amount ?? '', e.payment_method, e.billable ? 'Yes' : 'No', e.customer, EX.trips.find(t => t.id === e.trip_id)?.name || '', memberName(e.user_id), expStatus(e), EX.reps[e.report_id]?.name || '', e.miles ?? '', e.from_loc, e.to_loc, (e.flags || []).join('|'), e.notes, e.supplier_vat_no || '', e.receipt_uploaded_at || '', e.receipt_hash || '', e.receipt_path || ''])];
}
ACTIONS.exportExp = () => {
  const fmt = $('#exp_fmt').value; download(`expenses-${fmt}-${today()}.csv`, toCSV(expenseRows(filteredExpenses(), fmt)));
};

/* ---------- expense form ---------- */
let X = null; // working copy
const blankExpense = (kind = 'expense') => ({ id: null, kind, merchant: '', expense_date: today(), amount: '', currency: App.ws.currency, fx_rate: 1, category_id: '', notes: '', billable: false, customer: '', payment_method: 'personal', receipt_path: null, miles: '', from_loc: '', to_loc: '', vat_amount: '', supplier_vat_no: '', receipt_hash: null, receipt_uploaded_at: null, receipt_check: null, trip_id: '', flags: [], file: null, roundTrip: false, days: '', rate: '' });
ACTIONS.newExpense = () => openExpense();
ACTIONS.newMileage = () => openExpense(null, 'mileage');
ACTIONS.scanExpense = () => { openExpense(); setTimeout(() => { const i = $('#x_file'); if (i) { i.setAttribute('capture', 'environment'); i.click(); } }, 150); };
ACTIONS.openExpense = (t) => openExpense(t.dataset.id);

async function openExpense(id, kind) {
  if (id) {
    const e = EX.rows.find(r => r.id === id) || await q(sb.from('exp_expenses').select('*').eq('id', id).single());
    X = { ...blankExpense(e.kind), ...e, category_id: e.category_id || '', trip_id: e.trip_id || '', vat_amount: e.vat_amount ?? '', miles: e.miles ?? '', file: null, roundTrip: false };
    if (!EX.reps[e.report_id] && e.report_id) { try { const r = await q(sb.from('exp_reports').select('id,name,status,user_id').eq('id', e.report_id).single()); EX.reps[r.id] = r; } catch (err) { if (!isNetErr(err)) throw err; } }
  } else X = blankExpense(kind || 'expense');
  if (!EX.trips.length) { try { EX.trips = await q(sb.from('exp_trips').select('id,name,status,user_id').eq('workspace_id', App.ws.id)); } catch (e) { if (!isNetErr(e)) throw e; } }
  if (kind === 'mileage') X.category_id = App.cats.find(c => c.is_mileage)?.id || '';
  drawExpenseForm();
}
function readX() {
  if (!$('#x_date')) return;
  const v = id => $(id)?.value ?? '';
  Object.assign(X, {
    expense_date: v('#x_date') || today(), notes: v('#x_notes'), category_id: v('#x_cat') || '', trip_id: v('#x_trip') || '', billable: $('#x_bill')?.checked || false, customer: v('#x_cust'),
    payment_method: v('#x_pay') || 'personal'
  });
  if (X.kind === 'mileage') Object.assign(X, { from_loc: v('#x_from'), to_loc: v('#x_to'), miles: v('#x_miles'), roundTrip: $('#x_rt')?.checked || false });
  else if (X.kind === 'per_diem') Object.assign(X, { days: v('#x_days'), rate: v('#x_rate'), merchant: v('#x_merchant') });
  else Object.assign(X, { merchant: v('#x_merchant'), amount: v('#x_amount'), currency: v('#x_cur') || App.ws.currency, fx_rate: parseFloat(v('#x_fx')) || 1, vat_amount: v('#x_vat'), supplier_vat_no: v('#x_svat') });
}
function estimateMileage() {
  const m = (parseFloat(X.miles) || 0) * (X.roundTrip ? 2 : 1);
  return m * App.ws.mileage_rate; // server applies the over-threshold rate authoritatively
}
function drawExpenseForm() {
  const e = X, ed = canEditExpense(e), dis = ed ? '' : 'disabled', rep = EX.reps[e.report_id];
  const myTrips = EX.trips.filter(t => t.user_id === App.user.id || t.id === e.trip_id);
  const catOpts = App.cats.filter(c => e.kind === 'mileage' ? true : true).map(c => `<option value="${c.id}" ${e.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const foreign = e.currency !== App.ws.currency;
  modal(`<div class="row between"><h2>${e.id ? 'Expense' : 'New expense'} ${e.id ? pill(expStatus(e)) : ''}</h2><button class="btn ghost sm" data-act="close">${ic('x', 14)}</button></div>
  ${e.id && e.user_id !== App.user.id ? `<p class="sub">Submitted by ${esc(memberName(e.user_id))}</p>` : ''}
  ${rep?.status === 'rejected' ? '<div class="note">This report was rejected — fix the expense and resubmit.</div>' : ''}
  ${(e.flags || []).length ? `<div class="note">${flagHTML(e.flags)}</div>` : ''}
  <div class="seg">${[['expense', 'Expense'], ['mileage', 'Mileage'], ['per_diem', 'Per diem']].map(([k, n]) => `<button data-act="xKind" data-v="${k}" class="${e.kind === k ? 'on' : ''}" ${e.id ? 'disabled' : ''}>${n}</button>`).join('')}</div>
  <fieldset ${dis} style="border:0;padding:0;margin:0">
  ${e.kind === 'mileage' ? `
    ${e.id ? '' : `<div class="row gap" style="margin-bottom:8px"><select id="x_jn" style="flex:1"><option value="">Saved journeys…</option></select><button type="button" class="btn ghost sm" id="x_jndel" data-act="jnDel" hidden>Delete</button><button type="button" class="btn ghost sm" data-act="jnSave">Save this journey</button></div>`}
    <div class="two"><div><label>From</label><input id="x_from" value="${esc(e.from_loc)}" list="places" placeholder="Postcode or place" autocomplete="off"></div><div><label>To</label><input id="x_to" value="${esc(e.to_loc)}" list="places" placeholder="Postcode or place" autocomplete="off"></div></div>
    <datalist id="places">${[...new Set(EX.rows.filter(r => r.kind === 'mileage').flatMap(r => [r.from_loc, r.to_loc]).filter(Boolean))].slice(0, 40).map(m => `<option value="${esc(m)}">`).join('')}</datalist>
    <button type="button" class="btn ghost sm" data-act="xDist" style="margin-bottom:8px">${ic('pin', 16)} Work out the distance</button> <span class="sub" id="x_distnote"></span>
    <div class="two"><div><label>Miles</label><input id="x_miles" type="number" step="0.1" inputmode="decimal" value="${esc(e.miles)}"></div>
    <div><label>Date</label><input id="x_date" type="date" value="${e.expense_date}"></div></div>
    <label class="chk"><input type="checkbox" id="x_rt" ${e.roundTrip ? 'checked' : ''}> Round trip (double the miles)</label>
    <p class="sub" id="x_est">${e.id ? 'Amount ' + money(e.amount_base) : 'Estimated: ' + money(estimateMileage()) + ' (HMRC-style rates applied by the server)'}</p>`
  : e.kind === 'per_diem' ? `
    <label>Description</label><input id="x_merchant" value="${esc(e.merchant)}" placeholder="e.g. Subsistence – Leeds site visit">
    <div class="two"><div><label>Days</label><input id="x_days" type="number" step="0.5" value="${esc(e.days)}"></div><div><label>Daily rate</label><input id="x_rate" type="number" step="0.01" value="${esc(e.rate)}"></div></div>
    <div class="two"><div><label>Date</label><input id="x_date" type="date" value="${e.expense_date}"></div><div><label>Total</label><input id="x_amount" readonly value="${e.id ? e.amount : ''}"></div></div>`
  : `
    <label>Merchant</label><input id="x_merchant" value="${esc(e.merchant)}" placeholder="e.g. Shell, Premier Inn" list="merchants" autocomplete="off">
    <datalist id="merchants">${[...new Set(EX.rows.map(r => r.merchant).filter(Boolean))].slice(0, 60).map(m => `<option value="${esc(m)}">`).join('')}</datalist>
    <div class="two"><div><label>Date</label><input id="x_date" type="date" value="${e.expense_date}"></div>
    <div><label>Amount</label><input id="x_amount" type="number" step="0.01" inputmode="decimal" value="${esc(e.amount)}"></div></div>
    <div class="two"><div><label>Currency</label><select id="x_cur">${[...new Set([App.ws.currency, ...CURRENCIES])].map(c => `<option ${e.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div ${foreign ? '' : 'hidden'} id="x_fxbox"><label>Rate to ${App.ws.currency} <a href="#" data-act="xFx" style="float:right">Get today's rate</a></label><input id="x_fx" type="number" step="0.0001" value="${e.fx_rate}"></div></div>
    <div class="two"><div><label>VAT included <a href="#" data-act="xVat" style="float:right">20%</a></label><input id="x_vat" type="number" step="0.01" value="${esc(e.vat_amount)}"></div>
    <div><label>Paid with</label><select id="x_pay">${[['personal', 'Personal card'], ['company_card', 'Company card'], ['cash', 'Cash']].map(([k, n]) => `<option value="${k}" ${e.payment_method === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
    <label>Supplier VAT number <span class="sub">(needed to reclaim VAT on items over £250)</span></label><input id="x_svat" value="${esc(e.supplier_vat_no || '')}" placeholder="e.g. GB123456789" autocomplete="off">`}
  <label>Category</label><select id="x_cat"><option value="">— Choose —</option>${catOpts}</select><div id="x_sugg" class="sub"></div>
  <label>Trip</label><select id="x_trip"><option value="">— None —</option>${myTrips.map(t => `<option value="${t.id}" ${e.trip_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
  <label>Notes / business purpose</label><textarea id="x_notes" rows="2">${esc(e.notes)}</textarea>
  <label class="chk"><input type="checkbox" id="x_bill" ${e.billable ? 'checked' : ''}> Billable to a customer</label>
  <div id="x_custbox" ${e.billable ? '' : 'hidden'}><label>Customer</label><input id="x_cust" value="${esc(e.customer)}"></div>
  ${e.kind === 'mileage' ? '' : `<label>Receipt</label>
  <div class="rcpt">
    <div class="note" style="text-align:left;font-size:12.5px"><b>Before you bin the paper receipt</b> — your photo must show: the <b>whole receipt</b> (all four corners), the <b>supplier name</b>, the <b>date</b>, what was bought and the <b>total</b>, plus <b>VAT</b> details if shown. It must be sharp and readable. Keep the original if it's unclear.</div>
    ${e.file ? `<div class="sub">${ic('clip', 16)} ${esc(e.file.name)} ready to upload</div>` : e.receipt_path ? `<div class="sub">${ic('clip', 16)} Receipt attached — <a href="#" data-act="xView">view</a>${e.receipt_uploaded_at ? ' · stored ' + new Date(e.receipt_uploaded_at).toLocaleString('en-GB') : ''}</div>` : '<div class="sub">No receipt attached</div>'}
    <div class="row wrap gap" style="justify-content:center;margin-top:8px">
      <button type="button" class="btn ghost sm" data-act="xCamera">${ic('camera', 16)} Take photo</button>
      <button type="button" class="btn ghost sm" data-act="xPick">${ic('clip', 16)} Upload</button>
      ${e.file && e.file.type.startsWith('image/') ? `<button type="button" class="btn sm" data-act="xScan">${ic('spark', 16)} Rescan</button>` : ''}
      ${(e.file || e.receipt_path) ? '<button type="button" class="btn ghost sm" data-act="xRemoveFile">Remove</button>' : ''}
    </div><input type="file" id="x_file" accept="image/*,application/pdf" hidden>
    <div id="x_ocr" class="sub"></div></div>`}
  </fieldset>
  <div id="x_hints"></div>
  <div class="row wrap gap end" style="margin-top:16px">
    ${(e.id || e.qid) && ed ? '<button class="btn ghost danger-t" data-act="xDelete" style="margin-right:auto">Delete</button>' : ''}
    <button class="btn ghost" data-act="close">${ed ? 'Cancel' : 'Close'}</button>${ed ? '<button class="btn" data-act="xSave">Save</button>' : ''}
  </div>
  ${e.id ? '<hr><h3>Chat</h3><div id="x_chat" class="chat"><div class="sub">Loading…</div></div><div class="row gap" style="margin-top:8px"><input id="x_msg" placeholder="Ask or answer a question about this expense…"><button class="btn sm" data-act="xSend">Send</button></div>' : ''}`, { wide: false });
  wireExpenseForm(); if (e.id) loadChat('expense', e.id);
}
/* live heads-up before saving: the same rules the server will flag */
function readXSafe() { try { readX(); } catch (e) { } }
function updateHints() {
  const box = $('#x_hints'); if (!box || !$('#x_date')) return;
  const v = id => $(id)?.value ?? '', ws = App.ws, k = X.kind, h = [];
  const fx = parseFloat(v('#x_fx')) || 1, amt = (parseFloat(v('#x_amount')) || 0) * (k === 'expense' ? fx : 1), vat = parseFloat(v('#x_vat')) || 0, c = cat(v('#x_cat')), date = v('#x_date');
  const hasRc = !!(X.file || X.receipt_path);
  if (k === 'expense' && amt > 0) {
    if (!hasRc && amt > ws.receipt_required_over && c?.receipt_required !== false) h.push('A receipt is needed for this expense — add a photo.');
    if (vat > 0 && !hasRc) h.push('VAT can only be reclaimed with a receipt.');
    if (vat > 0 && amt > 250 && !v('#x_svat').trim()) h.push('Over £250 with VAT: add the supplier’s VAT number from the receipt.');
    if (c?.per_item_limit && amt > c.per_item_limit) h.push(`Over the ${c.name} limit of ${money(c.per_item_limit)} — it will be flagged for approval.`);
    if (amt > ws.flag_over) h.push(`Over ${money(ws.flag_over)} — it will be flagged for extra scrutiny.`);
    const m = v('#x_merchant').trim().toLowerCase();
    if (m && EX.rows.some(r => r.id !== X.id && r.kind === 'expense' && (r.merchant || '').toLowerCase() === m && r.expense_date === date && +r.amount === parseFloat(v('#x_amount')))) h.push('This looks like a duplicate of an expense you already have.');
  }
  if (k === 'mileage' && (v('#x_from').trim() === '' || v('#x_to').trim() === '' || !v('#x_notes').trim())) h.push('Mileage needs a start, an end and the business purpose (in Notes).');
  if (date && date > today()) h.push('The date is in the future.');
  else if (date && date < isoDate(new Date(Date.now() - 60 * 864e5))) h.push('This is more than 60 days old — it will be flagged.');
  box.innerHTML = h.length ? `<div class="note" style="text-align:left;margin-top:10px">${h.map(x => `<div>${ic('warn', 14)} ${esc(x)}</div>`).join('')}</div>` : '';
}
function wireExpenseForm() {
  $('#mc').oninput = debounce(() => { readXSafe(); updateHints(); }, 150);
  setTimeout(updateHints, 0);
  const g = id => $(id);
  g('#x_bill')?.addEventListener('change', ev => { $('#x_custbox').hidden = !ev.target.checked; });
  g('#x_cur')?.addEventListener('change', async ev => {
    $('#x_fxbox').hidden = ev.target.value === App.ws.currency;
    if (ev.target.value !== App.ws.currency) { try { $('#x_fx').value = await fxRate(ev.target.value, App.ws.currency); } catch (e) { toast('Enter the rate manually', 'err'); } } else $('#x_fx').value = 1;
  });
  g('#x_merchant')?.addEventListener('input', debounce(() => {
    if (X.kind !== 'expense' || !$('#x_merchant') || !$('#x_cat')) return;
    const m = ($('#x_merchant').value || '').toLowerCase(); if (!m) return;
    const r = ruleFor(m);
    if (r && !$('#x_cat').value) { $('#x_cat').value = r.category_id; if (r.billable) { $('#x_bill').checked = true; $('#x_custbox').hidden = false; } $('#x_sugg').textContent = 'Auto-categorised from your rules and past claims'; }
  }, 300));
  const mil = () => { readX(); const el = $('#x_est'); if (el) el.textContent = 'Estimated: ' + money(estimateMileage()) + ' (HMRC-style rates applied by the server)'; };
  ['#x_miles', '#x_rt'].forEach(s => g(s)?.addEventListener('input', mil));
  const pd = () => { const d = parseFloat($('#x_days').value) || 0, r = parseFloat($('#x_rate').value) || 0; $('#x_amount').value = (d * r).toFixed(2); };
  ['#x_days', '#x_rate'].forEach(s => g(s)?.addEventListener('input', pd));
  g('#x_file')?.addEventListener('change', ev => {
    const f = ev.target.files[0]; if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast('File is over 15MB', 'err');
    readX(); X.file = f; X.receipt_check = 'ok'; X.qualityNote = ''; drawExpenseForm();
    checkReceiptImage(f).then(r => {
      if (X.file !== f) return;
      X.receipt_check = r.ok ? 'ok' : 'unclear';
      if (!r.ok) { X.qualityNote = '<div class="note bad" style="text-align:left">' + ic('warn', 14) + ' ' + r.problems.map(esc).join('<br>' + ic('warn', 14) + ' ') + '<br>You can still save it, but retake the photo and keep the paper receipt if it is hard to read.</div>'; $('#x_ocr')?.insertAdjacentHTML('beforeend', X.qualityNote); }
    });
    if (f.type.startsWith('image/') && f.type !== 'image/heic') ACTIONS.xScan();   // read the receipt and autofill straight away
  });
}
ACTIONS.xKind = t => { readX(); X.kind = t.dataset.v; if (X.kind === 'mileage') X.category_id = App.cats.find(c => c.is_mileage)?.id || ''; drawExpenseForm(); };
/* distance: postcodes.io / OpenStreetMap to find the places, OSRM for the driving route (free public services; best effort) */
async function geocodePlace(txt) {
  txt = txt.trim(); const pc = txt.replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) { const r = await (await fetch('https://api.postcodes.io/postcodes/' + pc)).json(); if (r.result) return [r.result.longitude, r.result.latitude]; }
  const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=' + encodeURIComponent(txt))).json();
  if (r[0]) return [+r[0].lon, +r[0].lat];
  throw new Error('Could not find "' + txt + '"');
}
ACTIONS.xDist = async t => {
  const a = $('#x_from').value, b = $('#x_to').value, note = $('#x_distnote'); if (!a.trim() || !b.trim()) return toast('Enter where you started and finished first', 'err');
  note.textContent = 'Working it out…'; t.disabled = true;
  try {
    const [p1, p2] = await Promise.all([geocodePlace(a), geocodePlace(b)]);
    const r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${p1.join(',')};${p2.join(',')}?overview=false`)).json();
    if (!r.routes?.[0]) throw new Error('No driving route found');
    const mi = Math.round(r.routes[0].distance / 1609.344 * 10) / 10; $('#x_miles').value = mi; $('#x_miles').dispatchEvent(new Event('input', { bubbles: true }));
    note.textContent = `${mi} miles by road (one way). Tick "round trip" if you came back too. Check it looks right.`;
  } catch (e) { note.textContent = (e.message || 'Could not work it out') + ' — enter the miles by hand.'; } finally { t.disabled = false; }
};
ACTIONS.xCamera = () => { const i = $('#x_file'); i.setAttribute('capture', 'environment'); i.click(); };
ACTIONS.xPick = () => { const i = $('#x_file'); i.removeAttribute('capture'); i.click(); };
ACTIONS.xView = (t, ev) => {
  ev.preventDefault(); const p = X.receipt_path;
  viewFile(p, `<p class="sub" style="margin-top:6px">Stored ${X.receipt_uploaded_at ? new Date(X.receipt_uploaded_at).toLocaleString('en-GB') : ''} · fingerprint (SHA-256) ${X.receipt_hash ? esc(X.receipt_hash.slice(0, 16)) + '…' : 'n/a'}</p>`);
};
ACTIONS.xRemoveFile = () => { readX(); X.file = null; X.receipt_path = null; drawExpenseForm(); };
ACTIONS.xVat = (t, ev) => { ev.preventDefault(); const a = parseFloat($('#x_amount').value) || 0; $('#x_vat').value = (a - a / 1.2).toFixed(2); };
ACTIONS.xFx = async (t, ev) => { ev.preventDefault(); const c = $('#x_cur').value; try { $('#x_fx').value = await fxRate(c, App.ws.currency); toast('Rate updated'); } catch (e) { fail(e); } };
/* ---------- receipt reading (OCR) ---------- */
const KNOWN_MERCHANTS = ['Tesco', 'Sainsbury', 'Asda', 'Morrisons', 'Aldi', 'Lidl', 'Waitrose', 'Co-op', 'Marks & Spencer', 'Shell', 'BP', 'Esso', 'Texaco', 'Gulf', 'Jet', 'Murco', 'Costa', 'Starbucks', 'Greggs', 'Pret', 'Subway', 'McDonald', 'Burger King', 'KFC', 'Nandos', 'Wetherspoon', 'Premier Inn', 'Travelodge', 'Holiday Inn', 'Ibis', 'Hilton', 'Screwfix', 'Toolstation', 'B&Q', 'Wickes', 'Halfords', 'Argos', 'Amazon', 'Currys', 'Staples', 'WH Smith', 'Boots', 'Euro Car Parks', 'NCP', 'RingGo', 'Welcome Break', 'Moto', 'Roadchef', 'Euro Garages', 'Applegreen', 'Trainline', 'National Express', 'Uber', 'Parkdean'];
async function prepareForOcr(file) {
  const img = await new Promise((res, rej) => { const i = new Image(), u = URL.createObjectURL(file); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => rej(new Error('Could not read that image')); i.src = u; });
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
  const id = x.getImageData(0, 0, w, h), d = id.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const g = Math.round(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]); d[i] = g; hist[g]++; }
  const n = w * h; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * .01) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * .01) { hi = v; break; } }
  const span = Math.max(40, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const g = Math.max(0, Math.min(255, Math.round((d[i] - lo) * 255 / span))); d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255; }
  x.putImageData(id, 0, 0);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
async function newOcrWorker() {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
  return Tesseract.createWorker('eng');
}
async function ocrWith(worker, file) {
  const blob = await prepareForOcr(file), texts = [];
  for (const psm of ['6', '4']) { await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' }); texts.push((await worker.recognize(blob)).data.text); }
  return texts;
}
async function ocrReceipt(file) { const w = await newOcrWorker(); try { return await ocrWith(w, file); } finally { w.terminate(); } }
/* choose the best fields across the two reading passes */
function mergeParsed(texts) {
  const parsed = texts.map(parseReceipt), p = { ...(parsed.find(r => r.consistent) || parsed.reduce((a, b) => (b.score > a.score ? b : a))) };
  p.merchant = (parsed.find(r => r.known) || p).merchant || p.merchant; p.date = p.date || parsed.find(r => r.date)?.date; p.currency = p.currency || parsed.find(r => r.currency)?.currency;
  return p;
}
/* ---------- AI reading (Claude vision via the read-receipt Supabase function), with the on-device reader as fallback ---------- */
const blobB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
async function aiReadReceipt(file) {
  if (App.ws.ai_receipts === false) return null;
  let blob = file, type = file.type;
  if (type.startsWith('image/')) { blob = await compressImage(file, 1800, 0.82); type = 'image/jpeg'; } else if (type !== 'application/pdf') return null;
  if (blob.size > 4.5 * 1024 * 1024) return null;
  const { data, error } = await sb.functions.invoke('read-receipt', { body: { workspace_id: App.ws.id, image_base64: await blobB64(blob), media_type: type, categories: App.cats.map(c => c.name), currency: App.ws.currency } });
  if (error?.context?.json) { try { const j = await error.context.json(); if (j?.error === 'daily_limit') { if (!aiReadReceipt.warned) { aiReadReceipt.warned = true; toast("Today's AI reading limit is used up — reading on this device instead", 'err'); } throw new Error('AI daily limit reached'); } } catch (e2) { if (e2.message === 'AI daily limit reached') throw e2; } }
  if (error || !data || data.error) throw new Error(error?.message || data?.error || 'AI reader unavailable');
  const cat = App.cats.find(c => c.name === data.category);
  return { merchant: data.merchant, amount: data.total, date: data.date, vat: data.vat_amount, currency: data.currency, svat: data.supplier_vat_number, catId: cat?.id || '', pay: data.payment_method, ai: true, notReceipt: data.is_receipt === false, unclear: data.legible === false };
}
/* AI first; if it is switched off, offline or fails, read on the device instead. getWorker lets a batch share one OCR worker. */
async function readReceipt(file, getWorker) {
  try { const a = await aiReadReceipt(file); if (a) return a; } catch (e) { console.warn('AI read failed, using on-device reader:', e.message); }
  if (file.type.startsWith('image/') && file.type !== 'image/heic') return mergeParsed(getWorker ? await ocrWith(await getWorker(), file) : await ocrReceipt(file));
  return null;
}
ACTIONS.xScan = async () => {
  const out = $('#x_ocr');
  if (!navigator.onLine && !window.Tesseract) { out.textContent = 'Offline — your photo is kept on this device and will be read automatically when you are back online. You can also type the details in now.'; return; }
  out.textContent = 'Reading receipt…';
  try {
    const p = await readReceipt(X.file); readX();
    if (!p) { out.textContent = 'This file type cannot be read automatically — enter the details by hand.'; return; }
    if (p.svat) X.supplier_vat_no = p.svat;
    if (p.catId && !X.category_id) X.category_id = p.catId;
    if (p.pay) X.payment_method = p.pay;
    if (p.unclear) X.receipt_check = 'unclear';
    if (p.merchant) X.merchant = p.merchant;
    if (p.amount) X.amount = p.amount.toFixed(2);
    if (p.date) X.expense_date = p.date;
    if (p.vat) X.vat_amount = p.vat.toFixed(2);
    let note = '';
    if (p.currency && p.currency !== App.ws.currency) {
      X.currency = p.currency; try { X.fx_rate = await fxRate(p.currency, App.ws.currency); note = ` Currency read as ${p.currency} (rate ${X.fx_rate}).`; } catch (e) { note = ` Currency looks like ${p.currency} — enter the rate.`; }
    }
    const rule = ruleFor(X.merchant); if (rule && !X.category_id) { X.category_id = rule.category_id; if (rule.billable) X.billable = true; }
    drawExpenseForm(); $('#x_ocr').textContent = `${p.ai ? 'Read with AI' : 'Read on this device'} — filled in: ${[p.merchant && 'merchant', p.amount && 'amount', p.date && 'date', p.vat && 'VAT', p.svat && 'supplier VAT no.', p.catId && 'category'].filter(Boolean).join(', ') || 'nothing found'}.${note}${p.notReceipt ? ' This does not look like a receipt.' : ''}${p.unclear ? ' It looks hard to read — keep the paper copy.' : ''} Please check every field against the receipt.`;
    if (X.qualityNote) $('#x_ocr')?.insertAdjacentHTML('beforeend', X.qualityNote);
  } catch (e) { out.textContent = ''; fail(e); }
};
function parseReceipt(raw) {
  const text = raw.replace(/(\d)\s*([.,])\s*(\d{2})(?!\d)/g, '$1$2$3');
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean), out = {};
  const num = s => { const m = s.replace(/(\d),(\d{2})(?!\d)/g, '$1.$2').match(/\d{1,5}\.\d{2}(?!\d)/g); return m ? m.map(parseFloat) : []; };
  /* merchant: known names / the user's own merchants / first sensible line */
  const mine = [...new Set([...EX.rows.map(r => r.merchant), ...App.rules.map(r => r.match_text)].filter(m => m && m.length > 2))];
  const lc = text.toLowerCase(), hit = [...KNOWN_MERCHANTS, ...mine].find(m => lc.includes(m.toLowerCase()));
  if (hit) out.known = true;
  if (hit) out.merchant = mine.find(m => m.toLowerCase() === hit.toLowerCase()) || hit;
  else out.merchant = (lines.find(l => { const L = (l.match(/[A-Za-z]/g) || []).length; return L >= 3 && L / l.length > .6 && !/^\d/.test(l) && !/receipt|invoice|tel|vat reg|www\.|^(date|store|register|total|tax)/i.test(l); }) || '').replace(/[^\w &'.-]/g, '').trim().slice(0, 50);
  /* date: day-first (UK); swap if the "month" is > 12; also 25 Nov 2025 / Nov 25, 2025 */
  const MON = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' '), iso = (y, m, d) => { y = +y; if (y < 100) y += 2000; const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === +d && y >= 2000 && t.getTime() <= Date.now() + 864e5 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; };
  let m;
  if ((m = text.match(/(\d{4})-(\d{2})-(\d{2})/))) out.date = iso(m[1], +m[2], +m[3]);
  if (!out.date && (m = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) { let a = +m[1], b = +m[2]; out.date = iso(m[3], b, a) || iso(m[3], a, b); }
  if (!out.date && (m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{2,4})/)) && MON.includes(m[2].toLowerCase())) out.date = iso(m[3], MON.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  if (!out.date && (m = text.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/)) && MON.includes(m[1].toLowerCase())) out.date = iso(m[3], MON.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  /* amounts: total line, cross-checked against subtotal + tax */
  const isSub = l => /sub ?-?tota/i.test(l), tl = lines.filter(l => /tota|amount due|balance due|to pay|card payment|amount paid|\bsale\b/i.test(l) && !isSub(l) && !/vat|tax/i.test(l.replace(/total/i, ''))).flatMap(num);
  const sub = lines.filter(isSub).flatMap(num), vl = lines.filter(l => /\b(vat|tax)\b/i.test(l) && !/tota/i.test(l) && !/reg|no\.?\s*\d|number/i.test(l)).flatMap(num).filter(v => v > 0);
  const vat = vl.length ? Math.min(...vl) : null, calc = sub.length && vat ? Math.round((Math.max(...sub) + vat) * 100) / 100 : null;
  const near = (a, b) => Math.abs(a - b) < 0.015;
  if (calc && tl.some(t => near(t, calc))) { out.amount = calc; out.consistent = true; }
  else if (calc) { out.amount = calc; out.consistent = true; }
  else out.amount = tl.length ? Math.max(...tl) : Math.max(0, ...num(text)) || null;
  if (vat && (!out.amount || vat < out.amount)) out.vat = vat;
  out.currency = /£/.test(text) ? null : /\$/.test(text) && !/vat/i.test(text) ? 'USD' : /€/.test(text) ? 'EUR' : null;
  out.score = ['merchant', 'amount', 'date', 'vat'].filter(k => out[k]).length + (out.consistent ? 5 : 0);
  return out;
}
/* ---------- bulk receipt upload: pick many photos, read them all, review, save ---------- */
const BK = { rows: [], busy: false };
ACTIONS.bulkScan = () => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,application/pdf'; i.multiple = true; i.style.display = 'none'; document.body.appendChild(i);
  i.onchange = () => { const fs = [...i.files]; i.remove(); startBulk(fs); }; i.click();
};
function startBulk(files) {
  if (!files.length) return;
  if (files.length > 20) { toast('Reading the first 20 — do the rest in a second batch', 'err'); files = files.slice(0, 20); }
  const big = files.filter(f => f.size > 15 * 1024 * 1024); if (big.length) toast(big.length + ' file(s) over 15MB skipped', 'err');
  BK.rows = files.filter(f => f.size <= 15 * 1024 * 1024).map(f => ({ id: uuid(), svat: '', pay: '', file: f, merchant: '', date: today(), amount: '', vat: '', currency: App.ws.currency, fx: 1, cat: '', check: 'ok', state: 'wait', msg: '' }));
  if (!BK.rows.length) return;
  modal('<div id="bk"></div>', { wide: true });
  $('#mc').oninput = ev => { const t = ev.target, r = BK.rows.find(x => x.id === t.dataset.r); if (r && t.dataset.f) r[t.dataset.f] = t.value; };
  drawBk(); runBulk();
}
function drawBk() {
  const el = $('#bk'); if (!el) return;
  const done = BK.rows.filter(r => r.state === 'done').length, n = BK.rows.length;
  const catOpts = c => `<option value="">— Category —</option>` + App.cats.map(k => `<option value="${k.id}" ${c === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
  el.innerHTML = `<div class="row between"><h2>Multiple receipts</h2><button class="btn ghost sm" data-act="close">${ic('x', 14)}</button></div>
  <div class="note" style="text-align:left">${BK.busy ? `Reading receipts… ${done} of ${n} done. You can start checking the finished ones, but wait for the reading to finish before saving.` : `All read. Check every row against its receipt, fix anything wrong, then save.`}</div>
  ${BK.rows.map((r, i) => `<div class="card" style="margin:10px 0;padding:12px">
    <div class="row between"><span class="sub">${i + 1}. ${esc(r.file.name)} ${r.state === 'reading' ? '— reading…' : r.state === 'wait' ? '— waiting' : ''}</span><a href="#" data-act="bulkDrop" data-id="${r.id}">remove</a></div>
    ${r.msg ? `<div class="sub" style="color:var(--accent)">${ic('warn', 14)} ${esc(r.msg)}</div>` : ''}
    <label>Merchant</label><input data-r="${r.id}" data-f="merchant" value="${esc(r.merchant)}">
    <div class="two"><div><label>Date</label><input type="date" data-r="${r.id}" data-f="date" value="${r.date}"></div><div><label>Amount (${esc(r.currency)})</label><input type="number" step="0.01" inputmode="decimal" data-r="${r.id}" data-f="amount" value="${esc(r.amount)}"></div></div>
    <div class="two"><div><label>VAT included</label><input type="number" step="0.01" inputmode="decimal" data-r="${r.id}" data-f="vat" value="${esc(r.vat)}"></div><div><label>Category</label><select data-r="${r.id}" data-f="cat">${catOpts(r.cat)}</select></div></div>
  </div>`).join('')}
  <div class="row wrap gap end" style="margin-top:12px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="bulkSave" ${BK.busy || !BK.rows.length ? 'disabled' : ''}>Save ${BK.rows.length} expense(s)</button></div>`;
}
async function runBulk() {
  BK.busy = true; let worker = null;
  try {
    for (const r of BK.rows) {
      if (!$('#bk')) break;
      if (r.state !== 'wait') continue;
      r.state = 'reading'; drawBkSafe();
      try {
        if (!navigator.onLine) { r.msg = 'Offline — saved on this device and read when you are back online.'; }
        else if (r.file.type.startsWith('image/') && r.file.type !== 'image/heic') {
          const qc = await checkReceiptImage(r.file); r.check = qc.ok ? 'ok' : 'unclear'; r.msg = qc.problems.join(' ');
          const p = await readReceipt(r.file, async () => (worker = worker || await newOcrWorker()));
          if (!p) throw new Error('unreadable');
          if (p.svat) r.svat = p.svat; if (p.catId) r.cat = p.catId; if (p.pay) r.pay = p.pay; if (p.unclear) { r.check = 'unclear'; r.msg = (r.msg + ' Looks hard to read.').trim(); } if (p.notReceipt) r.msg = (r.msg + ' Does not look like a receipt.').trim();
          if (p.merchant) r.merchant = p.merchant; if (p.amount) r.amount = p.amount.toFixed(2); if (p.date) r.date = p.date; if (p.vat) r.vat = p.vat.toFixed(2);
          if (p.currency && p.currency !== App.ws.currency) { r.currency = p.currency; try { r.fx = await fxRate(p.currency, App.ws.currency); } catch (e) { r.msg += ' Foreign currency — check the amount.'; } }
          const rule = ruleFor(r.merchant); if (rule && !r.cat) r.cat = rule.category_id;
          if (!r.amount) r.msg = (r.msg + ' Could not read the total — enter it.').trim();
        } else if (r.file.type === 'application/pdf') {
          const p = await readReceipt(r.file); if (!p) throw new Error('unreadable');
          if (p.merchant) r.merchant = p.merchant; if (p.amount) r.amount = p.amount.toFixed(2); if (p.date) r.date = p.date; if (p.vat) r.vat = p.vat.toFixed(2); if (p.svat) r.svat = p.svat; if (p.catId) r.cat = p.catId;
        } else r.msg = 'Not read automatically — enter the details.';
      } catch (e) { r.msg = 'Could not read this one — enter the details.'; }
      r.state = 'done'; drawBkSafe();
    }
  } finally { try { worker?.terminate(); } catch (e) { } BK.busy = false; drawBkSafe(true); }
}
function drawBkSafe(force) {   // don't redraw under the user's cursor while they are typing in a row
  const a = document.activeElement; if (!force && a && a.dataset && a.dataset.r) { $('#bk .note') && ($('#bk .note').textContent = `Reading receipts… ${BK.rows.filter(r => r.state === 'done').length} of ${BK.rows.length} done.`); return; }
  drawBk();
}
ACTIONS.bulkDrop = (t, ev) => { ev.preventDefault(); BK.rows = BK.rows.filter(r => r.id !== t.dataset.id); if (!BK.rows.length) return closeModal(); drawBk(); };
ACTIONS.bulkSave = wrap(async () => {
  if (BK.busy) return toast('Still reading — wait for it to finish', 'err');
  const left = []; let ok = 0;
  for (const r of BK.rows) {
    const amount = parseFloat(r.amount), offline = !navigator.onLine;
    if (offline && !(amount > 0 && (r.merchant || '').trim())) {      // photo only: queue it, it is read once back online
      try { await OFF.queue({ kind: 'expense', merchant: (r.merchant || '').trim() || 'Receipt to read', expense_date: r.date || today(), amount: amount > 0 ? amount : 0, currency: r.currency, fx_rate: r.fx || 1, category_id: r.cat || null, payment_method: r.pay || 'personal', supplier_vat_no: r.svat || null, vat_amount: r.vat === '' ? null : parseFloat(r.vat), receipt_check: r.check, notes: '', billable: false, customer: null, miles: null, from_loc: null, to_loc: null, trip_id: null }, r.file, true); ok++; } catch (e) { r.msg = e.message || 'Could not keep it on this device'; left.push(r); }
      continue;
    }
    if (!(amount > 0) || !(r.merchant || '').trim()) { r.msg = 'Needs a merchant and an amount.'; left.push(r); continue; }
    const row = { kind: 'expense', merchant: r.merchant.trim(), expense_date: r.date || today(), amount, currency: r.currency, fx_rate: r.fx || 1, category_id: r.cat || null, payment_method: r.pay || 'personal', supplier_vat_no: r.svat || null, vat_amount: r.vat === '' ? null : parseFloat(r.vat), receipt_check: r.check, notes: '', billable: false, customer: null, miles: null, from_loc: null, to_loc: null, trip_id: null }, nid = uuid();
    try {
      const path = await uploadReceipt(r.file), hash = uploadReceipt.last?.hash || null;
      await q(sb.from('exp_expenses').insert({ ...row, id: nid, workspace_id: App.ws.id, user_id: App.user.id, receipt_path: path, receipt_hash: hash })); learnMerchant(row.merchant, row.category_id, false);
      ok++;
    } catch (e) {
      if (isNetErr(e)) { try { await OFF.queue(row, r.file, false, nid); ok++; continue; } catch (e2) { /* fall through */ } }
      r.msg = e.message || 'Could not save'; left.push(r);
    }
  }
  BK.rows = left;
  await OFF.refresh(); if (ok) toast(ok + (navigator.onLine ? ' expense(s) saved' : ' expense(s) saved on this device — they sync when you are online'));
  if (left.length) { toast(left.length + ' still need attention', 'err'); drawBk(); } else closeModal();
  rerender();
});
ACTIONS.xSave = wrap(async () => {
  readX();
  const e = X, offline = !navigator.onLine;
  const canDefer = e.kind === 'expense' && e.file && offline;            // photo only: it will be read once back online
  let needsRead = false;
  if (e.kind === 'per_diem') { e.amount = ((parseFloat(e.days) || 0) * (parseFloat(e.rate) || 0)).toFixed(2); e.merchant = e.merchant || 'Per diem'; if (e.days) e.notes = `${e.days} day(s) @ ${e.rate}. ${e.notes || ''}`.trim(); }
  if (e.kind === 'mileage') { e.miles = (parseFloat(e.miles) || 0) * (e.roundTrip ? 2 : 1); e.merchant = e.from_loc && e.to_loc ? `${e.from_loc} → ${e.to_loc}` : 'Mileage'; e.amount = 0; if (!(e.miles > 0)) return toast('Enter the miles', 'err'); if (!(e.from_loc || '').trim() || !(e.to_loc || '').trim()) return toast('Enter where the journey started and ended (required for mileage records)', 'err'); if (!(e.notes || '').trim()) return toast('Enter the business purpose of the journey', 'err'); }
  else if (!(parseFloat(e.amount) > 0)) { if (canDefer) needsRead = true; else return toast('Enter an amount', 'err'); }
  if (e.kind === 'expense' && !e.merchant) { if (canDefer) { e.merchant = 'Receipt to read'; needsRead = true; } else return toast('Enter a merchant', 'err'); }
  const base = {
    kind: e.kind, merchant: e.merchant, expense_date: e.expense_date, amount: parseFloat(e.amount) || 0, currency: e.currency, fx_rate: e.fx_rate || 1,
    category_id: e.category_id || null, notes: e.notes, billable: e.billable, customer: e.billable ? e.customer : null, payment_method: e.payment_method,
    miles: e.kind === 'mileage' ? e.miles : null, from_loc: e.from_loc || null, to_loc: e.to_loc || null,
    vat_amount: e.vat_amount === '' ? null : parseFloat(e.vat_amount), trip_id: e.trip_id || null, supplier_vat_no: (e.supplier_vat_no || '').trim() || null,
    receipt_check: e.file ? (e.receipt_check || 'ok') : (e.receipt_path ? e.receipt_check || null : null)
  };
  const nid = uuid();
  const keepLocal = async () => {                                         // save on this device; it syncs when the signal is back
    if (e.qid) { const it = (await OFF.all()).find(i => i.id === e.qid); if (it) { it.payload = base; it.file = e.file || null; it.needsRead = needsRead; it.state = 'queued'; it.err = ''; it.up = null; await OFF.put(it); } }
    else await OFF.queue(base, e.file, needsRead, nid);
    await OFF.refresh(); closeModal(); toast(navigator.onLine ? 'Saved — syncing…' : 'Saved on this device — it will sync when you are back online'); rerender(); if (navigator.onLine) OFF.sync();
  };
  if (e.qid || (!e.id && offline)) return keepLocal();
  if (e.id && offline) return toast("You're offline — changes to saved expenses need a connection", 'err');
  const btn = $('[data-act=xSave]'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const payload = { ...base };
    if (e.file) { e.receipt_path = await uploadReceipt(e.file); e.receipt_hash = uploadReceipt.last?.hash || null; }
    payload.receipt_path = e.receipt_path || null; payload.receipt_hash = e.receipt_path ? e.receipt_hash || null : null;
    if (e.id) await q(sb.from('exp_expenses').update(payload).eq('id', e.id));
    else await q(sb.from('exp_expenses').insert({ ...payload, id: nid, workspace_id: App.ws.id, user_id: App.user.id }));
    if (e.kind === 'expense') learnMerchant(e.merchant, e.category_id, e.billable);
    closeModal(); toast('Saved'); rerender();
  } catch (err) {
    if (!e.id && isNetErr(err)) return keepLocal();                       // signal dropped mid-save
    throw err;
  } finally { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } }
});
ACTIONS.xDelete = async () => {
  if (!await confirmBox('Delete this expense?', 'Delete', true)) return;
  if (X.qid) { await OFF.del(X.qid); await OFF.refresh(); closeModal(); toast('Deleted'); return rerender(); }
  await q(sb.from('exp_expenses').delete().eq('id', X.id)); closeModal(); toast('Deleted'); rerender();
};

/* ---------- chat (comments) shared by expenses and reports ---------- */
let CHAT = null;
async function loadChat(kind, id) {
  CHAT = { kind, id };
  const col = kind === 'expense' ? 'expense_id' : 'report_id';
  const rows = await q(sb.from('exp_comments').select('*').eq(col, id).order('created_at'));
  const box = $('#x_chat') || $('#r_chat'); if (!box) return;
  box.innerHTML = rows.length ? rows.map(c => `<div class="msg ${c.user_id === App.user.id ? 'me' : ''}"><div class="sub"><b>${esc(c.author_name || memberName(c.user_id))}</b> · ${dtfmt(c.created_at)}</div>${esc(c.body)}</div>`).join('') : '<div class="sub">No messages yet.</div>';
  box.scrollTop = box.scrollHeight;
}
ACTIONS.xSend = wrap(async () => {
  const inp = $('#x_msg') || $('#r_msg'); const body = inp.value.trim(); if (!body || !CHAT) return;
  await q(sb.from('exp_comments').insert({ workspace_id: App.ws.id, [CHAT.kind === 'expense' ? 'expense_id' : 'report_id']: CHAT.id, body }));
  inp.value = ''; await loadChat(CHAT.kind, CHAT.id);
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target.id === 'x_msg' || e.target.id === 'r_msg')) { e.preventDefault(); ACTIONS.xSend(); } });
