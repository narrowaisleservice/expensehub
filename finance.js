/* Dashboard, bill pay, invoices, budgets, analytics */

/* ---------- chart helpers ---------- */
function hbars(rows, fmt = money) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return rows.length ? `<div class="bars">${rows.map(r => `<div class="b"><span class="n" title="${esc(r.label)}">${esc(r.label)}</span><span class="t"><i style="width:${Math.max(1, r.value / max * 100)}%;${r.color ? `background:${esc(r.color)}` : ''}"></i></span><span class="v">${fmt(r.value)}</span></div>`).join('')}</div>` : '<div class="empty">No data</div>';
}
function vbars(rows) {
  const W = 560, H = 150, max = Math.max(1, ...rows.map(r => r.value)), bw = W / Math.max(1, rows.length);
  return `<svg viewBox="0 0 ${W} ${H + 26}" class="chart" role="img" aria-label="Trend chart">${rows.map((r, i) => {
    const h = r.value / max * H;
    return `<rect x="${i * bw + bw * .2}" y="${H - h}" width="${bw * .6}" height="${Math.max(1, h)}" rx="4" fill="var(--chart)"><title>${esc(r.label)}: ${money(r.value)}</title></rect><text x="${i * bw + bw / 2}" y="${H + 17}" text-anchor="middle" font-size="11" fill="var(--mute)">${esc(r.label)}</text>`;
  }).join('')}</svg>`;
}
const monthLabel = d => new Date(d + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'short' });
const stat = (label, val, sub = '', href = '') => `<${href ? 'a href="' + href + '"' : 'div'} class="card stat">${`<small>${label}</small><b>${val}</b>${sub ? `<span class="sub">${sub}</span>` : ''}`}</${href ? 'a' : 'div'}>`;

