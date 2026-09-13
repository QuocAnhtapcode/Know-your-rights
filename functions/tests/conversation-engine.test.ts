import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationView } from '../../shared/contracts';
import { OfficialConversationEngine, type ConversationEngine } from '../src/ai/conversation-engine';
import { buildModelContext } from '../src/ai/context-builder';
import {
  adaptPlannerOutput,
  applyPlannerCorrection,
  hardenPlannerDecision,
  type PlannerDecision,
} from '../src/ai/planner';
import { CitationGateError, gateResearchResponse } from '../src/security/citation-gate';
import { MockConversationService } from '../src/session/mock-service';
import { SOURCE_REGISTRY, SOURCES_BY_ID } from '../src/sources/registry';
import { routeSources } from '../src/sources/router';
import { MemorySessionRepository } from './memory-repository';

const now = Date.parse('2026-09-12T12:00:00.000Z');

function view(userText = 'Tôi làm ở Sydney và chưa nhận payslip'): ConversationView {
  const userMessageId = randomUUID();
  return {
    conversationId: randomUUID(), contextVersion: 1, status: 'active',
    messages: [{
      id: userMessageId, role: 'user', text: userText, createdAt: new Date(now).toISOString(),
      sourceIds: [], provenance: 'user_reported',
    }],
    userFacts: [], evidenceLedger: [], expiresAt: new Date(now + 60_000).toISOString(),
    conversationState: { language: 'vi', currentTopic: null, pendingQuestion: null },
  };
}

function decision(conversation: ConversationView): PlannerDecision {
  const latest = conversation.messages.at(-1)!;
  return {
    turnKind: 'research', standaloneQuestion: 'Quy định về payslip là gì?',
    searchQuery: 'official payslip requirements Australia', sourceGroups: ['payslips'],
    jurisdiction: 'NSW', needsNewEvidence: true, directReplyBlocks: [],
    factsPatch: [{
      operation: 'upsert', key: 'jurisdiction', value: 'NSW',
      sourceMessageId: latest.id, quote: 'Sydney',
    }],
    statePatch: { language: 'vi', currentTopic: 'payslips', pendingQuestion: null },
  };
}

