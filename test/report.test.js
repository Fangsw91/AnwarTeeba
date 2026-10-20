// اختبار توليد تقارير إكسل وPDF: node test/report.test.js [مجلد_الخرج]
require('fake-indexeddb/auto');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
require('../www/csv.js'); require('../www/db.js');
globalThis.ExcelJS = require('exceljs');
globalThis.jspdf = require('jspdf');
require('../www/report.js');
const { Inv } = globalThis;
const vm = require('vm'); const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../www/vendor/report-assets.js'), 'utf8'), ctx);
const assets = ctx.window.InvAssets;
const out = process.argv[2] || require('os').tmpdir();
(async () => {
  const s = Inv.createStore(); await s.init('t');
  await s.setMeta('deviceName', 'أحمد'); await s.setMeta('stocktakeName', 'جرد 2026');
  const rows = [['الباركود', 'الصنف', 'الوحدة', 'سعر الشراء', 'الكمية']];
  for (let i = 1; i <= 120; i++) rows.push(['62900' + String(i).padStart(7, '0'), (i % 3 ? 'حليب المراعي كامل الدسم ' : 'أرز بسمتي فاخر ') + i, 'حبة', (i * 0.37 + 1).toFixed(2), i % 5]);
  await s.importProducts(rows);
  const ps = []; for (const q of ['حليب', 'أرز']) ps.push(...s.lookupAll(q, 200).items);
  let n = 0; for (const p of ps) { await s.updateProduct(p.id, { tax: [0, 1, 2, 5, 10, 16][n % 6] }); if (n % 2 === 0) await s.addCount(p.id, n % 7 + 1, 'أحمد'); n++; }
  for (const type of ['full', 'tax', 'diff', 'uncounted']) {
    const pack = s.reportPack(type, type === 'tax' ? { rate: process.env.RATE || 'all' } : {});
    const x = await Inv.report.buildXlsx(pack, assets); assert.ok(x.length > 5000);
    fs.writeFileSync(path.join(out, type + '.xlsx'), x);
    const p = await Inv.report.buildPdf(pack, assets); assert.ok(p.length > 5000);
    fs.writeFileSync(path.join(out, type + '.pdf'), p);
    console.log('✓', type, x.length, p.length);
  }
})().catch(e => { console.error(e); process.exit(1); });
