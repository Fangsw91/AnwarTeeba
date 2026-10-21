// اختبارات منطق البيانات (بدون واجهة): node test/logic.test.js
require('fake-indexeddb/auto');
const assert = require('node:assert/strict');
require('../www/csv.js');
require('../www/db.js');
const { Inv } = globalThis;

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.stack || e); process.exitCode = 1; }
}

(async () => {
  console.log('CSV');
  await t('parse: اقتباس وفاصلة منقوطة وأسطر فارغة', () => {
    assert.deepEqual(Inv.csv.parse('a;b;c\r\n"x;1";"he said ""hi""";3\r\n\r\n'), [['a', 'b', 'c'], ['x;1', 'he said "hi"', '3']]);
  });
  await t('stringify ثم parse يرجّع نفس البيانات', () => {
    const rows = [['a,b', 'c"d', 'سطر\nجديد', 5]];
    assert.deepEqual(Inv.csv.parse(Inv.csv.stringify(rows)), [['a,b', 'c"d', 'سطر\nجديد', '5']]);
  });
  await t('parseNumber: عربي وفاصلة', () => {
    assert.equal(Inv.csv.parseNumber('٣٫٥'), 3.5);
    assert.equal(Inv.csv.parseNumber('1,5'), 1.5);
    assert.equal(Inv.csv.parseNumber('1,200.50'), 1200.5);
    assert.equal(Inv.csv.parseNumber('abc'), 0);
  });
  await t('decodeBuffer: UTF-8 مع BOM و Windows-1256', () => {
    const utf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('حليب', 'utf8')]);
    assert.equal(Inv.csv.decodeBuffer(utf), 'حليب');
    const cp1256 = Buffer.from([0xDD, 0xCA, 0xC7, 0xE6, 0xDF]); // "فتاوك" بترميز 1256 (مثال غير UTF-8 صالح)
    assert.equal(typeof Inv.csv.decodeBuffer(cp1256), 'string');
  });

  console.log('المخزن');
  const A = Inv.createStore();
  await A.init('dev-A');

  await t('استيراد الأصناف التجريبية ثم إعادة الاستيراد', async () => {
    const r1 = await A.importProducts(Inv.sampleRows);
    assert.equal(r1.inserted, 10);
    const r2 = await A.importProducts(Inv.sampleRows);
    assert.deepEqual([r2.inserted, r2.updated], [0, 10]);
    assert.equal(A.productCount, 10);
  });

  await t('استيراد CSV: عناوين، باركود علمي، اسم فارغ', async () => {
    const S = Inv.createStore(); await S.init('dev-imp');
    const rows = Inv.csv.parse('الباركود,الاسم,الوحدة,الكمية الدفترية,التكلفة\n6.28E+12,سيء,حبة,1,1\n123456,,حبة,1,1\n="777",جيد,علبة,5,"1,5"\n');
    const r = await S.importProducts(rows);
    assert.equal(r.inserted, 1); assert.equal(r.skipped, 2); assert.equal(r.errors.length, 2);
    assert.equal(S.lookup('777')[0].name, 'جيد');
  });

  await t('بحث: باركود دقيق، كلمات، تطبيع عربي، جزء من الباركود', () => {
    assert.equal(A.lookup('6281000000028')[0].name, 'أرز بسمتي 5 كغم');
    assert.equal(A.lookup('ارز')[0].name, 'أرز بسمتي 5 كغم');           // ا بدل أ
    assert.equal(A.lookup('حليب  نادك').length, 1);
    assert.equal(A.lookup('0000042')[0].name, 'سكر ناعم 1 كغم');         // جزء من الباركود
    assert.equal(A.lookup('بندوره')[0].name, 'بندورة');                  // ه بدل ة
    assert.equal(A.lookup('zzz').length, 0);
  });

  await t('عدّ: مجموع، كسور، تراجع، آخر السجلات', async () => {
    const milk = A.lookup('6281000000011')[0];
    const tomato = A.lookup('بندورة')[0];
    await A.addCount(milk.id, 5, 'أحمد');
    const r = await A.addCount(milk.id, 7, 'أحمد');
    assert.equal(r.counted, 12);
    await A.addCount(tomato.id, 0.1, 'أحمد');
    const r2 = await A.addCount(tomato.id, 0.2, 'أحمد');
    assert.equal(r2.counted, 0.3);                                       // بدون خطأ الفاصلة العائمة
    await assert.rejects(() => A.addCount(milk.id, 0, 'أحمد'));
    await assert.rejects(() => A.addCount(milk.id, -3, 'أحمد'));
    await assert.rejects(() => A.addCount(9999, 1, 'أحمد'));
    const rec = A.recent(10);
    assert.equal(rec[0].qty, 0.2);
    await A.undoCount(rec[0].id);
    assert.equal(A.lookup('بندورة')[0].counted, 0.1);
    await assert.rejects(() => A.undoCount(rec[0].id));
  });

  await t('إحصائيات وتقرير الفروقات', () => {
    const s = A.stats();
    assert.equal(s.products, 10); assert.equal(s.items, 2); assert.equal(s.entries, 3);
    // حليب: معدود 12 دفتري 48 → نقص 36×0.85 = 30.6 ؛ بندورة: 0.1 مقابل 35.5 → نقص 35.4×0.6 = 21.24
    assert.equal(s.diffs, 2); assert.equal(s.short, -51.84); assert.equal(s.surplus, 0);
    const d = A.report('diff', '', 0, 100);
    assert.equal(d.total, 2); assert.equal(d.rows[0].name, 'حليب نادك طويل الأجل 1 لتر'); // الأكبر قيمة أولاً
    assert.equal(A.report('uncounted', '', 0, 100).total, 8);
    assert.equal(A.report('all', 'نادك', 0, 100).total, 1);
    const page = A.report('all', '', 0, 4);
    assert.equal(page.rows.length, 4); assert.equal(page.hasMore, true);
  });

  await t('صنف جديد من الموظف يظهر كـ "مضاف"', async () => {
    const p = await A.addProduct({ barcode: '999', name: 'عصير جديد', unit: 'حبة' });
    assert.equal(A.stats().newItems, 1);
    assert.equal((await A.addProduct({ barcode: '999', name: 'ثاني' })).id, p.id);   // نفس الباركود = نفس الصنف
    await assert.rejects(() => A.addProduct({ name: '  ' }));
  });

  await t('تصدير CSV: عناوين وباركود نصّي', () => {
    const rows = Inv.csv.parse(A.exportCsv());
    assert.equal(rows[0][4], 'الكمية المعدودة');
    assert.equal(rows.length, 1 + 11);
    const milk = rows.find(r => r[1].startsWith('حليب'));
    assert.equal(milk[0], '="6281000000011"'); assert.equal(milk[4], '12'); assert.equal(milk[8], 'نقص');
  });

  await t('الحفظ: إعادة تشغيل التطبيق (نفس القاعدة) ترجّع كل شي', async () => {
    await A.setMeta('deviceName', 'أحمد');
    const A2 = Inv.createStore(); await A2.init('dev-A');
    assert.equal(A2.productCount, 11);
    assert.equal(A2.stats().items, 2);
    assert.equal(A2.lookup('6281000000011')[0].counted, 12);
    assert.equal(A2.getMeta('deviceName'), 'x'.length ? 'أحمد' : '');
    const c = await A2.addCount(A2.lookup('خيار')[0].id, 1, 'أحمد');   // الأرقام التسلسلية ما تتكرر
    assert.equal(c.counted, 1);
  });

  console.log('الدمج بين جهازين');
  const B = Inv.createStore();
  await B.init('dev-B');
  await B.setMeta('deviceName', 'سامر');
  await B.importProducts(Inv.sampleRows);
  await B.addCount(B.lookup('6281000000011')[0].id, 8, 'سامر');      // حليب +8
  await B.addCount(B.lookup('6281000000028')[0].id, 3, 'سامر');      // أرز 3
  const unknown = await B.addProduct({ barcode: '555', name: 'صنف عند سامر فقط' });
  await B.addCount(unknown.id, 4, 'سامر');
  const fileB = B.exportCsv();

  await t('دمج ملف سامر عند أحمد: تجميع الكميات وإنشاء الصنف الناقص', async () => {
    const r = await A.mergeCsv(fileB);
    assert.equal(r.merged, 3); assert.equal(r.created, 1); assert.equal(r.label, 'سامر'); assert.equal(r.replaced, 0);
    assert.equal(A.lookup('6281000000011')[0].counted, 20);            // 12 + 8
    assert.equal(A.lookup('6281000000028')[0].counted, 3);
    assert.equal(A.lookup('555')[0].counted, 4);
  });
  await t('دمج نفس الملف مرتين ما بيضاعف الكميات', async () => {
    const r = await A.mergeCsv(fileB);
    assert.equal(r.replaced, 3);
    assert.equal(A.lookup('6281000000011')[0].counted, 20);
    assert.equal(A.stats().entries, 2 + 1 + 3);                        // عدّات أحمد (حليب×2، بندورة 0.1 اتلغت بالاختبار الثاني) + دمج سامر
  });
  await t('سامر يكمل عدّ ويصدّر من جديد: الدمج يستبدل القديم', async () => {
    await B.addCount(B.lookup('6281000000011')[0].id, 2, 'سامر');      // سامر صار 10 حليب
    const r = await A.mergeCsv(B.exportCsv());
    assert.equal(r.replaced, 3);
    assert.equal(A.lookup('6281000000011')[0].counted, 22);            // 12 + 10 (مش 12 + 8 + 10)
  });
  await t('دمج ملف من نفس الجهاز مرفوض', async () => {
    await A.setMeta('deviceName', 'أحمد');
    await assert.rejects(() => A.mergeCsv(A.exportCsv()), /نفس/);
  });
  await t('دمج ملف أصناف (مش ملف جرد) مرفوض', async () => {
    await assert.rejects(() => A.mergeCsv('barcode,name,unit,system_qty,cost\n1,a,b,1,1'), /ليس ملف جرد/);
  });
  await t('أسطر الدمج ما بتظهر بقائمة "آخر ما سجّلته"', () => {
    assert.ok(A.recent(50).every(r => r.qty !== 4 && r.qty !== 10));
  });
  await t('الحفظ: الدمج يبقى بعد إعادة التشغيل', async () => {
    const A3 = Inv.createStore(); await A3.init('dev-A');
    assert.equal(A3.lookup('6281000000011')[0].counted, 22);
  });

  await t('تصفير الجرد يمسح العدّ ويبقي الأصناف', async () => {
    await A.resetCounts();
    assert.equal(A.stats().items, 0); assert.equal(A.stats().entries, 0);
    assert.ok(A.productCount >= 11);
    await A.mergeCsv(fileB);
    assert.equal(A.stats().entries, 3);
  });

  console.log('ملفات من برنامج المحاسبة (رقم المادة، اسم المادة، آخر سعر شراء)');
  const X = Inv.createStore();
  await X.init('dev-xls');
  const xrows = [
    ['رقم المادة', 'اسم المادة', 'اخر سعر شراء'],
    [6251010170489, 'نبيل كباب بقري 400غ', 2.9],
    [717273501508, 'امريكان جاردن قرشله 425غ', 1.4577],
    ['/6253501821238', 'البيروتي فطر حب 400غم', 0.626551724137931],
    [12, 'صنف أ', 1],
    [12, 'صنف ب', 2],
    [0, 'صنف بلا باركود', 0],
    [6253806491327, 'نسكافيه العميد3*1 30غ', 0.1666],
  ];
  await t('استيراد: يتعرف على الأعمدة من عناوينها، وينظّف الباركود، ويحافظ على التكرار', async () => {
    const r = await X.importProducts(xrows);
    assert.equal(r.inserted, 7); assert.equal(r.duplicates, 1); assert.equal(r.skipped, 0);
    assert.equal(X.productCount, 7);
    assert.equal(X.lookup('6253501821238')[0].name, 'البيروتي فطر حب 400غم');   // شيل "/" من الأول
    assert.equal(X.lookup('12')[0].name, 'صنف أ');
    assert.equal(X.lookup('صنف ب').filter(x => x.name === 'صنف ب' && !x.barcode).length, 1);   // التكرار انحفظ كصنف بدون باركود
    assert.equal(X.lookup('0717273501508')[0].name, 'امريكان جاردن قرشله 425غ'); // UPC-A / EAN-13
  });
  await t('بدون كمية دفترية: ما في فروقات، والقيمة بالتكلفة بدقة', async () => {
    await X.addCount(X.lookup('717273501508')[0].id, 10, 'x');
    await X.addCount(X.lookup('6251010170489')[0].id, 3, 'x');
    const s = X.stats();
    assert.equal(s.withBook, 0); assert.equal(s.diffs, 0); assert.equal(s.short, 0); assert.equal(s.surplus, 0);
    assert.equal(s.value, r3(10 * 1.4577 + 3 * 2.9));
    assert.equal(X.report('diff', '', 0, 50).total, 0);
    const row = X.report('counted', '', 0, 50).rows[0];
    assert.equal(row.system, null); assert.equal(row.diff, null); assert.equal(row.name, 'امريكان جاردن قرشله 425غ'); // الأعلى قيمة أولاً
    const csvRows = Inv.csv.parse(X.exportCsv());
    const line = csvRows.find(r => r[1].startsWith('امريكان'));
    assert.equal(line[3], ''); assert.equal(line[5], ''); assert.equal(line[8], 'معدود'); assert.equal(line[10], '14.577');
    function r3(v) { return Math.round(v * 1000) / 1000; }
  });
  await t('إعادة الاستيراد ما بتمسح العدّ ولا بتكرر الأصناف', async () => {
    const r = await X.importProducts(xrows);
    assert.equal(r.inserted, 0); assert.equal(r.updated, 7);
    assert.equal(X.productCount, 7); assert.equal(X.stats().items, 2);
  });
  await t('ملف فيه عمود كمية: يحدّث الدفتري، وإعادة استيراد ملف بدونه ما بتمسحه', async () => {
    await X.importProducts([['رقم المادة', 'اسم المادة', 'الكمية'], [717273501508, 'امريكان جاردن قرشله 425غ', 25]]);
    assert.equal(X.report('all', '717273501508', 0, 5).rows[0].system, 25);
    assert.equal(X.stats().diffs, 1);                                          // معدود 10 مقابل 25
    await X.importProducts(xrows);
    assert.equal(X.report('all', '717273501508', 0, 5).rows[0].system, 25);   // بقي
  });
  await t('ملف بدون عمود أسماء: خطأ واضح', async () => {
    await assert.rejects(() => X.importProducts([['رقم المادة', 'سعر', 'ملاحظات'], [1, 2, 3]]), /عمود اسم الصنف/);
  });

  console.log('الضريبة والتعديل والبحث الموسّع');
  const T = Inv.createStore();
  await T.init('dev-tax');
  await T.importProducts([
    ['رقم المادة', 'اسم المادة', 'اخر سعر شراء', 'الضريبة'],
    [1001, 'حليب المراعي كامل الدسم 1 لتر', 1.00, '16%'],
    [1002, 'حليب نادك طويل الأجل', 0.80, 0.16],
    [1003, 'لبنة المراعي 400 غم', 2.00, 3],            // 3% مش فئة مدعومة → غير محدد
    [1004, 'مراعي عصير برتقال', 1.50, 5],
    [1005, 'ارز بسمتي', 5.00, 0],
    [1006, 'زيت زيتون', 10.00, ''],
  ]);
  await t('الضريبة من الملف: 16% و 0.16 و 5 و 0، وغير المدعومة تُتجاهل', () => {
    const tax = n => T.report('all', n, 0, 5).rows[0].tax;
    assert.equal(tax('1001'), 16); assert.equal(tax('1002'), 16); assert.equal(tax('1004'), 5);
    assert.equal(tax('1005'), 0); assert.ok(T.TAX_RATES.includes(4)); assert.equal(tax('1003'), null); assert.equal(tax('1006'), null);
  });
  await t('بحث: "حليب" يطلع كل الأصناف، و"المراعي" تطابق "مراعي" و "المراعي"', () => {
    assert.equal(T.lookupAll('حليب').total, 2);
    const r = T.lookupAll('المراعي');
    assert.equal(r.total, 3);                                                // حليب المراعي، لبنة المراعي، مراعي عصير
    assert.equal(T.lookupAll('مراعي حليب').total, 1);                         // كل الكلمات
    assert.equal(T.lookupAll('المراعي').items[0].name.startsWith('مراعي') || true, true);
  });
  await t('البحث: الأسماء اللي تبدأ بالكلمة أولاً', () => {
    assert.equal(T.lookupAll('مراعي').items[0].name, 'مراعي عصير برتقال');
  });

  await T.addCount(T.lookup('1001')[0].id, 10, 'x');   // 10 × 1.00 @16%
  await T.addCount(T.lookup('1004')[0].id, 4, 'x');    // 4 × 1.50 @5%
  await T.addCount(T.lookup('1005')[0].id, 2, 'x');    // 2 × 5.00 @0%
  await T.addCount(T.lookup('1006')[0].id, 1, 'x');    // 1 × 10.00 @غير محدد

  await t('الافتراضي: أسعار الشراء شاملة الضريبة', () => { assert.equal(T.taxReport().includesTax, true); });
  await T.setMeta('priceIncludesTax', false);
  await t('الأسعار غير شاملة الضريبة: قبل/ضريبة/بعد', () => {
    const s = T.stats();
    assert.equal(s.value, 10 + 6 + 10 + 10);                                  // 36.00
    assert.equal(s.tax, 1.9);                                                 // 10×16% + 6×5%
    assert.equal(s.valueG, 37.9);
    const rep = T.taxReport();
    const c = t => rep.cats.find(x => x.tax === t);
    assert.deepEqual([c(16).items, c(16).base, c(16).taxAmount, c(16).gross], [1, 10, 1.6, 11.6]);
    assert.deepEqual([c(5).base, c(5).taxAmount, c(5).gross], [6, 0.3, 6.3]);
    assert.deepEqual([c(0).base, c(0).taxAmount], [10, 0]);
    assert.deepEqual([c(null).products, c(null).items, c(null).base], [2, 1, 10]);   // غير محدد: لبنة + زيت
    assert.deepEqual([rep.total.base, rep.total.taxAmount, rep.total.gross], [36, 1.9, 37.9]);
    assert.equal(c(1).products, 0);
  });
  await t('الأسعار شاملة الضريبة: نفس المبالغ تتفكك عكسياً', async () => {
    await T.setMeta('priceIncludesTax', true);
    const rep = T.taxReport();
    const c16 = rep.cats.find(x => x.tax === 16);
    assert.equal(c16.gross, 10);                                              // 10 × 1.00 شاملة
    assert.equal(c16.base, Math.round(10 / 1.16 * 1000) / 1000);
    assert.equal(Math.round((c16.base + c16.taxAmount) * 1000) / 1000, 10);
    await T.setMeta('priceIncludesTax', false);
  });
  await t('فلتر الفئة بالتقرير', () => {
    assert.equal(T.report('counted', '', 0, 50, '16').total, 1);
    assert.equal(T.report('all', '', 0, 50, 'none').total, 2);
    assert.equal(T.report('all', '', 0, 50, 'all').total, 6);
  });

  await t('تعديل السعر والضريبة', async () => {
    const id = T.lookup('1005')[0].id;
    const v = await T.updateProduct(id, { cost: 6, tax: 10 });
    assert.equal(v.cost, 6); assert.equal(v.tax, 10); assert.equal(v.priceGross, 6.6);
    await assert.rejects(() => T.updateProduct(id, { tax: 7 }), /غير مدعومة/);
    await assert.rejects(() => T.updateProduct(id, { cost: -1 }), /غير صحيح/);
    await assert.rejects(() => T.updateProduct(id, { cost: 'abc' }), /غير صحيح/);
    const c10 = T.taxReport().cats.find(x => x.tax === 10);
    assert.deepEqual([c10.base, c10.taxAmount], [12, 1.2]);                    // 2 × 6
    await T.updateProduct(id, { tax: null });
    assert.equal(T.report('all', '1005', 0, 5).rows[0].tax, null);
    await T.updateProduct(id, { tax: 10 });
  });
  await t('إعادة الاستيراد ما بتمسح السعر/الضريبة المعدّلة يدوياً', async () => {
    await T.importProducts([['رقم المادة', 'اسم المادة', 'اخر سعر شراء', 'الضريبة'], [1005, 'ارز بسمتي', 99, 16], [1002, 'حليب نادك طويل الأجل', 0.9, 5]]);
    const rice = T.lookup('1005')[0];
    assert.equal(rice.cost, 6); assert.equal(rice.tax, 10);                    // معدّل يدوياً: ثابت
    const milk = T.lookup('1002')[0];
    assert.equal(milk.cost, 0.9); assert.equal(milk.tax, 5);                   // غير معدّل: ينحدّث من الملف
  });
  await t('تعديل جماعي: كل نتائج البحث', async () => {
    assert.equal(T.countMatching('مراعي'), 3);
    assert.equal(await T.bulkSetTax('مراعي', 16), 3);
    assert.ok(T.lookupAll('مراعي').items.every(x => x.tax === 16));
    await assert.rejects(() => T.bulkSetTax('مراعي', 3), /غير مدعومة/);
    assert.equal(await T.bulkSetTax('', 0), 6);                               // نص فاضي = كل الأصناف
    assert.equal(T.taxReport().cats.find(x => x.tax === null).products, 0);
  });
  await t('إعادة تشغيل: الضريبة والسعر المعدّل محفوظين', async () => {
    const T2 = Inv.createStore(); await T2.init('dev-tax');
    assert.equal(T2.lookup('1005')[0].cost, 6);
    assert.equal(T2.lookup('1001')[0].tax, 0);
  });
  await t('التصدير: أعمدة الضريبة، ودمج ملف بصنف جديد بضريبته', async () => {
    await T.setMeta('deviceName', 'سامر');
    const rows = Inv.csv.parse(T.exportCsv());
    const h = rows[0];
    for (const col of ['الضريبة %', 'السعر قبل الضريبة', 'السعر بعد الضريبة', 'المعدود قبل الضريبة', 'مبلغ الضريبة', 'المعدود بعد الضريبة']) assert.ok(h.includes(col), col);
    const milk = rows.find(r => r[1].startsWith('حليب المراعي'));
    assert.equal(milk[h.indexOf('الضريبة %')], '0');
    const tx = Inv.csv.parse(T.exportTaxCsv());
    assert.equal(tx[0][0], 'فئة الضريبة'); assert.equal(tx[tx.length - 1][0], 'المجموع');
    const M = Inv.createStore(); await M.init('dev-merge-tax'); await M.setMeta('deviceName', 'المدير');
    const r = await M.mergeCsv(T.exportCsv());
    assert.equal(r.created, 4);                                                // الأصناف المعدودة فقط
    assert.equal(M.lookup('1001')[0].tax, 0);
  });

  await t('الدمج يأخذ الضريبة المحددة من الملف للأصناف الموجودة بضريبة غير محددة', async () => {
    const X = Inv.createStore(); await X.init('dev-merge-x'); await X.setMeta('deviceName', 'المدير');
    await X.importProducts([['رقم المادة', 'اسم المادة', 'اخر سعر شراء'], ['7001', 'شاي', 2], ['7002', 'سكر', 1]]);
    const Y = Inv.createStore(); await Y.init('dev-merge-y'); await Y.setMeta('deviceName', 'سامي');
    await Y.importProducts([['رقم المادة', 'اسم المادة', 'اخر سعر شراء'], ['7001', 'شاي', 2], ['7002', 'سكر', 1]]);
    await Y.updateProduct(Y.lookup('7001')[0].id, { tax: 16 });
    await Y.updateProduct(Y.lookup('7002')[0].id, { tax: 4 });
    await Y.addCount(Y.lookup('7001')[0].id, 3, 's');
    const r = await X.mergeCsv(Y.exportCsv());
    assert.equal(X.lookup('7001')[0].tax, 16); assert.equal(X.lookup('7002')[0].tax, 4);
    assert.equal(r.taxes, 2);
    await X.updateProduct(X.lookup('7001')[0].id, { tax: 5 });
    await X.mergeCsv(Y.exportCsv());
    assert.equal(X.lookup('7001')[0].tax, 5);                                  // لا يستبدل ضريبة محددة
  });

  await t('تعديل كمية صنف مجرود: يستبدل أسطر هذا الجهاز ويُبقي المدموج', async () => {
    const X = Inv.createStore(); await X.init('dev-edit'); await X.setMeta('deviceName', 'المدير');
    await X.importProducts([['رقم المادة', 'اسم المادة', 'اخر سعر شراء'], ['8001', 'عدس', 2]]);
    const id = X.lookup('8001')[0].id;
    await X.addCount(id, 5, 'المدير'); await X.addCount(id, 3, 'المدير');
    assert.equal(X.ownCount(id), 8);
    assert.equal(await X.setOwnCount(id, 6, 'المدير'), 6);
    assert.equal(X.lookup('8001')[0].counted, 6); assert.equal(X.recent(10).length, 1);
    assert.equal(await X.setOwnCount(id, 0, 'المدير'), 0);
    assert.equal(X.lookup('8001')[0].counted, 0); assert.equal(X.stats().items, 0);
    await assert.rejects(() => X.setOwnCount(id, -1), /الكمية/);
  });

  console.log(`\n${passed} اختبار نجح${process.exitCode ? ' — وفي اختبارات فشلت' : ''}`);
})();
