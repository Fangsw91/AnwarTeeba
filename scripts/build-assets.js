// يجهّز مكتبات التقارير والخط العربي والشعار داخل www/vendor
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), v = path.join(root, 'www/vendor');
const nm = p => path.join(root, 'node_modules', p);
fs.mkdirSync(v, { recursive: true });
fs.copyFileSync(nm('exceljs/dist/exceljs.min.js'), path.join(v, 'exceljs.min.js'));
fs.copyFileSync(nm('jspdf/dist/jspdf.umd.min.js'), path.join(v, 'jspdf.umd.min.js'));
const b64 = f => fs.readFileSync(f).toString('base64');
const fd = nm('@expo-google-fonts/noto-naskh-arabic');
const out = 'window.InvAssets={logo:"' + b64(path.join(root, 'www/logo.png')) + '",fonts:{regular:"' +
  b64(path.join(fd, '400Regular/NotoNaskhArabic_400Regular.ttf')) + '",bold:"' +
  b64(path.join(fd, '700Bold/NotoNaskhArabic_700Bold.ttf')) + '"}};';
fs.writeFileSync(path.join(v, 'report-assets.js'), out);
