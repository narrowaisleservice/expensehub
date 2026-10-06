/* Mileage by phone location: Start → drive → Stop. Needs the app open (screen kept awake while tracking).
   Counts the distance the phone actually travelled, then opens a mileage claim with From / To / Miles filled in. */
const TRK = (() => {
  const KEY = 'eh_trk', MI = 1609.344;
  let st = null, watch = null, lock = null, bar = null;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const save = () => { try { st ? localStorage.setItem(KEY, JSON.stringify(st)) : localStorage.removeItem(KEY); } catch (e) { } };
  const hav = (a, b) => { const R = 6371000, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon), h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  function onFix(pos) {
    if (!st) return;
    const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy || 0, t: pos.timestamp || Date.now() };
    st.last = st.last || null;
    if (!st.start) { if (p.acc > 150) return; st.start = p; st.last = p; save(); draw(); return; }          // wait for a usable first fix
    if (p.acc > 60) return;                                                                                // too vague to trust
    const d = hav(st.last, p), dt = Math.max(1, (p.t - st.last.t) / 1000);
    if (d < Math.max(12, p.acc * .6)) return;                                                              // jitter while standing still
    if (d / dt > 60) return;                                                                               // > ~135 mph: a bad fix
    st.dist += d; st.last = p; save(); draw();
  }
  function begin() {
    if (!navigator.geolocation) return toast('This phone or browser cannot share its location', 'err');
    if (st) return toast('A journey is already being tracked', 'err');
    st = { at: Date.now(), start: null, last: null, dist: 0, ws: App.ws && App.ws.id };
    watch = navigator.geolocation.watchPosition(onFix, err => { if (err.code === 1) { toast('Location is blocked — allow it for this site in your browser settings', 'err'); cancel(); } }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 60000 });   // timeouts / drop-outs are ignored: tracking carries on
    setTimeout(() => { if (st && !st.start) { cancel(); toast('Could not get a location fix. Try again outside or with location switched on.', 'err'); } }, 60000);
    keepAwake(); save(); draw(); closeModal && closeModal();
    toast('Tracking started — keep the app open and the screen on');
  }
  async function keepAwake() { try { if ('wakeLock' in navigator && st) lock = await navigator.wakeLock.request('screen'); } catch (e) { } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st) { keepAwake(); if (watch === null) resume(); } });
  function resume() { if (!st || watch !== null || !navigator.geolocation) return; watch = navigator.geolocation.watchPosition(onFix, () => { }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 60000 }); }
  function clear() { if (watch !== null) { try { navigator.geolocation.clearWatch(watch); } catch (e) { } watch = null; } try { lock && lock.release(); } catch (e) { } lock = null; st = null; save(); draw(); }
  function cancel() { clear(); }
  async function place(p) {
    const fallback = p.lat.toFixed(4) + ', ' + p.lon.toFixed(4);
    try {
      const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&addressdetails=1&lat=${p.lat}&lon=${p.lon}`)).json(), a = r.address || {};
      const s = [a.house_number && a.road ? a.house_number + ' ' + a.road : a.road || a.neighbourhood || a.suburb, a.town || a.city || a.village || a.hamlet, a.postcode].filter(Boolean).join(', ');
      return s || fallback;
    } catch (e) { return fallback; }
  }
  async function finish() {
    if (!st) return; const s = st, miles = Math.round(s.dist / MI * 10) / 10, end = s.last || s.start;
    clear();
    if (!s.start || miles < 0.1) return toast('That journey was too short to record', 'err');
    toast('Working out where you started and finished…');
    const [from, to] = await Promise.all([place(s.start), place(end)]);
    openExpense(null, 'mileage');
    setTimeout(() => {
      const set = (id, v) => { const el = $(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('#x_from', from); set('#x_to', to); set('#x_miles', miles);
      const n = $('#x_distnote'); if (n) n.textContent = miles + ' miles tracked by your phone’s GPS. Check it looks right, then add the business purpose in Notes.';
    }, 250);
  }
  function draw() {
    if (!st) { bar && bar.remove(); bar = null; return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'trkbar'; document.body.appendChild(bar); bar.onclick = ev => { const b = ev.target.closest('[data-t]'); if (!b) return; if (b.dataset.t === 'stop') finish(); else if (b.dataset.t === 'cancel' && confirm('Cancel this journey without saving it?')) cancel(); }; }
    const mi = (st.dist / MI).toFixed(1);
    bar.innerHTML = `<span class="trkdot"></span><div class="grow"><b>${st.start ? mi + ' miles' : 'Finding your location…'}</b><small>Journey in progress</small></div><button class="btn sm ghost" data-t="cancel">Cancel</button><button class="btn sm" data-t="stop">Stop</button>`;
  }
  function init() { st = load(); if (st) { resume(); keepAwake(); draw(); } }
  return { begin, finish, cancel, init, active: () => !!st, _hav: hav };
})();
ACTIONS.trkStart = () => TRK.begin();
document.addEventListener('DOMContentLoaded', () => setTimeout(() => TRK.init(), 800));