/* ---------- dashboard ---------- */
ACTIONS.gsHide = (t, ev) => { ev.preventDefault(); localStorage.setItem('eh_gs_' + App.ws.id, '1'); rerender(); };
VIEWS.dashboard = async el => {
  const start = new Date(); start.setMonth(start.getMonth() - 5, 1);
  const ms = monthStart(), uid = App.user.id;
  const mgr = isManager(), fin = isFinance();
  const [, mgrData] = await Promise.all([fetchExpenses({ from: isoDate(start) }), mgr ? Promise.all([
    sb.from('exp_reports').select('id', { count: 'exact', head: true }).eq('workspace_id', App.ws.id).eq('status', 'submitted'),
    sb.from('exp_reports').select('id', { count: 'exact', head: true }).eq('workspace_id', App.ws.id).eq('status', 'approved'),
    sb.from('exp_bills').select('amount,due_date,status').eq('workspace_id', App.ws.id).in('status', ['pending', 'approved']),
    sb.from('exp_invoices').select('total,due_date,status').eq('workspace_id', App.ws.id).eq('status', 'sent')
  ]).catch(() => null) : null]);
  const mine = EX.rows.filter(e => e.user_id === uid), monthMine = mine.filter(e => e.expense_date >= ms);
  const by = s => mine.filter(e => expStatus(e) === s);
  const noRc = mine.filter(e => ['unreported', 'draft', 'rejected'].includes(expStatus(e)) && (e.flags || []).includes('no_receipt')).length;
  const rejected = Object.values(EX.reps).filter(r => r.user_id === uid && r.status === 'rejected').length;
  const limit = App.me.monthly_limit, spent = sum(monthMine, e => e.amount_base);
  const catTot = {}; (mgr ? EX.rows : mine).filter(e => e.expense_date >= ms).forEach(e => catTot[e.category_id || ''] = (catTot[e.category_id || ''] || 0) + +e.amount_base);
  const months = []; for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i, 1); months.push(isoDate(d).slice(0, 7)); }
  const trend = months.map(m => ({ label: monthLabel(m), value: sum((mgr ? EX.rows : mine).filter(e => e.expense_date.startsWith(m)), e => e.amount_base) }));
  const unrep = mine.filter(e => expStatus(e) === 'unreported');
  const ready = unrep.length ? `<div class="card" style="margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div class="grow"><b style="white-space:normal;overflow:visible;text-overflow:clip">${unrep.length} expense${unrep.length > 1 ? 's' : ''} (${money(sum(unrep, e => e.amount_base))}) ready to claim</b><div class="sub">Put them in a report so they can be approved and paid.</div></div><button class="btn" data-act="submitAll">Create report</button></div>` : '';
  /* getting-started checklist for admins, until done or dismissed */
  let gs = '';
  if (isAdmin() && !localStorage.getItem('eh_gs_' + App.ws.id)) {
    const steps = [
      ['Add your company details and VAT number', !!(App.ws.company_details || App.ws.vat_number), '#/settings'],
      ['Check your mileage rates, limits and categories', false, '#/settings'],
      ['Invite your team', (App.members || []).length > 1, '#/team'],
      ['Scan your first receipt', EX.rows.length > 0, '#/expenses'],
      ['Install the app on your phone (browser menu → Install app)', matchMedia('(display-mode: standalone)').matches, '']];
    if (steps.filter(s => s[1]).length < steps.length)
      gs = `<div class="card" style="margin-bottom:14px"><div class="row between"><h3>Getting started</h3><a href="#" data-act="gsHide">hide</a></div>${steps.map(s => `<div style="padding:5px 0">${s[1] ? '✅' : '⬜'} ${s[2] ? `<a href="${s[2]}">${s[0]}</a>` : s[0]}</div>`).join('')}</div>`;
  }
  let mg = '';
  if (mgr && mgrData) {
    const [pend, appr, bills, invs] = mgrData, t = today();
    const bl = bills.data || [], iv = invs.data || [];
    const overBills = bl.filter(b => b.due_date && b.due_date < t), overInv = iv.filter(i => i.due_date && i.due_date < t);
    mg = `<h3 class="sec">Team</h3><div class="grid">
      ${stat('Awaiting your approval', pend.count || 0, 'reports', '#/approvals')}
      ${stat('Approved, ready to pay', appr.count || 0, 'reports', '#/approvals')}
      ${stat('Team spend this month', money(sum(EX.rows.filter(e => e.expense_date >= ms), e => e.amount_base)), 'all employees', '#/analytics')}
      ${fin ? stat('Bills to pay', money(sum(bl, b => b.amount)), `${bl.length} open${overBills.length ? ` · <span class="flag">${overBills.length} overdue</span>` : ''}`, '#/bills') : ''}
      ${fin ? stat('Invoices outstanding', money(sum(iv, i => i.total)), `${iv.length} sent${overInv.length ? ` · <span class="flag">${overInv.length} overdue</span>` : ''}`, '#/invoices') : ''}</div>`;
  }
  const alerts = [
    noRc ? `📎 ${noRc} expense(s) need a receipt` : '', rejected ? `↩ ${rejected} report(s) were rejected — fix and resubmit` : '',
    limit && spent > limit ? `🚫 You are over your monthly limit (${money(spent)} of ${money(limit)})` : ''].filter(Boolean);
  el.innerHTML = `${gs}${ready}${alerts.length ? `<div class="note" style="margin-bottom:12px">${alerts.map(a => `<div>${a}</div>`).join('')}</div>` : ''}
  <div class="row wrap gap" style="margin-bottom:14px"><button class="btn" data-act="newExpense">+ New expense</button><button class="btn ghost" data-act="scanExpense">📷 Scan receipt</button><button class="btn ghost" data-act="bulkScan">📚 Scan many</button><button class="btn ghost" data-act="newMileage">🚗 Mileage</button></div>
  <h3 class="sec">Me</h3><div class="grid">
    ${stat('Spent this month', money(spent), limit ? `of ${money(limit)} limit` : '')}
    ${stat('Not yet submitted', money(sum([...by('unreported'), ...by('draft')], e => e.amount_base)), '', '#/reports')}
    ${stat('Awaiting approval', money(sum(by('submitted'), e => e.amount_base)))}
    ${stat('Approved, to be paid to me', money(sum(by('approved'), e => e.amount_base)))}</div>
  ${limit ? `<div class="card" style="margin-bottom:14px"><small class="sub">Monthly limit</small><div class="meter"><i style="width:${Math.min(100, spent / limit * 100)}%" class="${spent > limit ? 'over' : spent > limit * .8 ? 'warn' : ''}"></i></div></div>` : ''}
  ${mg}
  <div class="grid2"><div class="card"><h3>${mgr ? 'Company' : 'My'} spend by category (this month)</h3>${hbars(Object.entries(catTot).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: catName(k), value: v, color: cat(k)?.color })))}</div>
  <div class="card"><h3>${mgr ? 'Company' : 'My'} spend – last 6 months</h3>${vbars(trend)}</div></div>
  <div class="card nopad" style="margin-top:14px"><h3 style="padding:14px 14px 0">Recent</h3>${mine.slice(0, 6).map(e => expenseRow(e)).join('') || '<div class="empty">No expenses yet — add your first one above.</div>'}</div>`;
};

