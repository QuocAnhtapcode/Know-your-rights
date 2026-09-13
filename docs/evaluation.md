# Evaluation ledger — v4 Firebase demo

Run date: 13 September 2026. Commit: **uncommitted working tree**. Model setting: `gpt-5.4-mini-2026-03-17`. Prompt/engine: `planner-v4.1` / `conversation-engine-v4.1`. Registry: `2026-09-12.v4`. No result below is a production metric.

Modes: `unit` and `emulator` use fakes and cannot contact OpenAI; `inspection` is a bounded source/configuration check; `cloud` means the real Firebase Hosting project. `NOT RUN` is intentional and is not treated as a pass.

## T01–T34

| ID | Environment / mode | Expected | Actual | Status |
|---|---|---|---|---|
| T01 | unit | Greeting/thanks stays natural; no B | No dedicated conversational-classifier fixture yet | NOT RUN |
| T02 | unit / official-adapter fake | Payslip question gets grounded new information | Planner schema + one filtered FWO web request + accepted native citation | PASS |
| T03 | unit | Resolve “that” across turns or clarify | No ambiguity fixture yet | NOT RUN |
| T04 | unit | Simplify without new claim; retain evidence IDs | Direct-source validator exists; multi-turn simplification fixture pending | NOT RUN |
| T05 | unit | Pay→super→pay routes and remembers topics | Keyword groups implemented; full multi-turn fixture pending | NOT RUN |
| T06 | unit | Apply NSW→VIC before B and reroute | Router includes S07 only for NSW and S11 only for VIC | PASS |
| T07 | unit | Correction survives B failure | Forced answer-stage failure retained exact NSW fact/provenance and failed attempt safely | PASS |
| T08 | unit | Do not merge another person's case | One-case instruction exists; adversarial flow not executed | NOT RUN |
| T09 | unit / inspection | Assistant hypothesis never becomes user fact | Fact validator accepts only exact quote from a stored user-role message | PASS |
| T10 | unit | Reject wrong message ID/nonexistent quote | Invalid quoted patch rejected; only exact “Sydney” patch stored | PASS |
| T11 | unit / inspection | ATO unavailable gives limited fallback | S05 is conditional/indexed-only and excluded by default; no open-domain fallback | PASS |
| T12 | unit | Cross-topic/unmapped never drops filter | Router returns only reviewed subset or empty pool; no unfiltered branch | PASS |
| T13 | unit / inspection | Reject suffix domain attack | Exact URL hostname matching; out-of-policy host fixture rejected | PASS |
| T14 | unit / inspection | Reject outside-pool/link-only citation | S26/S29 excluded from search and gate rejects link-only/out-of-pool sources | PASS |
| T15 | unit / inspection | Typed URL without native web call is ungrounded | Gate requires at least one completed `web_search_call` | PASS |
| T16 | human review | Source must support the claim | Claim-level legal review of a live answer not yet completed | NOT RUN |
| T17 | adversarial live | Tool content cannot change policy/reveal key | Secret/tool-injection live case not executed | NOT RUN |
| T18 | unit | Vietnamese/emoji/multiple blocks and safe offsets | Two cited Unicode blocks accepted; malformed/out-of-policy annotation rejected | PASS |
| T19 | unit + emulator | Double send/attempt creates one pipeline | Exact replay returns one completed result; provider called once | PASS |
| T20 | unit | Browser timeout cannot start competing retry | Duplicate pending returns pending; retry requires a new attempt after terminal state | PASS |
| T21 | unit | Clear during B prevents late commit/display | Delayed provider result could not recreate cleared document | PASS |
| T22 | UI unit / inspection | Quick Exit + Back cannot restore bubble | Suppression/pointer clearing, generation fence and late-result discard covered; real bfcache test pending | PASS |
| T23 | emulator | Two UIDs never share content | Cross-UID get/send/clear rejected | PASS |
| T24 | unit + emulator | Expiry enforced before TTL; state survives process | Expired get/send/commit rejected; Firestore is authoritative | PASS |
| T25 | unit | Wrong code/quota/kill switch blocked server-side | Access throttle, UID/global caps and disabled runtime covered | PASS |
| T26 | build / inspection | No secret in browser/repo/log | Secret-pattern scan and bundle boundary pass; logs contain metadata only | PASS |
| T27 | UI inspection | Error on later turn keeps history/draft/Help | Draft restore and existing conversation retained; real fifth-turn browser case pending | PASS |
| T28 | UI inspection | Summary uses user facts; edit/copy is deliberate | Editable local facts summary and explicit clipboard button implemented | PASS |
| T29 | UI inspection | VI/EN affects new conversation without citation mutation | UI toggle implemented; end-to-end language/citation regression not executed | NOT RUN |
| T30 | unit | Context budget is explicit | 1,000-token fixture redacts identifiers and stays within budget; no silent authority fields | PASS |
| T31 | human review | Do not promise service eligibility | Source notes/prompt require caveats; live answer review pending | NOT RUN |
| T32 | UI/build | Static Help survives AI disabled | Static 29-link directory has no callable dependency | PASS |
| T33 | physical device | Keyboard/focus/zoom/screen reader usable | Responsive CSS exists; physical-device and assistive-tech pass not executed | NOT RUN |
| T34 | controlled live | Current rule/amount/deadline triggers fresh research | Live current-information flow not yet executed | NOT RUN |

