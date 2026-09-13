# Milestone 3 — Auth, bounded session and server-only Firestore

**Project:** Know Your Rights  
**Date:** 13 September 2026  
**Scope:** Sections 4 and 8 of `docs/blueprint.md`; the answer provider may remain a clearly labelled mock.

## Outcome and acceptance boundary

Milestone 3 hardens the identity and short-lived conversation layer. Firebase Authentication identifies the caller, a separate demo grant controls access, and a server-generated conversation ID identifies one bounded case. None of those identifiers grants the authority of another.

Local unit, UI and emulator checks provide deterministic coverage; the deployed URL provides the cloud acceptance evidence recorded below. No OpenAI request is part of this milestone.

This remains a hackathon demo with a mock-capable provider. It is not production-ready legal software.

## Browser authentication and session handling

The Firebase client initializes identity in this order:

1. `await setPersistence(auth, browserSessionPersistence)`.
2. `await auth.authStateReady()` so the SDK can restore an existing same-tab identity.
3. Call `signInAnonymously(auth)` only when `auth.currentUser` is still absent.

Firebase Web SDK owns refresh and ID tokens. Application code does not copy tokens into Vite configuration, `localStorage`, conversation documents or its own session keys. Public Firebase Web configuration identifies the project; it is not an authorization secret.

The application owns only these short browser-session values:

- `kyr:conversation`: the opaque pointer used to request the current conversation again after a same-tab refresh.
- `kyr:suppressed`: a presentation-safety flag that prevents a Quick Exit page from restoring content.

Transcript text, extracted facts, conversation state and evidence are not persisted in browser storage. Firebase Auth may use SDK-internal session storage for its own identity state; the application neither reads nor writes that token material.

Closing a tab, signing out, losing the pointer or navigating to `/safe` is not proof that Firestore data was deleted. The UI may say the cloud payload was deleted only after `clearConversation` succeeds.

## Firestore storage model

The browser does not import the Firestore or Cloud Storage client SDK, create listeners, enable offline persistence or write conversation data directly. It calls four regional callable Functions. The Admin SDK uses the Google-managed runtime identity; no service-account JSON is needed in the browser or repository.

Each short conversation is one bounded document at `conversations/{conversationId}`. It contains the server-owned `ownerUid`, `generation`, `version`, `status`, timestamps and `expiresAt`, plus bounded `messages`, `userFacts`, `conversationState`, `evidenceLedger`, `attempts` and the current attempt lease. The MVP does not create transcript subcollections.

The application limits a conversation to 40 total user-and-assistant messages, caps one user input at 4,000 characters, and rejects a write before the document crosses its conservative application-size budget. The application budget is deliberately below Firestore's 1 MiB document limit, with room for encoded field and document overhead.

Related metadata is separated from story content:

| Path | Stored data | Must not contain |
|---|---|---|
| `demoGrants/{uid}` | Grant expiry, active pointer and bounded start-request dedupe metadata | Access code or transcript |
| `usageBuckets/{bucketId}` | Bounded counters, time window and expiry | Questions, answers or access code |
| `runtime/demo` | Operator-controlled kill switch and caps | User story or browser authorization |

Firestore Rules deny all browser reads, writes, queries and listeners. Admin SDK bypasses Rules, so every callable independently derives the UID from verified Firebase Auth and checks ownership, grant, expiry, version, bounds and quota. Client-supplied `ownerUid`, system messages, full history, model, domain list and source ledger remain invalid contract fields.

## Lifecycle and retention

The current real policy is:

- A conversation is readable and writable for **30 minutes after the most recent valid user activity**. Creating a session and accepting a user message set the server-side deadline. `getConversation`, polling and health checks do not extend it.
- An expired document remains inaccessible even if Firestore TTL has not deleted it yet. TTL cleanup is asynchronous and is not an authorization check or a promise of immediate deletion.
- A demo grant is retained for **24 hours from grant issuance**. Reusing an unexpired grant does not silently extend that deadline.
- Usage buckets carry a **24-hour metadata TTL**. Clearing or replacing a conversation does not erase or reset their counters.
- Bounded start-request mappings remain with the grant for dedupe and ownership checks until their metadata retention expires. They contain identifiers, not story content or the raw access code.
- `clearConversation` deletes the complete conversation payload and clears a matching active pointer. It deliberately retains the bounded grant, dedupe and quota metadata above.
- The Firebase Anonymous Auth account and UID are **not deleted** by normal clear, sign-out or tab close. No automatic Auth-account deletion deadline is promised in this MVP. Auth cleanup after the demo is an operator-managed task.

Firestore TTL is enabled independently for `conversations.expiresAt`, `demoGrants.expiresAt` and `usageBuckets.expiresAt`.

## Deployed cloud slice

