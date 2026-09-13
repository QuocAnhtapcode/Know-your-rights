import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ConversationView } from '../../shared/contracts';
import { hardenPlannerDecision, type PlannerDecision } from '../src/ai/planner';
import { SOURCES_BY_ID } from '../src/sources/registry';
import { hasExplicitWageProblem, inferGroups, routeSources } from '../src/sources/router';

function conversation(message: string): ConversationView {
  return {
    conversationId: randomUUID(),
    contextVersion: 1,
    status: 'active',
    messages: [{
      id: randomUUID(),
      role: 'user',
      text: message,
      createdAt: '2026-09-13T00:00:00.000Z',
      sourceIds: [],
      provenance: 'user_reported',
    }],
    userFacts: [],
    evidenceLedger: [],
    expiresAt: '2026-09-13T01:00:00.000Z',
    conversationState: { language: 'vi', currentTopic: null, pendingQuestion: null },
  };
}

function speculativeDecision(): PlannerDecision {
  return {
    turnKind: 'conversation',
    standaloneQuestion: 'Người dùng nói rằng chủ đang giữ lương.',
    searchQuery: 'general workplace information',
    sourceGroups: [
      'visa', 'work_safety', 'workers_compensation', 'discrimination', 'housing',
      'privacy', 'leave', 'super', 'dismissal', 'urgent_support',
    ],
    jurisdiction: 'VIC',
    factsPatch: [],
    statePatch: { language: 'vi', currentTopic: 'pay', pendingQuestion: null },
    directReplyBlocks: [{ text: 'Unverified direct answer', sourceIds: [] }],
    needsNewEvidence: false,
  };
}

describe('pay issue routing regression', () => {
  it.each([
    'Tôi bị chủ giữ lương',
    'Công ty chưa trả tiền công cho tôi',
    'Tôi bị trả thiếu lương',
    'My employer withheld my wages',
    'My final pay is unpaid',
    'I was underpaid last week',
  ])('recognises a wage-payment problem: %s', (message) => {
    expect(hasExplicitWageProblem(message)).toBe(true);
    expect(inferGroups(message)).toContain('pay');
  });

  it('routes the exact Vietnamese report to focused, grounded pay research', () => {
    const hardened = hardenPlannerDecision(speculativeDecision(), conversation('Tôi bị chủ giữ lương'));

    expect(hardened).toMatchObject({
      turnKind: 'research',
      needsNewEvidence: true,
      jurisdiction: 'UNKNOWN',
      sourceGroups: ['pay'],
      directReplyBlocks: [],
    });
    expect(hardened.searchQuery).toBe('Fair Work Ombudsman unpaid wages non-payment late pay Australia');

    const pool = routeSources(hardened.sourceGroups, hardened.jurisdiction);
    expect(pool.sourceIds).toContain('S02');
    expect(pool.allowedDomains).toContain('www.fairwork.gov.au');
  });

  it('keeps reviewed FWO pay/problem pages as server-owned search seeds', () => {
    expect(SOURCES_BY_ID.get('S02')?.seed_urls).toEqual(expect.arrayContaining([
      'https://www.fairwork.gov.au/pay-and-wages',
      'https://www.fairwork.gov.au/workplace-problems/common-workplace-problems/my-pay-doesnt-seem-right',
    ]));
  });
});
