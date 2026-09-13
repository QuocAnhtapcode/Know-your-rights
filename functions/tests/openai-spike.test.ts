import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationView } from '../../shared/contracts';
import {
  OPENAI_SPIKE_FWO_HOST,
  OPENAI_SPIKE_MODEL,
  OPENAI_SPIKE_SENTINEL,
  OfficialOpenAISpikeClient,
  OpenAICompatibilitySpikeProvider,
} from '../src/ai/openai-spike';
import { FakeReplyProvider } from '../src/ai/provider';
import type {
  OpenAISpikeRepository,
  PlannerCompletion,
  SpikeReservation,
  WebCompletion,
} from '../src/ai/spike-repository';

const plan = {
  turn_kind: 'research' as const,
  standalone_question: 'Does required time before a rostered shift potentially count as work?',
  search_query: 'required pre-shift meetings working time Australia',
  source_group: 'employment_general' as const,
  jurisdiction: 'Australia' as const,
  needs_new_evidence: true as const,
};

const usage = {
  input_tokens: 12,
  output_tokens: 8,
  total_tokens: 20,
  input_tokens_details: { cached_tokens: 2 },
  output_tokens_details: { reasoning_tokens: 1 },
};

function plannerResponse() {
  return { status: 'completed', model: OPENAI_SPIKE_MODEL, output_parsed: plan, usage, output: [] };
}

function webResponse(url = 'https://www.fairwork.gov.au/pay-and-wages') {
  const text = 'Synthetic FWO compatibility evidence.';
  return {
    status: 'completed',
    model: OPENAI_SPIKE_MODEL,
    usage,
    output: [
      {
        type: 'web_search_call', status: 'completed',
        action: { type: 'search', sources: [{ type: 'url', url }] },
      },
      {
        type: 'message', status: 'completed',
        content: [{
          type: 'output_text', text,
          annotations: [{
            type: 'url_citation', start_index: 0, end_index: 13,
            title: 'Fair Work Ombudsman', url,
          }],
        }],
      },
    ],
  };
}

function conversation(message: string): ConversationView {
  return {
    conversationId: randomUUID(),
    contextVersion: 1,
    status: 'active',
    messages: [{
      id: randomUUID(), role: 'user', text: message,
      createdAt: '2026-09-13T00:00:00.000Z', sourceIds: [], provenance: 'user_reported',
    }],
    userFacts: [], evidenceLedger: [],
    conversationState: { language: 'vi', currentTopic: null, pendingQuestion: null },
    expiresAt: '2026-09-13T01:00:00.000Z',
  };
}

class MemorySpikeRepository implements OpenAISpikeRepository {
  irreversibleSlotsUsed = 0;
  planner: ({ reservationId: string } & PlannerCompletion) | { reservationId: string; status: 'reserved' } | null = null;
  webSearch: ({ reservationId: string } & WebCompletion) | { reservationId: string; status: 'reserved' } | null = null;

  reserve(stage: 'planner' | 'webSearch'): Promise<SpikeReservation> {
    const current = stage === 'planner' ? this.planner : this.webSearch;
    if (current) return Promise.resolve({ kind: 'unavailable', reason: 'already_reserved' });
    if (this.irreversibleSlotsUsed >= 2) return Promise.resolve({ kind: 'unavailable', reason: 'budget_exhausted' });
    if (stage === 'planner' && this.irreversibleSlotsUsed !== 0) {
      return Promise.resolve({ kind: 'unavailable', reason: 'budget_exhausted' });
    }
    if (stage === 'webSearch' && (this.irreversibleSlotsUsed !== 1 || this.planner?.status !== 'succeeded')) {
      return Promise.resolve({ kind: 'unavailable', reason: 'planner_not_succeeded' });
    }
    const reservationId = randomUUID();
    this.irreversibleSlotsUsed += 1;
    if (stage === 'planner') this.planner = { status: 'reserved', reservationId };
    else this.webSearch = { status: 'reserved', reservationId };
    return Promise.resolve({ kind: 'reserved', reservationId, slot: stage === 'planner' ? 1 : 2 });
  }

