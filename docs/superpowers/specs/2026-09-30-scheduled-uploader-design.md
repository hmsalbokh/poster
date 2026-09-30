# تصميم: تطبيق ديسكتوب لرفع الشورتس مجدولاً من مجلد محلي إلى YouTube

- **التاريخ:** 2026-09-30
- **الحالة:** مسودة بانتظار مراجعة المستخدم
- **القرار المعتمد:** مقاربة A — Electron + Vite + React + SQLite
- **النطاق V1:** YouTube فقط، شورتس عمودية (<60 ثانية)، واجهة عربي/إنجليزي
- **المؤجل:** TikTok / Instagram كـ Uploader plugins لاحقاً (المعمارية جاهزة لها)

## 1. الهدف ومعايير النجاح

**الهدف:** يرمي المستخدم ملفات `mp4 + json` في مجلد محلي، والتطبيق يرفعها إلى YouTube في الأوقات المحددة تلقائياً حتى لو انقطع النت أو أُغلق التطبيق (يكمل عند التشغيل).

**معايير النجاح:**
1. مراقبة مجلد + ظهور الفيديو في الطابور خلال ≤5 ثوانٍ.
2. رفع resumable مع جدولة `publishAt` صحيحة (يظهر Scheduled في YouTube Studio).
3. تحمّل انقطاع النت والتوكن المنتهي بدون ضياع أي عنصر.
4. واجهة ثنائية اللغة (AR RTL / EN LTR) تعرض الحالة والسجل.
5. يعمل عند بدء تشغيل Windows (اختياري، قابل للتفعيل).

## 2. المعمارية

```
[ Watched Folder ] --chokidar--> [ Ingest + Zod validation ] --> [ SQLite Queue ]
                                                                       |
[ React Dashboard ] <--> [ Scheduler (node-schedule) ] --> [ YouTube Uploader ] --> YouTube Data API v3
        ^                           |                                  |
        +---- [ Auth Store ] --------+----------------------------------+
              (OAuth2 + safeStorage + auto-refresh)
```

**حدود الوحدات:**
- `watcher/`: يكتشف الملفات فقط، لا يرفع.
- `queue/`: مصدر الحقيقة الوحيد للحالة (pending/scheduled/uploading/published/failed).
- `uploader/`: واجهة `UploaderPlugin { validate(), upload(), schedule() }` — نسخة YouTube أولاً.
- `scheduler/`: يقرر "متى" حسب `publishAt`، ويدير retry.
- `ui/`: تعرض فقط، لا منطق رفع داخل React.

## 3. عقد المجلد المحلي

```
watch-folder/
  clip1.mp4
  clip1.json
  clip2.mp4
  clip2.json
```

**`clip1.json` (يُتحقق منه بـ Zod):**
```json
{
  "title": "عنوان الشورت #Shorts",
  "description": "وصف + روابط",
  "tags": ["shorts", "تقنية"],
  "publishAt": "2026-10-01T18:00:00+03:00",
  "privacyStatus": "private",
  "madeForKids": false,
  "language": "ar",
  "categoryId": "22"
}
```

**قواعد:**
- `title` ≤100 حرف، `description` ≤5000 حرف (حدود YouTube).
- `publishAt` يجب أن يكون في المستقبل؛ لو ماضٍ → يُرفع فوراً كـ unlisted ويُعلَّم تحذير.
- `privacyStatus` في الإدخال يُتجاهل للجدولة: الرفع دائماً `private + publishAt` (طريقة YouTube الرسمية للجدولة)، ثم YouTube ينشره تلقائياً.
- ملف mp4 بدون json → يظهر في الواجهة كـ `needs-metadata` ولا يُرفع.
- الشورتس: عمودي (9:16) وأقل من 60 ثانية — يُفحص بـ ffprobe ويُحذَّر لو مخالف (لا يُمنع الرفع).

## 4. المصادقة (إعداد لمرة واحدة على المستخدم)

1. المستخدم ينشئ مشروع Google Cloud خاص به → يفعّل **YouTube Data API v3** → ينشئ **OAuth Client (Desktop)**.
2. يلصق `client_id + client_secret` في التطبيق (تُحفظ مشفرة بـ `safeStorage`، وليست في الكود).
3. تسجيل دخول عبر المتصفح (OAuth consent) مع scope: `youtube.upload youtube.force-ssl`.
4. التوكن يُجدَّد تلقائياً؛ عند revoke يظهر زر "إعادة تسجيل الدخول".

## 5. قاعدة البيانات (SQLite)

```sql
videos(id TEXT PK, file_path TEXT UNIQUE, json_path TEXT, title TEXT,
  description TEXT, tags TEXT, publishAt TEXT, lang TEXT,
  status TEXT, youtube_video_id TEXT, error TEXT,
  attempts INT DEFAULT 0, created_at TEXT, updated_at TEXT);
events(id INTEGER PK, video_id TEXT, level TEXT, message TEXT, at TEXT);
settings(key TEXT PK, value TEXT); -- watch_folder, locale, auto_start, channel_id
```

الحالات: `pending → uploading → scheduled → published | failed | needs-metadata`.