/* ---------- bills (bill pay) ---------- */
const BL = { tab: 'pending', rows: [] };
VIEWS.bills = async el => {
  const rows = await q(sb.from('exp_bills').select('*').eq('workspace_id', App.ws.id).order('due_date', { nullsFirst: false }).limit(500));
  BL.rows = rows; const t = today();
  const list = rows.filter(b => b.status === BL.tab);
  el.innerHTML = `<div class="row wrap gap" style="margin-bottom:12px"><button class="btn" data-act="newBill">+ Capture bill</button>
    ${BL.tab === 'approved' && isFinance() ? '<button class="btn ghost" data-act="billRun">Download payment run (CSV)</button>' : ''}</div>
  <div class="seg" style="max-width:560px">${['pending', 'approved', 'paid', 'rejected'].map(s => `<button data-act="billTab" data-v="${s}" class="${BL.tab === s ? 'on' : ''}">${s} (${rows.filter(b => b.status === s).length})</button>`).join('')}</div>
  <div class="card nopad" style="margin-top:12px">${list.length ? list.map(b => {
    const od = b.due_date && b.due_date < t && ['pending', 'approved'].includes(b.status), soon = b.due_date && b.due_date >= t && b.due_date <= isoDate(Date.now() + 7 * 864e5);
    return `<div class="item" data-act="openBill" data-id="${b.id}"><div class="thumb" style="--c:#58286a">${b.file_path ? '📎' : '💷'}</div><div class="grow"><b>${esc(b.vendor)}</b><span class="sub">${esc(b.reference || '')} ${b.due_date ? '· due ' + dfmt(b.due_date) : ''} · ${esc(memberName(b.submitted_by))}</span>${od ? '<div class="flag">⚠ Overdue</div>' : soon ? '<div class="flag">Due within 7 days</div>' : ''}</div><div class="right"><div class="amt">${money(b.amount, b.currency)}</div>${pill(b.status)}</div></div>`;
  }).join('') : '<div class="empty">No bills here.</div>'}</div>`;
};
ACTIONS.billTab = t => { BL.tab = t.dataset.v; rerender(); };
ACTIONS.newBill = () => modal(`<h2>Capture bill</h2><label>Vendor / supplier</label><input id="b_vendor" autofocus>
  <div class="two"><div><label>Invoice / reference</label><input id="b_ref"></div><div><label>Amount (${App.ws.currency})</label><input id="b_amt" type="number" step="0.01" inputmode="decimal"></div></div>
  <label>Due date</label><input id="b_due" type="date"><label>Bill (photo or PDF)</label><input id="b_file" type="file" accept="image/*,application/pdf" capture="environment">
  <label>Notes</label><textarea id="b_notes" rows="2"></textarea>
  <div class="row end gap" style="margin-top:14px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="saveBill">Submit for approval</button></div>`);
