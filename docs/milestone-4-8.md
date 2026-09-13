# Milestones 4–8 — integrated demo record

Date: 13 September 2026. Target: `know-your-rights-cd8b5`, `australia-southeast1`.

## Outcome

The Firebase v4 path is deployed at <https://know-your-rights-cd8b5.web.app>. It contains the two-stage conversation engine, S01–S29 source policy, server-authoritative correction/attempt flow, expanded bilingual UI, security/cost controls, CI and operator documentation. This is a hackathon demo, not production-ready legal software.

## Changed areas

- `functions/src/ai/`: manual context builder, strict Structured Output planner, official Responses API engine and existing network-free adapter.
- `functions/src/sources/`: versioned 29-source registry plus topic/jurisdiction router.
- `functions/src/security/citation-gate.ts`: completed-web-call, native-citation, exact-host/path/pool validation with whole-answer fallback.
- `functions/src/session/`: short reserve/correction/commit transactions, attempt states, lease/fencing, owner/expiry/bounds enforcement and evidence commit.
- `functions/src/index.ts`: `cloud-live` runtime; OpenAI secret only on `sendMessage`, access-code secret only on `startConversation`.
- `src/App.tsx` / `src/styles.css`: VI/EN, natural chat surface, Sources/Facts/editable Summary, failure-safe retry, truthful mode/loading/deletion and static 29-link Help.
- `.github/workflows/ci.yml`: read-only CI, Node 22, Java 21, lockfile install, local checks and isolated Firebase emulators; no deploy or cloud credentials.
- `README.md` and `docs/{deployment,demo-script,evaluation,source-policy}.md`.

## Verified results

| Gate | Result |
|---|---|
| Typecheck/lint/unit/UI/build/bundle/secret scan | PASS — 13 files, 73 tests |
| Auth/Firestore/Functions emulator suite | PASS — 2 files, 7 tests, `demo-*`, no OpenAI |
| Firestore Rules compile/deploy | PASS — deny all browser access |
| Functions deploy | PASS — four gen2 Node 22 callables ACTIVE in Sydney |
| Secret binding metadata | PASS — OpenAI v2 on send only; access code v1 on start only; values not read |
| Hosting deploy and deep links | PASS — `/`, `/chat`, `/help`, `/safe` HTTPS 200 with security headers |
| Unauthenticated callable | PASS — 401, no session/provider work |
| Chrome render | PASS — VI/EN navigation and 29 Help links visible on real Hosting URL |
| Live OpenAI turn | NOT RUN at time of this record — waiting for user-entered demo access code; request count remains 0 |

The full T01–T34/F01–F16 record, including honest NOT RUN cases, is in `docs/evaluation.md`.

## Dependency audit

Runtime packages: `npm audit --omit=dev` PASS with 0 vulnerabilities; Functions package audit PASS with 0. The root development tree reports 10 moderate transitive advisories under the pinned Firebase CLI toolchain. npm offers no non-breaking complete resolution and suggests an unsafe major downgrade for part of the tree, so no automatic audit fix was applied. These packages are build/deploy tooling, not shipped browser or Functions runtime dependencies, but the lockfile should be rechecked when Firebase publishes compatible updates.

## Remaining blockers and limits

- A complete live multi-turn sequence would exceed the previously authorized two-request OpenAI spike; it remains NOT RUN unless separately authorized.
- Physical-device/accessibility, claim-by-claim legal review, valid-Auth/invalid-App-Check isolation, worker-crash-after-provider and multi-instance stress remain open.
- No commit, staged files, GitHub push, repository visibility change or auto-deploy was created. The local/remote repository currently has no commit or remote branch; all prepared source is untracked pending the owner's review.