## 6. الرفع والجدولة (YouTube Data API v3)

- رفع **resumable** (ضروري للملفات الكبيرة والنت المتقطع) مع استئناف تلقائي.
- `status = { privacyStatus: "private", publishAt, madeForKids }`.
- `snippet = { title, description, tags, categoryId, defaultLanguage }`.
- بعد نجاح الاستدعاء يُحفظ `youtube_video_id` والحالة `scheduled`.
- مهمة خلفية يومية تتحقق من `videos.list` لتحديث `scheduled → published` بعد وقت النشر.

**⚠️ قيد الحصة (مهم):** الحصة الافتراضية 10,000 وحدة/يوم وسعر `videos.insert` ≈1600 → **~6 مقاطع/يوم كحد أقصى** لكل مشروع Cloud. تجاوز ذلك يتطلب طلب زيادة حصة من Google (شاشة في الواجهة تعرض الاستهلاك التقريبي + تنبيه عند الاقتراب). هذا قيد من Google وليس من التطبيق.

## 7. الواجهة (React + Tailwind، ثنائية اللغة)

- مفتاح تبديل AR/EN في الأعلى؛ العربية RTL كاملة.
- الشاشات: (1) الطابور (جدول: ملف/عنوان/وقت النشر/الحالة/إجراءات إعادة/حذف)، (2) الإعدادات (المجلد، اللغة، التشغيل مع Windows، بيانات Cloud)، (3) السجل (events)، (4) حالة الحساب والكوتا.
- سحب وإفلات ملفات إلى المجلد عبر زر "فتح المجلد" (لا نسخ داخل التطبيق — المجلد هو المصدر).
- إشعارات سطح مكتب عند نجاح/فشل الرفع.

## 8. معالجة الأخطاء

| الحالة | السلوك |
|---|---|
| JSON ناقص/غير صالح | `failed` + رسالة Zod مترجمة، لا يُعاد تلقائياً |
| توكن منتهي | تجديد تلقائي، وإلا تنبيه تسجيل دخول |
| انقطاع النت | يبقى `pending/uploading`، استئناف resumable عند عودة النت |
| كوتا Google نفدت (403 quotaExceeded) | تأجيل الكل لليوم التالي + تنبيه واضح |
| ملف محذوف قبل الرفع | `failed` بسبب `file-missing` |
| `publishAt` ماضٍ | رفع فوري unlisted + تحذير |

Retry: exponential backoff (1m → 5m → 30m) بحد 5 محاولات، ثم `failed` يدوي.

## 5. الاختبار

- Unit: تحقق Zod لكل حقل، انتقالات حالات الـ queue، حساب backoff.
- Integration (mock): watcher يلتقط ملفاً جديداً، scheduler يطلق في الوقت الصحيح.
- E2E يدوي: رفع تجريبي واحد `unlisted` على قناة تجريبية قبل الاعتماد.
- لا أسرار في المستودع: `client_secret` والتوكن في `safeStorage` فقط + `.gitignore` لقاعدة البيانات.

## 10. البناء والتوزيع

- `electron-vite` للتطوير، `electron-builder` (NSIS) لتثبيت Windows، تحديث تلقائي اختياري لاحقاً (خارج V1).
- التشغيل مع Windows عبر `auto-launch` (اختياري، افتراضي OFF في V1).
- `ffprobe` (من `ffmpeg-static`) لفحص مدة/أبعاد الفيديو فقط — لا ترميز في V1.

## 11. قابلية التوسع (TikTok/Instagram لاحقاً)

- `UploaderPlugin` مجردة؛ إضافة TikTok تعني ملفاً جديداً `tiktok-uploader.ts` + شاشة OAuth الخاصة به دون لمس الـ queue.
- ملاحظة: TikTok Content Posting API وInstagram Graph API يتطلبان موافقات وحسابات Business — تُبحث عند تفعيلها، ولا تعطل V1.

## 12. معايير القبول لـ V1

- [ ] مجلد فيه 3 أزواج mp4+json تُجدول بنجاح وتظهر Scheduled في YouTube Studio.
- [ ] فصل النت أثناء الرفع ثم إعادته → يُستكمل بدون تكرار الفيديو.
- [ ] ملف json خاطئ → رسالة عربية واضحة ولا يعلق الطابور.
- [ ] تبديل AR/EN يعكس الاتجاه والنصوص بالكامل.
- [ ] لا يوجد أي secret في الكود أو قاعدة بيانات مكشوفة.

## 13. Self-review (مراجعة ذاتية للـ spec)

- **Placeholders:** لا يوجد TBD/TODO — كل حقل JSON وقيمة افتراضية محددة.
- **الاتساق:** الجدولة دائماً `private + publishAt` في كل الأقسام؛ لا تعارض.
- **النطاق:** V1 مقصور على YouTube Shorts + مراقبة مجلد؛ الترميز والتحديث التلقائي خارج النطاق صراحةً.
- **الغموض المتبقي:** صيغة `categoryId` الافتراضية (22 = People & Blogs) قابلة للتغيير من الواجهة — مقبول لـ V1.