ACTIONS.saveBill = wrap(async t => {
  const vendor = $('#b_vendor').value.trim(), amount = parseFloat($('#b_amt').value);
  if (!vendor || !(amount >= 0)) return toast('Vendor and amount are required', 'err');
  t.disabled = true; const f = $('#b_file').files[0];
  try {
    const file_path = f ? await uploadReceipt(f, 'bill-') : null;
    await q(sb.from('exp_bills').insert({ workspace_id: App.ws.id, submitted_by: App.user.id, vendor, reference: $('#b_ref').value || null, amount, currency: App.ws.currency, due_date: $('#b_due').value || null, notes: $('#b_notes').value || null, file_path }));
    closeModal(); toast('Bill submitted'); rerender();
  } finally { t.disabled = false; }
});
ACTIONS.openBill = t => {
  const b = BL.rows.find(x => x.id === t.dataset.id), mine = b.submitted_by === App.user.id;
  modal(`<div class="row between"><h2>${esc(b.vendor)} ${pill(b.status)}</h2><button class="btn ghost sm" data-act="close">✕</button></div>
  <table><tr><td>Amount</td><td class="r"><b>${money(b.amount, b.currency)}</b></td></tr><tr><td>Reference</td><td class="r">${esc(b.reference || '—')}</td></tr><tr><td>Due</td><td class="r">${b.due_date ? dfmt(b.due_date) : '—'}</td></tr><tr><td>Submitted by</td><td class="r">${esc(memberName(b.submitted_by))}</td></tr>${b.approved_by ? `<tr><td>Decided by</td><td class="r">${esc(memberName(b.approved_by))}</td></tr>` : ''}${b.paid_at ? `<tr><td>Paid</td><td class="r">${dfmt(b.paid_at)}</td></tr>` : ''}</table>
  ${b.notes ? `<p class="sub">${esc(b.notes)}</p>` : ''}${b.file_path ? `<p><a href="#" data-act="viewBillFile" data-p="${esc(b.file_path)}">📎 View attached bill</a></p>` : ''}
  <div class="row wrap gap" style="margin-top:14px">
    ${isManager() && b.status === 'pending' ? `<button class="btn ok" data-act="billSet" data-id="${b.id}" data-st="approved">Approve</button><button class="btn ghost" data-act="billSet" data-id="${b.id}" data-st="rejected">Reject</button>` : ''}
    ${isFinance() && b.status === 'approved' ? `<button class="btn ok" data-act="billSet" data-id="${b.id}" data-st="paid">Mark paid</button>` : ''}
    ${(mine && b.status === 'pending') || isAdmin() ? `<button class="btn ghost danger-t" data-act="billDelete" data-id="${b.id}" style="margin-left:auto">Delete</button>` : ''}</div>`);
};
ACTIONS.viewBillFile = (t, ev) => { ev.preventDefault(); viewFile(t.dataset.p); };
ACTIONS.billSet = wrap(async t => { await q(sb.from('exp_bills').update({ status: t.dataset.st }).eq('id', t.dataset.id)); closeModal(); toast('Updated'); rerender(); refreshBadges(); });
ACTIONS.billDelete = async t => { if (!await confirmBox('Delete this bill?', 'Delete', true)) return; await q(sb.from('exp_bills').delete().eq('id', t.dataset.id)); closeModal(); rerender(); };
ACTIONS.billRun = () => {
  const l = BL.rows.filter(b => b.status === 'approved');
  download(`bill-payment-run-${today()}.csv`, toCSV([['Payee', 'Reference', 'Due date', 'Amount', 'Currency'], ...l.map(b => [b.vendor, b.reference, b.due_date, Number(b.amount).toFixed(2), b.currency])]));
};

