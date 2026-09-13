import { randomUUID } from 'node:crypto';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

export const OPENAI_SPIKE_RUN_ID = 'm2-fwo-v1' as const;
export const OPENAI_SPIKE_MAX_SLOTS = 2 as const;

export const spikeUsageSchema = z.strictObject({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  reasoningOutputTokens: z.number().int().min(0),
});

export const spikeTelemetrySchema = z.strictObject({
  requestedModel: z.literal('gpt-5.4-mini-2026-03-17'),
  responseModel: z.string().min(1).max(100).nullable(),
  responseStatus: z.string().min(1).max(40).nullable(),
  latencyMs: z.number().int().min(0).max(120_000),
  usage: spikeUsageSchema.nullable(),
});

export const plannerOutputSchema = z.strictObject({
  turn_kind: z.literal('research'),
  standalone_question: z.string().min(1).max(500),
  search_query: z.string().min(1).max(240),
  source_group: z.literal('employment_general'),
  jurisdiction: z.literal('Australia'),
  needs_new_evidence: z.literal(true),
});

export const nativeUrlCitationSchema = z.strictObject({
  type: z.literal('url_citation'),
  start_index: z.number().int().min(0),
  end_index: z.number().int().min(1),
  title: z.string().min(1).max(500),
  url: z.string().url().max(2_048),
});

export const rawWebTextBlockSchema = z.strictObject({
  text: z.string().min(1).max(16_000),
  annotations: z.array(nativeUrlCitationSchema).max(24),
});

export const consultedSourceSchema = z.strictObject({
  type: z.literal('url'),
  url: z.string().url().max(2_048),
});

export const spikeFailureCodeSchema = z.enum([
  'client_configuration_failed',
  'planner_request_failed',
  'planner_response_invalid',
  'web_request_failed',
  'web_response_invalid',
  'source_policy_failed',
]);

const reservedStageSchema = z.strictObject({
  status: z.literal('reserved'),
  slot: z.union([z.literal(1), z.literal(2)]),
  reservationId: z.uuid(),
  reservedAt: z.iso.datetime(),
});

const failedStageSchema = reservedStageSchema.extend({
  status: z.literal('failed'),
  completedAt: z.iso.datetime(),
  failureCode: spikeFailureCodeSchema,
  telemetry: spikeTelemetrySchema,
});

const succeededPlannerStageSchema = reservedStageSchema.extend({
  status: z.literal('succeeded'),
  slot: z.literal(1),
  completedAt: z.iso.datetime(),
  telemetry: spikeTelemetrySchema,
  plannerOutput: plannerOutputSchema,
});

const succeededWebStageSchema = reservedStageSchema.extend({
  status: z.literal('succeeded'),
  slot: z.literal(2),
  completedAt: z.iso.datetime(),
  telemetry: spikeTelemetrySchema,
  rawTextBlocks: z.array(rawWebTextBlockSchema).min(1).max(8),
  consultedSources: z.array(consultedSourceSchema).min(1).max(32),
});

export const plannerStageSchema = z.union([
  reservedStageSchema.extend({ slot: z.literal(1) }),
  failedStageSchema.extend({ slot: z.literal(1) }),
  succeededPlannerStageSchema,
]);

export const webStageSchema = z.union([
  reservedStageSchema.extend({ slot: z.literal(2) }),
  failedStageSchema.extend({ slot: z.literal(2) }),
  succeededWebStageSchema,
]);

export const openAISpikeRunSchema = z.strictObject({
  schemaVersion: z.literal(OPENAI_SPIKE_RUN_ID),
  maxIrreversibleSlots: z.literal(OPENAI_SPIKE_MAX_SLOTS),
  irreversibleSlotsUsed: z.number().int().min(0).max(OPENAI_SPIKE_MAX_SLOTS),
  planner: plannerStageSchema.nullable(),
  webSearch: webStageSchema.nullable(),
  updatedAt: z.iso.datetime(),
});

export type SpikeTelemetry = z.infer<typeof spikeTelemetrySchema>;
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
export type NativeUrlCitation = z.infer<typeof nativeUrlCitationSchema>;
export type RawWebTextBlock = z.infer<typeof rawWebTextBlockSchema>;
export type ConsultedSource = z.infer<typeof consultedSourceSchema>;
export type SpikeFailureCode = z.infer<typeof spikeFailureCodeSchema>;
export type OpenAISpikeRun = z.infer<typeof openAISpikeRunSchema>;
export type SpikeStageName = 'planner' | 'webSearch';

export type PlannerCompletion =
  | { status: 'succeeded'; telemetry: SpikeTelemetry; plannerOutput: PlannerOutput }
  | { status: 'failed'; telemetry: SpikeTelemetry; failureCode: SpikeFailureCode };

export type WebCompletion =
  | {
    status: 'succeeded';
    telemetry: SpikeTelemetry;
    rawTextBlocks: RawWebTextBlock[];
    consultedSources: ConsultedSource[];
  }
  | { status: 'failed'; telemetry: SpikeTelemetry; failureCode: SpikeFailureCode };