  completePlanner(reservationId: string, completion: PlannerCompletion): Promise<void> {
    if (this.planner?.status !== 'reserved' || this.planner.reservationId !== reservationId) throw new Error('bad reservation');
    this.planner = { reservationId, ...structuredClone(completion) };
    return Promise.resolve();
  }

  completeWebSearch(reservationId: string, completion: WebCompletion): Promise<void> {
    if (this.webSearch?.status !== 'reserved' || this.webSearch.reservationId !== reservationId) throw new Error('bad reservation');
    this.webSearch = { reservationId, ...structuredClone(completion) };
    return Promise.resolve();
  }
}

function provider(options: {
  repository?: MemorySpikeRepository;
  model?: string;
  planner?: () => Promise<unknown>;
  web?: () => Promise<unknown>;
} = {}) {
  const repository = options.repository ?? new MemorySpikeRepository();
  const createPlanner = vi.fn(options.planner ?? (() => Promise.resolve(plannerResponse())));
  const createFwoSearch = vi.fn(options.web ?? (() => Promise.resolve(webResponse())));
  const createClient = vi.fn(() => ({ createPlanner, createFwoSearch }));
  let now = 1_000;
  const instance = new OpenAICompatibilitySpikeProvider(
    new FakeReplyProvider(), repository, createClient,
    () => options.model ?? OPENAI_SPIKE_MODEL,
    () => (now += 25),
  );
  return { instance, repository, createClient, createPlanner, createFwoSearch };
}