- **Hosting:** <https://know-your-rights-cd8b5.web.app>
- **Firebase project:** `know-your-rights-cd8b5`
- **Functions:** 2nd gen, Node.js 22, `australia-southeast1`, 256 MiB, `maxInstances: 2`, `concurrency: 4`
- **Callable entry points:** `startConversation`, `getConversation`, `sendMessage`, `clearConversation`
- **Firestore:** deny-all client Rules released; TTL enabled for the three `expiresAt` fields above
- **App Check and Auth:** both were reported `VALID` by callable verification for the Hosting-origin browser request
- **Runtime identity:** Google-managed default compute identity with the narrow `roles/datastore.user` data role; no service-account JSON is distributed
- **Transport IAM:** the four Cloud Run services accept unauthenticated HTTPS transport so Firebase callable headers can reach the handler. Firebase Auth and App Check are still enforced inside every callable.
- **Build retention:** the regional `gcf-artifacts` repository deletes container images older than seven days to limit demo build-storage growth.

The deployed provider is still the visibly labelled mock path for normal messages. No legal web-grounded answer or OpenAI request is claimed by this milestone.

The first browser request exposed a real deployment issue: the runtime identity could start the container but did not yet have Firestore data access. The request failed closed. The identity was then granted only `roles/datastore.user`, the role intended by Google for application/service-account read-write access to Firestore data. No client Rule was relaxed. After IAM propagation, the same Hosting flow succeeded.

## Replacement, retry and deletion guarantees

A replacement must be explicitly confirmed in the UI and identify the existing conversation. The server verifies that the old document belongs to the authenticated UID, reserves the next start quota, deletes the old payload and creates the new server-owned ID in one transaction. If validation or quota reservation fails, the old payload is not partially removed. Replaying the same start `requestId` returns the same result rather than creating a second document.

`userMessageId`, `attemptId`, `contextVersion`, `generation` and the active-attempt fencing token prevent duplicate user messages and stale workers. Provider work runs outside Firestore transaction callbacks. A response that arrives after expiry, replacement or clear cannot use an upsert to recreate the deleted document.

Owner deletion remains available when the demo is disabled, the grant or conversation has expired, or the AI quota is exhausted, provided Functions and Firebase Auth are still available. Repeating clear for a conversation previously owned by the same UID is idempotent; a different UID or never-owned identifier must not gain a successful ownership result.

## Verification matrix

| Check | Required evidence | Status |
|---|---|---|
| Persistence ordering | Delayed unit seam proves persistence resolves before auth restore/sign-in | **PASS** |
| Existing Auth reuse | Restored `currentUser` causes no new anonymous sign-in | **PASS** |
| Two separate UIDs | Other UID cannot get, send to or clear owner's session | **PASS — emulator** |
| Direct Firestore access | Unauthenticated, owner and other UID cannot read/write/list | **PASS — emulator** |
| Same-tab restore | Session pointer restores through `getConversation`; no transcript stored locally | **PASS — UI/local seam** |
| Expiry before TTL | Existing expired document is rejected for get/send/late commit | **PASS — unit** |
| Double-start dedupe | Concurrent same `requestId` produces one conversation and one quota reservation | **PASS — unit** |
| Confirmed replacement | Old owned payload is removed atomically; metadata/quota is retained | **PASS — unit** |
| Clear and fencing | Clear is owner-only/idempotent and a late provider result cannot revive data | **PASS — unit; owner/cross-owner clear PASS in emulator** |
| Hosting and deep links | `/`, `/chat` and `/safe` return the deployed SPA with security headers | **PASS — cloud** |
| Callable verification | Hosting request reaches Sydney callable with Firebase Auth and App Check both valid | **PASS — cloud log** |
| Firestore owner flow | Start, restore after refresh, one synthetic send and owner clear through callable Functions | **PASS — cloud** |
| Clear verification | UI returned home after callable ACK; `conversations` contained 0 documents | **PASS — cloud** |
| Metadata after clear | One grant retained only `activeConversationId`, `expiresAt`, `startRequests`; quota buckets retained only counters and `expiresAt` | **PASS — cloud** |
| Second independent browser identity | Cross-UID cloud isolation | **NOT RUN — emulator coverage exists; cloud browser context pending** |

Cloud acceptance used one explicitly synthetic Vietnamese message. The stored document had all expected bounded top-level fields, a non-empty server-owned `ownerUid`, two messages, one completed attempt, an `expiresAt` timestamp and version 2 before clear. Its text was not printed during the administrative inspection. The mock response was visibly labelled as not calling AI or web search. OpenAI request count for this milestone: **0**.

The final integrator should rerun the complete local gate after merging parallel milestone work:

```powershell
npm run check
npm run test:emulator
```

Final local gate on 13 September 2026: `npm run check` **PASS** — typecheck, lint, 11 test files / 62 tests, frontend build, Functions build and bundle-safety check. The focused emulator suite had previously passed 7/7 tests after the milestone code was integrated; it was not rerun after the final documentation-only edit. Cloud Hosting checks returned HTTP 200 for `/`, `/chat` and `/safe` with `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.

## Remaining production work

- Define and execute an operator schedule for deleting stale Anonymous Auth accounts; sign-out is not account deletion.
- Measure actual encoded Firestore size and observed TTL cleanup rather than treating the application budget as proof of timing.
- Continue auditing logs, backup policy and provider retention; the current runtime identity has the narrow Firestore data role but project-level IAM should still be reviewed before production use.
- Run the full cloud isolation flow in a second independent browser identity; emulator coverage is not a substitute for that final production-project check.
- Keep Cloud Storage/upload support outside this MVP until file scanning, consent, access control and retention are designed.
