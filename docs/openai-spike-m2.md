# Milestone 2 — bounded OpenAI/FWO compatibility spike

Status in source: **implemented and covered by network-free tests; paid cloud calls are NOT RUN by this document**.

This spike is a deliberately narrow compatibility check. It is not the production chatbot path and never returns the researched legal text to the chat. The existing `sendMessage` callable still returns `mode: "mock"` and stores a clearly labelled non-legal technical summary.

## Trigger and gates

The exact, case-sensitive synthetic trigger is:

```text
RUN_M2_FWO_COMPATIBILITY_SPIKE_V1
```

Only the cloud-mock reply provider recognises this string. All other messages continue to use `FakeReplyProvider`. The provider is reached only after callable validation, Firebase Auth, App Check enforcement, exact project/runtime checks, a valid server-side demo grant, quota reservation and attempt/fencing reservation. The browser cannot submit a model, domain list, prompt, owner UID, history or source ledger.

The browser trigger is used only as a switch. Neither the trigger nor any other browser message is sent to OpenAI. Both OpenAI inputs are derived from one hardcoded fictional scenario.

Runtime requirements:

- `OPENAI_MODEL` must equal `gpt-5.4-mini-2026-03-17` exactly. There is no fallback or automatic upgrade.
- `OPENAI_API_KEY` remains a Secret Manager parameter bound only to `sendMessage`; its value is read lazily after the first irreversible spike slot is reserved.
- `KYR_BACKEND_MODE=cloud-mock`, project `know-your-rights-cd8b5`, and the normal server-side demo policy must all pass.

## Two-call budget

The singleton Firestore document is `openaiSpikeRuns/m2-fwo-v1`:

```text
schemaVersion: "m2-fwo-v1"
maxIrreversibleSlots: 2
irreversibleSlotsUsed: 0 | 1 | 2
planner: null | reserved | succeeded | failed
webSearch: null | reserved | succeeded | failed
updatedAt: ISO-8601 timestamp
```

Slot 1 is reserved transactionally before the planner request. Slot 2 can be reserved only after the planner has been persisted as successful. Reserved, successful and failed slots are never reclaimed. A repeated trigger cannot make another request. Firestore transaction callbacks perform database work only; no OpenAI request runs inside a transaction.

The OpenAI SDK client and both per-request options use `maxRetries: 0`. The planner timeout is 20 seconds and the web-search timeout is 60 seconds, under the callable/lease envelope.

## Request 1: Structured Output planner

The code uses the official SDK's `responses.parse` with `zodTextFormat`. It sends `store: false`, `max_output_tokens: 300`, and the pinned model. The strict planner result is:

```json
{
  "turn_kind": "research",
  "standalone_question": "string, max 500",
  "search_query": "string, max 240, no URL",
  "source_group": "employment_general",
  "jurisdiction": "Australia",
  "needs_new_evidence": true
}
```

If the request fails, the response is incomplete, usage is missing, the returned model differs, or parsing fails, the planner stage records only a bounded failure code and sanitized telemetry. Web search is not started.

## Request 2: FWO-only web search

The single Responses request declares only this tool configuration:

```json
{
  "type": "web_search",
  "external_web_access": true,
  "filters": { "allowed_domains": ["www.fairwork.gov.au"] },
  "search_context_size": "low"
}
```

It also sets `tool_choice: "required"`, `max_tool_calls: 1`, `parallel_tool_calls: false`, `store: false`, `max_output_tokens: 500`, and requests `web_search_call.action.sources`.

The installed OpenAI SDK 7.15.0 exposes `max_tool_calls` on its WebSocket response-create type but omits it from the stable REST `ResponseCreateParamsBase` type, while the official REST API documents the parameter. The implementation therefore uses a narrow TypeScript intersection for this one field and records any runtime rejection as a compatibility failure; it does not silently omit the limit.

## Persisted evidence and telemetry

A successful planner stage stores its validated structured output plus:

```text
requestedModel, responseModel, responseStatus, latencyMs
usage { inputTokens, outputTokens, totalTokens, cachedInputTokens, reasoningOutputTokens }
```

A successful web stage stores the same telemetry and only these response-derived shapes:

```text
rawTextBlocks[] {
  text,
  annotations[] { type: "url_citation", start_index, end_index, title, url }
}
consultedSources[] { type: "url", url }
```

Text is kept unchanged so native citation offsets remain attached to the original block. Every citation and consulted/opened URL is parsed and post-filtered. Only HTTPS URLs with exact hostname `www.fairwork.gov.au`, no credentials and no explicit port pass. Lookalikes such as `www.fairwork.gov.au.evil.example` fail closed. At least one completed web call, text block, native citation and consulted source is required.

The spike does not persist the API key, access code, full user input, request headers, raw SDK response, raw exception text or browser-provided domain/model data. Failures use bounded codes such as `planner_request_failed`, `planner_response_invalid`, `web_request_failed`, `web_response_invalid` and `source_policy_failed`.

## Verification

`functions/tests/openai-spike.test.ts` uses a fake OpenAI client and in-memory spike repository. It verifies the normal mock path, exact model gate, request order, two-slot ceiling, no retries, planner-failure short circuit, request parameters, safe telemetry, and rejection of an adversarial hostname. Tests perform no network calls and use no secrets.

Official references:

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [GPT-5.4 Mini model](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