/* ---------- invoices ---------- */
const IV = { rows: [], cur: null };
const ivStatus = i => i.status === 'sent' && i.due_date && i.due_date < today() ? 'overdue' : i.status;
VIEWS.invoices = async el => {
  IV.rows = await q(sb.from('exp_invoices').select('*').eq('workspace_id', App.ws.id).order('created_at', { ascending: false }).limit(500));
  const o = IV.rows.filter(i => ['sent'].includes(i.status));
  el.innerHTML = `<div class="grid">${stat('Outstanding', money(sum(o, i => i.total)), o.length + ' sent')}${stat('Overdue', money(sum(o.filter(i => ivStatus(i) === 'overdue'), i => i.total)))}${stat('Paid (all time)', money(sum(IV.rows.filter(i => i.status === 'paid'), i => i.total)))}</div>
  <div class="row wrap gap" style="margin-bottom:12px"><button class="btn" data-act="newInvoice">+ New invoice</button></div>
  <div class="card nopad">${IV.rows.length ? IV.rows.map(i => `<div class="item" data-act="openInvoice" data-id="${i.id}"><div class="thumb" style="--c:#3e4d9c">🧮</div><div class="grow"><b>${esc(i.number)} · ${esc(i.client_name)}</b><span class="sub">Issued ${dfmt(i.issue_date)}${i.due_date ? ' · due ' + dfmt(i.due_date) : ''}</span></div><div class="right"><div class="amt">${money(i.total)}</div>${pill(ivStatus(i))}</div></div>`).join('') : '<div class="empty">No invoices yet.</div>'}</div>`;
};
ACTIONS.newInvoice = () => invoiceForm();
function invoiceForm(inv) {
  const i = inv || { items: [{ desc: '', qty: 1, unit_price: '' }], vat_rate: App.ws.vat_rate, issue_date: today(), due_date: isoDate(Date.now() + 30 * 864e5) };
  IV.cur = inv || null;
  const row = it => `<tr class="li"><td><input class="li_d" value="${esc(it.desc)}" placeholder="Description"></td><td style="width:70px"><input class="li_q" type="number" step="0.01" value="${esc(it.qty)}"></td><td style="width:110px"><input class="li_p" type="number" step="0.01" value="${esc(it.unit_price)}"></td><td class="li_t r" style="width:90px"></td><td style="width:28px"><a href="#" data-act="liDel">✕</a></td></tr>`;
  modal(`<div class="row between"><h2>${inv ? 'Edit ' + esc(inv.number) : 'New invoice'}</h2><button class="btn ghost sm" data-act="close">✕</button></div>
  <label>Client name</label><input id="i_client" value="${esc(i.client_name || '')}" autofocus><div class="two"><div><label>Client email</label><input id="i_email" value="${esc(i.client_email || '')}"></div><div><label>VAT %</label><input id="i_vat" type="number" step="0.5" value="${i.vat_rate}"></div></div>
  <label>Client address</label><textarea id="i_addr" rows="2">${esc(i.client_address || '')}</textarea>
  <div class="two"><div><label>Issue date</label><input id="i_issue" type="date" value="${i.issue_date}"></div><div><label>Due date</label><input id="i_due" type="date" value="${i.due_date || ''}"></div></div>
  <label>Line items</label><table id="i_items">${(i.items.length ? i.items : [{}]).map(row).join('')}</table>
  <a href="#" data-act="liAdd">+ Add line</a>
  <div class="right" id="i_tot" style="margin-top:8px"></div><label>Notes / payment terms</label><textarea id="i_notes" rows="2">${esc(i.notes || '')}</textarea>
  <div class="row end gap" style="margin-top:14px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="saveInvoice">Save</button></div>`, { wide: true });
  const calc = () => {
    if (!$('#i_items')) return;
    let s = 0; $$('#i_items .li').forEach(r => { const t = (parseFloat($('.li_q', r).value) || 0) * (parseFloat($('.li_p', r).value) || 0); $('.li_t', r).textContent = money(t); s += t; });
    const v = s * (parseFloat($('#i_vat').value) || 0) / 100; $('#i_tot').innerHTML = `Subtotal ${money(s)} · VAT ${money(v)} · <b>Total ${money(s + v)}</b>`;
  };
  $('#mc').oninput = calc; calc(); IV.row = row; IV.calc = calc;
}
ACTIONS.liAdd = (t, ev) => { ev.preventDefault(); $('#i_items').insertAdjacentHTML('beforeend', IV.row({ qty: 1, unit_price: '' })); IV.calc(); };
ACTIONS.liDel = (t, ev) => { ev.preventDefault(); if ($$('#i_items .li').length > 1) { t.closest('tr').remove(); IV.calc(); } };
ACTIONS.saveInvoice = wrap(async () => {
  const client = $('#i_client').value.trim(); if (!client) return toast('Client name required', 'err');
  const items = $$('#i_items .li').map(r => ({ desc: $('.li_d', r).value, qty: parseFloat($('.li_q', r).value) || 0, unit_price: parseFloat($('.li_p', r).value) || 0 })).filter(x => x.desc || x.unit_price);
  if (!items.length) return toast('Add at least one line', 'err');
  const p = { client_name: client, client_email: $('#i_email').value || null, client_address: $('#i_addr').value || null, issue_date: $('#i_issue').value, due_date: $('#i_due').value || null, vat_rate: parseFloat($('#i_vat').value) || 0, items, notes: $('#i_notes').value || null };
  if (IV.cur) await q(sb.from('exp_invoices').update(p).eq('id', IV.cur.id));
  else { const number = await q(sb.rpc('exp_next_invoice_number', { ws: App.ws.id })); await q(sb.from('exp_invoices').insert({ ...p, number, workspace_id: App.ws.id, created_by: App.user.id })); }
  closeModal(); toast('Invoice saved'); rerender();
});
ACTIONS.openInvoice = t => {
  const i = IV.rows.find(x => x.id === t.dataset.id); IV.cur = i; const st = ivStatus(i);
  const co = esc(App.ws.company_details || App.ws.name).replace(/\n/g, '<br>');
  modal(`<div id="rpt-print"><div class="row between"><div><h2>Invoice ${esc(i.number)}</h2><div class="sub">${co}</div></div><div class="right">${pill(st)}<div class="sub no-print"><button class="btn ghost sm" data-act="close">✕</button></div></div></div>
  <div class="two" style="margin:12px 0"><div><b>${esc(i.client_name)}</b><div class="sub">${esc(i.client_address || '').replace(/\n/g, '<br>')}</div></div><div class="right sub">Issued ${dfmt(i.issue_date)}<br>${i.due_date ? 'Due ' + dfmt(i.due_date) : ''}</div></div>
  <table><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>${i.items.map(x => `<tr><td>${esc(x.desc)}</td><td class="r">${x.qty}</td><td class="r">${money(x.unit_price)}</td><td class="r">${money(x.qty * x.unit_price)}</td></tr>`).join('')}
  <tr><td colspan="3" class="r">Subtotal</td><td class="r">${money(i.subtotal)}</td></tr><tr><td colspan="3" class="r">VAT ${i.vat_rate}%</td><td class="r">${money(i.vat)}</td></tr><tr><td colspan="3" class="r"><b>Total due</b></td><td class="r"><b>${money(i.total)}</b></td></tr></table>
  ${i.notes ? `<p class="sub" style="margin-top:10px">${esc(i.notes).replace(/\n/g, '<br>')}</p>` : ''}</div>
  <div class="row wrap gap no-print" style="margin-top:14px">
    ${i.status === 'draft' ? '<button class="btn" data-act="ivSet" data-st="sent">Mark as sent</button>' : ''}${['sent'].includes(i.status) ? '<button class="btn ok" data-act="ivSet" data-st="paid">Mark paid</button>' : ''}
    <button class="btn ghost" data-act="ivPrint">Print / PDF</button><button class="btn ghost" data-act="ivEmail">Email</button>
    ${i.status === 'draft' ? '<button class="btn ghost" data-act="ivEdit">Edit</button>' : ''}${i.status !== 'void' && i.status !== 'paid' ? '<button class="btn ghost" data-act="ivSet" data-st="void">Void</button>' : ''}
    ${i.status === 'draft' || isAdmin() ? '<button class="btn ghost danger-t" data-act="ivDelete" style="margin-left:auto">Delete</button>' : ''}</div>`, { wide: true });
};
ACTIONS.ivEdit = () => invoiceForm(IV.cur);
ACTIONS.ivPrint = () => window.print();
ACTIONS.ivEmail = () => { const i = IV.cur; location.href = `mailto:${encodeURIComponent(i.client_email || '')}?subject=${encodeURIComponent('Invoice ' + i.number + ' from ' + App.ws.name)}&body=${encodeURIComponent(`Hello,\n\nPlease find invoice ${i.number} for ${money(i.total)}${i.due_date ? ', due ' + dfmt(i.due_date) : ''}.\n\nPrint/save the invoice as PDF from Flexi Expenses and attach it before sending.\n\nThanks,\n${App.me.display_name || ''}`)}`; };
ACTIONS.ivSet = wrap(async t => { await q(sb.from('exp_invoices').update({ status: t.dataset.st }).eq('id', IV.cur.id)); closeModal(); toast('Updated'); rerender(); });
ACTIONS.ivDelete = async () => { if (!await confirmBox('Delete this invoice?', 'Delete', true)) return; await q(sb.from('exp_invoices').delete().eq('id', IV.cur.id)); closeModal(); rerender(); };

