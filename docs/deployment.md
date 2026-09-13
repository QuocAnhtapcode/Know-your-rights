# Deployment and operations — Firebase v4

Last reviewed: 13 September 2026.

## Fixed target

| Item | Value |
|---|---|
| Firebase/GCP project | `know-your-rights-cd8b5` |
| Hosting site | `know-your-rights-cd8b5` |
| Public URL | <https://know-your-rights-cd8b5.web.app> |
| Functions generation/runtime | 2nd gen / Node.js 22 |
| Functions/Firestore region | `australia-southeast1` |
| Database | `(default)` |
| Backend mode | `cloud-live` (ignored Functions environment file) |
| Frontend mode | `firebase` (ignored Vite production environment file) |

Never infer the target from a CLI default. Every write/deploy command must include `--project know-your-rights-cd8b5`.

## Preflight

1. Confirm branch, remote and uncommitted files. Do not overwrite unrelated work.
2. Run `npm run install:all`, `npm run check`, then `npm run test:emulator`.
3. Confirm the public Firebase config points to `know-your-rights-cd8b5` and Functions region `australia-southeast1`.
4. Confirm Anonymous Auth is enabled and the Web App is registered with App Check/reCAPTCHA Enterprise for the real Hosting domains.
5. Check only Secret Manager metadata: enabled versions must exist for `OPENAI_API_KEY` and `DEMO_ACCESS_CODE`. Never access, print or copy values.
6. Confirm `runtime/demo` exists, is valid, has `enabled: true`, `syntheticOnly: true`, and reviewed UID/global caps.
7. Confirm deny-all `firestore.rules` is appropriate for this dedicated project and TTL is enabled for the three `expiresAt` collection groups.

## Manual deployment

```powershell
npm run build
node node_modules/firebase-tools/lib/bin/firebase.js deploy --project know-your-rights-cd8b5
```

The Functions predeploy rebuilds `functions/lib/index.cjs`; local shared contracts are bundled and no deployed import leaves the Functions bundle. The Hosting config publishes `dist` and rewrites SPA routes only—callables use `httpsCallable` in `australia-southeast1`.

If only one surface changed, a scoped deploy is acceptable, but the project flag remains mandatory. A secret update alone is not enough: redeploy `sendMessage` after changing `OPENAI_API_KEY`, and `startConversation` after changing `DEMO_ACCESS_CODE`.

## Cloud acceptance

From the real Hosting URL, not localhost:

- load `/`, deep-link and refresh `/chat`, `/help` and `/safe`;
- start an anonymous session with a valid App Check token and grant;
- confirm the callable target is the same project and Sydney region;
- use one explicitly fictional prompt; distinguish a live answer from a labelled mock;
- inspect only metadata needed to confirm owner UID, generation/version, bounded fields and evidence presence—never print story text;
- verify a second UID cannot access the conversation and a browser Firestore read is denied;
- clear through the UI and report cloud deletion only after callable acknowledgement;
- verify Quick Exit hides immediately and truthfully reports when deletion cannot be confirmed.

The authorized live spike budget for the 13 September 2026 integration run is at most two OpenAI requests total: one planner Structured Output and one FWO-domain web search. No automatic retry is permitted.

## App Check, kill switch and cost

App Check supplements Firebase Auth; it does not replace it. Keep `enforceAppCheck: true` on cloud callables and never relax Firestore Rules to repair IAM. Monitor valid/invalid App Check metrics before changing the provider or token policy.

To pause the demo, set `runtime/demo.enabled=false` through the Firebase console or another authenticated operator path. Verify new starts/sends stop, while static Help and owner deletion still work. Quotas are transactionally reserved per UID and globally, but process failure after an external request means exactly-once provider billing is not promised.

Functions use `minInstances: 0`, `maxInstances: 2`, `concurrency: 4`, a 120-second function timeout, a 150-second lease, a 25-second planner timeout and a 70-second web timeout. Revisit these only after observing latency. `maxInstances` limits scale; it is not a guaranteed bill cap. Configure Firebase/GCP budget alerts and OpenAI project limits separately, understanding their scope and enforcement delay.

## Rollback and post-demo

First disable `runtime/demo`. If a deployment is faulty, restore a reviewed prior commit and redeploy manually; do not use force-push or destructive Git commands. Retire unused secret versions, review metadata-only logs, clear test conversations, and follow the operator process for stale Anonymous Auth accounts. Firestore TTL remains asynchronous.
