/* Team, settings (policy, categories, rules), audit log */

/* ---------- team ---------- */
VIEWS.team = async el => {
  const [members, invites] = await Promise.all([
    q(sb.from('exp_members').select('*').eq('workspace_id', App.ws.id).order('created_at')),
    isAdmin() ? q(sb.from('exp_invites').select('*').eq('workspace_id', App.ws.id).eq('accepted', false)) : []
  ]);
  App.members = members; const ad = isAdmin();
  const roles = ['member', 'approver', 'finance', 'admin'];
  el.innerHTML = `${ad ? `<div class="card" style="margin-bottom:14px"><h3>Invite a colleague</h3>
    <div class="toolbar" style="margin:8px 0 0"><input id="inv_email" type="email" placeholder="colleague@company.com"><select id="inv_role">${roles.map(r => `<option>${r}</option>`).join('')}</select><button class="btn" data-act="invite">Invite</button></div>
    <p class="sub" style="margin-top:6px">They sign up (or sign in) with this email address at the app URL and are added automatically. No email is sent by the app — use the share button to send them the link.</p>
    ${invites.length ? '<div style="margin-top:10px">' + invites.map(i => `<div class="row between gap" style="padding:6px 0;border-top:1px solid var(--line)"><span>${esc(i.email)} <span class="sub">· ${i.role}</span></span><span><a href="#" data-act="shareInvite" data-email="${esc(i.email)}">share</a> · <a href="#" data-act="revokeInvite" data-id="${i.id}">revoke</a></span></div>`).join('') + '</div>' : ''}</div>` : ''}
  <div class="card nopad"><table><tr><th>Name</th><th>Role</th><th>Department</th><th class="r">Monthly limit</th><th></th></tr>
  ${members.map(m => `<tr data-uid="${m.user_id}"><td><b>${esc(m.display_name || '')}</b><div class="sub">${esc(m.email || '')}</div></td>
    <td>${ad ? `<select class="m_role">${roles.map(r => `<option ${m.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : esc(m.role)}</td>
    <td>${ad ? `<input class="m_dept" value="${esc(m.department || '')}">` : esc(m.department || '')}</td>
    <td class="r">${ad ? `<input class="m_lim" type="number" step="10" value="${m.monthly_limit ?? ''}" placeholder="none" style="width:100px">` : m.monthly_limit ? money(m.monthly_limit) : '—'}</td>
    <td>${ad ? `<button class="btn sm ghost" data-act="saveMember" data-uid="${m.user_id}">Save</button> <button class="btn sm ghost danger-t" data-act="removeMember" data-uid="${m.user_id}">Remove</button>` : ''}</td></tr>`).join('')}</table></div>
  <div class="card" style="margin-top:14px"><h3>What each role can do</h3><ul class="sub" style="padding-left:18px;margin-top:6px">
    <li><b>Member</b> – add expenses, bills and invoices, submit own reports.</li><li><b>Approver</b> – also see team spend and approve or reject reports and bills.</li>
    <li><b>Finance</b> – also mark reports/bills paid, manage categories, rules and budgets.</li><li><b>Admin</b> – everything, plus team, roles and workspace policy.</li></ul></div>`;
};
ACTIONS.invite = wrap(async () => {
  const email = $('#inv_email').value.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid email', 'err');
  await q(sb.from('exp_invites').upsert({ workspace_id: App.ws.id, email, role: $('#inv_role').value, accepted: false }, { onConflict: 'workspace_id,email' }));
  toast('Invite created — share the link with them'); rerender();
});
ACTIONS.shareInvite = (t, ev) => { ev.preventDefault(); const url = location.origin + location.pathname; location.href = `mailto:${encodeURIComponent(t.dataset.email)}?subject=${encodeURIComponent('Join ' + App.ws.name + ' on FlexiExpenseHub')}&body=${encodeURIComponent(`I've invited you to ${App.ws.name} on FlexiExpenseHub.\n\nOpen ${url}, choose "Create account" and sign up with this email address (${t.dataset.email}). You'll be added to the workspace automatically.`)}`; };
ACTIONS.revokeInvite = wrap(async (t, ev) => { ev.preventDefault(); await q(sb.from('exp_invites').delete().eq('id', t.dataset.id)); rerender(); });
ACTIONS.saveMember = wrap(async t => {
  const tr = t.closest('tr'), lim = $('.m_lim', tr).value;
  await q(sb.from('exp_members').update({ role: $('.m_role', tr).value, department: $('.m_dept', tr).value || null, monthly_limit: lim === '' ? null : parseFloat(lim) }).eq('workspace_id', App.ws.id).eq('user_id', t.dataset.uid));
  toast('Saved'); await reloadWorkspace(); renderShell(); rerender();
});
ACTIONS.removeMember = async t => {
  if (!await confirmBox(`Remove ${memberName(t.dataset.uid)} from this workspace? Their expenses stay on record.`, 'Remove', true)) return;
  await q(sb.from('exp_members').delete().eq('workspace_id', App.ws.id).eq('user_id', t.dataset.uid));
  toast('Removed'); if (t.dataset.uid === App.user.id) location.reload(); else { await reloadWorkspace(); rerender(); }
};

/* ---------- settings ---------- */
VIEWS.settings = async el => {
  const w = App.ws, fin = isFinance(), ad = isAdmin(), me = App.me;
  el.innerHTML = `
  <div class="grid2"><div class="card"><h3>My profile</h3>
    <label>Display name</label><input id="p_name" value="${esc(me.display_name || '')}"><label>Department</label><input id="p_dept" value="${esc(me.department || '')}">
    <div class="row gap" style="margin-top:12px"><button class="btn" data-act="saveProfile">Save</button><button class="btn ghost" data-act="changePw">Change password</button></div></div>
  <div class="card"><h3>Appearance</h3><label>Theme</label><select id="p_theme"><option value="auto">Match my device</option><option value="light">Light</option><option value="dark">Dark</option></select>
    <p class="sub" style="margin-top:10px">Signed in as ${esc(App.user.email)}</p><button class="btn ghost" data-act="signOut" style="margin-top:6px">Sign out</button></div></div>
  ${ad ? `<div class="card" style="margin-top:14px"><h3>Workspace policy</h3>
    <div class="two"><div><label>Workspace name</label><input id="w_name" value="${esc(w.name)}"></div><div><label>Currency</label><select id="w_cur">${[...new Set([w.currency, ...CURRENCIES])].map(c => `<option ${w.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
    <div class="grid3"><div><label>Mileage rate (per mile)</label><input id="w_mr" type="number" step="0.001" value="${w.mileage_rate}"></div><div><label>Rate after threshold</label><input id="w_mr2" type="number" step="0.001" value="${w.mileage_rate_after}"></div><div><label>Threshold (miles / tax year)</label><input id="w_mt" type="number" value="${w.mileage_threshold}"></div></div>
    <div class="grid3"><div><label>Receipt required above</label><input id="w_rc" type="number" step="0.01" value="${w.receipt_required_over}"></div><div><label>Flag expenses over</label><input id="w_fl" type="number" step="1" value="${w.flag_over}"></div><div><label>Default VAT %</label><input id="w_vat" type="number" step="0.5" value="${w.vat_rate}"></div></div>
    <div class="two"><div><label>Invoice prefix</label><input id="w_ip" value="${esc(w.invoice_prefix)}"></div><div><label>Company VAT number</label><input id="w_vatno" value="${esc(w.vat_number || '')}" placeholder="GB123456789"></div></div>
    <div class="two"><div><label>Keep records for (years, minimum 6)</label><input id="w_ret" type="number" min="6" step="1" value="${w.retention_years || 6}"></div><div></div></div>
    <label>Company details (shown on invoices)</label><textarea id="w_co" rows="3" placeholder="Company name, address, VAT number, bank details">${esc(w.company_details || '')}</textarea>
    <button class="btn" style="margin-top:12px" data-act="saveWs">Save policy</button></div>` : ''}
  ${fin ? `<div class="card" style="margin-top:14px"><div class="row between"><h3>Categories</h3><button class="btn sm" data-act="newCat">+ Add</button></div>
    <table><tr><th>Name</th><th>GL code</th><th class="r">Limit per item</th><th>Receipt</th><th></th></tr>${App.cats.map(c => `<tr><td><span class="dot" style="background:${esc(c.color)}"></span> ${esc(c.name)}${c.is_mileage ? ' <span class="sub">(mileage)</span>' : ''}</td><td>${esc(c.gl_code || '')}</td><td class="r">${c.per_item_limit ? money(c.per_item_limit) : '—'}</td><td>${c.receipt_required ? 'Required' : 'Optional'}</td><td><a href="#" data-act="editCat" data-id="${c.id}">edit</a></td></tr>`).join('')}</table></div>
  <div class="card" style="margin-top:14px"><div class="row between"><h3>Auto-categorise rules</h3><button class="btn sm" data-act="newRule">+ Add</button></div>
    <p class="sub">When a merchant name contains the text, the category is filled in automatically (and the receipt scanner uses it too).</p>
    <table><tr><th>Merchant contains</th><th>Category</th><th>Billable</th><th></th></tr>${App.rules.map(r => `<tr><td>${esc(r.match_text)}</td><td>${esc(catName(r.category_id))}</td><td>${r.billable ? 'Yes' : ''}</td><td><a href="#" data-act="delRule" data-id="${r.id}">delete</a></td></tr>`).join('') || '<tr><td colspan="4" class="sub">No rules</td></tr>'}</table></div>` : ''}
  <div class="card" style="margin-top:14px"><h3>Records &amp; privacy</h3>
    <ul class="sub" style="margin:6px 0 10px 18px;line-height:1.6">
      <li>Receipt images are stored privately, time-stamped, fingerprinted (SHA-256) and cannot be edited or replaced once a report is submitted.</li>
      <li>Submitted and approved expenses, reports, bills and invoices cannot be deleted for <b>${w.retention_years || 6} years</b> (HMRC requires business records to be kept for at least 6 years).</li>
      <li>Every change after submission is written to the audit log.</li>
    </ul>
    <div class="row wrap gap"><button class="btn ghost" data-act="exportMine">Download my data</button><button class="btn ghost" data-act="privacyInfo">Privacy &amp; records notice</button></div></div>
  ${ad ? `<div class="card" style="margin-top:14px"><h3>Danger zone</h3><p class="sub">A workspace can only be deleted once it holds no submitted, approved or paid records inside the retention period. Export your records first.</p><button class="btn danger" data-act="delWs">Delete workspace</button></div>` : ''}`;
  const th = $('#p_theme'); th.value = localStorage.getItem('eh_theme') || 'auto'; th.onchange = e => setTheme(e.target.value);
};
ACTIONS.saveProfile = wrap(async () => {
  await q(sb.from('exp_members').update({ display_name: $('#p_name').value.trim() || null, department: $('#p_dept').value.trim() || null }).eq('workspace_id', App.ws.id).eq('user_id', App.user.id));
  await reloadWorkspace(); renderShell(); toast('Profile saved');
});
ACTIONS.changePw = () => showSetPassword();
ACTIONS.exportMine = wrap(async () => {
  const rows = await q(sb.from('exp_expenses').select('*').eq('workspace_id', App.ws.id).eq('user_id', App.user.id).order('expense_date'));
  download(`my-expenses-${today()}.csv`, toCSV([['Date', 'Type', 'Merchant', 'Amount', 'Currency', 'VAT', 'Supplier VAT no.', 'Notes', 'Receipt stored (UTC)', 'Receipt SHA-256'], ...rows.map(e => [e.expense_date, e.kind, e.merchant, e.amount, e.currency, e.vat_amount ?? '', e.supplier_vat_no || '', e.notes, e.receipt_uploaded_at || '', e.receipt_hash || ''])]));
});
ACTIONS.privacyInfo = () => modal(`<div class="row between"><h2>Privacy &amp; records notice</h2><button class="btn ghost sm" data-act="close">✕</button></div>
  <p><b>What is held:</b> your name, work email, expense details (merchant, date, amount, VAT, notes, journeys) and photos of receipts you upload.</p>
  <p><b>Why:</b> to reimburse you, keep the accounting records the company must keep by law, and support VAT and tax returns.</p>
  <p><b>Who sees it:</b> you, your approvers and the finance team of your workspace. Data is held in the company's own database account and protected by access rules.</p>
  <p><b>How long:</b> at least ${App.ws.retention_years || 6} years (HMRC business record-keeping). Submitted records cannot be deleted before then, even on request; after that they can be removed.</p>
  <p><b>Your rights (UK GDPR):</b> you can download your data from Settings and ask your company's data controller to correct or erase data that is no longer needed.</p>
  <p class="sub">Digital receipt copies: HMRC accepts scanned or photographed records if they are a clear, complete and unaltered copy and are kept for the required period. Check with your accountant if unsure.</p>`);
ACTIONS.saveWs = wrap(async () => {
  const n = id => parseFloat($(id).value);
  await q(sb.from('exp_workspaces').update({ name: $('#w_name').value.trim() || App.ws.name, currency: $('#w_cur').value, mileage_rate: n('#w_mr'), mileage_rate_after: n('#w_mr2'), mileage_threshold: parseInt($('#w_mt').value), receipt_required_over: n('#w_rc'), flag_over: n('#w_fl'), vat_rate: n('#w_vat'), invoice_prefix: $('#w_ip').value, vat_number: $('#w_vatno').value.trim() || null, retention_years: Math.max(6, parseInt($('#w_ret').value) || 6), company_details: $('#w_co').value || null }).eq('id', App.ws.id));
  await reloadWorkspace(); renderShell(); toast('Policy saved');
});
ACTIONS.newCat = () => catForm();
ACTIONS.editCat = (t, ev) => { ev.preventDefault(); catForm(cat(t.dataset.id)); };
function catForm(c = {}) {
  modal(`<h2>${c.id ? 'Edit' : 'New'} category</h2><label>Name</label><input id="c_name" value="${esc(c.name || '')}" autofocus>
  <div class="two"><div><label>GL / account code</label><input id="c_gl" value="${esc(c.gl_code || '')}"></div><div><label>Colour</label><input id="c_col" type="color" value="${c.color || '#6b6b73'}" style="height:42px;padding:4px"></div></div>
  <div class="two"><div><label>Max per item (flag above)</label><input id="c_lim" type="number" step="1" value="${c.per_item_limit ?? ''}"></div><div><label>Receipt</label><select id="c_rc"><option value="1" ${c.receipt_required !== false ? 'selected' : ''}>Required</option><option value="0" ${c.receipt_required === false ? 'selected' : ''}>Optional</option></select></div></div>
  <label class="chk"><input type="checkbox" id="c_mile" ${c.is_mileage ? 'checked' : ''}> This is the mileage category</label>
  <div class="row gap end" style="margin-top:14px">${c.id ? `<button class="btn ghost danger-t" data-act="delCat" data-id="${c.id}" style="margin-right:auto">Delete</button>` : ''}<button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="saveCat" data-id="${c.id || ''}">Save</button></div>`);
}
ACTIONS.saveCat = wrap(async t => {
  const p = { name: $('#c_name').value.trim(), gl_code: $('#c_gl').value || null, color: $('#c_col').value, per_item_limit: $('#c_lim').value === '' ? null : parseFloat($('#c_lim').value), receipt_required: $('#c_rc').value === '1', is_mileage: $('#c_mile').checked };
  if (!p.name) return toast('Name required', 'err');
  if (t.dataset.id) await q(sb.from('exp_categories').update(p).eq('id', t.dataset.id)); else await q(sb.from('exp_categories').insert({ ...p, workspace_id: App.ws.id }));
  closeModal(); await reloadWorkspace(); rerender();
});
ACTIONS.delCat = async t => { if (!await confirmBox('Delete this category? Existing expenses become uncategorised.', 'Delete', true)) return; await q(sb.from('exp_categories').delete().eq('id', t.dataset.id)); closeModal(); await reloadWorkspace(); rerender(); };
ACTIONS.newRule = () => modal(`<h2>New rule</h2><label>Merchant contains</label><input id="r_text" placeholder="e.g. shell" autofocus>
  <label>Category</label><select id="r_cat">${App.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><label class="chk"><input type="checkbox" id="r_bill"> Mark as billable</label>
  <div class="row gap end" style="margin-top:14px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="saveRule">Save</button></div>`);
ACTIONS.saveRule = wrap(async () => {
  const m = $('#r_text').value.trim(); if (!m) return toast('Enter the text to match', 'err');
  await q(sb.from('exp_rules').insert({ workspace_id: App.ws.id, match_text: m, category_id: $('#r_cat').value, billable: $('#r_bill').checked })); closeModal(); await reloadWorkspace(); rerender();
});
ACTIONS.delRule = wrap(async (t, ev) => { ev.preventDefault(); await q(sb.from('exp_rules').delete().eq('id', t.dataset.id)); await reloadWorkspace(); rerender(); });
ACTIONS.delWs = async () => {
  if (!await confirmBox(`Delete workspace “${App.ws.name}” and all of its data? This cannot be undone.`, 'Delete everything', true)) return;
  await q(sb.from('exp_workspaces').delete().eq('id', App.ws.id)); localStorage.removeItem('eh_ws'); location.reload();
};

/* ---------- audit log ---------- */
VIEWS.audit = async el => {
  if (!isManager()) { el.innerHTML = '<div class="card">Managers only.</div>'; return; }
  const rows = await q(sb.from('exp_audit').select('*').eq('workspace_id', App.ws.id).order('created_at', { ascending: false }).limit(300));
  const nice = { exp_reports: 'Report', exp_expenses: 'Expense', exp_bills: 'Bill', exp_invoices: 'Invoice' };
  el.innerHTML = `<div class="card nopad"><table><tr><th>When</th><th>Who</th><th>What</th><th>Action</th></tr>${rows.map(r => `<tr><td>${dtfmt(r.created_at)}</td><td>${esc(memberName(r.user_id))}</td><td>${nice[r.entity] || r.entity}: ${esc(r.label || '')}</td><td>${esc(r.action)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No activity yet</td></tr>'}</table></div>`;
};
