/* Expenses: list, filters, bulk actions, add/edit form, receipt scan (OCR), comments, exports */
const EX = { rows: [], reps: {}, trips: [], sel: new Set(), f: { q: '', status: '', cat: '', who: '', from: '', to: '', flagged: false } };

const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
const expStatus = e => e.report_id ? (EX.reps[e.report_id]?.status || 'draft') : 'unreported';
const canEditExpense = e => !e.id || ((e.user_id === App.user.id && ['unreported', 'draft', 'rejected'].includes(expStatus(e))) || isFinance());

async function fetchExpenses(opts = {}) {
  let qy = sb.from('exp_expenses').select('*').eq('workspace_id', App.ws.id).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000);
  if (opts.from) qy = qy.gte('expense_date', opts.from);
  if (opts.to) qy = qy.lte('expense_date', opts.to);
  const [rows, reps] = await Promise.all([q(qy), q(sb.from('exp_reports').select('id,name,status,user_id').eq('workspace_id', App.ws.id))]);
  EX.rows = rows; EX.reps = Object.fromEntries(reps.map(r => [r.id, r]));
  return rows;
}

/* ---------- list view ---------- */
VIEWS.expenses = async el => {
  await fetchExpenses();
  EX.trips = await q(sb.from('exp_trips').select('id,name,status,user_id').eq('workspace_id', App.ws.id).order('start_date', { ascending: false }));
  el.innerHTML = `
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
    <button class="btn ghost" data-act="scanExpense">📷 Scan receipt</button>
    <button class="btn ghost" data-act="newMileage">🚗 Mileage</button>
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
    <div class="thumb" style="--c:${esc(c?.color || '#9ca3af')}">${e.kind === 'mileage' ? '🚗' : e.kind === 'per_diem' ? '📅' : e.receipt_path ? '📎' : '🧾'}</div>
    <div class="grow"><b>${esc(e.merchant || (e.kind === 'mileage' ? 'Mileage' : 'Expense'))}</b>
      <span class="sub">${dfmt(e.expense_date)} · ${esc(c?.name || 'Uncategorised')}${isManager() ? ' · ' + esc(memberName(e.user_id)) : ''}${e.billable ? ' · Billable' : ''}</span>
      <div>${flagHTML(e.flags)}</div></div>
    <div class="right"><div class="amt">${money(e.amount_base)}</div>${foreign ? `<div class="sub">${money(e.amount, e.currency)}</div>` : ''}${pill(st)}</div></div>`;
}
function drawExpenseList() {
  const l = filteredExpenses();
  $('#exlist').innerHTML = l.length ? l.map(e => expenseRow(e, true)).join('') + `<div class="item foot"><span class="grow">${l.length} expense(s)</span><b>${money(sum(l, e => e.amount_base))}</b></div>` : '<div class="empty">No expenses match. Tap “+ New expense” or scan a receipt.</div>';
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
ACTIONS.scanExpense = () => { openExpense(); setTimeout(() => $('#x_file')?.click(), 150); };
ACTIONS.openExpense = (t) => openExpense(t.dataset.id);

async function openExpense(id, kind) {
  if (id) {
    const e = EX.rows.find(r => r.id === id) || await q(sb.from('exp_expenses').select('*').eq('id', id).single());
    X = { ...blankExpense(e.kind), ...e, category_id: e.category_id || '', trip_id: e.trip_id || '', vat_amount: e.vat_amount ?? '', miles: e.miles ?? '', file: null, roundTrip: false };
    if (!EX.reps[e.report_id] && e.report_id) { const r = await q(sb.from('exp_reports').select('id,name,status,user_id').eq('id', e.report_id).single()); EX.reps[r.id] = r; }
  } else X = blankExpense(kind || 'expense');
  if (!EX.trips.length) EX.trips = await q(sb.from('exp_trips').select('id,name,status,user_id').eq('workspace_id', App.ws.id));
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
  modal(`<div class="row between"><h2>${e.id ? 'Expense' : 'New expense'} ${e.id ? pill(expStatus(e)) : ''}</h2><button class="btn ghost sm" data-act="close">✕</button></div>
  ${e.id && e.user_id !== App.user.id ? `<p class="sub">Submitted by ${esc(memberName(e.user_id))}</p>` : ''}
  ${rep?.status === 'rejected' ? '<div class="note">This report was rejected — fix the expense and resubmit.</div>' : ''}
  ${(e.flags || []).length ? `<div class="note">${flagHTML(e.flags)}</div>` : ''}
  <div class="seg">${[['expense', 'Expense'], ['mileage', 'Mileage'], ['per_diem', 'Per diem']].map(([k, n]) => `<button data-act="xKind" data-v="${k}" class="${e.kind === k ? 'on' : ''}" ${e.id ? 'disabled' : ''}>${n}</button>`).join('')}</div>
  <fieldset ${dis} style="border:0;padding:0;margin:0">
  ${e.kind === 'mileage' ? `
    <div class="two"><div><label>From</label><input id="x_from" value="${esc(e.from_loc)}"></div><div><label>To</label><input id="x_to" value="${esc(e.to_loc)}"></div></div>
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
    ${e.file ? `<div class="sub">📎 ${esc(e.file.name)} ready to upload</div>` : e.receipt_path ? `<div class="sub">📎 Receipt attached — <a href="#" data-act="xView">view</a>${e.receipt_uploaded_at ? ' · stored ' + new Date(e.receipt_uploaded_at).toLocaleString('en-GB') : ''}</div>` : '<div class="sub">No receipt attached</div>'}
    <div class="row wrap gap" style="justify-content:center;margin-top:8px">
      <button type="button" class="btn ghost sm" data-act="xPick">📷 Take photo / upload</button>
      ${e.file && e.file.type.startsWith('image/') ? '<button type="button" class="btn sm" data-act="xScan">✨ Scan & autofill</button>' : ''}
      ${(e.file || e.receipt_path) ? '<button type="button" class="btn ghost sm" data-act="xRemoveFile">Remove</button>' : ''}
    </div><input type="file" id="x_file" accept="image/*,application/pdf" capture="environment" hidden>
    <div id="x_ocr" class="sub"></div></div>`}
  </fieldset>
  <div class="row wrap gap end" style="margin-top:16px">
    ${e.id && ed ? '<button class="btn ghost danger-t" data-act="xDelete" style="margin-right:auto">Delete</button>' : ''}
    <button class="btn ghost" data-act="close">${ed ? 'Cancel' : 'Close'}</button>${ed ? '<button class="btn" data-act="xSave">Save</button>' : ''}
  </div>
  ${e.id ? '<hr><h3>Chat</h3><div id="x_chat" class="chat"><div class="sub">Loading…</div></div><div class="row gap" style="margin-top:8px"><input id="x_msg" placeholder="Ask or answer a question about this expense…"><button class="btn sm" data-act="xSend">Send</button></div>' : ''}`, { wide: false });
  wireExpenseForm(); if (e.id) loadChat('expense', e.id);
}
function wireExpenseForm() {
  const g = id => $(id);
  g('#x_bill')?.addEventListener('change', ev => { $('#x_custbox').hidden = !ev.target.checked; });
  g('#x_cur')?.addEventListener('change', async ev => {
    $('#x_fxbox').hidden = ev.target.value === App.ws.currency;
    if (ev.target.value !== App.ws.currency) { try { $('#x_fx').value = await fxRate(ev.target.value, App.ws.currency); } catch (e) { toast('Enter the rate manually', 'err'); } } else $('#x_fx').value = 1;
  });
  g('#x_merchant')?.addEventListener('input', debounce(() => {
    if (X.kind !== 'expense') return;
    const m = ($('#x_merchant').value || '').toLowerCase(); if (!m) return;
    const r = App.rules.find(r => m.includes(r.match_text.toLowerCase()));
    if (r && !$('#x_cat').value) { $('#x_cat').value = r.category_id; if (r.billable) { $('#x_bill').checked = true; $('#x_custbox').hidden = false; } $('#x_sugg').textContent = '✨ Auto-categorised from your rules'; }
  }, 300));
  const mil = () => { readX(); const el = $('#x_est'); if (el) el.textContent = 'Estimated: ' + money(estimateMileage()) + ' (HMRC-style rates applied by the server)'; };
  ['#x_miles', '#x_rt'].forEach(s => g(s)?.addEventListener('input', mil));
  const pd = () => { const d = parseFloat($('#x_days').value) || 0, r = parseFloat($('#x_rate').value) || 0; $('#x_amount').value = (d * r).toFixed(2); };
  ['#x_days', '#x_rate'].forEach(s => g(s)?.addEventListener('input', pd));
  g('#x_file')?.addEventListener('change', ev => {
    const f = ev.target.files[0]; if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast('File is over 15MB', 'err');
    readX(); X.file = f; X.receipt_check = 'ok'; drawExpenseForm();
    checkReceiptImage(f).then(r => {
      if (X.file !== f) return;
      X.receipt_check = r.ok ? 'ok' : 'unclear';
      const out = $('#x_ocr'); if (out && !r.ok) out.innerHTML = '<div class="note bad" style="text-align:left">⚠ ' + r.problems.map(esc).join('<br>⚠ ') + '<br>You can still save it, but retake the photo and keep the paper receipt if it is hard to read.</div>';
    });
  });
}
ACTIONS.xKind = t => { readX(); X.kind = t.dataset.v; if (X.kind === 'mileage') X.category_id = App.cats.find(c => c.is_mileage)?.id || ''; drawExpenseForm(); };
ACTIONS.xPick = () => $('#x_file').click();
ACTIONS.xView = (t, ev) => {
  ev.preventDefault(); const p = X.receipt_path;
  viewFile(p, `<p class="sub" style="margin-top:6px">Stored ${X.receipt_uploaded_at ? new Date(X.receipt_uploaded_at).toLocaleString('en-GB') : ''} · fingerprint (SHA-256) ${X.receipt_hash ? esc(X.receipt_hash.slice(0, 16)) + '…' : 'n/a'}</p>`);
};
ACTIONS.xRemoveFile = () => { readX(); X.file = null; X.receipt_path = null; drawExpenseForm(); };
ACTIONS.xVat = (t, ev) => { ev.preventDefault(); const a = parseFloat($('#x_amount').value) || 0; $('#x_vat').value = (a - a / 1.2).toFixed(2); };
ACTIONS.xFx = async (t, ev) => { ev.preventDefault(); const c = $('#x_cur').value; try { $('#x_fx').value = await fxRate(c, App.ws.currency); toast('Rate updated'); } catch (e) { fail(e); } };
ACTIONS.xScan = async () => {
  const out = $('#x_ocr'); out.textContent = 'Scanning receipt… (first scan downloads the reader, ~10s)';
  try {
    if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    const r = await Tesseract.recognize(X.file, 'eng');
    const p = parseReceipt(r.data.text); readX();
    if (p.merchant && !X.merchant) X.merchant = p.merchant;
    if (p.amount) X.amount = p.amount.toFixed(2);
    if (p.date) X.expense_date = p.date;
    if (p.vat) X.vat_amount = p.vat.toFixed(2);
    const rule = App.rules.find(r => (X.merchant || '').toLowerCase().includes(r.match_text.toLowerCase())); if (rule && !X.category_id) X.category_id = rule.category_id;
    drawExpenseForm(); $('#x_ocr').textContent = `✨ Filled in: ${[p.merchant && 'merchant', p.amount && 'amount', p.date && 'date', p.vat && 'VAT'].filter(Boolean).join(', ') || 'nothing found'} — please check.`;
  } catch (e) { out.textContent = ''; fail(e); }
};
function parseReceipt(text) {
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean), out = {};
  out.merchant = (lines.find(l => /[A-Za-z]{3,}/.test(l) && !/^\d/.test(l) && !/receipt|invoice|tel|vat reg|www\./i.test(l)) || '').replace(/[^\w &'.-]/g, '').trim().slice(0, 50);
  const d = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/), d2 = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (d) { let [, dd, mm, yy] = d; yy = yy.length === 2 ? '20' + yy : yy; const iso = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`; if (!isNaN(new Date(iso))) out.date = iso; } else if (d2) out.date = d2[0];
  const num = s => { const m = s.match(/(\d{1,5}[.,]\d{2})(?!\d)/g); return m ? m.map(x => parseFloat(x.replace(',', '.'))) : []; };
  const tl = lines.filter(l => /total|amount due|balance due|to pay|card payment|sale/i.test(l) && !/sub ?total|vat/i.test(l)).flatMap(num);
  out.amount = tl.length ? Math.max(...tl) : Math.max(0, ...num(text)) || null;
  const vl = lines.filter(l => /vat/i.test(l)).flatMap(num); if (vl.length) out.vat = Math.min(...vl.filter(v => !out.amount || v < out.amount));
  return out;
}
ACTIONS.xSave = wrap(async () => {
  readX();
  const e = X;
  if (e.kind === 'per_diem') { e.amount = ((parseFloat(e.days) || 0) * (parseFloat(e.rate) || 0)).toFixed(2); e.merchant = e.merchant || 'Per diem'; if (e.days) e.notes = `${e.days} day(s) @ ${e.rate}. ${e.notes || ''}`.trim(); }
  if (e.kind === 'mileage') { e.miles = (parseFloat(e.miles) || 0) * (e.roundTrip ? 2 : 1); e.merchant = e.from_loc && e.to_loc ? `${e.from_loc} → ${e.to_loc}` : 'Mileage'; e.amount = 0; if (!(e.miles > 0)) return toast('Enter the miles', 'err'); if (!(e.from_loc || '').trim() || !(e.to_loc || '').trim()) return toast('Enter where the journey started and ended (required for mileage records)', 'err'); if (!(e.notes || '').trim()) return toast('Enter the business purpose of the journey', 'err'); }
  else if (!(parseFloat(e.amount) > 0)) return toast('Enter an amount', 'err');
  if (e.kind === 'expense' && !e.merchant) return toast('Enter a merchant', 'err');
  const btn = $('[data-act=xSave]'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (e.file) { e.receipt_path = await uploadReceipt(e.file); e.receipt_hash = uploadReceipt.last?.hash || null; }
    const payload = {
      kind: e.kind, merchant: e.merchant, expense_date: e.expense_date, amount: parseFloat(e.amount) || 0, currency: e.currency, fx_rate: e.fx_rate || 1,
      category_id: e.category_id || null, notes: e.notes, billable: e.billable, customer: e.billable ? e.customer : null, payment_method: e.payment_method,
      receipt_path: e.receipt_path || null, miles: e.kind === 'mileage' ? e.miles : null, from_loc: e.from_loc || null, to_loc: e.to_loc || null,
      vat_amount: e.vat_amount === '' ? null : parseFloat(e.vat_amount), trip_id: e.trip_id || null,
      supplier_vat_no: (e.supplier_vat_no || '').trim() || null, receipt_hash: e.receipt_path ? (e.file ? e.receipt_hash : e.receipt_hash || null) : null, receipt_check: e.receipt_path ? (e.file ? e.receipt_check : e.receipt_check || null) : null
    };
    if (e.id) await q(sb.from('exp_expenses').update(payload).eq('id', e.id));
    else await q(sb.from('exp_expenses').insert({ ...payload, workspace_id: App.ws.id, user_id: App.user.id }));
    closeModal(); toast('Saved'); rerender();
  } finally { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } }
});
ACTIONS.xDelete = async () => {
  if (!await confirmBox('Delete this expense?', 'Delete', true)) return;
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