describe('M4 source routing and manual context', () => {
  it('ships S01-S29 exactly and keeps conditional/link-only sources out of ordinary search', () => {
    expect(SOURCE_REGISTRY.map((source) => source.id)).toEqual(
      Array.from({ length: 29 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`),
    );
    expect(SOURCES_BY_ID.get('S05')).toMatchObject({ mode: 'conditional_search', review_status: 'indexed_only' });
    expect(SOURCES_BY_ID.get('S26')?.mode).toBe('link_only');
    expect(SOURCES_BY_ID.get('S29')?.mode).toBe('link_only');
    const ordinary = routeSources(['super', 'urgent_support'], 'NSW');
    expect(ordinary.sourceIds).not.toContain('S05');
    expect(ordinary.sourceIds).not.toContain('S26');
    expect(ordinary.sourceIds).not.toContain('S29');
    expect(routeSources(['super'], 'NSW', { allowConditional: true }).sourceIds).toContain('S05');
  });

  it('reroutes state-specific workplace safety when a correction changes NSW to VIC', () => {
    expect(routeSources(['work_safety'], 'NSW').sourceIds).toContain('S07');
    expect(routeSources(['work_safety'], 'NSW').sourceIds).not.toContain('S11');
    expect(routeSources(['work_safety'], 'VIC').sourceIds).toContain('S11');
    expect(routeSources(['work_safety'], 'VIC').sourceIds).not.toContain('S07');
  });

  it('redacts identifiers, respects a token budget and has no authority/quota fields', () => {
    const context = buildModelContext(view('Email test@example.com, phone 0412 345 678, tôi ở Sydney.'), 1_000);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('test@example.com');
    expect(serialized).not.toContain('0412 345 678');
    expect(serialized).not.toMatch(/ownerUid|quota|attempts|activeAttempt/);
    expect(context.approximateTokens).toBeLessThanOrEqual(1_000);
  });
});

describe('M4 planner provenance and citation gate', () => {
  it('whitelists the snake_case planner adapter and only stores a verbatim user fact', () => {
    const conversation = view();
    const latest = conversation.messages.at(-1)!;
    const adapted = adaptPlannerOutput({
      turn_kind: 'research', standalone_question: 'Payslip?', search_query: 'official payslip requirements',
      source_groups: ['payslips'], jurisdiction: 'NSW', needs_new_evidence: true,
      facts_patch: [
        { operation: 'upsert', key: 'jurisdiction', value: 'NSW', source_message_id: latest.id, quote: 'Sydney' },
        { operation: 'upsert', key: 'user_goal', value: 'invented', source_message_id: latest.id, quote: 'not in message' },
      ],
      state_patch: { current_topic: 'payslips', pending_question: null, language: 'vi' },
      direct_reply_blocks: [],
    });
    const record = {
      ...conversation, id: conversation.conversationId, ownerUid: 'owner', generation: randomUUID(),
      version: 1, createdAt: now, updatedAt: now, expiresAt: now + 60_000, attempts: {}, activeAttempt: null,
    };
    // @ts-expect-error Replace public wire aliases with server fields for this focused fixture.
    delete record.conversationId;
    // @ts-expect-error Replace public wire aliases with server fields for this focused fixture.
    delete record.contextVersion;
    applyPlannerCorrection(record, adapted, now);
    expect(record.userFacts).toHaveLength(1);
    expect(record.userFacts[0]).toMatchObject({ sourceMessageId: latest.id, quote: 'Sydney', status: 'user_reported' });
  });

  it('does not let the model invent a jurisdiction for source routing', () => {
    const conversation = view('Tình huống hư cấu: payslip là gì?');
    const raw = decision(conversation);
    const hardened = hardenPlannerDecision({ ...raw, jurisdiction: 'VIC', factsPatch: [] }, conversation);
    expect(hardened.jurisdiction).toBe('UNKNOWN');
  });

  it('accepts Unicode/multiple cited blocks and rejects an out-of-policy source', () => {
    const allowed = [SOURCES_BY_ID.get('S02')!];
    const block = (text: string, url = 'https://www.fairwork.gov.au/pay-and-wages/paying-wages/pay-slips') => ({
      type: 'output_text', text,
      annotations: [{ type: 'url_citation', url, title: 'Pay slips', start_index: 0, end_index: Array.from(text).length }],
    });
    const response = {
      status: 'completed', model: 'fixture-model', usage: { input_tokens: 10, output_tokens: 10 },
      output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: 'https://www.fairwork.gov.au/pay-and-wages/paying-wages/pay-slips' }] } },
        { type: 'message', status: 'completed', content: [block('🙂 Quyền của bạn.'), block('Kiểm tra phiếu lương.')] },
      ],
    };
    const result = gateResearchResponse(response, allowed, 'fixture-model', 'NSW', now);
    expect(result.text).toContain('🙂');
    expect(result.evidence).toHaveLength(1);
    const bad = structuredClone(response);
    bad.output[1]!.content![0]!.annotations![0]!.url = 'https://evil.example/fake';
    expect(() => gateResearchResponse(bad, allowed, 'fixture-model', 'NSW', now)).toThrow(CitationGateError);
  });
});

describe('M4 authoritative correction pipeline', () => {
  it('calls planner/answer outside transactions and preserves correction when answer fails', async () => {
    const repository = new MemorySessionRepository();
    const plan = vi.fn((conversation: ConversationView) => {
      expect(repository.inTransaction).toBe(false);
      return Promise.resolve(decision(conversation));
    });
    const answer = vi.fn(() => {
      expect(repository.inTransaction).toBe(false);
      return Promise.reject(new Error('synthetic B failure'));
    });
    const engine: ConversationEngine = { mode: 'live', usesExternalAI: false, plan, answer };
    const service = new MockConversationService(repository, engine, () => now);
    const started = await service.start('owner', { requestId: randomUUID(), accessCode: 'emulator-only-code' });
    const input = {
      conversationId: started.conversation.conversationId,
      contextVersion: started.conversation.contextVersion,
      userMessageId: randomUUID(), attemptId: randomUUID(),
      message: 'Tôi làm ở Sydney và chưa nhận payslip',
    };
    await expect(service.send('owner', input)).rejects.toMatchObject({ code: 'unavailable' });
    const stored = repository.conversations.get(input.conversationId)!;
    expect(stored.userFacts.filter((fact) => fact.status === 'user_reported')).toEqual([
      expect.objectContaining({ key: 'jurisdiction', value: 'NSW', sourceMessageId: input.userMessageId, quote: 'Sydney' }),
    ]);
    expect(stored.attempts[input.attemptId]?.status).toBe('failed');
    expect(stored.activeAttempt).toBeNull();
    expect(plan).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledTimes(1);
  });
});

describe('M4 official Responses adapter (network-free)', () => {
  it('uses one no-web structured plan and one server-filtered web request with store false', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const conversation = view();
    const latest = conversation.messages.at(-1)!;
    const parsedPlan = {
      turn_kind: 'research', standalone_question: 'What are the payslip rules?',
      search_query: 'official payslip requirements Australia', source_groups: ['payslips'],
      jurisdiction: 'NSW', needs_new_evidence: true,
      facts_patch: [{ operation: 'upsert', key: 'jurisdiction', value: 'NSW', source_message_id: latest.id, quote: 'Sydney' }],
      state_patch: { current_topic: 'payslips', pending_question: null, language: 'vi' },
      direct_reply_blocks: [],
    };
    const sourceUrl = 'https://www.fairwork.gov.au/pay-and-wages/paying-wages/pay-slips';
    const parse = vi.fn().mockResolvedValue({
      status: 'completed', model: 'fixture-model', output_parsed: parsedPlan,
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    const answerText = 'Kiểm tra thông tin trên Fair Work Ombudsman.';
    const create = vi.fn().mockResolvedValue({
      status: 'completed', model: 'fixture-model', usage: { input_tokens: 30, output_tokens: 15 },
      output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: sourceUrl }] } },
        { type: 'message', status: 'completed', content: [{
          type: 'output_text', text: answerText,
          annotations: [{ type: 'url_citation', url: sourceUrl, title: 'Pay slips', start_index: 0, end_index: answerText.length }],
        }] },
      ],
    });
    const client = { responses: { parse, create } } as unknown as OpenAI;
    const engine = new OfficialConversationEngine(client, 'fixture-model', () => now);
    const plan = await engine.plan(conversation);
    const answer = await engine.answer(conversation, plan);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0]![0]).toMatchObject({ store: false, model: 'fixture-model' });
    expect(parse.mock.calls[0]![0]).not.toHaveProperty('tools');
    expect(create).toHaveBeenCalledTimes(1);
    const researchRequest = create.mock.calls[0]![0];
    expect(researchRequest).toMatchObject({ store: false, max_tool_calls: 1, tool_choice: 'required' });
    expect(researchRequest.tools[0].filters.allowed_domains).toContain('www.fairwork.gov.au');
    expect(researchRequest.tools[0].filters.allowed_domains.length).toBeLessThan(29);
    expect(answer).toMatchObject({ provenance: 'web_grounded', text: expect.stringContaining('Fair Work') });
    expect(answer.evidence).toHaveLength(1);
  });
});
