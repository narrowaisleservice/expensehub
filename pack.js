/* Flexi Expenses pack: builds a real Excel workbook (.xlsx) and a "month-end pack" ZIP (workbook + receipt images)
   with no outside libraries, so it also works offline once the app is cached. */

/* ---------- tiny ZIP writer (stored, no compression: receipts are already compressed) ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipBlob(files) {
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  const d = new Date(), dt = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF, tm = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    cen.push(ch.buffer, name);
    off += 30 + name.length + data.length;
  }
  const csize = cen.reduce((t, p) => t + p.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cen, end.buffer], { type: 'application/zip' });
}

/* ---------- XLSX writer ---------- */
/* sheet = { name, cols:[width...], rows:[[cell...]], freeze:bool, filter:bool }
   cell = string | number | Date | null | { v, s:'money'|'bold'|'total'|'title'|'int'|'wrap'|'head'|'date'|'label', f:'SUM(..)' } */
const XS = { head: 1, money: 2, date: 3, bold: 4, total: 5, title: 6, wrap: 7, label: 8, int: 9 };
const xesc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xcol = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const xserial = d => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5;
function xcell(c, r, ci) {
  if (c == null || c === '') return '';
  const ref = xcol(ci) + (r + 1); let o = c, s = 0;
  if (typeof c === 'object' && !(c instanceof Date)) { o = c.v; s = XS[c.s] || 0; if (c.f) return `<c r="${ref}"${s ? ` s="${s}"` : ''}><f>${xesc(c.f)}</f><v>${+c.v || 0}</v></c>`; }
  if (o == null || o === '') return s ? `<c r="${ref}" s="${s}"/>` : '';
  if (o instanceof Date) return `<c r="${ref}" s="${XS.date}"><v>${xserial(o)}</v></c>`;
  if (typeof o === 'number' && isFinite(o)) return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${o}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${xesc(o)}</t></is></c>`;
}
function xsheet(sh) {
  const w = Math.max(...sh.rows.map(r => r.length), 1), h = sh.rows.length;
  const cols = sh.cols ? `<cols>${sh.cols.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${x}" customWidth="1"/>`).join('')}</cols>` : '';
  const view = sh.freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>';
  const data = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => xcell(c, ri, ci)).join('')}</row>`).join('');
  const filter = sh.filter && h > 1 ? `<autoFilter ref="A1:${xcol(w - 1)}${sh.filterTo || h}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${data}</sheetData>${filter}</worksheet>`;
}
const XSTYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]\\-#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FFDF0A1E"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B3A57"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
function xlsxBytes(sheets) {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', enc = new TextEncoder();
  const files = [
    { name: '[Content_Types].xml', data: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${xesc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: XSTYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xsheet(s) }))
  ];
  return files;
}
const xlsxBlob = sheets => zipBlob(xlsxBytes(sheets).map(f => ({ ...f, data: f.data }))).slice(0, undefined, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

/* ---------- the pack ---------- */
const slug = (s, n = 28) => String(s || 'item').normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, n) || 'item';
const r2 = n => Math.round((+n || 0) * 100) / 100;
const dOf = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const XMON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function packSheets(list, label, names) {
  const vatOf = e => r2((parseFloat(e.vat_amount) || 0) * (parseFloat(e.fx_rate) || 1));
  const rows = [...list].sort((a, b) => String(a.expense_date).localeCompare(String(b.expense_date))).map(e => {
    const gross = r2(e.amount_base), vat = vatOf(e);
    return { e, gross, vat, net: r2(gross - vat) };
  });
  const gl = id => cat(id)?.gl_code || '';
  const rep = e => EX.reps?.[e.report_id], tripName = id => (PK.trips || []).find(t => t.id === id)?.name || '';
  const head = ['Date', 'Employee', 'Supplier', 'Category', 'GL code', 'Notes', 'Net', 'VAT', 'Gross', 'Currency', 'Original amount', 'Payment method', 'Billable', 'Customer', 'Trip', 'Report', 'Status', 'Miles', 'Receipt file', 'Receipt SHA-256'];
  const body = rows.map(({ e, gross, vat, net }) => [dOf(e.expense_date), memberName(e.user_id), e.merchant || e.kind, catName(e.category_id), gl(e.category_id), e.kind === 'mileage' ? [e.from_loc && e.to_loc ? e.from_loc + ' → ' + e.to_loc : '', e.notes].filter(Boolean).join(' · ') : (e.notes || ''),
    { v: net, s: 'money' }, { v: vat, s: 'money' }, { v: gross, s: 'money' }, e.currency, e.currency !== App.ws.currency ? { v: +e.amount, s: 'money' } : null, String(e.payment_method || '').replace('_', ' '), e.billable ? 'Yes' : '', e.customer || '', tripName(e.trip_id), rep(e)?.name || '', expStatus(e),
    e.miles ? +e.miles : null, names?.get(e.id) || (e.receipt_path ? 'Attached' : 'NO RECEIPT'), e.receipt_hash || '']);
  const n = body.length, tot = (c) => ({ f: `SUM(${c}2:${c}${n + 1})`, v: r2(sum(rows, r => ({ G: r.net, H: r.vat, I: r.gross }[c]))), s: 'total' });
  const expenses = { name: 'Expenses', freeze: true, filter: true, filterTo: n + 1, cols: [11, 18, 26, 20, 9, 34, 11, 10, 11, 9, 12, 14, 9, 16, 18, 20, 13, 8, 34, 24], rows: [head.map(h => ({ v: h, s: 'head' })), ...body, ...(n ? [['', '', '', '', '', { v: 'Total', s: 'label' }, tot('G'), tot('H'), tot('I')]] : [])] };
  const group = (keyFn, sortFn) => { const g = {}; rows.forEach(r => { const k = keyFn(r.e); (g[k] = g[k] || { n: 0, net: 0, vat: 0, gross: 0 }); g[k].n++; g[k].net += r.net; g[k].vat += r.vat; g[k].gross += r.gross; }); return Object.entries(g).sort(sortFn); };
  const tbl = (name, first, entries, withGl) => {
    const m = entries.length, extra = withGl ? 1 : 0;
    const cols = [first, ...(withGl ? ['GL code'] : []), 'Items', 'Net', 'VAT', 'Gross'];
    const col = i => xcol(1 + extra + i);
    return { name, freeze: true, cols: [30, ...(withGl ? [10] : []), 9, 13, 12, 13], rows: [cols.map(h => ({ v: h, s: 'head' })),
      ...entries.map(([k, o]) => [withGl ? k.split('\u0001')[0] : k, ...(withGl ? [k.split('\u0001')[1]] : []), { v: o.n, s: 'int' }, { v: r2(o.net), s: 'money' }, { v: r2(o.vat), s: 'money' }, { v: r2(o.gross), s: 'money' }]),
      [{ v: 'Total', s: 'label' }, ...(withGl ? [{ v: '', s: 'label' }] : []), { f: `SUM(${col(0)}2:${col(0)}${m + 1})`, v: sum(entries, x => x[1].n), s: 'total' }, { f: `SUM(${col(1)}2:${col(1)}${m + 1})`, v: r2(sum(entries, x => x[1].net)), s: 'total' }, { f: `SUM(${col(2)}2:${col(2)}${m + 1})`, v: r2(sum(entries, x => x[1].vat)), s: 'total' }, { f: `SUM(${col(3)}2:${col(3)}${m + 1})`, v: r2(sum(entries, x => x[1].gross)), s: 'total' }]] };
  };
  const byCat = tbl('By category', 'Category', group(e => catName(e.category_id) + '\u0001' + gl(e.category_id), (a, b) => b[1].gross - a[1].gross), true);
  const byMon = tbl('By month', 'Month', group(e => String(e.expense_date).slice(0, 7), (a, b) => a[0].localeCompare(b[0])).map(([k, o]) => [XMON[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4), o]), false);
  const byEmp = tbl('By employee', 'Employee', group(e => memberName(e.user_id), (a, b) => b[1].gross - a[1].gross), false);
  const withR = rows.filter(r => r.e.receipt_path).length;
  const summary = { name: 'Summary', cols: [26, 44], rows: [
    [{ v: 'Flexi Expenses', s: 'title' }], [{ v: App.ws.name, s: 'bold' }], [],
    [{ v: 'Period / selection', s: 'bold' }, label], [{ v: 'Prepared', s: 'bold' }, new Date().toLocaleString('en-GB')], [{ v: 'Prepared by', s: 'bold' }, memberName(App.user.id)],
    [{ v: 'Company VAT number', s: 'bold' }, App.ws.vat_number || ''], [{ v: 'Currency', s: 'bold' }, App.ws.currency], [],
    [{ v: 'Items', s: 'bold' }, { v: n, s: 'int' }], [{ v: 'Net', s: 'bold' }, { v: r2(sum(rows, r => r.net)), s: 'money' }], [{ v: 'VAT', s: 'bold' }, { v: r2(sum(rows, r => r.vat)), s: 'money' }], [{ v: 'Gross', s: 'bold' }, { v: r2(sum(rows, r => r.gross)), s: 'money' }], [],
    [{ v: 'With a receipt', s: 'bold' }, { v: withR, s: 'int' }], [{ v: 'Without a receipt', s: 'bold' }, { v: n - withR, s: 'int' }], [],
    [{ v: 'Receipt images are stored securely in Flexi Expenses with a SHA-256 fingerprint, upload time and uploader. The fingerprint column proves a copy is unchanged.', s: 'wrap' }]] };
  return [summary, expenses, byCat, byMon, byEmp];
}
const PK = { trips: [] };
function receiptName(e) { const ext = (String(e.receipt_path).match(/\.(\w{2,4})$/)?.[1] || 'jpg').toLowerCase(); return `${String(e.expense_date).slice(0, 10)}_${slug(e.merchant || e.kind)}_${(+e.amount_base).toFixed(2)}_${String(e.id).slice(0, 6)}.${ext}`; }
async function exportPack(list, label, withReceipts) {
  list = list.filter(e => !e.needs_review);
  if (!list.length) return toast('Nothing to export', 'err');
  try { PK.trips = await q(sb.from('exp_trips').select('id,name').eq('workspace_id', App.ws.id)); } catch (e) { PK.trips = []; }
  const stamp = today(), base = `Flexi-Expenses_${slug(App.ws.name, 20)}_${stamp}`;
  if (!withReceipts) {
    download(`${base}.xlsx`, xlsxBlob(packSheets(list, label, null)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); return toast('Excel file downloaded');
  }
  const withR = list.filter(e => e.receipt_path);
  modal(`<h2>Preparing your pack</h2><p class="sub" id="pk_msg">Collecting receipts… 0 of ${withR.length}</p><div class="bars"><div class="b"><span class="t" style="grid-column:1/-1"><i id="pk_bar" style="width:0%"></i></span></div></div>`);
  const files = [], names = new Map(), failed = []; let done = 0, next = 0;
  const worker = async () => {
    while (next < withR.length) {
      const e = withR[next++], nm = receiptName(e);
      try { const { data, error } = await sb.storage.from('exp-receipts').download(e.receipt_path); if (error || !data) throw error || new Error('missing'); files.push({ name: `Receipts/${nm}`, data: new Uint8Array(await data.arrayBuffer()) }); names.set(e.id, nm); }
      catch (err) { failed.push(e); names.set(e.id, 'NOT DOWNLOADED'); }
      done++; const m = $('#pk_msg'), b = $('#pk_bar'); if (m) m.textContent = `Collecting receipts… ${done} of ${withR.length}`; if (b) b.style.width = Math.round(done / Math.max(1, withR.length) * 100) + '%';
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const noR = list.filter(e => !e.receipt_path);
  const readme = `Flexi Expenses – month-end pack
Workspace: ${App.ws.name}
Selection: ${label}
Prepared: ${new Date().toLocaleString('en-GB')} by ${memberName(App.user.id)}

Contents
  Expenses.xlsx   Summary, every expense, and totals by category, month and employee.
  Receipts/       One image or PDF per expense, named date_supplier_amount_id.

Each row in the Expenses sheet shows the receipt file name and its SHA-256 fingerprint.
Items with no receipt: ${noR.length}${noR.length ? '\n' + noR.map(e => `  - ${String(e.expense_date).slice(0, 10)} ${e.merchant || e.kind} ${(+e.amount_base).toFixed(2)}`).join('\n') : ''}
${failed.length ? '\nReceipts that could not be downloaded: ' + failed.length + '\n' + failed.map(e => `  - ${String(e.expense_date).slice(0, 10)} ${e.merchant || e.kind}`).join('\n') : ''}
`;
  const root = base + '/';
  const all = [{ name: root + 'Expenses.xlsx', data: new Uint8Array(await xlsxBlob(packSheets(list, label, names)).arrayBuffer()) }, { name: root + 'README.txt', data: readme }, ...files.map(f => ({ ...f, name: root + f.name }))];
  closeModal(); download(`${base}.zip`, zipBlob(all), 'application/zip');
  toast(failed.length ? `Pack downloaded — ${failed.length} receipt(s) could not be fetched` : 'Pack downloaded', failed.length ? 'err' : undefined);
}
const rangeLabel = list => { const d = list.map(e => String(e.expense_date).slice(0, 10)).sort(); return d.length ? `${dfmt(d[0])} to ${dfmt(d[d.length - 1])}` : ''; };
