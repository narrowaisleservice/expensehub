/* Live camera scanner with a receipt-frame overlay (corner brackets + moving scan line).
   Cam.open({ multi, onDone(files), onGallery() }) — falls back to the phone's own camera if live video is not available. */
const Cam = (() => {
  let stream = null, root = null, shots = [], opts = null, track = null, torch = false;
  const icon = (d, s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  function stop() { try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) { } stream = null; track = null; torch = false; if (root) { root.remove(); root = null; } document.body.classList.remove('camopen'); }
  function nativeFallback(o) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.setAttribute('capture', 'environment'); if (o.multi) i.multiple = true; i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = () => { const f = [...i.files]; i.remove(); if (f.length) o.onDone(f); }; i.click();
  }
  async function open(o) {
    opts = o; shots = [];
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return nativeFallback(o);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) { toast('Camera not available — using your phone’s camera app instead', 'err'); return nativeFallback(o); }
    track = stream.getVideoTracks()[0];
    const caps = (track.getCapabilities && track.getCapabilities()) || {};
    root = document.createElement('div'); root.className = 'cam';
    root.innerHTML = `<video playsinline muted autoplay></video>
      <div class="cam-mask"><div class="cam-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="cam-line"></span></div></div>
      <div class="cam-top"><button type="button" class="cam-btn" data-c="close" aria-label="Close">${icon('<path d="M18 6 6 18M6 6l12 12"/>')}</button><div class="cam-hint" id="camHint">Fit the whole receipt inside the frame</div>${caps.torch ? `<button type="button" class="cam-btn" data-c="torch" aria-label="Light">${icon('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>')}</button>` : '<span style="width:44px"></span>'}</div>
      <div class="cam-bottom"><button type="button" class="cam-btn" data-c="gallery" aria-label="Choose from gallery">${icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>')}</button>
        <button type="button" class="cam-shutter" data-c="shot" aria-label="Take photo"><i></i></button>
        <button type="button" class="cam-done" data-c="done" ${o.multi ? '' : 'hidden'} disabled>Done</button><span class="cam-spacer" ${o.multi ? 'hidden' : ''}></span></div>
      <div class="cam-flash"></div>`;
    document.body.appendChild(root); document.body.classList.add('camopen');
    const v = root.querySelector('video'); v.srcObject = stream; v.play().catch(() => { });
    root.onclick = async ev => {
      const b = ev.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c;
      if (c === 'close') stop();
      else if (c === 'torch') { torch = !torch; try { await track.applyConstraints({ advanced: [{ torch }] }); b.classList.toggle('on', torch); } catch (e) { } }
      else if (c === 'gallery') { stop(); o.onGallery ? o.onGallery() : (() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,application/pdf'; i.style.display = 'none'; document.body.appendChild(i); i.onchange = () => { const f = [...i.files]; i.remove(); if (f.length) o.onDone(f); }; i.click(); })(); }
      else if (c === 'shot') shoot(v);
      else if (c === 'done') finish();
    };
  }
  function shoot(v) {
    if (!v.videoWidth) return;
    const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext('2d').drawImage(v, 0, 0);
    const fl = root.querySelector('.cam-flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go'); root.querySelector('.cam-frame').classList.add('ok'); setTimeout(() => root && root.querySelector('.cam-frame').classList.remove('ok'), 450);
    cv.toBlob(bl => {
      if (!bl) return; const f = new File([bl], 'receipt-' + Date.now() + '.jpg', { type: 'image/jpeg' });
      if (!opts.multi) { stop(); opts.onDone([f]); return; }
      shots.push(f); const d = root.querySelector('.cam-done'); d.disabled = false; d.textContent = 'Done (' + shots.length + ')';
      root.querySelector('#camHint').textContent = shots.length + ' captured — next receipt, or tap Done';
      if (shots.length >= 20) finish();
    }, 'image/jpeg', 0.9);
  }
  function finish() { const f = shots.slice(); stop(); if (f.length) opts.onDone(f); }
  return { open, stop };
})();
