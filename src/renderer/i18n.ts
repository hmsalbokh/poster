export type Locale = "ar" | "en";

const dict = {
  en: {
    "app.title": "Poster — Scheduled Uploader",
    "tabs.queue": "Queue",
    "tabs.settings": "Settings",
    "tabs.logs": "Logs",
    "tabs.account": "Account",
    "queue.openFolder": "Open watch folder",
    "queue.refresh": "Refresh",
    "queue.empty": "No videos yet. Drop an mp4 + json pair into the watch folder.",
    "queue.file": "File",
    "queue.title": "Title",
    "queue.publishAt": "Publish at",
    "queue.status": "Status",
    "queue.actions": "Actions",
    "queue.retry": "Retry",
    "status.pending": "Pending",
    "status.uploading": "Uploading",
    "status.scheduled": "Scheduled",
    "status.published": "Published",
    "status.failed": "Failed",
    "status.needs-metadata": "Needs metadata",
    "settings.watchFolder": "Watch folder",
    "settings.language": "Language",
    "logs.empty": "No events yet.",
    "account.signedIn": "Signed in to YouTube",
    "account.signedOut": "Not signed in",
    "account.clientId": "Google OAuth client ID",
    "account.clientSecret": "Google OAuth client secret",
    "account.saveClient": "Save",
    "account.signIn": "Sign in with Google",
    "account.waiting": "Waiting for browser sign-in…",
    "account.quotaLeft": "Estimated uploads left today"
  },
  ar: {
    "app.title": "بوستر — رفع مجدول",
    "tabs.queue": "الطابور",
    "tabs.settings": "الإعدادات",
    "tabs.logs": "السجل",
    "tabs.account": "الحساب",
    "queue.openFolder": "فتح مجلد المراقبة",
    "queue.refresh": "تحديث",
    "queue.empty": "لا توجد فيديوهات بعد. ضع ملف mp4 مع ملف json في مجلد المراقبة.",
    "queue.file": "الملف",
    "queue.title": "العنوان",
    "queue.publishAt": "وقت النشر",
    "queue.status": "الحالة",
    "queue.actions": "إجراءات",
    "queue.retry": "إعادة المحاولة",
    "status.pending": "بالانتظار",
    "status.uploading": "يُرفع",
    "status.scheduled": "مجدول",
    "status.published": "منشور",
    "status.failed": "فشل",
    "status.needs-metadata": "يحتاج بيانات",
    "settings.watchFolder": "مجلد المراقبة",
    "settings.language": "اللغة",
    "logs.empty": "لا أحداث بعد.",
    "account.signedIn": "مسجل الدخول إلى يوتيوب",
    "account.signedOut": "غير مسجل الدخول",
    "account.clientId": "معرّف عميل Google OAuth",
    "account.clientSecret": "سر عميل Google OAuth",
    "account.saveClient": "حفظ",
    "account.signIn": "تسجيل الدخول عبر Google",
    "account.waiting": "بانتظار تسجيل الدخول من المتصفح…",
    "account.quotaLeft": "الرفعات المتبقية اليوم (تقديري)"
  }
} as const;

export type I18nKey = keyof (typeof dict)["en"];

export function t(locale: Locale, key: I18nKey): string {
  return dict[locale][key];
}
