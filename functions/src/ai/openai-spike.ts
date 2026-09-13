import type OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { z } from 'zod';
import type { ConversationView } from '../../../shared/contracts';
import type { ReplyProvider } from './provider';
import {
  nativeUrlCitationSchema,
  plannerOutputSchema,
  rawWebTextBlockSchema,
  spikeTelemetrySchema,
} from './spike-repository';
import type {
  ConsultedSource,
  NativeUrlCitation,
  OpenAISpikeRepository,
  PlannerOutput,
  RawWebTextBlock,
  SpikeFailureCode,
  SpikeTelemetry,
} from './spike-repository';

export const OPENAI_SPIKE_SENTINEL = 'RUN_M2_FWO_COMPATIBILITY_SPIKE_V1' as const;
export const OPENAI_SPIKE_MODEL = 'gpt-5.4-mini-2026-03-17' as const;
export const OPENAI_SPIKE_FWO_HOST = 'www.fairwork.gov.au' as const;

const SYNTHETIC_SCENARIO =
  'A fictional worker in Australia is required to attend a short employer meeting before a scheduled shift '
  + 'and wants to know which official Fair Work Ombudsman information may help them ask whether that time counts as work.';

const plannerResponseSchema = z.looseObject({
  status: z.literal('completed'),
  model: z.string().min(1).max(100),
  output_parsed: plannerOutputSchema,
  usage: z.unknown(),
});

const webResponseSchema = z.looseObject({
  status: z.literal('completed'),
  model: z.string().min(1).max(100),
  output: z.array(z.unknown()).min(1).max(16),
  usage: z.unknown(),
});

const usageEnvelopeSchema = z.looseObject({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
  input_tokens_details: z.looseObject({ cached_tokens: z.number().int().min(0).optional() }).optional(),
  output_tokens_details: z.looseObject({ reasoning_tokens: z.number().int().min(0).optional() }).optional(),
});

const webCallSchema = z.looseObject({
  type: z.literal('web_search_call'),
  status: z.literal('completed'),
  action: z.discriminatedUnion('type', [
    z.looseObject({
      type: z.literal('search'),
      sources: z.array(z.looseObject({ type: z.literal('url'), url: z.string() })).min(1),
    }),
    z.looseObject({ type: z.literal('open_page'), url: z.string().min(1) }),
    z.looseObject({ type: z.literal('find_in_page'), url: z.string().min(1) }),
  ]),
});

const outputTextSchema = z.looseObject({
  type: z.literal('output_text'),
  text: z.string().min(1).max(16_000),
  annotations: z.array(z.unknown()).max(24),
});

const outputMessageSchema = z.looseObject({
  type: z.literal('message'),
  status: z.literal('completed'),
  content: z.array(z.unknown()).min(1).max(8),
});

export interface OpenAISpikeClient {
  createPlanner(model: typeof OPENAI_SPIKE_MODEL): Promise<unknown>;
  createFwoSearch(model: typeof OPENAI_SPIKE_MODEL, plan: PlannerOutput): Promise<unknown>;
}

/** Thin official-SDK adapter. Keeping this separate makes all tests network-free. */
export class OfficialOpenAISpikeClient implements OpenAISpikeClient {
  constructor(private readonly client: OpenAI) {}

  async createPlanner(model: typeof OPENAI_SPIKE_MODEL): Promise<unknown> {
    return this.client.responses.parse({
      model,
      store: false,
      max_output_tokens: 300,
      reasoning: { effort: 'none' },
      input: [
        {
          role: 'developer',
          content: 'Plan one synthetic research turn. Return only the supplied schema. Do not provide legal advice.',
        },
        { role: 'user', content: SYNTHETIC_SCENARIO },
      ],
      text: { format: zodTextFormat(plannerOutputSchema, 'm2_fwo_planner') },
    }, { maxRetries: 0, timeout: 20_000 });
  }

