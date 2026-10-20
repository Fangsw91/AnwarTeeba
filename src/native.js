// يربط التطبيق بمشاركة الملفات في أندرويد (حفظ CSV وإرساله عبر واتساب/إيميل/ملفات…)
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

window.NativeFiles = {
  isNative: () => Capacitor.isNativePlatform(),
  async save(name, text) {
    const w = await Filesystem.writeFile({
      path: name,
      data: '﻿' + text, // BOM ليفتح Excel العربي صح
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: name, url: w.uri, dialogTitle: 'حفظ أو إرسال الملف' });
  },
  async saveBinary(name, bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const w = await Filesystem.writeFile({ path: name, data: btoa(s), directory: Directory.Cache });
    await Share.share({ title: name, url: w.uri, dialogTitle: 'حفظ أو إرسال الملف' });
  },
};
