/* Live receipt scanner.
   - finds the receipt in the picture (draws its outline), straightens and crops it
   - warns if it is too dark / too blurry / too far away, and can take the photo by itself when steady
   - optional "scanner look" (black-and-white, boosted contrast), long-receipt stitching, tap-to-focus, pinch-to-zoom
   Cam.open({ multi, onDone(files), onGallery(), onShot(file) -> Promise<{label, warn}> }) — falls back to the phone's own camera app. */
const Cam = (() => {
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch (e) { return d; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { } };
  const AW = 240;                                   // analysis width (pixels)
  let stream = null, root = null, opts = null, track = null, caps = {}, timer = null, torch = false, raf = 0;
  let shots = [], parts = [], S = null;

  /* ============================ image maths (pure functions, unit-tested) ============================ */
  function grayOf(d, w, h) { const g = new Uint8ClampedArray(w * h); for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; return g; }
  function boxBlur(g, w, h, r) {                    // integral-image box blur
    const W = w + 1, I = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; } }
    const o = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      o[y * w + x] = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
    }
    return o;
  }
  function otsu(g) {
    const hist = new Array(256).fill(0); for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let wB = 0, sB = 0, best = 0, thr = 127; const n = g.length;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = t; } }
    return thr;
  }
  /* Find the receipt: biggest bright blob → four corners (normalised 0..1, order TL, TR, BR, BL) */
  function detect(g, w, h) {
    const b = boxBlur(g, w, h, 2), thr = otsu(b), mask = new Uint8Array(w * h);
    let mean = 0; for (let i = 0; i < g.length; i++) mean += g[i]; mean /= g.length;
    for (let i = 0; i < mask.length; i++) mask[i] = b[i] > thr ? 1 : 0;
    const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
    let best = null;
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || seen[s]) continue;
      let sp = 0, area = 0, tl = [1e9, 0, 0], br = [-1e9, 0, 0], tr = [-1e9, 0, 0], bl = [1e9, 0, 0]; stack[sp++] = s; seen[s] = 1;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p / w) | 0; area++;
        const a = x + y, d = x - y;
        if (a < tl[0]) tl = [a, x, y]; if (a > br[0]) br = [a, x, y]; if (d > tr[0]) tr = [d, x, y]; if (d < bl[0]) bl = [d, x, y];
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
      }
      if (!best || area > best.area) best = { area, pts: [tl, tr, br, bl] };
    }
    const out = { mean, found: false };
    if (!best) return out;
    const P = best.pts.map(p => [p[1], p[2]]);
    const q = polyArea(P), frac = best.area / (w * h);
    out.cover = frac;
    if (frac < .1 || frac > .97 || q < 1 || best.area / q < .72 || !convex(P)) return out;
    out.found = true; out.cover = q / (w * h); out.pts = P.map(p => [(p[0] + .5) / w, (p[1] + .5) / h]);
    return out;
  }
  function polyArea(P) { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
  function convex(P) { let sg = 0; for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4], c = P[(i + 2) % 4], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(z) < 1e-6) return false; const s = z > 0 ? 1 : -1; if (sg && s !== sg) return false; sg = s; } return true; }
  function sharpness(g, w, h) {                      // variance of the Laplacian (higher = sharper)
    let n = 0, s = 0, s2 = 0; const x0 = (w * .2) | 0, x1 = (w * .8) | 0, y0 = (h * .2) | 0, y1 = (h * .8) | 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; s += l; s2 += l * l; n++; }
    const m = s / n; return s2 / n - m * m;
  }
  /* unit square → quad (Heckbert). returns mapper (u,v) → [x,y] */
  function homog(P) {
    const [p0, p1, p2, p3] = P, dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0], dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1];
    let g = 0, h = 0; const den = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { g = (dx3 * dy2 - dy3 * dx2) / den; h = (dx1 * dy3 - dy1 * dx3) / den; }
    const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + h * p3[0], c = p0[0], d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + h * p3[1], f = p0[1];
    return (u, v) => { const k = g * u + h * v + 1; return [(a * u + b * v + c) / k, (d * u + e * v + f) / k]; };
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  /* straighten + crop: sample the source canvas through the quad */
  function warp(src, ptsN, margin = .015) {
    const W = src.width, H = src.height;
    let P = ptsN.map(p => [p[0] * W, p[1] * H]);
    const cx = (P[0][0] + P[2][0]) / 2, cy = (P[0][1] + P[2][1]) / 2;
    P = P.map(p => [cx + (p[0] - cx) * (1 + margin * 2), cy + (p[1] - cy) * (1 + margin * 2)]);
    let ow = Math.max(dist(P[0], P[1]), dist(P[3], P[2])), oh = Math.max(dist(P[0], P[3]), dist(P[1], P[2]));
    if (ow > oh * 1.15) { P = [P[3], P[0], P[1], P[2]]; [ow, oh] = [oh, ow]; }          // keep the receipt upright (portrait)
    const k = Math.min(1, 2200 / Math.max(ow, oh)); ow = Math.max(40, Math.round(ow * k)); oh = Math.max(40, Math.round(oh * k));
    const out = document.createElement('canvas'); out.width = ow; out.height = oh;
    const sd = src.getContext('2d').getImageData(0, 0, W, H).data, oc = out.getContext('2d'), od = oc.createImageData(ow, oh), o = od.data, map = homog(P);
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const [sx, sy] = map((x + .5) / ow, (y + .5) / oh), i = (y * ow + x) * 4;
      if (sx < 0 || sy < 0 || sx > W - 1 || sy > H - 1) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = 255; continue; }
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, a = (y0 * W + x0) * 4, b = a + 4, c = a + W * 4, d = c + 4;
      for (let ch = 0; ch < 3; ch++) o[i + ch] = sd[a + ch] * (1 - fx) * (1 - fy) + sd[b + ch] * fx * (1 - fy) + sd[c + ch] * (1 - fx) * fy + sd[d + ch] * fx * fy;
      o[i + 3] = 255;
    }
    oc.putImageData(od, 0, 0); return out;
  }
  /* "scanner look": grayscale + stretch the levels so faded thermal paper turns crisp */
  function enhance(cv) {
    const c = cv.getContext('2d'), im = c.getImageData(0, 0, cv.width, cv.height), d = im.data, hist = new Array(256).fill(0), n = cv.width * cv.height;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; d[i] = d[i + 1] = d[i + 2] = l; hist[l]++; }
    let acc = 0, lo = 0, hi = 255; for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= n * .02) { lo = t; break; } }
    acc = 0; for (let t = 255; t >= 0; t--) { acc += hist[t]; if (acc >= n * .25) { hi = t; break; } }       // paper is the brightest quarter
    if (hi - lo < 40) { lo = Math.max(0, hi - 120); }
    const lut = new Uint8ClampedArray(256); for (let t = 0; t < 256; t++) lut[t] = 255 * Math.pow(Math.min(1, Math.max(0, (t - lo) / (hi - lo))), 1.15);
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lut[d[i]];
    c.putImageData(im, 0, 0); return cv;
  }
  /* join several photos of one long receipt, finding the overlap between each pair */
  function stitch(cvs) {
    if (cvs.length === 1) return cvs[0];
    const W = cvs[0].width, scaled = cvs.map(c => { if (c.width === W) return c; const k = W / c.width, o = document.createElement('canvas'); o.width = W; o.height = Math.round(c.height * k); o.getContext('2d').drawImage(c, 0, 0, o.width, o.height); return o; });
    const SW = 100, small = scaled.map(c => { const k = SW / c.width, o = document.createElement('canvas'); o.width = SW; o.height = Math.max(1, Math.round(c.height * k)); o.getContext('2d').drawImage(c, 0, 0, o.width, o.height); const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data; return { g: grayOf(d, o.width, o.height), h: o.height }; });
    const k = W / SW, offs = [0];
    for (let i = 1; i < scaled.length; i++) {
      const A = small[i - 1], B = small[i], maxO = Math.floor(Math.min(A.h, B.h) * .5), minO = Math.max(2, Math.floor(Math.min(A.h, B.h) * .04)); let bestO = 0, bestD = 1e9;
      for (let o = minO; o <= maxO; o++) { let s = 0; const n = o * SW; for (let r = 0; r < o; r++) for (let x = 0; x < SW; x++) s += Math.abs(A.g[(A.h - o + r) * SW + x] - B.g[r * SW + x]); s /= n; if (s < bestD) { bestD = s; bestO = o; } }
      offs.push(bestD < 38 ? Math.round(bestO * k) : 0);
    }
    let H = 0; scaled.forEach((c, i) => { H += c.height - offs[i]; });
    const out = document.createElement('canvas'); out.width = W; out.height = H; const ctx = out.getContext('2d'); let y = 0;
    scaled.forEach((c, i) => { y -= offs[i]; ctx.drawImage(c, 0, y); y += c.height; });
    return out;
  }

  /* ============================ camera UI ============================ */
  function stop() { clearTimeout(timer); cancelAnimationFrame(raf); raf = 0; try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) { } stream = null; track = null; torch = false; S = null; if (root) { root.remove(); root = null; } document.body.classList.remove('camopen'); }
  function nativeFallback(o) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.setAttribute('capture', 'environment'); if (o.multi) i.multiple = true; i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = () => { const f = [...i.files]; i.remove(); if (f.length) o.onDone(f); }; i.click();
  }
  const ic = d => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  async function open(o) {
    opts = o; shots = []; parts = [];
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return nativeFallback(o);
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
    catch (e) { toast('Camera not available — using your phone’s camera app instead', 'err'); return nativeFallback(o); }
    track = stream.getVideoTracks()[0]; caps = (track.getCapabilities && track.getCapabilities()) || {};
    S = { auto: LS('eh_cam_auto', true), bw: LS('eh_cam_bw', true), long: false, hist: [], last: null, lastAt: 0, hold: 0, armed: true, lost: 0, busy: false, zoom: 1 };
    root = document.createElement('div'); root.className = 'cam';
    root.innerHTML = `<video playsinline muted autoplay></video><canvas class="cam-ov"></canvas>
      <div class="cam-mask"><div class="cam-frame" id="camFrame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="cam-line"></span></div></div>
      <div class="cam-top"><button type="button" class="cam-btn" data-c="close" aria-label="Close">${ic('<path d="M18 6 6 18M6 6l12 12"/>')}</button><div class="cam-hint" id="camHint">Fit the whole receipt inside the frame</div>${caps.torch ? `<button type="button" class="cam-btn" id="camTorch" data-c="torch" aria-label="Light">${ic('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>')}</button>` : '<span style="width:44px"></span>'}</div>
      <div class="cam-chips"><button type="button" class="cam-chip" data-c="auto">Auto-capture</button><button type="button" class="cam-chip" data-c="bw">Scanner look</button>${o.multi ? '' : '<button type="button" class="cam-chip" data-c="long">Long receipt</button>'}</div>
      <div class="cam-last" id="camLast" hidden></div><div class="cam-zoom" id="camZoom" hidden></div><div class="cam-focus" id="camFocus" hidden></div>
      <div class="cam-bottom"><button type="button" class="cam-btn" data-c="gallery" aria-label="Choose from gallery">${ic('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>')}</button>
        <div class="cam-shwrap"><b class="cam-ring" id="camRing"></b><button type="button" class="cam-shutter" data-c="shot" aria-label="Take photo"><i></i></button></div>
        <button type="button" class="cam-done" data-c="done" ${o.multi ? '' : 'hidden'} disabled>Done</button><span class="cam-spacer" ${o.multi ? 'hidden' : ''}></span></div>
      <div class="cam-flash"></div>`;
    document.body.appendChild(root); document.body.classList.add('camopen');
    const v = root.querySelector('video'); v.srcObject = stream; v.play().catch(() => { });
    chips(); wireTouch(v);
    root.onclick = async ev => {
      const b = ev.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c;
      if (c === 'close') stop();
      else if (c === 'torch') { torch = !torch; try { await track.applyConstraints({ advanced: [{ torch }] }); b.classList.toggle('on', torch); } catch (e) { } }
      else if (c === 'gallery') { stop(); o.onGallery ? o.onGallery() : nativeFallback({ ...o, multi: o.multi }); }
      else if (c === 'shot') shoot(v, false);
      else if (c === 'done') finish();
      else if (c === 'auto') { S.auto = !S.auto; LSset('eh_cam_auto', S.auto); S.hold = 0; chips(); }
      else if (c === 'bw') { S.bw = !S.bw; LSset('eh_cam_bw', S.bw); chips(); }
      else if (c === 'long') { S.long = !S.long; parts = []; chips(); hint(S.long ? 'Long receipt: photograph the top first, then overlap each next part a little' : 'Fit the whole receipt inside the frame'); doneBtn(); }
    };
    loop(v);
  }
  function chips() { if (!root) return; root.querySelectorAll('.cam-chip').forEach(b => { const on = { auto: S.auto, bw: S.bw, long: S.long }[b.dataset.c]; b.classList.toggle('on', !!on); }); }
  function hint(t, cls) { const h = root && root.querySelector('#camHint'); if (h) { h.textContent = t; h.className = 'cam-hint' + (cls ? ' ' + cls : ''); } }
  function doneBtn() {
    const d = root && root.querySelector('.cam-done'); if (!d) return;
    if (opts.multi) { d.disabled = !shots.length; d.textContent = shots.length ? 'Done (' + shots.length + ')' : 'Done'; }
    else { d.hidden = !(S.long && parts.length); d.disabled = !parts.length; d.textContent = parts.length ? 'Done (' + parts.length + ')' : 'Done'; }
  }
  /* analysis loop ~8 times a second */
  function loop(v) {
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true }), ov = root.querySelector('.cam-ov'), frame = root.querySelector('#camFrame'), ring = root.querySelector('#camRing');
    const tick = () => {
      if (!root) return;
      try {
        if (v.videoWidth && !S.busy) {
          const w = AW, h = Math.round(AW * v.videoHeight / v.videoWidth); cv.width = w; cv.height = h; cx.drawImage(v, 0, 0, w, h);
          const g = grayOf(cx.getImageData(0, 0, w, h).data, w, h), det = detect(g, w, h), sh = sharpness(g, w, h);
          analyse(det, sh); aim(ov, v, det, frame); ring.style.setProperty('--p', Math.min(1, S.hold / HOLD_MS)); 
        }
      } catch (e) { console.warn('cam analyse', e); }
      timer = setTimeout(tick, 120);
    };
    tick(); const spin = t => { if (!root) return; try { render(ov, t); } catch (e) { } raf = requestAnimationFrame(spin); }; raf = requestAnimationFrame(spin);
  }
  const HOLD_MS = 700;
  function analyse(det, sh) {
    const now = performance.now();
    if (!det.found && S.det && S.det.found && S.lost < 3) { S.lost++; return; }      // ignore a one-off missed detection so a tiny wobble doesn't restart the countdown
    S.det = det; S.sh = sh;
    const dark = det.mean < 55, blurry = sh < 12, small = det.found && det.cover < .22;
    if (det.found) { S.hist.push(det.pts); if (S.hist.length > 4) S.hist.shift(); S.lost = 0; if (det.pts) { S.last = det.pts; S.lastAt = now; } }
    else { S.hist = []; S.lost++; S.hold = 0; if (S.lost > 4) S.armed = true; }
    if (S.firedPts && det.found && maxMove(det.pts, S.firedPts) > .12) S.armed = true;      // re-arm once the paper has moved on
    const stable = det.found && S.hist.length >= 4 && S.hist.every(p => maxMove(p, S.hist[S.hist.length - 1]) < .04);   // ~4% of the picture: normal hand shake is fine
    if (dark) hint('Too dark — turn on the light or move to a brighter spot', 'warn');
    else if (!det.found) { hint(S.long && parts.length ? 'Line up the next part of the receipt' : opts.multi && shots.length ? shots.length + ' captured — next receipt, or tap Done' : 'Fit the whole receipt inside the frame'); }
    else if (small) hint('Move closer', 'warn');
    else if (blurry) hint('Hold steady — it looks blurry', 'warn');
    else if (S.auto && S.armed) hint(stable ? 'Hold still…' : 'Receipt found', 'ok');
    else hint(S.auto ? 'Move to the next receipt' : 'Receipt found — tap the button', 'ok');
    const tb = root.querySelector('#camTorch'); if (tb) tb.classList.toggle('pulse', dark && !torch);
    const good = stable && !dark && !small && sh >= 12;
    if (S.auto && S.armed && good) { S.hold += 120; if (S.hold >= HOLD_MS) { S.hold = 0; S.armed = false; S.firedPts = det.pts; shoot(root.querySelector('video'), true); } } else S.hold = Math.max(0, S.hold - 60);   // lose progress slowly, not all at once
  }
  const maxMove = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));
  /* the outline is eased towards each new detection and painted every frame, so it glides instead of jumping */
  function aim(ov, v, det, frame) {
    const W = ov.clientWidth, H = ov.clientHeight; if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
    if (!det.found && S.lost > 0 && S.lost < 3 && S.tgt) return;
    frame.classList.toggle('det', !!det.found);
    if (!det.found) { S.tgt = null; return; }
    const vw = v.videoWidth, vh = v.videoHeight, sc = Math.max(W / vw, H / vh), ox = (W - vw * sc) / 2, oy = (H - vh * sc) / 2;
    S.tgt = det.pts.map(p => [p[0] * vw * sc + ox, p[1] * vh * sc + oy]);
    if (!S.cur) { S.cur = S.tgt.map(p => p.slice()); S.born = performance.now(); }
  }
  function render(ov, t) {
    const W = ov.width, H = ov.height, c = ov.getContext('2d'); c.clearRect(0, 0, W, H);
    if (!S.tgt) { S.cur = null; S.fade = 0; return; }
    const P = S.cur; S.tgt.forEach((q, i) => { P[i][0] += (q[0] - P[i][0]) * .28; P[i][1] += (q[1] - P[i][1]) * .28; });
    const prog = Math.min(1, S.hold / HOLD_MS), lock = Math.min(1, (t - S.born) / 280), ease = 1 - Math.pow(1 - lock, 3);
    const cx = P.reduce((a, p) => a + p[0], 0) / 4, cy = P.reduce((a, p) => a + p[1], 0) / 4;
    const Q = P.map(p => [cx + (p[0] - cx) * (1.04 - .04 * ease), cy + (p[1] - cy) * (1.04 - .04 * ease)]);   // settles in from slightly larger
    const rgb = prog > 0 ? '34,197,94' : '255,255,255', col = `rgb(${rgb})`;
    const path = () => { c.beginPath(); Q.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); };
    c.save(); c.globalAlpha = ease;
    // dim everything outside the receipt
    c.fillStyle = 'rgba(0,0,0,.38)'; c.beginPath(); c.rect(0, 0, W, H); Q.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill('evenodd');
    // soft tint + travelling light band inside the receipt
    path(); c.fillStyle = `rgba(${rgb},.10)`; c.fill();
    c.save(); path(); c.clip();
    const minY = Math.min(...Q.map(p => p[1])), maxY = Math.max(...Q.map(p => p[1])), hh = maxY - minY, y = minY + ((t % 1800) / 1800) * (hh + 80) - 40;
    const g = c.createLinearGradient(0, y - 40, 0, y + 40); g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(.5, `rgba(${rgb},.28)`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(0, y - 40, W, 80); c.restore();
    // glowing outline
    c.lineJoin = 'round'; c.lineCap = 'round'; c.shadowColor = col; c.shadowBlur = 14;
    path(); c.lineWidth = 2; c.strokeStyle = `rgba(${rgb},.55)`; c.stroke();
    // corner brackets along the edges
    c.lineWidth = 5; c.strokeStyle = col;
    for (let i = 0; i < 4; i++) {
      const a = Q[i], b = Q[(i + 1) % 4], d = Q[(i + 3) % 4], la = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ld = Math.hypot(d[0] - a[0], d[1] - a[1]) || 1, k = Math.min(34, la * .22, ld * .22);
      c.beginPath(); c.moveTo(a[0] + (b[0] - a[0]) / la * k, a[1] + (b[1] - a[1]) / la * k); c.lineTo(a[0], a[1]); c.lineTo(a[0] + (d[0] - a[0]) / ld * k, a[1] + (d[1] - a[1]) / ld * k); c.stroke();
    }
    // auto-capture progress: green line drawn round the edge
    if (prog > 0) {
      let tot = 0; const seg = Q.map((p, i) => { const n = Q[(i + 1) % 4], l = Math.hypot(n[0] - p[0], n[1] - p[1]); tot += l; return l; });
      let left = tot * prog; c.lineWidth = 5; c.strokeStyle = '#4ade80'; c.shadowColor = '#22c55e'; c.shadowBlur = 18; c.beginPath(); c.moveTo(Q[0][0], Q[0][1]);
      for (let i = 0; i < 4 && left > 0; i++) { const n = Q[(i + 1) % 4], f = Math.min(1, left / seg[i]); c.lineTo(Q[i][0] + (n[0] - Q[i][0]) * f, Q[i][1] + (n[1] - Q[i][1]) * f); left -= seg[i]; }
      c.stroke();
    }
    c.restore();
  }
  function shoot(v, auto) {
    if (!v.videoWidth || S.busy) return; S.busy = true;
    const raw = document.createElement('canvas'); raw.width = v.videoWidth; raw.height = v.videoHeight; raw.getContext('2d').drawImage(v, 0, 0);
    try { navigator.vibrate && navigator.vibrate(18); } catch (e) { }
    const fl = root.querySelector('.cam-flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    const fr = root.querySelector('#camFrame'); fr.classList.add('ok'); setTimeout(() => fr && fr.classList.remove('ok'), 450);
    const usePts = S.last && performance.now() - S.lastAt < 900 ? S.last : null;
    setTimeout(() => {                                                // let the flash paint first, then do the heavy pixel work
      let cv = raw; try { if (usePts) cv = warp(raw, usePts); } catch (e) { console.warn('warp failed', e); cv = raw; }
      if (S.bw) { try { enhance(cv); } catch (e) { } }
      S.busy = false; if (!root) return;
      if (!opts.multi && S.long) { parts.push(cv); doneBtn(); hint(parts.length + ' part' + (parts.length > 1 ? 's' : '') + ' — overlap the next bit a little, or tap Done'); return; }
      cv.toBlob(bl => {
        if (!bl) return; const f = new File([bl], 'receipt-' + Date.now() + '.jpg', { type: 'image/jpeg' });
        if (!opts.multi) { stop(); opts.onDone([f]); return; }
        shots.push(f); doneBtn();
        if (opts.onShot) readBack(f);
        if (shots.length >= 20) finish();
      }, 'image/jpeg', 0.88);
    }, 60);
  }
  function readBack(f) {
    const box = root.querySelector('#camLast'); box.hidden = false; box.className = 'cam-last'; box.textContent = 'Reading receipt ' + shots.length + '…';
    const n = shots.length;
    Promise.resolve(opts.onShot(f)).then(r => { if (!root || n !== shots.length) return; box.textContent = r ? r.label : 'Saved — will be read next'; box.classList.toggle('warn', !!(r && r.warn)); }).catch(() => { if (root && n === shots.length) { box.textContent = 'Saved — will be read next'; } });
  }
  function finish() {
    if (!opts.multi) { if (!parts.length) return; let cv; try { cv = stitch(parts); } catch (e) { console.warn(e); cv = parts[0]; } const o = opts; stop(); cv.toBlob(bl => o.onDone([new File([bl], 'receipt-' + Date.now() + '.jpg', { type: 'image/jpeg' })]), 'image/jpeg', 0.88); return; }
    const f = shots.slice(), o = opts; stop(); if (f.length) o.onDone(f);
  }
  /* tap to focus, pinch to zoom */
  function wireTouch(v) {
    let d0 = 0, z0 = 1;
    const zoomTo = async z => { if (!caps.zoom) return; const mn = caps.zoom.min || 1, mx = caps.zoom.max || 1; z = Math.max(mn, Math.min(mx, z)); S.zoom = z; try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch (e) { } const zb = root && root.querySelector('#camZoom'); if (zb) { zb.hidden = false; zb.textContent = z.toFixed(1) + '×'; clearTimeout(zb._t); zb._t = setTimeout(() => zb.hidden = true, 900); } };
    root.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); z0 = S.zoom || 1; } }, { passive: true });
    root.addEventListener('touchmove', e => { if (e.touches.length === 2 && d0) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); zoomTo(z0 * d / d0); } }, { passive: true });
    root.addEventListener('touchend', () => { d0 = 0; }, { passive: true });
    v.addEventListener('click', ev => {
      const f = root.querySelector('#camFocus'); f.style.left = ev.clientX + 'px'; f.style.top = ev.clientY + 'px'; f.hidden = false; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); setTimeout(() => f.hidden = true, 900);
      try { const r = v.getBoundingClientRect(); track.applyConstraints({ advanced: [{ focusMode: 'single-shot', pointsOfInterest: [{ x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height }] }] }).catch(() => { }); } catch (e) { }
    });
  }
  return { open, stop, _t: { detect, warp, enhance, stitch, grayOf, sharpness, homog } };
})();