  async createFwoSearch(model: typeof OPENAI_SPIKE_MODEL, plan: PlannerOutput): Promise<unknown> {
    // SDK 7.15.0 exposes max_tool_calls on its WebSocket ResponseCreate type, but
    // omits it from the stable REST ResponseCreateParamsBase. The official REST API
    // documents the field, so this narrow intersection preserves it for the spike.
    const request: ResponseCreateParamsNonStreaming & { max_tool_calls: 1 } = {
      model,
      store: false,
      max_output_tokens: 500,
      max_tool_calls: 1,
      parallel_tool_calls: false,
      reasoning: { effort: 'none' },
      include: ['web_search_call.action.sources'],
      tools: [{
        type: 'web_search',
        external_web_access: true,
        filters: { allowed_domains: [OPENAI_SPIKE_FWO_HOST] },
        search_context_size: 'low',
      }],
      tool_choice: 'required',
      input: [
        {
          role: 'developer',
          content: 'This is a synthetic API compatibility check, not legal advice. Use the web tool once. '
            + 'Base every factual statement only on returned Fair Work Ombudsman pages and include native citations.',
        },
        {
          role: 'user',
          content: `Synthetic question: ${plan.standalone_question}\nSearch focus: ${plan.search_query}`,
        },
      ],
    };
    return this.client.responses.create(request, { maxRetries: 0, timeout: 60_000 });
  }
}

function safeLatency(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.min(120_000, Math.round(endedAt - startedAt)));
}

function telemetry(
  response: unknown,
  latencyMs: number,
): SpikeTelemetry {
  const envelope = z.looseObject({
    model: z.string().min(1).max(100).optional(),
    status: z.string().min(1).max(40).optional(),
    usage: z.unknown().optional(),
  }).safeParse(response);
  const usage = envelope.success ? usageEnvelopeSchema.safeParse(envelope.data.usage) : null;
  return spikeTelemetrySchema.parse({
    requestedModel: OPENAI_SPIKE_MODEL,
    responseModel: envelope?.success ? (envelope.data.model ?? null) : null,
    responseStatus: envelope?.success ? (envelope.data.status ?? null) : null,
    latencyMs,
    usage: usage?.success ? {
      inputTokens: usage.data.input_tokens,
      outputTokens: usage.data.output_tokens,
      totalTokens: usage.data.total_tokens,
      cachedInputTokens: usage.data.input_tokens_details?.cached_tokens ?? 0,
      reasoningOutputTokens: usage.data.output_tokens_details?.reasoning_tokens ?? 0,
    } : null,
  });
}

function isExactFwoUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname === OPENAI_SPIKE_FWO_HOST
      && parsed.port === ''
      && parsed.username === ''
      && parsed.password === '';
  } catch {
    return false;
  }
}

function parsePlannerResponse(response: unknown): PlannerOutput | null {
  const parsed = plannerResponseSchema.safeParse(response);
  if (!parsed.success || parsed.data.model !== OPENAI_SPIKE_MODEL) return null;
  if (/https?:\/\/|www\./iu.test(parsed.data.output_parsed.search_query)) return null;
  return parsed.data.output_parsed;
}

function parseCitation(annotation: unknown, text: string):
  | { kind: 'valid'; citation: NativeUrlCitation }
  | { kind: 'invalid_response' | 'source_policy_failed' } {
  const parsed = nativeUrlCitationSchema.safeParse(annotation);
  if (!parsed.success) return { kind: 'invalid_response' };
  if (!isExactFwoUrl(parsed.data.url)) return { kind: 'source_policy_failed' };
  if (parsed.data.start_index >= parsed.data.end_index || parsed.data.end_index > text.length) {
    return { kind: 'invalid_response' };
  }
  return { kind: 'valid', citation: parsed.data };
}

type WebEvidence = { rawTextBlocks: RawWebTextBlock[]; consultedSources: ConsultedSource[] };
type WebEvidenceResult =
  | { kind: 'valid'; evidence: WebEvidence }
  | { kind: 'web_response_invalid' | 'source_policy_failed' };

