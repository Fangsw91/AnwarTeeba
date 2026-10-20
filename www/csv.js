/* قراءة وكتابة CSV + تحويل الأرقام (يشتغل بالمتصفح وبـ node للاختبار) */
(function (root) {
  const Inv = (root.Inv = root.Inv || {});

  const ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٫': '.' };

  function parseNumber(v) {
    let s = String(v == null ? '' : v).replace(/[٠-٩٫]/g, c => ARABIC_DIGITS[c]).replace(/\s+/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
    else s = s.replace(/,/g, '.');
    const n = Number(s);
    return s !== '' && isFinite(n) ? n : 0;
  }

  /** يفك ترميز ملف: UTF-8 أولاً، وإذا فشل نجرّب Windows-1256 (Excel العربي القديم) */
  function decodeBuffer(buf) {
    let bytes = new Uint8Array(buf);
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bytes = bytes.subarray(3);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('windows-1256').decode(bytes);
    }
  }

  /** CSV → مصفوفة صفوف. يكتشف الفاصل (, ; tab) ويدعم النص بين علامتي اقتباس */
  function parse(text) {
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    let delim = ',';
    for (const d of [';', '\t']) {
      if (first.split(d).length > first.split(delim).length) delim = d;
    }
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
        } else cell += c;
      } else if (c === '"' && cell === '') inQ = true;   // الاقتباس يبدأ فقط بأول الخلية
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        rows.push(row); row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }

  function stringify(rows) {
    return rows.map(r => r.map(v => {
      const s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }

  /** حماية من الصيغ في Excel (= + - @ بأول النص) */
  function safeText(s) {
    s = String(s == null ? '' : s);
    return s && '=+-@'.includes(s[0]) ? "'" + s : s;
  }

  /** ="628..." (الصيغة اللي نكتبها بالتصدير) → 628... */
  function cleanBarcode(s) {
    s = String(s == null ? '' : s).trim();
    const m = s.match(/^="(.*)"$/);
    return m ? m[1] : s;
  }

  Inv.csv = { parse, stringify, parseNumber, decodeBuffer, safeText, cleanBarcode };
})(typeof window !== 'undefined' ? window : globalThis);
