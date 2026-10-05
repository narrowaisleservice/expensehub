/* Flexi Expenses boot: auth, onboarding, theme, workspace switching, PWA */

/* ---------- theme ---------- */
function setTheme(mode) {
  localStorage.setItem('eh_theme', mode);
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', mode);
}
setTheme(localStorage.getItem('eh_theme') || 'auto');
$('#themeBtn').onclick = () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  setTheme(dark ? 'light' : 'dark');
};
$('#burger').onclick = () => document.body.classList.toggle('menu');

/* ---------- screens ---------- */
const show = id => ['auth', 'onboard', 'app'].forEach(s => { $('#' + s).hidden = s !== id; });
const showAuth = () => { App.user = null; App.ws = null; show('auth'); };
function showOnboarding() { show('onboard'); }
function showApp() { show('app'); renderShell(); if (!location.hash) location.hash = '#/dashboard'; route(); }

/* ---------- sign in / up ---------- */
let authMode = 'in';
$$('#authTabs button').forEach(b => b.onclick = () => {
  authMode = b.dataset.at; $$('#authTabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#a_go').textContent = authMode === 'in' ? 'Sign in' : 'Create account';
  $('#a_pw').autocomplete = authMode === 'in' ? 'current-password' : 'new-password'; $('#a_msg').hidden = true;
});
const authMsg = (m, err) => { const n = $('#a_msg'); n.hidden = false; n.textContent = m; n.className = 'note' + (err ? ' bad' : ''); };
$('#authForm').onsubmit = async e => {
  e.preventDefault(); const email = $('#a_email').value.trim(), password = $('#a_pw').value, btn = $('#a_go'); btn.disabled = true;
  try {
    if (authMode === 'in') {
      const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }); if (error) throw error;
      if (!data.session) authMsg('Account created. Check your email to confirm your address, then sign in.');
    }
  } catch (err) { authMsg(err.message, true); } finally { btn.disabled = false; }
};
$('#a_forgot').onclick = async e => {
  e.preventDefault(); const email = $('#a_email').value.trim(); if (!email) return authMsg('Enter your email above first.', true);
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  authMsg(error ? error.message : 'If that account exists, a reset link is on its way.', !!error);
};
$('#o_out').onclick = async e => { e.preventDefault(); await sb.auth.signOut(); };
ACTIONS.signOut = async () => {
  const n = (await OFF.mine()).length;
  if (n && !await confirmBox(`${n} expense(s) have not synced yet. They stay on this device and sync next time you sign in here. Sign out anyway?`, 'Sign out', true)) return;
  OFF.clearSnap(); await sb.auth.signOut(); location.hash = '';
};
$('#o_go').onclick = wrap(async () => {
  const name = $('#o_ws').value.trim(); if (!name) return toast('Enter a workspace name', 'err');
  $('#o_go').disabled = true;
  try { const id = await q(sb.rpc('exp_create_workspace', { p_name: name, p_display_name: $('#o_name').value.trim() || null })); localStorage.setItem('eh_ws', id); await start(App.user); }
  finally { $('#o_go').disabled = false; }
});

function showSetPassword() {
  modal(`<h2>Set a new password</h2><label>New password (min 8 characters)</label><input id="np1" type="password" minlength="8" autocomplete="new-password" autofocus>
  <div class="row end gap" style="margin-top:14px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="doSetPw">Update password</button></div>`);
}
ACTIONS.doSetPw = wrap(async () => {
  const p = $('#np1').value; if (p.length < 8) return toast('Use at least 8 characters', 'err');
  const { error } = await sb.auth.updateUser({ password: p }); if (error) throw error; closeModal(); toast('Password updated');
});

/* ---------- workspace switching ---------- */
$('#wsswitch').onchange = wrap(async e => {
  if (e.target.value === '__new') {
    e.target.value = App.ws.id;
    modal(`<h2>New workspace</h2><label>Name</label><input id="nw_name" autofocus><div class="row end gap" style="margin-top:14px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="doNewWs">Create</button></div>`);
    return;
  }
  await selectWorkspace(e.target.value); renderShell(); route();
});
ACTIONS.doNewWs = wrap(async () => {
  const n = $('#nw_name').value.trim(); if (!n) return;
  const id = await q(sb.rpc('exp_create_workspace', { p_name: n, p_display_name: App.me.display_name })); closeModal();
  await loadWorkspaces(); await selectWorkspace(id); renderShell(); location.hash = '#/dashboard'; route();
});

/* ---------- session lifecycle ---------- */
let starting = false;
async function start(user) {
  if (starting) return; starting = true;
  try {
    App.user = user;
    if (navigator.onLine) { try { await sb.rpc('exp_accept_invites'); } catch (e) { /* no invites */ } }
    const offlineStart = async e => { if (isNetErr(e) && OFF.loadSnap(user.id)) { App.offline = true; await OFF.refresh(); showApp(); OFF.bar(); return true; } return false; };
    try { await loadWorkspaces(); } catch (e) { if (await offlineStart(e)) return; throw e; }
    if (!App.workspaces.length) return showOnboarding();
    try { await selectWorkspace(localStorage.getItem('eh_ws')); } catch (e) { if (await offlineStart(e)) return; throw e; }
    App.offline = false; await OFF.refresh(); showApp(); OFF.sync(); fetchExpenses().catch(() => { });   // sync anything waiting, and keep a copy of the list for offline use
  } catch (e) { fail(e); showAuth(); } finally { starting = false; }
}
async function boot() {
  sb.auth.onAuthStateChange((ev, session) => {
    setTimeout(() => {
      if (ev === 'PASSWORD_RECOVERY') { App.user = session.user; start(session.user).then(showSetPassword); }
      else if (ev === 'SIGNED_OUT') { OFF.clearSnap(); showAuth(); }
      else if (ev === 'SIGNED_IN' && session && App.user?.id !== session.user.id) start(session.user);
    }, 0);
  });
  let session = null; try { session = (await sb.auth.getSession()).data.session; } catch (e) { /* offline */ }
  const stored = !session && !navigator.onLine ? OFF.storedUser() : null;     // opened with no signal: use the saved sign-in
  if (session) await start(session.user); else if (stored) await start(stored); else showAuth();
}
boot();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