function parseWebEvidence(response: unknown): WebEvidenceResult {
  const envelope = webResponseSchema.safeParse(response);
  if (!envelope.success || envelope.data.model !== OPENAI_SPIKE_MODEL) return { kind: 'web_response_invalid' };
  const rawTextBlocks: RawWebTextBlock[] = [];
  const sourceUrls: string[] = [];
  let completedWebCalls = 0;
  let totalTextLength = 0;

  for (const item of envelope.data.output) {
    if (item && typeof item === 'object' && 'type' in item && item.type === 'web_search_call') {
      const webCall = webCallSchema.safeParse(item);
      if (!webCall.success) return { kind: 'web_response_invalid' };
      completedWebCalls += 1;
      if (webCall.data.action.type === 'search') {
        for (const source of webCall.data.action.sources) sourceUrls.push(source.url);
      } else {
        sourceUrls.push(webCall.data.action.url);
      }
      continue;
    }
    if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'message') continue;
    const message = outputMessageSchema.safeParse(item);
    if (!message.success) return { kind: 'web_response_invalid' };
    for (const content of message.data.content) {
      if (!content || typeof content !== 'object' || !('type' in content) || content.type !== 'output_text') continue;
      const block = outputTextSchema.safeParse(content);
      if (!block.success) return { kind: 'web_response_invalid' };
      const citationResults = block.data.annotations.map((annotation) => parseCitation(annotation, block.data.text));
      if (citationResults.some((result) => result.kind === 'source_policy_failed')) {
        return { kind: 'source_policy_failed' };
      }
      if (citationResults.some((result) => result.kind !== 'valid')) return { kind: 'web_response_invalid' };
      const annotations = citationResults.map((result) => {
        if (result.kind !== 'valid') throw new Error('Unreachable citation state.');
        return result.citation;
      });
      totalTextLength += block.data.text.length;
      if (totalTextLength > 16_000) return { kind: 'web_response_invalid' };
      rawTextBlocks.push(rawWebTextBlockSchema.parse({
        text: block.data.text,
        annotations,
      }));
    }
  }

  const citationCount = rawTextBlocks.reduce((sum, block) => sum + block.annotations.length, 0);
  if (completedWebCalls !== 1 || rawTextBlocks.length === 0 || citationCount === 0 || sourceUrls.length === 0) {
    return { kind: 'web_response_invalid' };
  }
  if (sourceUrls.some((url) => !isExactFwoUrl(url))) return { kind: 'source_policy_failed' };
  const consultedSources: ConsultedSource[] = [...new Set(sourceUrls)].map((url) => ({ type: 'url', url }));
  if (consultedSources.length > 32) return { kind: 'web_response_invalid' };
  return { kind: 'valid', evidence: { rawTextBlocks, consultedSources } };
}

function failureSummary(stage: 'planner' | 'web search', code: SpikeFailureCode): string {
  return `[M2 OPENAI COMPATIBILITY SPIKE — NON-LEGAL / MOCK RESPONSE] FAIL (${stage}; ${code}). `
    + 'No legal answer is shown. The consumed global slot will not be retried or reclaimed.';
}

function unavailableSummary(reason: string): string {
  return `[M2 OPENAI COMPATIBILITY SPIKE — NON-LEGAL / MOCK RESPONSE] NOT RUN (${reason}). `
    + 'No OpenAI request was made for this message.';
}

