# Acceptance checklist (V1)

Run on a **test YouTube channel** with one `unlisted` trial upload first.

- [ ] 1. Drop 3 × (`clip.mp4` + `clip.json` with future `publishAt`) into the watch folder → Queue shows 3 `pending` within 5s.
- [ ] 2. Disconnect network mid-upload → reconnect → upload resumes/completes with a single `youtube_video_id` (no duplicate).
- [ ] 3. Corrupt one `clip.json` → that row shows `failed` with an Arabic message; other rows unaffected.
- [ ] 4. Toggle AR/EN → layout flips `rtl`/`ltr`, all strings translated.
- [x] 5. Secrets hygiene (verified 2026-09-30): grep finds only OAuth *field names* (`refresh_token` property keys in `auth.ts`/`main.ts`), zero secret values. Tokens persist only via `safeStorage` to `tokens.bin` in userData (gitignored).
