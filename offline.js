/* Offline support: an outbox of new expenses kept on the device (IndexedDB) that syncs when the signal returns,
   a saved snapshot of the workspace so the app opens without a connection, and a status bar. */
const isNetErr = e => !navigator.onLine || /failed to fetch|networkerror|network request failed|load failed|fetch failed|network|timed? ?out|err_internet/i.test(String(e?.message || e || ''));
const isAuthErr = e => /jwt|token|expired|not authenticated|invalid claim/i.test(String(e?.message || e || '')) || e?.status === 401;

const OFF = {
  _db: null, busy: false, items: [],
  open() {
    return this._db || (this._db = new Promise((res, rej) => {
      const r = indexedDB.open('eh-offline', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction('outbox', mode), rq = fn(t.objectStore('outbox')); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  },
  all() { return this.tx('readonly', s => s.getAll()).then(r => r || []); },
  put(i) { return this.tx('readwrite', s => s.put(i)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
  async mine() { try { return (await this.all()).filter(i => App.user && i.user === App.user.id && App.ws && i.ws === App.ws.id).sort((a, b) => a.created - b.created); } catch (e) { return []; } },

  /* put a new expense in the outbox. file = the receipt photo (kept on the device until it uploads). */
  async queue(payload, file, needsRead, id) {
    const it = { id: id || uuid(), ws: App.ws.id, user: App.user.id, payload, file: file || null, needsRead: !!needsRead, up: null, created: Date.now(), state: 'queued', err: '' };
    await this.put(it); await this.refresh(); return it;
  },
  async refresh() { this.items = await this.mine(); this.bar(); },

  bar() {
    const b = $('#netbar'); if (!b) return;
    const n = this.items.length, bad = this.items.filter(i => i.state === 'error').length, off = !navigator.onLine || App.offline;
    if (!off && !n) { b.hidden = true; return; }
    b.hidden = false; b.className = off ? 'off' : (bad ? 'warn' : 'sync');
    b.innerHTML = off ? `${ic('offline', 16)} You're offline${n ? ` — ${n} waiting to sync` : ' — you can still add expenses, they will sync when you are back online'}`
      : `${ic('upload', 16)} ${n} waiting to sync${bad ? ` (${bad} need your attention)` : ''} <a href="#" data-act="syncNow">Sync now</a>`;
  },

  /* send queued items to the server, oldest first. Stops quietly if the connection drops. */
  async sync() {
    if (this.busy || !navigator.onLine || !App.user || !App.ws) return;
    this.busy = true; let done = 0, failed = 0;
    try {
      try { await sb.auth.getSession(); } catch (e) { }
      for (const it of await this.mine()) {
        if (it.state === 'error') continue;
        try {
          const p = { ...it.payload };
          if (it.needsRead && it.file && !(p.amount > 0)) {
            const r = await readReceipt(it.file).catch(() => null);
            if (r) {
              if (r.merchant) p.merchant = r.merchant; if (r.amount) p.amount = r.amount; if (r.date) p.expense_date = r.date; if (r.vat) p.vat_amount = r.vat; if (r.svat) p.supplier_vat_no = r.svat;
              if (r.catId && !p.category_id) p.category_id = r.catId; if (r.pay) p.payment_method = r.pay;
              if (r.currency && r.currency !== App.ws.currency) { p.currency = r.currency; try { p.fx_rate = await fxRate(r.currency, App.ws.currency); } catch (e) { } }
              if (r.unclear) p.receipt_check = 'unclear';
            }
            it.payload = { ...it.payload, ...p }; await this.put(it);
          }
          if (p.kind !== 'mileage' && !(p.amount > 0)) throw new Error('Could not read the total from this receipt — open it and enter the amount.');
          if (!p.merchant || p.merchant === 'Receipt to read') throw new Error('Open it and enter the merchant.');
          if (it.file && !it.up) { const path = await uploadReceipt(it.file); it.up = { path, hash: uploadReceipt.last?.hash || null }; await this.put(it); }
          if (it.up) { p.receipt_path = it.up.path; p.receipt_hash = it.up.hash; }
          const { error } = await sb.from('exp_expenses').insert({ ...p, id: it.id, workspace_id: it.ws, user_id: it.user });
          if (error && error.code !== '23505') throw error;           // 23505 = already saved on an earlier attempt
          await this.del(it.id); done++;
        } catch (e) {
          if (isNetErr(e) || isAuthErr(e)) break;                      // try again later
          it.state = 'error'; it.err = e.message || 'Could not save'; await this.put(it); failed++;
        }
      }
    } finally { this.busy = false; await this.refresh(); }
    if (done) { toast(done + ' offline expense(s) synced'); if (/^#\/(expenses|dashboard|reports)/.test(location.hash)) rerender(); }
    if (failed) toast(failed + ' need your attention', 'err');
  },

  /* ---- snapshot: lets the app open with no connection ---- */
  saveSnap() {
    try { localStorage.setItem('eh_snap', JSON.stringify({ user: { id: App.user.id, email: App.user.email }, workspaces: App.workspaces, ws: App.ws?.id, members: App.members, cats: App.cats, rules: App.rules })); } catch (e) { }
  },
  loadSnap(userId) {
    try {
      const s = JSON.parse(localStorage.getItem('eh_snap') || 'null'); if (!s || (userId && s.user.id !== userId)) return false;
      App.workspaces = s.workspaces; App.ws = s.workspaces.find(w => w.id === s.ws) || s.workspaces[0]; App.members = s.members; App.cats = s.cats; App.rules = s.rules;
      App.me = s.members.find(m => m.user_id === s.user.id) || { role: App.ws._role }; return !!App.ws;
    } catch (e) { return false; }
  },
  clearSnap() { try { localStorage.removeItem('eh_snap'); Object.keys(localStorage).filter(k => k.startsWith('eh_rows_')).forEach(k => localStorage.removeItem(k)); } catch (e) { } },
  /* who was signed in last (read straight from the stored session, because refreshing the token needs a connection) */
  storedUser() {
    try { const k = Object.keys(localStorage).find(x => /^sb-.*-auth-token$/.test(x)); const j = JSON.parse(localStorage.getItem(k) || 'null'); return j?.user || j?.currentSession?.user || null; } catch (e) { return null; }
  },
  cacheRows(ws, rows, reps) { try { localStorage.setItem('eh_rows_' + ws, JSON.stringify({ rows, reps, at: Date.now() })); } catch (e) { } },
  cachedRows(ws) { try { return JSON.parse(localStorage.getItem('eh_rows_' + ws) || 'null'); } catch (e) { return null; } },

  /* list of waiting items for the Expenses page */
  pendingHTML() {
    if (!this.items.length) return '';
    return `<div class="card nopad" style="margin-bottom:12px"><div class="item mhead"><b>Waiting to sync (${this.items.length})</b><span class="grow"></span>${navigator.onLine ? '<a href="#" data-act="syncNow">Sync now</a>' : '<span>offline</span>'}</div>${this.items.map(i => {
      const p = i.payload;
      return `<div class="item" data-act="openQueued" data-id="${i.id}"><div class="thumb" style="--c:#9ca3af">${i.file ? ic('clip', 20) : p.kind === 'mileage' ? ic('car', 20) : ic('receipt', 20)}</div>
      <div class="grow"><b>${esc(p.merchant && p.merchant !== 'Receipt to read' ? p.merchant : 'Receipt to read')}</b><span class="sub">${dfmt(p.expense_date)}${p.kind === 'mileage' ? ' · ' + p.miles + ' mi' : ''}${i.needsRead && !(p.amount > 0) ? ' · will be read when online' : ''}</span>
      ${i.state === 'error' ? `<div><span class="flag">${ic('warn', 14)} ${esc(i.err)}</span></div>` : ''}</div>
      <div class="right"><div class="amt">${p.amount > 0 ? money(p.amount, p.currency) : p.kind === 'mileage' ? '' : '—'}</div><span class="pill ${i.state === 'error' ? 'rejected' : 'queued'}">${i.state === 'error' ? 'needs details' : 'waiting'}</span></div></div>`;
    }).join('')}</div>`;
  }
};

ACTIONS.syncNow = async (t, ev) => { ev?.preventDefault(); if (!navigator.onLine) return toast('Still offline', 'err'); for (const i of await OFF.mine()) if (i.state === 'error') { /* leave for the user to fix */ } await OFF.sync(); };
ACTIONS.openQueued = async t => {
  const it = (await OFF.mine()).find(i => i.id === t.dataset.id); if (!it) return;
  const p = it.payload;
  X = { ...blankExpense(p.kind), ...p, category_id: p.category_id || '', trip_id: p.trip_id || '', vat_amount: p.vat_amount ?? '', miles: p.miles ?? '', amount: p.amount > 0 ? p.amount : '', file: it.file || null, qid: it.id, roundTrip: false, receipt_path: null };
  if (p.kind === 'mileage') X.miles = p.miles;
  drawExpenseForm();
};

function netEvents() {
  window.addEventListener('offline', () => { OFF.bar(); });
  window.addEventListener('online', async () => {
    OFF.bar();
    try {
      await sb.auth.getSession();
      if (App.offline) { App.offline = false; await reloadWorkspace(); renderShell(); }
    } catch (e) { /* stay in offline mode until the next try */ }
    await OFF.sync(); if (App.ws) rerender();
  });
  setInterval(() => { if (navigator.onLine && OFF.items.some(i => i.state !== 'error')) OFF.sync(); }, 45000);
}
netEvents();