describe('M2 OpenAI compatibility spike', () => {
  it('keeps ordinary messages on the fake provider without reading model/client/ledger', async () => {
    const repository = new MemorySpikeRepository();
    const createClient = vi.fn();
    const readModel = vi.fn();
    const instance = new OpenAICompatibilitySpikeProvider(
      new FakeReplyProvider(), repository, createClient, readModel,
    );
    const reply = await instance.reply(conversation('A normal synthetic UI message'));
    expect(reply).toContain('MOCK');
    expect(readModel).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(repository.irreversibleSlotsUsed).toBe(0);
  });

  it('uses exactly two irreversible slots and stores only gated FWO evidence plus telemetry', async () => {
    const run = provider();
    const reply = await run.instance.reply(conversation(OPENAI_SPIKE_SENTINEL));
    expect(reply).toContain('NON-LEGAL / MOCK RESPONSE] PASS');
    expect(run.createClient).toHaveBeenCalledTimes(1);
    expect(run.createPlanner).toHaveBeenCalledTimes(1);
    expect(run.createFwoSearch).toHaveBeenCalledTimes(1);
    expect(run.repository.irreversibleSlotsUsed).toBe(2);
    expect(run.repository.planner).toMatchObject({ status: 'succeeded', plannerOutput: plan });
    expect(run.repository.webSearch).toMatchObject({
      status: 'succeeded',
      rawTextBlocks: [{ annotations: [{ type: 'url_citation' }] }],
      consultedSources: [{ type: 'url', url: 'https://www.fairwork.gov.au/pay-and-wages' }],
    });
    expect(JSON.stringify(run.repository)).not.toContain(OPENAI_SPIKE_SENTINEL);

    const second = await run.instance.reply(conversation(OPENAI_SPIKE_SENTINEL));
    expect(second).toContain('NOT RUN (already_reserved)');
    expect(run.createPlanner).toHaveBeenCalledTimes(1);
    expect(run.createFwoSearch).toHaveBeenCalledTimes(1);
    expect(run.repository.irreversibleSlotsUsed).toBe(2);
  });

  it('does not allocate a slot or create a client when OPENAI_MODEL is missing or changed', async () => {
    const run = provider({ model: 'gpt-unreviewed' });
    const reply = await run.instance.reply(conversation(OPENAI_SPIKE_SENTINEL));
    expect(reply).toContain(`OPENAI_MODEL must equal ${OPENAI_SPIKE_MODEL}`);
    expect(run.repository.irreversibleSlotsUsed).toBe(0);
    expect(run.createClient).not.toHaveBeenCalled();
  });

  it('never starts web search when planner fails and never retries the planner request', async () => {
    const run = provider({ planner: () => Promise.reject(new Error('sensitive upstream detail')) });
    const reply = await run.instance.reply(conversation(OPENAI_SPIKE_SENTINEL));
    expect(reply).toContain('FAIL (planner; planner_request_failed)');
    expect(run.createPlanner).toHaveBeenCalledTimes(1);
    expect(run.createFwoSearch).not.toHaveBeenCalled();
    expect(run.repository.irreversibleSlotsUsed).toBe(1);
    expect(run.repository.planner).toMatchObject({ status: 'failed', failureCode: 'planner_request_failed' });
    expect(JSON.stringify(run.repository)).not.toContain('sensitive upstream detail');
  });

  it('fails closed and persists no raw text or URL when web evidence leaves the exact HTTPS host', async () => {
    const run = provider({ web: () => Promise.resolve(webResponse('https://www.fairwork.gov.au.evil.example/page')) });
    const reply = await run.instance.reply(conversation(OPENAI_SPIKE_SENTINEL));
    expect(reply).toContain('FAIL (web search; source_policy_failed)');
    expect(run.createPlanner).toHaveBeenCalledTimes(1);
    expect(run.createFwoSearch).toHaveBeenCalledTimes(1);
    expect(run.repository.irreversibleSlotsUsed).toBe(2);
    expect(run.repository.webSearch).toMatchObject({ status: 'failed', failureCode: 'source_policy_failed' });
    expect(JSON.stringify(run.repository)).not.toContain('evil.example');
    expect(JSON.stringify(run.repository)).not.toContain('rawTextBlocks');
  });

  it('builds both official SDK requests with fixed synthetic input and hard limits', async () => {
    const parse = vi.fn(() => Promise.resolve(plannerResponse()));
    const create = vi.fn(() => Promise.resolve(webResponse()));
    const sdk = { responses: { parse, create } } as unknown as OpenAI;
    const client = new OfficialOpenAISpikeClient(sdk);
    await client.createPlanner(OPENAI_SPIKE_MODEL);
    await client.createFwoSearch(OPENAI_SPIKE_MODEL, plan);

    const parseCalls = parse.mock.calls as unknown as Array<[unknown, unknown?]>;
    const createCalls = create.mock.calls as unknown as Array<[unknown, unknown?]>;
    const plannerRequest = parseCalls[0]?.[0];
    const plannerOptions = parseCalls[0]?.[1];
    expect(plannerRequest).toMatchObject({
      model: OPENAI_SPIKE_MODEL, store: false, max_output_tokens: 300,
      reasoning: { effort: 'none' }, text: { format: { type: 'json_schema' } },
    });
    expect(plannerOptions).toEqual({ maxRetries: 0, timeout: 20_000 });

    const webRequest = createCalls[0]?.[0];
    const webOptions = createCalls[0]?.[1];
    expect(webRequest).toMatchObject({
      model: OPENAI_SPIKE_MODEL,
      store: false,
      max_output_tokens: 500,
      max_tool_calls: 1,
      parallel_tool_calls: false,
      tool_choice: 'required',
      include: ['web_search_call.action.sources'],
      tools: [{
        type: 'web_search', external_web_access: true,
        filters: { allowed_domains: [OPENAI_SPIKE_FWO_HOST] },
      }],
    });
    expect(webOptions).toEqual({ maxRetries: 0, timeout: 60_000 });
    expect(JSON.stringify([plannerRequest, webRequest])).not.toContain(OPENAI_SPIKE_SENTINEL);
  });
});