export type SpikeReservation =
  | { kind: 'reserved'; reservationId: string; slot: 1 | 2 }
  | { kind: 'unavailable'; reason: 'already_reserved' | 'budget_exhausted' | 'planner_not_succeeded' };

export interface OpenAISpikeRepository {
  reserve(stage: SpikeStageName): Promise<SpikeReservation>;
  completePlanner(reservationId: string, completion: PlannerCompletion): Promise<void>;
  completeWebSearch(reservationId: string, completion: WebCompletion): Promise<void>;
}

function blankRun(nowIso: string): OpenAISpikeRun {
  return {
    schemaVersion: OPENAI_SPIKE_RUN_ID,
    maxIrreversibleSlots: OPENAI_SPIKE_MAX_SLOTS,
    irreversibleSlotsUsed: 0,
    planner: null,
    webSearch: null,
    updatedAt: nowIso,
  };
}

function parseExisting(value: unknown, nowIso: string): OpenAISpikeRun {
  if (value === undefined) return blankRun(nowIso);
  const parsed = openAISpikeRunSchema.safeParse(value);
  if (!parsed.success) throw new Error('OpenAI spike run metadata is invalid.');
  return parsed.data;
}

/** Dedicated singleton ledger. Its two slots are consumed before external calls and never reclaimed. */
export class FirestoreOpenAISpikeRepository implements OpenAISpikeRepository {
  private readonly reference: DocumentReference;

  constructor(
    database: Firestore,
    private readonly now: () => number = Date.now,
  ) {
    this.reference = database.collection('openaiSpikeRuns').doc(OPENAI_SPIKE_RUN_ID);
  }

  reserve(stage: SpikeStageName): Promise<SpikeReservation> {
    const reservationId = randomUUID();
    const nowIso = new Date(this.now()).toISOString();
    return this.reference.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.reference);
      const run = parseExisting(snapshot.exists ? snapshot.data() : undefined, nowIso);
      const existing = stage === 'planner' ? run.planner : run.webSearch;
      if (existing) return { kind: 'unavailable' as const, reason: 'already_reserved' as const };
      if (run.irreversibleSlotsUsed >= OPENAI_SPIKE_MAX_SLOTS) {
        return { kind: 'unavailable' as const, reason: 'budget_exhausted' as const };
      }
      if (stage === 'planner' && run.irreversibleSlotsUsed !== 0) {
        return { kind: 'unavailable' as const, reason: 'budget_exhausted' as const };
      }
      if (stage === 'webSearch' && (run.irreversibleSlotsUsed !== 1 || run.planner?.status !== 'succeeded')) {
        return { kind: 'unavailable' as const, reason: 'planner_not_succeeded' as const };
      }
      const slot = stage === 'planner' ? 1 as const : 2 as const;
      const next: OpenAISpikeRun = stage === 'planner'
        ? {
          ...run,
          irreversibleSlotsUsed: run.irreversibleSlotsUsed + 1,
          planner: { status: 'reserved', slot: 1, reservationId, reservedAt: nowIso },
          updatedAt: nowIso,
        }
        : {
          ...run,
          irreversibleSlotsUsed: run.irreversibleSlotsUsed + 1,
          webSearch: { status: 'reserved', slot: 2, reservationId, reservedAt: nowIso },
          updatedAt: nowIso,
        };
      transaction.set(this.reference, openAISpikeRunSchema.parse(next));
      return { kind: 'reserved' as const, reservationId, slot };
    });
  }

  completePlanner(reservationId: string, completion: PlannerCompletion): Promise<void> {
    return this.complete('planner', reservationId, completion);
  }

  completeWebSearch(reservationId: string, completion: WebCompletion): Promise<void> {
    return this.complete('webSearch', reservationId, completion);
  }

  private complete(
    stage: SpikeStageName,
    reservationId: string,
    completion: PlannerCompletion | WebCompletion,
  ): Promise<void> {
    const completedAt = new Date(this.now()).toISOString();
    return this.reference.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.reference);
      const parsed = openAISpikeRunSchema.safeParse(snapshot.data());
      if (!snapshot.exists || !parsed.success) throw new Error('OpenAI spike run metadata is unavailable.');
      const run = parsed.data;
      const current = stage === 'planner' ? run.planner : run.webSearch;
      if (!current || current.status !== 'reserved' || current.reservationId !== reservationId) {
        throw new Error('OpenAI spike reservation cannot be completed.');
      }
      const completed = {
        ...current,
        ...completion,
        completedAt,
      };
      const next: OpenAISpikeRun = {
        ...run,
        ...(stage === 'planner' ? { planner: plannerStageSchema.parse(completed) } : { webSearch: webStageSchema.parse(completed) }),
        updatedAt: completedAt,
      };
      transaction.set(this.reference, openAISpikeRunSchema.parse(next));
    });
  }
}
