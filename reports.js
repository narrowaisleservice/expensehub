/* Reports, approvals/payments, travel */

/* ---------- my reports ---------- */
VIEWS.reports = async el => {
  const reps = await q(sb.from('exp_reports').select('*').eq('workspace_id', App.ws.id).eq('user_id', App.user.id).order('created_at', { ascending: false }));
  const exps = reps.length ? await q(sb.from('exp_expenses').select('report_id,amount_base,flags').in('report_id', reps.map(r => r.id))) : [];
  el.innerHTML = `<div class="row wrap gap" style="margin-bottom:12px"><button class="btn" data-act="newReport">+ New report</button><span class="sub">Group expenses into a report, then submit it for approval.</span></div>
  <div class="card nopad">${reps.length ? reps.map(r => {
    const items = exps.filter(e => e.report_id === r.id);
    return `<div class="item" data-act="openReport" data-id="${r.id}"><div class="thumb" style="--c:#0d9488">${ic('file', 20)}</div>
      <div class="grow"><b>${esc(r.name)}</b><span class="sub">${items.length} expense(s) · created ${dfmt(r.created_at)}${r.submitted_at ? ' · submitted ' + dfmt(r.submitted_at) : ''}</span>${r.status === 'rejected' && r.reject_reason ? `<div class="flag">Rejected: ${esc(r.reject_reason)}</div>` : ''}</div>
      <div class="right"><div class="amt">${money(sum(items, e => e.amount_base))}</div>${pill(r.status)}</div></div>`;
  }).join('') : '<div class="empty">No reports yet.</div>'}</div>`;
};
ACTIONS.newReport = async () => {
  const free = await q(sb.from('exp_expenses').select('*').eq('workspace_id', App.ws.id).eq('user_id', App.user.id).is('report_id', null).order('expense_date', { ascending: false }));
  const d = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  modal(`<h2>New report</h2><label>Report name</label><input id="nr_name" value="Expenses – ${d}" autofocus>
  <label>Choose expenses (${free.length} not yet in a report)</label>
  <div class="card nopad" style="max-height:320px;overflow:auto">${free.length ? free.map(e => `<label class="item" style="margin:0"><input type="checkbox" class="nr_chk" value="${e.id}" checked style="width:auto"><div class="grow"><b>${esc(e.merchant || e.kind)}</b><span class="sub">${dfmt(e.expense_date)} · ${esc(catName(e.category_id))}</span></div><div class="amt">${money(e.amount_base)}</div></label>`).join('') : '<div class="empty">Add some expenses first.</div>'}</div>
  <div class="row end gap" style="margin-top:14px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="createReport" ${free.length ? '' : 'disabled'}>Create report</button></div>`);
};
ACTIONS.createReport = wrap(async () => {
  const ids = $$('.nr_chk:checked').map(c => c.value); if (!ids.length) return toast('Select at least one expense', 'err');
  const r = await q(sb.from('exp_reports').insert({ workspace_id: App.ws.id, user_id: App.user.id, name: $('#nr_name').value.trim() || 'Expenses' }).select().single());
  await q(sb.from('exp_expenses').update({ report_id: r.id }).in('id', ids));
  closeModal(); toast('Report created'); rerender(); openReport(r.id);
});

