/* إصدار التقارير: ملف إكسل (ExcelJS) أو PDF (jsPDF بخط عربي). يعمل بالمتصفح وبـ node للاختبار. */
(function (root) {
  const Inv = (root.Inv = root.Inv || {});

  // تقارير رسمية: أبيض وأسود بلا شعار ولا ألوان
  const NAVY = [0, 0, 0], RED = [0, 0, 0], LIGHT = [238, 238, 238], ZEBRA = [255, 255, 255],
    INK = [0, 0, 0], MUTED = [60, 60, 60], LINE = [110, 110, 110], WHITE = [255, 255, 255];
  const hex = c => c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const AR = /[؀-ۿ]/;

  const f2 = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f3 = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const fq = n => (Math.round(Number(n) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const taxTxt = t => (t === null || t === undefined ? 'غير محدد' : t + '%');

  /* ---------- تعريف الأعمدة والمؤشرات (مشترك بين الصيغتين) ---------- */
  function columnsFor(pack) {
    const t = pack.type, book = pack.hasBook;
    const c = {
      idx: { title: '#', mm: 9, xl: 6, kind: 'idx' },
      name: { title: 'اسم الصنف', mm: 0, xl: 46, kind: 'text', get: i => i.name },
      barcode: { title: 'الباركود', mm: 31, xl: 17, kind: 'code', get: i => i.barcode },
      unit: { title: 'الوحدة', mm: 14, xl: 9, kind: 'text', get: i => i.unit },
      tax: { title: 'الضريبة', mm: 16, xl: 11, kind: 'text', get: i => taxTxt(i.tax) },
      qty: { title: 'الكمية المعدودة', mm: 19, xl: 12, kind: 'qty', get: i => i.qty },
      system: { title: 'الكمية الدفترية', mm: 18, xl: 12, kind: 'qty', get: i => i.system },
      diff: { title: 'الفرق', mm: 15, xl: 10, kind: 'qty', get: i => i.diff, signed: true },
      price: { title: 'سعر الوحدة', mm: 19, xl: 12, kind: 'price', get: i => i.price },
      base: { title: 'القيمة قبل الضريبة', mm: 25, xl: 15, kind: 'money', get: i => i.base, sum: 'base' },
      taxAmount: { title: 'مبلغ الضريبة', mm: 21, xl: 13, kind: 'money', get: i => i.taxAmount, sum: 'taxAmount' },
      gross: { title: 'القيمة بعد الضريبة', mm: 25, xl: 15, kind: 'money', get: i => i.gross, sum: 'gross' },
      diffValue: { title: 'قيمة الفرق قبل الضريبة', mm: 27, xl: 16, kind: 'money', get: i => i.diffValue, sum: 'diffValue', signed: true },
      diffValueGross: { title: 'قيمة الفرق بعد الضريبة', mm: 27, xl: 16, kind: 'money', get: i => i.diffValueGross, sum: 'diffValueGross', signed: true },
    };
    let keys;
    if (t === 'uncounted') keys = ['idx', 'name', 'barcode', 'unit', 'tax', ...(book ? ['system'] : []), 'price'];
    else if (t === 'diff') keys = ['idx', 'name', 'barcode', 'unit', 'tax', 'system', 'qty', 'diff', 'price', 'diffValue', 'diffValueGross'];
    else keys = ['idx', 'name', 'barcode', 'unit', 'tax', 'qty', ...(book ? ['system', 'diff'] : []), 'price', 'base', 'taxAmount', 'gross'];
    return keys.map(k => c[k]);
  }

  function kpisFor(pack) {
    const s = pack.stats;
    if (pack.type === 'tax' && pack.sel) {
      return [['عدد الأصناف', fq(pack.sel.items)], ['القيمة قبل الضريبة', f2(pack.sel.base)], ['مبلغ الضريبة', f2(pack.sel.taxAmount)], ['القيمة بعد الضريبة', f2(pack.sel.gross)]];
    }
    if (pack.type === 'diff') {
      return [
        ['أصناف فيها فرق', fq(s.diffs)],
        ['قيمة النقص قبل الضريبة', f2(s.short)],
        ['قيمة الزيادة قبل الضريبة', f2(s.surplus)],
        ['صافي الفرق بعد الضريبة', f2(s.shortG + s.surplusG)],
      ];
    }
    if (pack.type === 'uncounted') {
      const pct = s.products ? Math.round(s.items / s.products * 100) : 0;
      return [
        ['أصناف غير معدودة', fq(s.products - s.items)],
        ['أصناف معدودة', fq(s.items)],
        ['إجمالي الأصناف', fq(s.products)],
        ['نسبة الإنجاز', pct + '%'],
      ];
    }
    const k = [
      ['الأصناف المعدودة', fq(s.items)],
      ['القيمة قبل الضريبة', f2(s.value)],
      ['مبلغ الضريبة', f2(s.tax)],
      ['القيمة بعد الضريبة', f2(s.valueG)],
    ];
    if (pack.hasBook) k.push(['أصناف فيها فرق', fq(s.diffs)]);
    return k;
  }

  const sumsOf = (cols, items) => {
    const out = {};
    for (const c of cols) if (c.sum) out[c.sum] = Math.round(items.reduce((a, i) => a + (i[c.sum] || 0), 0) * 1000) / 1000;
    return out;
  };
  const metaLine = pack => `${pack.day}  ${pack.date}      الوقت: ${pack.time}`;
  const priceNote = pack => (pack.includesTax ? 'أسعار الشراء في الملف شاملة الضريبة' : 'أسعار الشراء في الملف غير شاملة الضريبة');

  const toBytes = b => (b instanceof Uint8Array ? b : new Uint8Array(b));

  /* ======================= إكسل ======================= */
  async function buildXlsx(pack, assets) {
    const ExcelJS = root.ExcelJS;
    if (!ExcelJS) throw new Error('تعذّر تحميل مكتبة إكسل');
    assets = assets || {};
    const wb = new ExcelJS.Workbook();
    wb.creator = pack.company; wb.created = new Date();
    const logoId = null;

    const font = (o = {}) => Object.assign({ name: 'Arial', size: 11, color: { argb: 'FF' + hex(INK) } }, o);
    const fill = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(c) } });
    const border = { top: { style: 'thin', color: { argb: 'FF' + hex(LINE) } }, bottom: { style: 'thin', color: { argb: 'FF' + hex(LINE) } },
      left: { style: 'thin', color: { argb: 'FF' + hex(LINE) } }, right: { style: 'thin', color: { argb: 'FF' + hex(LINE) } } };

    function sheet(name, lastCol) {
      const ws = wb.addWorksheet(name, {
        views: [{ rightToLeft: true, showGridLines: false }],
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
        headerFooter: { oddFooter: '&L&P / &N&R' + pack.company },
      });
      ws.getColumn(1).width = 15;       // عمود الشعار
      header(ws, lastCol);
      return ws;
    }
    function header(ws, lastCol) {
      const rows = [
        [pack.company, font({ size: 20, bold: true, color: { argb: 'FF' + hex(NAVY) } }), 32],
        [pack.title, font({ size: 15, bold: true, color: { argb: 'FF' + hex(RED) } }), 26],
        [metaLine(pack), font({ size: 11, color: { argb: 'FF' + hex(MUTED) } }), 22],
      ];
      rows.forEach(([text, f, h], i) => {
        const r = i + 1;
        ws.mergeCells(r, 2, r, lastCol);
        const cell = ws.getCell(r, 2);
        cell.value = text; cell.font = f; cell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(r).height = h;
      });
      for (let c = 1; c <= lastCol; c++) ws.getCell(4, c).border = { top: { style: 'medium', color: { argb: 'FF000000' } } };
      ws.getRow(4).height = 4;
      ws.getRow(5).height = 8;
      if (logoId !== null) ws.addImage(logoId, { tl: { col: 0.08, row: 0.1 }, ext: { width: 86, height: 86 } });
    }

    function tableHeader(ws, row, titles, startCol) {
      titles.forEach((t, i) => {
        const c = ws.getCell(row, startCol + i);
        c.value = t; c.font = font({ bold: true, color: { argb: 'FF000000' } }); c.fill = fill(LIGHT);
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = border;
      });
      ws.getRow(row).height = 32;
    }

    function valueCell(cell, col, v, zebra) {
      cell.border = border;
      if (zebra) cell.fill = fill(ZEBRA);
      cell.font = font({ size: 10.5 });
      if (col.kind === 'text') { cell.value = v; cell.alignment = { horizontal: col.title === 'اسم الصنف' ? 'right' : 'center', vertical: 'middle', readingOrder: 'rtl' }; }
      else if (col.kind === 'code') { cell.value = v || ''; cell.numFmt = '@'; cell.alignment = { horizontal: 'center', vertical: 'middle' }; }
      else {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (v === null || v === undefined) { cell.value = ''; return; }
        cell.value = v;
        cell.numFmt = col.kind === 'money' ? '#,##0.00' : col.kind === 'price' ? '#,##0.000' : 'General';
        if (col.signed && v < 0) cell.font = font({ size: 10.5, color: { argb: 'FF' + hex(RED) }, bold: true });
      }
    }

    function itemsTable(ws, startRow, cols, items, opts = {}) {
      tableHeader(ws, startRow, cols.map(c => c.title), 2);
      let r = startRow + 1;
      items.forEach((it, n) => {
        cols.forEach((c, k) => {
          const cell = ws.getCell(r, 2 + k);
          if (c.kind === 'idx') { cell.value = n + 1; cell.alignment = { horizontal: 'center' }; cell.border = border; cell.font = font({ size: 10, color: { argb: 'FF' + hex(MUTED) } }); if (n % 2) cell.fill = fill(ZEBRA); }
          else valueCell(cell, c, c.get(it), n % 2 === 1);
        });
        ws.getRow(r).height = 20;
        r++;
      });
      const sums = sumsOf(cols, items);
      if (Object.keys(sums).length && items.length) {
        cols.forEach((c, k) => {
          const cell = ws.getCell(r, 2 + k);
          cell.fill = fill(LIGHT); cell.border = border; cell.font = font({ bold: true });
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          if (k === 1) cell.value = opts.totalLabel || 'المجموع';
          if (c.sum) {
            const col = ws.getColumn(2 + k).letter;
            cell.value = { formula: `SUM(${col}${startRow + 1}:${col}${r - 1})`, result: sums[c.sum] };
            cell.numFmt = '#,##0.00';
          }
        });
        ws.getRow(r).height = 24;
        r++;
      }
      return r;
    }

    function setWidths(ws, cols) { cols.forEach((c, k) => { ws.getColumn(2 + k).width = c.xl; }); }

    /* ---- ورقة الملخص ---- */
    const sum = sheet('الملخص', 7);
    [34, 18, 18, 18, 18, 18].forEach((w, i) => { sum.getColumn(2 + i).width = w; });
    let r = 6;
    const k = kpisFor(pack);
    tableHeader(sum, r, ['المؤشر', 'القيمة'], 2); r++;
    k.forEach(([label, value], n) => {
      const a = sum.getCell(r, 2), b = sum.getCell(r, 3);
      a.value = label; b.value = value;
      [a, b].forEach(c => { c.border = border; c.font = font({ size: 11.5 }); c.alignment = { horizontal: 'center', vertical: 'middle' }; if (n % 2) c.fill = fill(ZEBRA); });
      a.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl' };
      b.font = font({ size: 12, bold: true, color: { argb: 'FF' + hex(NAVY) } });
      sum.getRow(r).height = 24; r++;
    });
    const note = sum.getCell(r + 1, 2); sum.mergeCells(r + 1, 2, r + 1, 7);
    note.value = priceNote(pack); note.font = font({ size: 10, color: { argb: 'FF' + hex(MUTED) } }); note.alignment = { horizontal: 'right', readingOrder: 'rtl' };
    r += 3;
    if (pack.type === 'full' || pack.type === 'tax') {
      const t = sum.getCell(r, 2); sum.mergeCells(r, 2, r, 7);
      t.value = 'ملخص فئات الضريبة'; t.font = font({ size: 13, bold: true, color: { argb: 'FF' + hex(NAVY) } }); t.alignment = { horizontal: 'right', readingOrder: 'rtl' };
      r++;
      tableHeader(sum, r, ['الفئة', 'أصناف معدودة', 'كل الأصناف', 'القيمة قبل الضريبة', 'مبلغ الضريبة', 'القيمة بعد الضريبة'], 2);
      const first = r + 1; r++;
      pack.taxCats.filter(c => c.tax !== null || c.products > 0).forEach((c, n) => {
        const vals = [c.tax === null ? 'غير محدد (تُحتسب 0%)' : c.tax + '%', c.items, c.products, c.base, c.taxAmount, c.gross];
        vals.forEach((v, i) => {
          const cell = sum.getCell(r, 2 + i);
          cell.value = v; cell.border = border; cell.font = font({ size: 11 });
          cell.alignment = { horizontal: i === 0 ? 'right' : 'center', vertical: 'middle', readingOrder: 'rtl' };
          if (i >= 3) cell.numFmt = '#,##0.00';
          if (n % 2) cell.fill = fill(ZEBRA);
        });
        sum.getRow(r).height = 22; r++;
      });
      const tot = pack.taxTotal;
      [['المجموع', null], [tot.items, 1], [tot.products, 2], [tot.base, 3], [tot.taxAmount, 4], [tot.gross, 5]].forEach(([v], i) => {
        const cell = sum.getCell(r, 2 + i);
        cell.value = v; cell.fill = fill(LIGHT); cell.border = border; cell.font = font({ bold: true });
        cell.alignment = { horizontal: i === 0 ? 'right' : 'center', vertical: 'middle', readingOrder: 'rtl' };
        if (i >= 3) {
          const col = sum.getColumn(2 + i).letter;
          cell.value = { formula: `SUM(${col}${first}:${col}${r - 1})`, result: v }; cell.numFmt = '#,##0.00';
        }
      });
      sum.getRow(r).height = 24;
    }

    /* ---- ورقة الأصناف ---- */
    const cols = columnsFor(pack);
    if (pack.type === 'tax') {
      const ws = sheet('تفاصيل الفئات', cols.length + 1);
      setWidths(ws, cols);
      let row = 6;
      if (!pack.groups.length) { ws.getCell(row, 2).value = 'لا توجد أصناف معدودة'; }
      pack.groups.forEach(g => {
        ws.mergeCells(row, 2, row, cols.length + 1);
        const t = ws.getCell(row, 2);
        t.value = `${g.tax === null ? 'ضريبة غير محددة (تُحتسب 0%)' : 'فئة الضريبة ' + g.tax + '%'}   —   ${g.items.length} صنف`;
        t.font = font({ size: 12.5, bold: true, color: { argb: 'FF000000' } }); t.fill = fill(LIGHT);
        t.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl' };
        ws.getRow(row).height = 26; row++;
        row = itemsTable(ws, row, cols, g.items, { totalLabel: 'مجموع الفئة' }) + 1;
      });
    } else {
      const ws = sheet(pack.type === 'uncounted' ? 'الأصناف غير المعدودة' : pack.type === 'diff' ? 'الفروقات' : 'الأصناف', cols.length + 1);
      setWidths(ws, cols);
      if (!pack.items.length) { ws.getCell(6, 2).value = 'لا توجد أصناف'; }
      else {
        itemsTable(ws, 6, cols, pack.items);
        ws.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: 6, xSplit: 0 }];
        ws.autoFilter = { from: { row: 6, column: 2 }, to: { row: 6, column: cols.length + 1 } };
        ws.pageSetup.printTitlesRow = '6:6';
      }
    }
    return toBytes(await wb.xlsx.writeBuffer());
  }

  /* ======================= PDF ======================= */
  async function buildPdf(pack, assets, onProgress) {
    const jsPDF = (root.jspdf && root.jspdf.jsPDF) || root.jsPDF;
    if (!jsPDF) throw new Error('تعذّر تحميل مكتبة PDF');
    assets = assets || {};
    if (!assets.fonts) throw new Error('الخط العربي غير متوفر');
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
    doc.addFileToVFS('NotoNaskh-Regular.ttf', assets.fonts.regular); doc.addFont('NotoNaskh-Regular.ttf', 'Naskh', 'normal');
    doc.addFileToVFS('NotoNaskh-Bold.ttf', assets.fonts.bold); doc.addFont('NotoNaskh-Bold.ttf', 'Naskh', 'bold');
    const W = 297, H = 210, M = 10, FOOT = 10;
    
    const tick = () => new Promise(r => setTimeout(r, 0));

    const color = (c, kind) => (kind === 'fill' ? doc.setFillColor(...c) : kind === 'draw' ? doc.setDrawColor(...c) : doc.setTextColor(...c));
    function text(s, x, y, o = {}) {
      s = String(s);
      doc.setFont('Naskh', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 9);
      color(o.color || INK, 'text');
      const opts = { align: o.align || 'left' };
      if (AR.test(s)) opts.lang = 'ar';
      doc.text(s, x, y, opts);
    }
    function fit(s, maxW, o = {}) {
      s = String(s);
      doc.setFont('Naskh', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 9);
      if (doc.getTextWidth(s) <= maxW) return s;
      while (s.length > 1 && doc.getTextWidth(s + '…') > maxW) s = s.slice(0, -1);
      return s + '…';
    }
    const rect = (x, y, w, h, c, r) => { color(c, 'fill'); r ? doc.roundedRect(x, y, w, h, r, r, 'F') : doc.rect(x, y, w, h, 'F'); };

    let y = 0, first = true;
    function pageHeader() {
      if (first) {
        text(pack.company, W / 2, 14, { size: 20, bold: true, align: 'center' });
        text(pack.title, W / 2, 23, { size: 14, bold: true, align: 'center' });
        text(pack.day + '  ' + pack.date, W - M, 32, { size: 10.5, align: 'right' });
        text('الوقت: ' + pack.time, M, 32, { size: 10.5, align: 'left' });
        color(INK, 'draw'); doc.setLineWidth(0.5); doc.line(M, 35, W - M, 35);
        y = 42; first = false;
      } else {
        text(pack.company + '  —  ' + pack.title, W - M, 6.2, { size: 10, bold: true, align: 'right' });
        text(pack.day + ' ' + pack.date + ' ' + pack.time, M, 6.2, { size: 9, align: 'left' });
        color(INK, 'draw'); doc.setLineWidth(0.3); doc.line(M, 8.5, W - M, 8.5);
        y = 15;
      }
    }
    function newPage() { doc.addPage(); pageHeader(); }
    const ensure = h => { if (y + h > H - FOOT) { newPage(); return true; } return false; };

    function kpiCards(list) {
      const gap = 5, w = (W - 2 * M - gap * (list.length - 1)) / list.length, h = 20;
      list.forEach(([label, value], i) => {
        const x = W - M - (i + 1) * w - i * gap;
        color(INK, 'draw'); doc.setLineWidth(0.3); doc.rect(x, y, w, h, 'S');
        text(label, x + w / 2, y + 7, { size: 9.5, color: MUTED, align: 'center' });
        text(value, x + w / 2, y + 15.5, { size: 15, bold: true, color: NAVY, align: 'center' });
      });
      y += h + 8;
    }

    function sectionTitle(s, c) {
      ensure(14);
      text(s, W - M - 5, y + 5.5, { size: 12.5, bold: true, color: NAVY, align: 'right' });
      y += 10;
    }

    /** جدول: cols[i] = {title, w, align, text(row)} بترتيب من اليمين لليسار */
    async function table(cols, rows, o = {}) {
      const RH = o.rowH || 6.4, HH = 9;
      const drawHead = () => {
        let xr = W - M;
        rect(M, y, W - 2 * M, HH, LIGHT); color(INK, 'draw'); doc.setLineWidth(0.3); doc.rect(M, y, W - 2 * M, HH, 'S');
        cols.forEach(c => {
          const lines = c.title.length > 12 && c.w < 28 ? splitTitle(c.title) : [c.title];
          lines.forEach((ln, li) => text(ln, xr - c.w / 2, y + (lines.length === 1 ? 6 : 4 + li * 3.6), { size: lines.length === 1 ? 9 : 8, bold: true, color: INK, align: 'center' }));
          xr -= c.w;
        });
        y += HH;
      };
      const splitTitle = t => { const w = t.split(' '); const mid = Math.ceil(w.length / 2); return [w.slice(0, mid).join(' '), w.slice(mid).join(' ')]; };
      ensure(HH + RH * 2); drawHead();
      let n = 0;
      for (const row of rows) {
        if (y + RH > H - FOOT) { newPage(); drawHead(); }
        if (n % 2) rect(M, y, W - 2 * M, RH, ZEBRA);
        let xr = W - M;
        cols.forEach(c => {
          const v = c.text(row, n);
          if (v !== null && v !== undefined && v !== '') {
            const o2 = { size: 8.5, bold: !!row._bold, color: c.color ? c.color(row) : INK };
            const s = c.name ? fit(v, c.w - 3, o2) : String(v);
            if (c.align === 'right') text(s, xr - 1.8, y + 4.5, { ...o2, align: 'right' });
            else text(s, xr - c.w / 2, y + 4.5, { ...o2, align: 'center' });
          }
          xr -= c.w;
        });
        color(LINE, 'draw'); doc.setLineWidth(0.2); doc.line(M, y + RH, W - M, y + RH);
        y += RH; n++;
        if (n % 150 === 0) { if (onProgress) onProgress(Math.min(0.95, n / Math.max(rows.length, 1))); await tick(); }
      }
      if (o.totals) {
        rect(M, y, W - 2 * M, RH + 1, LIGHT);
        let xr = W - M;
        cols.forEach((c, k) => {
          const v = o.totals(c, k);
          if (v) text(v, c.align === 'right' ? xr - 1.8 : xr - c.w / 2, y + 5, { size: 9, bold: true, color: NAVY, align: c.align === 'right' ? 'right' : 'center' });
          xr -= c.w;
        });
        y += RH + 1;
      }
      y += 6;
    }

    function itemCols() {
      const base = columnsFor(pack);
      const fixed = base.reduce((a, c) => a + c.mm, 0);
      const nameW = W - 2 * M - fixed;
      return base.map(c => {
        const out = { title: c.title, w: c.kind === 'text' && c.title === 'اسم الصنف' ? nameW : c.mm, name: c.title === 'اسم الصنف', align: c.title === 'اسم الصنف' ? 'right' : 'center' };
        out.sum = c.sum;
        out.text = (it, n) => {
          if (c.kind === 'idx') return n + 1;
          const v = c.get(it);
          if (v === null || v === undefined) return '';
          if (c.kind === 'money') return f2(v);
          if (c.kind === 'price') return f3(v);
          if (c.kind === 'qty') return (c.signed && v > 0 ? '+' : '') + fq(v);
          return v;
        };
        if (c.signed) out.color = it => { const v = c.get(it); return v < 0 ? RED : INK; };
        return out;
      });
    }
    const totalsFor = (cols, items, label) => {
      const sums = sumsOf(columnsFor(pack), items);
      return (c, k) => (k === 1 ? label : c.sum ? f2(sums[c.sum] || 0) : '');
    };

    /* ---- بناء الصفحات ---- */
    pageHeader();
    kpiCards(kpisFor(pack));

    if (pack.type === 'full' || pack.type === 'tax') {
      sectionTitle('ملخص فئات الضريبة');
      const tc = [
        { title: 'الفئة', w: 62, align: 'right', text: r => r.label },
        { title: 'أصناف معدودة', w: 38, text: r => r.items },
        { title: 'كل الأصناف', w: 38, text: r => r.products },
        { title: 'القيمة قبل الضريبة', w: 46, text: r => f2(r.base) },
        { title: 'مبلغ الضريبة', w: 46, text: r => f2(r.taxAmount) },
        { title: 'القيمة بعد الضريبة', w: 47, text: r => f2(r.gross) },
      ];
      const rows = pack.taxCats.filter(c => c.tax !== null || c.products > 0)
        .map(c => ({ ...c, label: c.tax === null ? 'غير محدد (تُحتسب 0%)' : c.tax + '%' }));
      const t = pack.taxTotal;
      await table(tc, rows, { totals: (c, k) => [ 'المجموع', t.items, t.products, f2(t.base), f2(t.taxAmount), f2(t.gross) ][k] });
      text(priceNote(pack), W - M, y - 2, { size: 9, color: MUTED, align: 'right' });
      y += 4;
    } else {
      text(priceNote(pack), W - M, y - 2, { size: 9, color: MUTED, align: 'right' });
      y += 4;
    }

    const cols = itemCols();
    const hasSums = columnsFor(pack).some(c => c.sum);
    if (pack.type === 'tax') {
      for (const g of pack.groups) {
        sectionTitle(`${g.tax === null ? 'ضريبة غير محددة (تُحتسب 0%)' : 'فئة الضريبة ' + g.tax + '%'}  —  ${g.items.length} صنف`, RED);
        await table(cols, g.items, { totals: hasSums ? totalsFor(cols, g.items, 'مجموع الفئة') : null });
      }
      if (!pack.groups.length) text('لا توجد أصناف معدودة', W - M, y + 5, { size: 11, color: MUTED, align: 'right' });
    } else {
      sectionTitle(pack.type === 'uncounted' ? 'الأصناف غير المعدودة' : pack.type === 'diff' ? 'الأصناف التي فيها فرق' : 'تفاصيل الأصناف المعدودة');
      if (pack.items.length) await table(cols, pack.items, { totals: hasSums ? totalsFor(cols, pack.items, 'المجموع') : null });
      else text('لا توجد أصناف', W - M, y + 5, { size: 11, color: MUTED, align: 'right' });
    }

    /* ---- تذييل كل صفحة ---- */
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      color(LINE, 'draw'); doc.setLineWidth(0.2); doc.line(M, H - 8, W - M, H - 8);
      text(`صفحة ${i} من ${n}`, M, H - 3.8, { size: 8.5, color: MUTED, align: 'left' });
      text(pack.company, W - M, H - 3.8, { size: 8.5, color: MUTED, align: 'right' });
    }
    if (onProgress) onProgress(1);
    return toBytes(doc.output('arraybuffer'));
  }

  Inv.report = { buildXlsx, buildPdf, columnsFor, kpisFor };
})(typeof window !== 'undefined' ? window : globalThis);
