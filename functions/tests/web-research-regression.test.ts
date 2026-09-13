import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationView } from '../../shared/contracts';
import { OfficialConversationEngine } from '../src/ai/conversation-engine';
import type { PlannerDecision } from '../src/ai/planner';
import { CitationGateError, gateResearchResponse } from '../src/security/citation-gate';
import { SOURCES_BY_ID } from '../src/sources/registry';

const now = Date.parse('2026-09-13T08:00:00.000Z');
const fairWorkUrl = 'https://www.fairwork.gov.au/pay-and-wages';

function conversation(userText = 'Tôi bị chủ giữ lương. Email của tôi là worker@example.com'): ConversationView {
  return {
    conversationId: randomUUID(),
    contextVersion: 1,
    status: 'active',
    messages: [{
      id: randomUUID(),
      role: 'user',
      text: userText,
      createdAt: new Date(now).toISOString(),
      sourceIds: [],
      provenance: 'user_reported',
    }],
    userFacts: [],
    evidenceLedger: [],
    expiresAt: new Date(now + 60_000).toISOString(),
    conversationState: { language: 'vi', currentTopic: 'pay', pendingQuestion: null },
  };
}

function payDecision(): PlannerDecision {
  return {
    turnKind: 'research',
    standaloneQuestion: 'Tôi nên làm gì khi chủ giữ lương?',
    searchQuery: 'Fair Work Ombudsman unpaid wages Australia',
    sourceGroups: ['pay'],
    jurisdiction: 'UNKNOWN',
    factsPatch: [],
    statePatch: { language: 'vi', currentTopic: 'pay', pendingQuestion: null },
    directReplyBlocks: [],
    needsNewEvidence: true,
  };
}

function citedResponse() {
  const answer = 'Fair Work Ombudsman có thông tin về tiền lương.';
  return {
    status: 'completed',
    model: 'fixture-model',
    usage: { input_tokens: 20, output_tokens: 10 },
    output: [
      {
        type: 'web_search_call', status: 'completed',
        action: { type: 'search', sources: [{ type: 'url', url: fairWorkUrl }] },
      },
      {
        type: 'web_search_call', status: 'completed',
        action: { type: 'open_page', url: fairWorkUrl },
      },
      {
        type: 'web_search_call', status: 'completed',
        action: { type: 'find_in_page', url: fairWorkUrl, pattern: 'pay' },
      },
      {
        type: 'message', status: 'completed', phase: 'commentary',
        content: [{ type: 'output_text', text: 'Checking the official page.', annotations: [] }],
      },
      {
        type: 'message', status: 'completed', phase: 'final_answer',
        content: [{
          type: 'output_text', text: answer,
          annotations: [{
            type: 'url_citation', url: fairWorkUrl, title: 'Pay and wages',
            start_index: 0, end_index: answer.length,
          }],
        }],
      },
    ],
  };
}

describe('web research resilience regressions', () => {
  it('sends the redacted reported issue and selected seed pages with a bounded multi-action web budget', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const create = vi.fn().mockResolvedValue(citedResponse());
    const client = { responses: { create } } as unknown as OpenAI;
    const engine = new OfficialConversationEngine(client, 'fixture-model', () => now);

    const result = await engine.answer(conversation(), payDecision());

    expect(result.provenance).toBe('web_grounded');
    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0]![0];
    expect(request).toMatchObject({
      store: false,
      max_tool_calls: 3,
      tool_choice: 'required',
      tools: [{ search_context_size: 'medium' }],
    });
    expect(request.instructions).toContain('at least one web search action');
    expect(request.instructions).toContain('starting hints only');
    expect(request.instructions).toContain('jurisdiction is UNKNOWN');
    expect(request.instructions).toContain('one final output_text block');
    const input = JSON.parse(request.input as string) as Record<string, unknown>;
    expect(input.reported_issue).toContain('Tôi bị chủ giữ lương');
    expect(input.reported_issue).not.toContain('worker@example.com');
    expect(input.preferred_source_pages).toEqual(expect.arrayContaining([
      'https://www.fairwork.gov.au/tools-and-resources/language-help/vietnamese',
    ]));
  });

  it('ignores explicit commentary but accepts completed search, open and find actions with a cited final answer', () => {
    const result = gateResearchResponse(
      citedResponse(),
      [SOURCES_BY_ID.get('S02')!],
      'fixture-model',
      'UNKNOWN',
      now,
    );
    expect(result.text).not.toContain('Checking the official page');
    expect(result.text).toContain('Fair Work Ombudsman');
    expect(result.evidence).toHaveLength(1);
  });

  it('still rejects an uncited final or phase-absent output block', () => {
    for (const phase of ['final_answer', undefined] as const) {
      const base = citedResponse();
      const response: unknown = {
        ...base,
        output: [
          base.output[0]!,
          {
            type: 'message', status: 'completed', ...(phase ? { phase } : {}),
            content: [{ type: 'output_text', text: 'An uncited legal answer.', annotations: [] }],
          },
        ],
      };
      expect(() => gateResearchResponse(
        response,
        [SOURCES_BY_ID.get('S02')!],
        'fixture-model',
        'UNKNOWN',
        now,
      )).toThrow(CitationGateError);
    }
  });

  it('treats a null phase as a final message and keeps it citation-gated', () => {
    const base = citedResponse();
    const response: unknown = {
      ...base,
      output: base.output
        .filter((item) => item.type !== 'message' || item.phase !== 'commentary')
        .map((item) => item.type === 'message' ? { ...item, phase: null } : item),
    };

    expect(gateResearchResponse(
      response,
      [SOURCES_BY_ID.get('S02')!],
      'fixture-model',
      'UNKNOWN',
      now,
    ).text).toContain('Fair Work Ombudsman');
  });

  it('returns a useful non-legal pay clarification when the grounded final answer fails its citation gate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = citedResponse();
    response.output = response.output.map((item) => {
      if (item.type !== 'message' || item.phase !== 'final_answer') return item;
      return { ...item, content: [{ type: 'output_text', text: 'Uncited answer.', annotations: [] }] };
    });
    const create = vi.fn().mockResolvedValue(response);
    const client = { responses: { create } } as unknown as OpenAI;
    const engine = new OfficialConversationEngine(client, 'fixture-model', () => now);

    const result = await engine.answer(conversation('Tôi bị chủ giữ lương'), payDecision());

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ provenance: 'assistant_generated', sourceIds: [], evidence: [] });
    expect(result.text).toContain('chưa được trả cả kỳ lương');
    expect(result.text).toContain('khấu trừ');
    expect(result.text).not.toContain('bạn có quyền');
  });
});