/* ---------- report detail ---------- */
let CUR = null;
ACTIONS.openReport = t => openReport(t.dataset.id);
async function openReport(id) {
  const r = await q(sb.from('exp_reports').select('*').eq('id', id).single());
  const items = await q(sb.from('exp_expenses').select('*').eq('report_id', id).order('expense_date'));
  EX.reps[r.id] = r; CUR = { r, items };
  const mine = r.user_id === App.user.id, st = r.status, total = sum(items, e => e.amount_base);
  const flagged = items.filter(e => (e.flags || []).length).length, noRc = items.filter(e => (e.flags || []).includes('no_receipt')).length;
  const byCat = {}; items.forEach(e => byCat[catName(e.category_id)] = (byCat[catName(e.category_id)] || 0) + +e.amount_base);
  const canDecide = isManager() && st === 'submitted';
  modal(`<div id="rpt-print">
  <div class="row between"><div><h2>${esc(r.name)} ${pill(st)}</h2><p class="sub">${esc(memberName(r.user_id))} · created ${dfmt(r.created_at)}</p></div><button class="btn ghost sm no-print" data-act="close">${ic('x', 14)}</button></div>
  ${st === 'rejected' && r.reject_reason ? `<div class="note">Rejected: ${esc(r.reject_reason)}</div>` : ''}
  <table><tr><th>Date</th><th>Merchant</th><th>Category</th><th class="r">Amount</th><th class="no-print"></th></tr>
  ${items.map(e => `<tr><td>${dfmt(e.expense_date)}</td><td><a href="#" data-act="openExpFromReport" data-id="${e.id}">${esc(e.merchant || e.kind)}</a>${e.receipt_path ? ' ' + ic('clip', 13) : ''} <span class="no-print">${flagHTML(e.flags)}</span></td><td>${esc(catName(e.category_id))}</td><td class="r">${money(e.amount_base)}</td>
    <td class="no-print">${mine && ['draft', 'rejected'].includes(st) ? `<a href="#" data-act="removeFromReport" data-id="${e.id}" title="Remove from report">${ic('x', 14)}</a>` : ''}</td></tr>`).join('')}
  <tr><td colspan="3"><b>Total</b></td><td class="r"><b>${money(total)}</b></td><td class="no-print"></td></tr></table>
  <div class="two" style="margin-top:10px"><div class="sub">${items.filter(e => e.receipt_path).length}/${items.length} receipts attached${flagged ? ` · ${flagged} flagged` : ''}</div>
  <div class="sub" style="text-align:right">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${money(v)}`).join(' · ')}</div></div>
  <div class="timeline sub">Created ${dtfmt(r.created_at)}${r.submitted_at ? ` → Submitted ${dtfmt(r.submitted_at)}` : ''}${r.decided_at ? ` → ${st === 'rejected' ? 'Rejected' : 'Approved'} by ${esc(memberName(r.decided_by))} ${dtfmt(r.decided_at)}` : ''}${r.reimbursed_at ? ` → Reimbursed ${dtfmt(r.reimbursed_at)}${r.reimburse_ref ? ' (' + esc(r.reimburse_ref) + ')' : ''}` : ''}</div>
  <div id="rpt-receipts" class="print-only"></div></div>
  <div class="row wrap gap no-print" style="margin-top:14px">
    ${mine && ['draft', 'rejected'].includes(st) ? '<button class="btn" data-act="submitReport">Submit for approval</button>' : ''}
    ${mine && st === 'submitted' ? '<button class="btn ghost" data-act="recallReport">Recall to draft</button>' : ''}
    ${canDecide ? (App.ws.approval_threshold && App.me.role === 'approver' && sum(items, e => e.amount_base) > App.ws.approval_threshold ? `<div class="note">This report is over ${money(App.ws.approval_threshold)}, so it needs approval from Finance or an Admin.</div>` : '<button class="btn ok" data-act="approveReport">Approve</button>') + '<button class="btn ghost" data-act="rejectReport">Reject…</button>' : ''}
    ${isFinance() && st === 'approved' ? '<button class="btn ok" data-act="payReport">Mark reimbursed</button>' : ''}
    <button class="btn ghost" data-act="printReport">Print / PDF</button>
    <select id="rp_fmt"><option value="xlsx">Excel</option><option value="zip">Excel + receipts (ZIP)</option><option value="generic">CSV</option></select><button class="btn ghost" data-act="exportReport">Export</button>
    ${mine && ['draft', 'rejected'].includes(st) ? '<button class="btn ghost danger-t" data-act="deleteReport" style="margin-left:auto">Delete</button>' : ''}
  </div>
  <div class="no-print"><hr><h3>Chat</h3><div id="r_chat" class="chat"></div><div class="row gap" style="margin-top:8px"><input id="r_msg" placeholder="Message about this report…"><button class="btn sm" data-act="xSend">Send</button></div></div>`, { wide: true });
  loadChat('report', id);
}
ACTIONS.openExpFromReport = (t, ev) => { ev.preventDefault(); const e = CUR.items.find(i => i.id === t.dataset.id); if (!EX.rows.find(r => r.id === e.id)) EX.rows.push(e); openExpense(e.id); };
ACTIONS.removeFromReport = wrap(async (t, ev) => { ev.preventDefault(); await q(sb.from('exp_expenses').update({ report_id: null }).eq('id', t.dataset.id)); openReport(CUR.r.id); });
const setReport = async (patch, msg) => { await q(sb.from('exp_reports').update(patch).eq('id', CUR.r.id)); toast(msg); await openReport(CUR.r.id); refreshBadges(); };
ACTIONS.submitReport = async () => {
  const noRc = CUR.items.filter(e => (e.flags || []).includes('no_receipt')).length;
  if (!CUR.items.length) return toast('Add expenses first', 'err');
  if (noRc && !await confirmBox(`${noRc} expense(s) have no receipt. Submit anyway?`, 'Submit anyway')) return;
  await setReport({ status: 'submitted' }, 'Submitted for approval');
};
ACTIONS.recallReport = () => setReport({ status: 'draft' }, 'Recalled to draft');
ACTIONS.approveReport = () => setReport({ status: 'approved' }, 'Approved');
ACTIONS.rejectReport = async () => { const why = await askText('Reject report', 'Reason (the employee will see this)', 'e.g. Missing receipt for the hotel', 'Reject'); if (why) await setReport({ status: 'rejected', reject_reason: why }, 'Rejected'); };
ACTIONS.payReport = async () => { const ref = await askText('Mark as reimbursed', 'Payment reference (optional)', 'e.g. BACS 05/10', 'Mark paid', true); if (ref !== null) await setReport({ status: 'reimbursed', reimburse_ref: ref }, 'Marked reimbursed'); };
ACTIONS.deleteReport = async () => { if (!await confirmBox('Delete this report? The expenses stay and go back to unreported.', 'Delete', true)) return; await q(sb.from('exp_reports').delete().eq('id', CUR.r.id)); closeModal(); toast('Deleted'); rerender(); };
ACTIONS.exportReport = () => { const f = $('#rp_fmt').value; if (f === 'xlsx' || f === 'zip') return exportPack(CUR.items, `Report: ${CUR.r.name}`, f === 'zip'); EX.trips = EX.trips || []; download(`report-${CUR.r.name.replace(/\W+/g, '-')}-${f}.csv`, toCSV(expenseRows(CUR.items, f))); };
ACTIONS.printReport = async () => {
  const box = $('#rpt-receipts'); box.innerHTML = '';
  const withR = CUR.items.filter(e => e.receipt_path && !/\.pdf$/i.test(e.receipt_path));
  if (withR.length) {
    box.innerHTML = '<h3 style="margin-top:20px">Receipts</h3>' + (await Promise.all(withR.map(async e => `<figure><img src="${await signedUrl(e.receipt_path)}"><figcaption>${esc(e.merchant)} · ${dfmt(e.expense_date)} · ${money(e.amount_base)}</figcaption></figure>`))).join('');
    await Promise.all([...box.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  }
  window.print();
};

/* ---------- approvals & payments (managers) ---------- */
const AP = { tab: 'submitted', sel: new Set() };
VIEWS.approvals = async el => {
  if (!isManager()) { el.innerHTML = '<div class="card">Managers only.</div>'; return; }
  const sts = AP.tab === 'paid' ? ['reimbursed'] : [AP.tab];
  const reps = await q(sb.from('exp_reports').select('*').eq('workspace_id', App.ws.id).in('status', sts).order('submitted_at', { ascending: false }).limit(200));
  const exps = reps.length ? await q(sb.from('exp_expenses').select('report_id,amount_base,flags').in('report_id', reps.map(r => r.id))) : [];
  AP.reps = reps; AP.tot = Object.fromEntries(reps.map(r => [r.id, sum(exps.filter(e => e.report_id === r.id), e => e.amount_base)]));
  AP.sel.clear();
  el.innerHTML = `<div class="seg" style="max-width:520px">${[['submitted', 'Awaiting approval'], ['approved', 'Ready to pay'], ['paid', 'Paid']].map(([k, n]) => `<button data-act="apTab" data-v="${k}" class="${AP.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
  <div class="row wrap gap" style="margin:12px 0">
    ${AP.tab === 'submitted' ? '<button class="btn ok sm" data-act="bulkApprove">Approve selected</button>' : ''}
    ${AP.tab === 'approved' && isFinance() ? '<button class="btn ok sm" data-act="bulkPay">Mark selected paid</button><button class="btn ghost sm" data-act="payFile">Download payment file (CSV)</button>' : ''}
  </div>
  <div class="card nopad">${reps.length ? reps.map(r => {
    const fl = exps.filter(e => e.report_id === r.id && (e.flags || []).length).length;
    return `<div class="item" data-act="openReport" data-id="${r.id}">${AP.tab !== 'paid' ? `<input type="checkbox" class="selbox" data-act="apSel" data-id="${r.id}">` : ''}
      <div class="thumb" style="--c:#0d9488">${ic('file', 20)}</div><div class="grow"><b>${esc(r.name)}</b><span class="sub">${esc(memberName(r.user_id))} · ${r.submitted_at ? 'submitted ' + dfmt(r.submitted_at) : ''}</span>${fl ? `<div class="flag">${ic('warn', 14)} ${fl} flagged expense(s)</div>` : ''}</div>
      <div class="right"><div class="amt">${money(AP.tot[r.id])}</div>${pill(r.status)}</div></div>`;
  }).join('') : `<div class="empty">Nothing here.</div>`}</div>`;
};
ACTIONS.apTab = t => { AP.tab = t.dataset.v; rerender(); };
ACTIONS.apSel = (t, ev) => { ev.stopPropagation(); t.checked ? AP.sel.add(t.dataset.id) : AP.sel.delete(t.dataset.id); };
ACTIONS.bulkApprove = wrap(async () => {
  if (!AP.sel.size) return toast('Select reports first', 'err');
  if (!await confirmBox(`Approve ${AP.sel.size} report(s)?`, 'Approve')) return;
  const res = await Promise.all([...AP.sel].map(id => sb.from('exp_reports').update({ status: 'approved' }).eq('id', id)));
  const bad = res.find(r => r.error); if (bad) toast(bad.error.message, 'err'); else toast('Approved'); rerender();
});
ACTIONS.bulkPay = wrap(async () => {
  if (!AP.sel.size) return toast('Select reports first', 'err');
  const ref = await askText('Mark as reimbursed', 'Payment reference (optional)', 'e.g. BACS run 05/10', 'Mark paid', true); if (ref === null) return;
  const res = await Promise.all([...AP.sel].map(id => sb.from('exp_reports').update({ status: 'reimbursed', reimburse_ref: ref }).eq('id', id)));
  const bad = res.find(r => r.error); if (bad) toast(bad.error.message, 'err'); else toast('Marked reimbursed'); rerender();
});
ACTIONS.payFile = () => {
  const by = {}; AP.reps.forEach(r => by[r.user_id] = (by[r.user_id] || 0) + AP.tot[r.id]);
  download(`payments-${today()}.csv`, toCSV([['Payee', 'Email', 'Amount', 'Currency', 'Reference'], ...Object.entries(by).map(([u, a]) => [memberName(u), member(u)?.email || '', a.toFixed(2), App.ws.currency, 'Expenses ' + today()])]));
};

/* ---------- travel (trips) ---------- */
VIEWS.trips = async el => {
  const trips = await q(sb.from('exp_trips').select('*').eq('workspace_id', App.ws.id).order('start_date', { ascending: false, nullsFirst: false }));
  const exps = trips.length ? await q(sb.from('exp_expenses').select('trip_id,amount_base').in('trip_id', trips.map(t => t.id))) : [];
  el.innerHTML = `<div class="row wrap gap" style="margin-bottom:12px"><button class="btn" data-act="newTrip">+ New trip</button><span class="sub">Group flights, hotels, mileage and meals per trip. Pick the trip on each expense.</span></div>
  <div class="card nopad">${trips.length ? trips.map(t => {
    const its = exps.filter(e => e.trip_id === t.id);
    const spentT = sum(its, e => e.amount_base);
    return `<div class="item" data-act="openTrip" data-id="${t.id}"><div class="thumb" style="--c:#3e4d9c">${ic('trip', 20)}</div><div class="grow"><b>${esc(t.name)}</b>${t.budget ? `<span class="sub">Budget ${money(t.budget)}${spentT > t.budget ? ' · <span class="flag" style="margin:0">over by ' + money(spentT - t.budget) + '</span>' : ' · ' + money(t.budget - spentT) + ' left'}</span>` : ''}<span class="sub">${esc(t.destination || '')} ${t.start_date ? '· ' + dfmt(t.start_date) : ''}${t.end_date ? ' – ' + dfmt(t.end_date) : ''}${isManager() ? ' · ' + esc(memberName(t.user_id)) : ''}</span></div>
      <div class="right"><div class="amt">${money(sum(its, e => e.amount_base))}</div>${pill(t.status)}</div></div>`;
  }).join('') : '<div class="empty">No trips yet.</div>'}</div>`;
};
ACTIONS.newTrip = () => tripForm();
ACTIONS.openTrip = wrap(async t => {
  const trip = await q(sb.from('exp_trips').select('*').eq('id', t.dataset.id).single());
  const items = await q(sb.from('exp_expenses').select('*').eq('trip_id', trip.id).order('expense_date'));
  const byCat = {}; items.forEach(e => byCat[catName(e.category_id)] = (byCat[catName(e.category_id)] || 0) + +e.amount_base);
  const mine = trip.user_id === App.user.id || isManager();
  modal(`<div class="row between"><div><h2>${esc(trip.name)} ${pill(trip.status)}</h2><p class="sub">${esc(trip.destination || '')} ${trip.start_date ? '· ' + dfmt(trip.start_date) : ''}${trip.end_date ? ' – ' + dfmt(trip.end_date) : ''}</p>${trip.purpose ? `<p>${esc(trip.purpose)}</p>` : ''}</div><button class="btn ghost sm" data-act="close">${ic('x', 14)}</button></div>
  <div class="grid3"><div class="card stat"><small>Total${trip.budget ? ' of ' + money(trip.budget) : ''}</small><b${trip.budget && sum(items, e => e.amount_base) > trip.budget ? ' style="color:var(--accent)"' : ''}>${money(sum(items, e => e.amount_base))}</b></div><div class="card stat"><small>Expenses</small><b>${items.length}</b></div><div class="card stat"><small>Mileage</small><b>${sum(items, e => e.miles).toFixed(0)} mi</b></div></div>
  <div class="bars">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="b"><span class="n">${esc(k)}</span><span class="t"><i style="width:${v / Math.max(...Object.values(byCat)) * 100}%"></i></span><span class="v">${money(v)}</span></div>`).join('')}</div>
  <div class="card nopad" style="margin-top:12px">${items.length ? items.map(e => `<div class="item" data-act="openTripExp" data-id="${e.id}"><div class="grow"><b>${esc(e.merchant || e.kind)}</b><span class="sub">${dfmt(e.expense_date)} · ${esc(catName(e.category_id))}</span></div><div class="amt">${money(e.amount_base)}</div></div>`).join('') : '<div class="empty">No expenses on this trip yet.</div>'}</div>
  ${mine ? `<div class="row gap wrap" style="margin-top:14px"><button class="btn ghost" data-act="tripEdit" data-id="${trip.id}">Edit</button><button class="btn ghost" data-act="tripToggle" data-id="${trip.id}" data-st="${trip.status}">${trip.status === 'open' ? 'Close trip' : 'Reopen trip'}</button><button class="btn ghost danger-t" data-act="tripDelete" data-id="${trip.id}" style="margin-left:auto">Delete</button></div>` : ''}`, { wide: true });
  CUR = { trip, items };
});
ACTIONS.openTripExp = t => { const e = CUR.items.find(i => i.id === t.dataset.id); if (!EX.rows.find(r => r.id === e.id)) EX.rows.push(e); openExpense(e.id); };
ACTIONS.tripEdit = t => tripForm(CUR.trip);
function tripForm(tr = {}) {
  modal(`<h2>${tr.id ? 'Edit trip' : 'New trip'}</h2><label>Name</label><input id="t_name" value="${esc(tr.name || '')}" placeholder="e.g. Leeds customer visit" autofocus>
  <label>Destination</label><input id="t_dest" value="${esc(tr.destination || '')}"><div class="two"><div><label>Start</label><input id="t_start" type="date" value="${tr.start_date || ''}"></div><div><label>End</label><input id="t_end" type="date" value="${tr.end_date || ''}"></div></div>
  <label>Purpose</label><textarea id="t_purpose" rows="2">${esc(tr.purpose || '')}</textarea>
  ${HAS.v8 ? `<label>Budget for the trip (optional)</label><input id="t_budget" type="number" min="0" step="1" value="${tr.budget ?? ''}" placeholder="e.g. 400">` : ''}
  <div class="row end gap" style="margin-top:14px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="saveTrip" data-id="${tr.id || ''}">Save</button></div>`);
}
ACTIONS.saveTrip = wrap(async t => {
  const name = $('#t_name').value.trim(); if (!name) return toast('Name required', 'err');
  const p = { name, destination: $('#t_dest').value || null, start_date: $('#t_start').value || null, end_date: $('#t_end').value || null, purpose: $('#t_purpose').value || null, ...($('#t_budget') ? { budget: parseFloat($('#t_budget').value) > 0 ? parseFloat($('#t_budget').value) : null } : {}) };
  if (t.dataset.id) await q(sb.from('exp_trips').update(p).eq('id', t.dataset.id)); else await q(sb.from('exp_trips').insert({ ...p, workspace_id: App.ws.id, user_id: App.user.id }));
  closeModal(); toast('Saved'); rerender();
});
ACTIONS.tripToggle = wrap(async t => { await q(sb.from('exp_trips').update({ status: t.dataset.st === 'open' ? 'closed' : 'open' }).eq('id', t.dataset.id)); closeModal(); rerender(); });
ACTIONS.tripDelete = async t => { if (!await confirmBox('Delete this trip? Expenses stay but lose the trip tag.', 'Delete', true)) return; await q(sb.from('exp_trips').delete().eq('id', t.dataset.id)); closeModal(); rerender(); };