/* ---------- budgets ---------- */
VIEWS.budgets = async el => {
  const ms = monthStart();
  const [budgets] = await Promise.all([q(sb.from('exp_budgets').select('*').eq('workspace_id', App.ws.id).order('name')), fetchExpenses({ from: ms })]);
  const mgr = isManager(), mine = EX.rows.filter(e => e.user_id === App.user.id);
  const vis = mgr ? budgets : budgets.filter(b => b.user_id === App.user.id);
  const spentFor = b => sum(EX.rows.filter(e => (!b.category_id || e.category_id === b.category_id) && (!b.user_id || e.user_id === b.user_id)), e => e.amount_base);
  const limit = App.me.monthly_limit;
  el.innerHTML = `${isFinance() ? '<div class="row wrap gap" style="margin-bottom:12px"><button class="btn" data-act="newBudget">+ New budget</button><span class="sub">Monthly budgets by category and/or person. Spend resets each month.</span></div>' : ''}
  ${limit ? `<div class="card" style="margin-bottom:12px"><b>My monthly spending limit</b><div class="meter"><i style="width:${Math.min(100, sum(mine.filter(e => e.expense_date >= ms), e => e.amount_base) / limit * 100)}%"></i></div><span class="sub">${money(sum(mine.filter(e => e.expense_date >= ms), e => e.amount_base))} of ${money(limit)}</span></div>` : ''}
  <div class="grid2">${vis.length ? vis.map(b => {
    const s = spentFor(b), p = s / b.amount * 100;
    return `<div class="card"><div class="row between"><b>${esc(b.name)}</b>${isFinance() ? `<span><a href="#" data-act="editBudget" data-id="${b.id}">edit</a></span>` : ''}</div>
    <div class="sub">${b.category_id ? esc(catName(b.category_id)) : 'All categories'} · ${b.user_id ? esc(memberName(b.user_id)) : 'Everyone'}</div>
    <div class="meter"><i style="width:${Math.min(100, p)}%" class="${p > 100 ? 'over' : p > 80 ? 'warn' : ''}"></i></div>
    <div class="row between"><b>${money(s)}</b><span class="sub">of ${money(b.amount)} · ${p.toFixed(0)}%</span></div>${p > 100 ? '<div class="flag">⚠ Over budget</div>' : p > 80 ? '<div class="flag">Nearing limit</div>' : ''}</div>`;
  }).join('') : '<div class="card empty">No budgets set.</div>'}</div>`;
  BL.budgets = budgets;
};
ACTIONS.newBudget = () => budgetForm();
ACTIONS.editBudget = (t, ev) => { ev.preventDefault(); budgetForm(BL.budgets.find(b => b.id === t.dataset.id)); };
function budgetForm(b = {}) {
  modal(`<h2>${b.id ? 'Edit' : 'New'} budget</h2><label>Name</label><input id="bd_name" value="${esc(b.name || '')}" autofocus>
  <label>Monthly amount (${App.ws.currency})</label><input id="bd_amt" type="number" step="1" value="${b.amount || ''}">
  <label>Category (optional)</label><select id="bd_cat"><option value="">All categories</option>${App.cats.map(c => `<option value="${c.id}" ${b.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
  <label>Person (optional)</label><select id="bd_user"><option value="">Everyone</option>${App.members.map(m => `<option value="${m.user_id}" ${b.user_id === m.user_id ? 'selected' : ''}>${esc(m.display_name || m.email)}</option>`).join('')}</select>
  <div class="row gap end" style="margin-top:14px">${b.id ? `<button class="btn ghost danger-t" data-act="delBudget" data-id="${b.id}" style="margin-right:auto">Delete</button>` : ''}<button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="saveBudget" data-id="${b.id || ''}">Save</button></div>`);
}
ACTIONS.saveBudget = wrap(async t => {
  const p = { name: $('#bd_name').value.trim(), amount: parseFloat($('#bd_amt').value), category_id: $('#bd_cat').value || null, user_id: $('#bd_user').value || null };
  if (!p.name || !(p.amount > 0)) return toast('Name and amount required', 'err');
  if (t.dataset.id) await q(sb.from('exp_budgets').update(p).eq('id', t.dataset.id)); else await q(sb.from('exp_budgets').insert({ ...p, workspace_id: App.ws.id }));
  closeModal(); rerender();
});
ACTIONS.delBudget = async t => { if (!await confirmBox('Delete this budget?', 'Delete', true)) return; await q(sb.from('exp_budgets').delete().eq('id', t.dataset.id)); closeModal(); rerender(); };

/* ---------- analytics / report builder ---------- */
const AN = { preset: 'month', from: '', to: '', group: 'category', metric: 'sum', cat: '', who: '', bill: '', status: '' };
function presetRange(p) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth(), f = d => isoDate(d);
  if (p === 'month') return [f(new Date(y, m, 1)), f(new Date(y, m + 1, 0))];
  if (p === 'last') return [f(new Date(y, m - 1, 1)), f(new Date(y, m, 0))];
  if (p === 'quarter') { const qs = Math.floor(m / 3) * 3; return [f(new Date(y, qs, 1)), f(new Date(y, qs + 3, 0))]; }
  if (p === 'year') return [f(new Date(y, 0, 1)), f(new Date(y, 11, 31))];
  if (p === 'tax') { const s = n >= new Date(y, 3, 6) ? y : y - 1; return [f(new Date(s, 3, 6)), f(new Date(s + 1, 3, 5))]; }
  return [AN.from || '2000-01-01', AN.to || '2100-01-01'];
}
VIEWS.analytics = async el => {
  const [from, to] = presetRange(AN.preset);
  await fetchExpenses({ from, to });
  EX.trips = EX.trips.length ? EX.trips : await q(sb.from('exp_trips').select('id,name,status,user_id').eq('workspace_id', App.ws.id));
  const rows = EX.rows.filter(e => (!AN.cat || e.category_id === AN.cat) && (!AN.who || e.user_id === AN.who) && (!AN.bill || String(e.billable) === AN.bill) && (!AN.status || expStatus(e) === AN.status));
  const keyOf = { category: e => catName(e.category_id), member: e => memberName(e.user_id), merchant: e => e.merchant || '—', month: e => e.expense_date.slice(0, 7), status: e => expStatus(e), payment: e => e.payment_method, billable: e => e.billable ? 'Billable' : 'Non-billable', trip: e => EX.trips.find(t => t.id === e.trip_id)?.name || 'No trip', customer: e => e.customer || '—' }[AN.group];
  const g = {}; rows.forEach(e => { const k = keyOf(e); (g[k] = g[k] || []).push(e); });
  let out = Object.entries(g).map(([k, l]) => ({ label: AN.group === 'month' ? k : k, sum: sum(l, e => e.amount_base), count: l.length, avg: sum(l, e => e.amount_base) / l.length }));
  out.forEach(o => o.value = o[AN.metric]);
  out.sort((a, b) => AN.group === 'month' ? a.label.localeCompare(b.label) : b.value - a.value);
  const fmt = AN.metric === 'count' ? v => v : money;
  const total = sum(rows, e => e.amount_base), billable = sum(rows.filter(e => e.billable), e => e.amount_base);
  const opt = (arr, cur) => arr.map(([k, n]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${n}</option>`).join('');
  el.innerHTML = `<div class="grid">${stat('Total spend', money(total), `${rows.length} expenses`)}${stat('Average expense', money(rows.length ? total / rows.length : 0))}${stat('Billable', money(billable), total ? (billable / total * 100).toFixed(0) + '% of spend' : '')}${stat('Flagged', rows.filter(e => (e.flags || []).length).length, 'need attention')}</div>
  <div class="card" style="margin-bottom:12px"><h3>Report builder</h3><div class="toolbar" style="margin:8px 0 0">
    <select id="a_preset">${opt([['month', 'This month'], ['last', 'Last month'], ['quarter', 'This quarter'], ['tax', 'This tax year (6 Apr)'], ['year', 'This calendar year'], ['custom', 'Custom range']], AN.preset)}</select>
    ${AN.preset === 'custom' ? `<input type="date" id="a_from" value="${AN.from}"><input type="date" id="a_to" value="${AN.to}">` : ''}
    <select id="a_group">${opt([['category', 'Group by category'], ['member', 'by employee'], ['merchant', 'by merchant'], ['month', 'by month'], ['status', 'by status'], ['payment', 'by payment method'], ['billable', 'by billable'], ['trip', 'by trip'], ['customer', 'by customer']], AN.group)}</select>
    <select id="a_metric">${opt([['sum', 'Total spend'], ['count', 'Number of expenses'], ['avg', 'Average']], AN.metric)}</select>
    <select id="a_cat"><option value="">All categories</option>${App.cats.map(c => `<option value="${c.id}" ${AN.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    ${isManager() ? `<select id="a_who"><option value="">Everyone</option>${App.members.map(m => `<option value="${m.user_id}" ${AN.who === m.user_id ? 'selected' : ''}>${esc(m.display_name || m.email)}</option>`).join('')}</select>` : ''}
    <select id="a_bill">${opt([['', 'Billable or not'], ['true', 'Billable only'], ['false', 'Non-billable only']], AN.bill)}</select>
    <select id="a_status">${opt([['', 'Any status'], ...['unreported', 'draft', 'submitted', 'approved', 'rejected', 'reimbursed'].map(s => [s, s])], AN.status)}</select>
    <button class="btn ghost" data-act="anCsv">Export table</button></div></div>
  <div class="card">${AN.group === 'month' ? vbars(out.map(o => ({ label: monthLabel(o.label), value: o.value }))) : hbars(out.slice(0, 15), fmt)}</div>
  <div class="card nopad" style="margin-top:12px"><table><tr><th>${AN.group}</th><th class="r">Count</th><th class="r">Total</th><th class="r">Average</th></tr>${out.map(o => `<tr><td>${esc(o.label)}</td><td class="r">${o.count}</td><td class="r">${money(o.sum)}</td><td class="r">${money(o.avg)}</td></tr>`).join('')}</table></div>`;
  AN.out = out;
  const bind = (id, k) => { const n = $(id); if (n) n.onchange = e => { AN[k] = e.target.value; rerender(); }; };
  bind('#a_preset', 'preset'); bind('#a_group', 'group'); bind('#a_metric', 'metric'); bind('#a_cat', 'cat'); bind('#a_who', 'who'); bind('#a_bill', 'bill'); bind('#a_status', 'status'); bind('#a_from', 'from'); bind('#a_to', 'to');
};
ACTIONS.anCsv = () => download(`analytics-${AN.group}-${today()}.csv`, toCSV([[AN.group, 'Count', 'Total', 'Average'], ...AN.out.map(o => [o.label, o.count, o.sum.toFixed(2), o.avg.toFixed(2)])]));