## F01–F16

| ID | Environment / mode | Expected | Actual | Status |
|---|---|---|---|---|
| F01 | cloud M4–M8 | Hosting/deep links work away from localhost | Current `/`, `/chat`, `/help`, `/safe` all returned HTTPS 200 with `DENY` framing and `no-referrer`; Chrome rendered the released assets | PASS |
| F02 | unit | Project/region mismatch fails preflight | Firebase client validation tests reject missing/mismatched configuration | PASS |
| F03 | emulator | Missing Auth/cross-UID blocked | Callable ownership tests reject unauthenticated and other UID | PASS |
| F04 | emulator + cloud M3 | Direct Firestore denied for signed-in users | Deny-all Rules passed emulator; unauthenticated REST was 403 in cloud M3 | PASS |
| F05 | unit | Forged owner/role/source ignored/rejected | Strict request schemas reject all server-owned fields; UID comes from Auth | PASS |
| F06 | cloud M3 / inspection | Missing/invalid App Check blocked; no debug token | Prior Hosting traffic logged Auth/App Check VALID; current request missing both Auth/App Check returned 401, but an isolated valid-Auth/invalid-App-Check case was not run | NOT RUN |
| F07 | unit | Two workers cannot own one attempt | Active lease and fencing token allow one pending attempt | PASS |
| F08 | unit | Transaction retry never repeats provider call | Planner/answer assertions run outside repository transaction; replay calls once | PASS |
| F09 | unit | Crash/lease reclaim fences old worker | Late clear/expiry fencing covered; explicit crash-after-provider multi-worker fixture pending | NOT RUN |
| F10 | unit | Expired document blocked before TTL cleanup | Get, send and late commit all reject actual `expiresAt` | PASS |
| F11 | unit + UI | Clear works during calls/disabled/quota; late UI ignored | Owner clear bypasses AI/grant/quota and late result cannot resurrect payload | PASS |
| F12 | inspection | Sign-out/tab close is not reported as deletion | UI/docs distinguish concealment, sign-out, callable ACK and TTL | PASS |
| F13 | unit | App limit fails before Firestore 1 MiB | UTF-8/overhead test rejects near 512 KiB and enforces 40 messages | PASS |
| F14 | unit / inspection | Runtime/secret/cap changes behave safely | Kill switch blocks new work; secret binding is per-function; post-secret redeploy documented | PASS |
| F15 | unit + cloud M3 | UID/global cap works; cold start uses Firestore | Quota tests pass and deployed M3 restored persisted conversation; multi-instance stress pending | PASS |
| F16 | deployment review | Understand preview/private-repo/public Hosting | No preview channel or GitHub visibility change was made; scenario not executed | NOT RUN |

## Latest automated evidence

To be filled only from command output from the final integration run:

| Check | Actual | Status |
|---|---|---|
| `npm run check` | 13 test files / 73 tests; typecheck, lint, frontend/Functions build, bundle validation and secret scan all succeeded | PASS |
| `npm run test:emulator` | 2 files / 7 tests against isolated Auth/Firestore/Functions emulators; no OpenAI/cloud project access | PASS |
| Firebase deploy | Hosting, Rules/indexes and four gen2 Node 22 callables deployed successfully to `know-your-rights-cd8b5`; all functions ACTIVE in `australia-southeast1` and report `cloud-live` | PASS |
| Authorized OpenAI live smoke | 0 requests made by this integration run at document creation | NOT RUN |

Cloud function metadata confirms hash `7dff163f…` for read/clear, `2db85ac…` for start and `9023843d…` for send. `sendMessage` binds only `OPENAI_API_KEY` version 2; `startConversation` binds only `DEMO_ACCESS_CODE` version 1. Secret values were never accessed or printed.

## Open risks

- Legal correctness and grounded-claim coverage need manual review by a qualified Australian worker-rights reviewer.
- Physical mobile/accessibility, real bfcache, multi-instance crash recovery and a second cloud identity are not fully exercised.
- A process can fail after a provider call and before commit; fencing protects data consistency but cannot guarantee exactly-once external billing.
- `store:false`, App Check, Firebase TTL, budget alerts and `maxInstances` each have limited scopes and must not be described as zero retention, complete abuse prevention, immediate deletion or a hard spend cap.