export class OpenAICompatibilitySpikeProvider implements ReplyProvider {
  constructor(
    private readonly fallback: ReplyProvider,
    private readonly repository: OpenAISpikeRepository,
    private readonly createClient: () => OpenAISpikeClient,
    private readonly readModel: () => string | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  async reply(conversation: ConversationView): Promise<string> {
    const latest = conversation.messages.at(-1);
    if (latest?.role !== 'user' || latest.text !== OPENAI_SPIKE_SENTINEL) {
      return this.fallback.reply(conversation);
    }
    if (this.readModel() !== OPENAI_SPIKE_MODEL) {
      return unavailableSummary(`OPENAI_MODEL must equal ${OPENAI_SPIKE_MODEL}`);
    }

    const plannerReservation = await this.repository.reserve('planner');
    if (plannerReservation.kind !== 'reserved') return unavailableSummary(plannerReservation.reason);

    let client: OpenAISpikeClient;
    try {
      // The secret-backed SDK factory is deliberately reached only after the irreversible slot reservation.
      client = this.createClient();
    } catch {
      const failedTelemetry = telemetry(null, 0);
      await this.repository.completePlanner(plannerReservation.reservationId, {
        status: 'failed', failureCode: 'client_configuration_failed', telemetry: failedTelemetry,
      });
      return failureSummary('planner', 'client_configuration_failed');
    }

    const plannerStartedAt = this.now();
    let plannerResponse: unknown;
    try {
      plannerResponse = await client.createPlanner(OPENAI_SPIKE_MODEL);
    } catch {
      const failedTelemetry = telemetry(null, safeLatency(plannerStartedAt, this.now()));
      await this.repository.completePlanner(plannerReservation.reservationId, {
        status: 'failed', failureCode: 'planner_request_failed', telemetry: failedTelemetry,
      });
      return failureSummary('planner', 'planner_request_failed');
    }
    const plannerTelemetry = telemetry(plannerResponse, safeLatency(plannerStartedAt, this.now()));
    const plan = parsePlannerResponse(plannerResponse);
    if (!plan || !plannerTelemetry.usage) {
      await this.repository.completePlanner(plannerReservation.reservationId, {
        status: 'failed', failureCode: 'planner_response_invalid', telemetry: plannerTelemetry,
      });
      return failureSummary('planner', 'planner_response_invalid');
    }
    await this.repository.completePlanner(plannerReservation.reservationId, {
      status: 'succeeded', telemetry: plannerTelemetry, plannerOutput: plan,
    });

    const webReservation = await this.repository.reserve('webSearch');
    if (webReservation.kind !== 'reserved') return unavailableSummary(webReservation.reason);
    const webStartedAt = this.now();
    let webResponse: unknown;
    try {
      webResponse = await client.createFwoSearch(OPENAI_SPIKE_MODEL, plan);
    } catch {
      const failedTelemetry = telemetry(null, safeLatency(webStartedAt, this.now()));
      await this.repository.completeWebSearch(webReservation.reservationId, {
        status: 'failed', failureCode: 'web_request_failed', telemetry: failedTelemetry,
      });
      return failureSummary('web search', 'web_request_failed');
    }
    const webTelemetry = telemetry(webResponse, safeLatency(webStartedAt, this.now()));
    const evidenceResult = parseWebEvidence(webResponse);
    if (evidenceResult.kind !== 'valid' || !webTelemetry.usage) {
      const failureCode = evidenceResult.kind === 'source_policy_failed'
        ? 'source_policy_failed' as const
        : 'web_response_invalid' as const;
      await this.repository.completeWebSearch(webReservation.reservationId, {
        status: 'failed', failureCode, telemetry: webTelemetry,
      });
      return failureSummary('web search', failureCode);
    }
    const evidence = evidenceResult.evidence;
    await this.repository.completeWebSearch(webReservation.reservationId, {
      status: 'succeeded', telemetry: webTelemetry,
      rawTextBlocks: evidence.rawTextBlocks,
      consultedSources: evidence.consultedSources,
    });

    const citations = evidence.rawTextBlocks.reduce((sum, block) => sum + block.annotations.length, 0);
    return '[M2 OPENAI COMPATIBILITY SPIKE — NON-LEGAL / MOCK RESPONSE] PASS. '
      + `Planner parsed; one domain-filtered FWO web request returned ${evidence.rawTextBlocks.length} text block(s), `
      + `${citations} native citation(s), and ${evidence.consultedSources.length} consulted source URL(s). `
      + `Latency: planner ${plannerTelemetry.latencyMs} ms, web ${webTelemetry.latencyMs} ms. `
      + `Usage: ${plannerTelemetry.usage.totalTokens + webTelemetry.usage.totalTokens} total token(s). `
      + 'Sanitized compatibility evidence was stored server-side; no legal answer is displayed.';
  }
}
