import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationView } from '../../shared/contracts';
import { OfficialConversationEngine } from '../src/ai/conversation-engine';
import { hardenPlannerDecision, type PlannerDecision } from '../src/ai/planner';
import { SOURCES_BY_ID } from '../src/sources/registry';
import {
  hasExplicitWorkplaceViolence, inferGroups, routeSources,
} from '../src/sources/router';

const now = Date.parse('2026-09-13T09:00:00.000Z');

function conversation(message: string, language: 'vi' | 'en' = 'vi'): ConversationView {
  return {
    conversationId: randomUUID(),
    contextVersion: 1,
    status: 'active',
    messages: [{
      id: randomUUID(),
      role: 'user',
      text: message,
      createdAt: new Date(now).toISOString(),
      sourceIds: [],
      provenance: 'user_reported',
    }],
    userFacts: [],
    evidenceLedger: [],
    expiresAt: new Date(now + 60_000).toISOString(),
    conversationState: { language, currentTopic: null, pendingQuestion: null },
  };
}

function modelDecision(language: 'vi' | 'en' = 'vi'): PlannerDecision {
  return {
    turnKind: 'clarify',
    standaloneQuestion: 'The user reported a workplace problem.',
    searchQuery: 'general employment information',
    sourceGroups: ['pay', 'visa', 'housing'],
    jurisdiction: 'NSW',
    factsPatch: [],
    statePatch: { language, currentTopic: 'workplace safety', pendingQuestion: null },
    directReplyBlocks: [{ text: 'Unverified answer', sourceIds: [] }],
    needsNewEvidence: false,
  };
}

describe('workplace violence routing regression', () => {
  it.each([
    'Tôi bị chủ đánh đập',
    'Sếp đấm và đá tôi tại chỗ làm',
    'Quản lý dọa giết tôi',
    'My boss hit me',
    'I was assaulted at work',
    'My supervisor threatened to hurt me',
    'There is workplace violence at my job',
  ])('recognises an explicit physical assault or threat: %s', (message) => {
    expect(hasExplicitWorkplaceViolence(message)).toBe(true);
    expect(inferGroups(message)).toEqual(expect.arrayContaining([
      'urgent_support', 'work_safety', 'legal_help',
    ]));
  });

  it.each([
    'Tôi đang đánh giá công việc',
    'Tôi bị chủ đánh giá không tốt',
    'Sếp đánh giá hiệu suất của tôi',
    'My manager assessed my work',
    'Tôi thấy sàn nhà không an toàn',
  ])('does not label a non-violent statement as an assault: %s', (message) => {
    expect(hasExplicitWorkplaceViolence(message)).toBe(false);
  });

  it('overrides a weak model guess for the exact Vietnamese report', () => {
    const hardened = hardenPlannerDecision(
      modelDecision(),
      conversation('Tôi bị chủ đánh đập'),
    );

    expect(hardened).toMatchObject({
      turnKind: 'research',
      needsNewEvidence: true,
      jurisdiction: 'UNKNOWN',
      sourceGroups: ['urgent_support', 'work_safety', 'legal_help'],
      searchQuery: 'Australia workplace violence physical assault immediate safety worker support',
      directReplyBlocks: [],
    });
  });

  it('keeps a useful national search pool while excluding exact link-only emergency sources', () => {
    const pool = routeSources(['urgent_support', 'work_safety', 'legal_help'], 'UNKNOWN');

    expect(pool.sourceIds).toEqual(expect.arrayContaining(['S10', 'S25', 'S27']));
    expect(pool.sourceIds).not.toContain('S29');
    expect(pool.allowedDomains).toEqual(expect.arrayContaining([
      'www.safeworkaustralia.gov.au', '1800respect.org.au',
    ]));
    expect(pool.allowedDomains).not.toContain('www.infrastructure.gov.au');
  });

  it('seeds the reviewed national workplace-violence guidance page', () => {
    expect(SOURCES_BY_ID.get('S10')?.seed_urls).toContain(
      'https://www.safeworkaustralia.gov.au/doc/preventing-workplace-violence-and-aggression-guide',
    );
    expect(SOURCES_BY_ID.get('S10')?.seed_urls).toContain(
      'https://www.safeworkaustralia.gov.au/safety-topic/hazards/workplace-violence-and-aggression/overview',
    );
  });

  it.each([
    {
      language: 'vi' as const,
      message: 'Tôi bị chủ đánh đập',
      expected: ['gọi 000', 'nơi an toàn', 'trợ giúp y tế', 'Trợ giúp'],
    },
    {
      language: 'en' as const,
      message: 'My employer assaulted me',
      expected: ['call 000', 'safe place', 'medical help', 'Help'],
    },
  ])('returns a safety-first $language fallback if live research fails', async ({
    language, message, expected,
  }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const create = vi.fn().mockRejectedValue(new Error('synthetic research failure'));
    const client = { responses: { create } } as unknown as OpenAI;
    const engine = new OfficialConversationEngine(client, 'fixture-model', () => now);
    const decision = hardenPlannerDecision(modelDecision(language), conversation(message, language));

    const result = await engine.answer(conversation(message, language), decision);

    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0]![0];
    expect(request.instructions).toContain('Triple Zero (000)');
    const input = JSON.parse(request.input as string) as Record<string, unknown>;
    expect(input).toMatchObject({
      safety_priority: true,
      source_groups: ['urgent_support', 'work_safety', 'legal_help'],
    });
    expect(request.tools[0].filters.allowed_domains).not.toContain('www.infrastructure.gov.au');
    expect(result).toMatchObject({ provenance: 'assistant_generated', sourceIds: [], evidence: [] });
    for (const phrase of expected) expect(result.text).toContain(phrase);
    expect(result.text.toLowerCase()).not.toContain('cloud');
    expect(result.text).not.toContain('đã xóa');
  });
});
