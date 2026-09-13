# Know Your Rights — short judging script

Use only fictional details. Target: 5–7 minutes on <https://know-your-rights-cd8b5.web.app>.

## Before the room

- Confirm `runtime/demo.enabled=true`, App Check valid traffic, quotas and both secret bindings from metadata only.
- Open the real Firebase Hosting URL on a phone-sized browser and a desktop browser.
- Prepare the demo access code outside slides, source and browser autofill. Never show the OpenAI key.
- Keep `/help` open as the no-model fallback. Do not describe a mock as live.

## Story

1. On Home, switch VI/EN once. Point out the short cloud/AI disclosure, absence of name/email/visa-number fields and the demo access-code field.
2. Start deliberately; entering Home or `/safe` never creates a session automatically.
3. Send: **“Tình huống hư cấu: Tôi làm ở Sydney, NSW và phiếu lương tuần này thiếu số giờ làm thêm. Tôi nên kiểm tra gì trước?”**
4. While waiting, explain only the truthful state: the request is being processed. There is no fake streaming or list of “domains searched.”
5. When the response appears, open Sources. Check that the URLs are approved HTTPS hosts and explain that an answer is withheld if the web call/citations/source policy fail.
6. Open Facts. Show that “NSW” is grounded in the exact user message, then correct by chat: **“Sửa lại: tình huống này ở Melbourne, VIC.”** Explain that the correction is committed before any new research and state routing changes to Victoria.
7. Open Summary, edit it locally and click Copy. Explain it is never submitted automatically.
8. Open Help to show the static S01–S29 directory remains available if AI is disabled.
9. Return to chat and demonstrate either Clear (confirm, wait for cloud acknowledgement) or Quick Exit (cover immediately, `/safe`, then report deletion truthfully).

## If live AI fails

Say: “The source check did not produce evidence that met our release gate, so the product declined to guess.” Show Help. A labelled mock may demonstrate UI only; it is not presented as a successful live AI integration.

## Claims to avoid

- Do not say the app is legal advice, production-ready, anonymous with no identifiers, zero-retention, instantly TTL-deleted or impossible to trace in browser history.
- Do not claim citation count proves legal correctness; manually check whether each source supports the important claim.
- Do not claim `maxInstances`, Firebase billing alerts or repository privacy creates a hard spend/security boundary.
