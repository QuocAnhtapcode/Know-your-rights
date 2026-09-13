import type OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { z } from 'zod';
import type { ConversationView } from '../../../shared/contracts';
import { CitationGateError, gateResearchResponse, validateDirectSourceIds } from '../security/citation-gate';
import { activeJurisdiction, routeSources } from '../sources/router';
import type { ReplyProvider } from './provider';
import { buildModelContext, redactIdentifiers } from './context-builder';
import {
  PLANNER_VERSION,
  adaptPlannerOutput,
  hardenPlannerDecision,
  rawPlannerOutputSchema,
  type PlannerDecision,
} from './planner';

export const ENGINE_VERSION = 'conversation-engine-v4.1' as const;
const DEFAULT_MODEL = 'gpt-5.4-mini-2026-03-17';
const PLANNER_TIMEOUT_MS = 25_000;
const WEB_TIMEOUT_MS = 70_000;

const plannerEnvelopeSchema = z.looseObject({
  status: z.literal('completed'),
  model: z.string().min(1).max(100),
  output_parsed: z.unknown(),
  usage: z.unknown().optional(),
});

export interface EngineAnswer {
  text: string;
  sourceIds: string[];
  evidence: ConversationView['evidenceLedger'];
  provenance: 'assistant_generated' | 'mock' | 'web_grounded';
}

export interface ConversationEngine {
  readonly mode: 'mock' | 'live';
  readonly usesExternalAI: boolean;
  plan(conversation: ConversationView): Promise<PlannerDecision>;
  answer(conversation: ConversationView, decision: PlannerDecision): Promise<EngineAnswer>;
}

function neutralDecision(conversation: ConversationView): PlannerDecision {
  const latest = [...conversation.messages].reverse().find((message) => message.role === 'user');
  return {
    turnKind: 'conversation',
    standaloneQuestion: latest?.text ?? 'Synthetic test turn',
    searchQuery: '',
    sourceGroups: [],
    jurisdiction: activeJurisdiction(conversation),
    factsPatch: [],
    statePatch: { ...conversation.conversationState },
    directReplyBlocks: [],
    needsNewEvidence: false,
  };
}

/** Preserves the network-free M1/M3 fixtures while exercising the same transaction pipeline. */
export class LegacyReplyEngineAdapter implements ConversationEngine {
  readonly mode = 'mock' as const;
  readonly usesExternalAI = false;

  constructor(private readonly provider: ReplyProvider) {}

  plan(conversation: ConversationView): Promise<PlannerDecision> {
    return Promise.resolve(neutralDecision(conversation));
  }

  async answer(conversation: ConversationView): Promise<EngineAnswer> {
    return { text: await this.provider.reply(conversation), sourceIds: [], evidence: [], provenance: 'mock' };
  }
}

/** Used by non-send callables so they can report live mode without reading the AI secret. */
export class LiveModeOnlyEngine implements ConversationEngine {
  readonly mode = 'live' as const;
  readonly usesExternalAI = false;

  plan(): Promise<PlannerDecision> {
    return Promise.reject(new Error('The live engine is not available to this callable.'));
  }

  answer(): Promise<EngineAnswer> {
    return Promise.reject(new Error('The live engine is not available to this callable.'));
  }
}

function directAnswer(conversation: ConversationView, decision: PlannerDecision): EngineAnswer {
  const blocks = decision.directReplyBlocks.map((block) => ({
    text: block.text,
    sourceIds: validateDirectSourceIds(block.sourceIds, conversation),
  }));
  if (blocks.length === 0) {
    const text = conversation.conversationState.language === 'en'
      ? 'Tell me what happened in your own words. Please avoid names, addresses, ID numbers and account details.'
      : 'Bạn có thể kể điều đã xảy ra theo cách của mình. Đừng nhập tên, địa chỉ, số giấy tờ hay thông tin tài khoản.';
    return { text, sourceIds: [], evidence: [], provenance: 'assistant_generated' };
  }
  const sourceIds = [...new Set(blocks.flatMap((block) => block.sourceIds))];
  return {
    text: blocks.map((block) => block.text).join('\n\n'),
    sourceIds,
    evidence: [],
    provenance: sourceIds.length > 0 ? 'web_grounded' : 'assistant_generated',
  };
}

function researchFallback(language: 'vi' | 'en'): EngineAnswer {
  return {
    text: language === 'en'
      ? 'I could not verify this answer against the approved sources just now, so I will not guess. Please try again later or open Help to contact an official service.'
      : 'Mình chưa xác minh được câu trả lời từ các nguồn đã duyệt nên sẽ không đoán. Bạn có thể thử lại sau hoặc mở Trợ giúp để liên hệ một dịch vụ chính thức.',
    sourceIds: [], evidence: [], provenance: 'assistant_generated',
  };
}

function compactResearchInput(conversation: ConversationView, decision: PlannerDecision): string {
  const context = buildModelContext(conversation, 6_000);
  const facts = context.userFacts.map((fact) => ({ key: fact.key, value: fact.value }));
  return JSON.stringify({
    language: context.language,
    standalone_question: redactIdentifiers(decision.standaloneQuestion),
    search_query: redactIdentifiers(decision.searchQuery),
    jurisdiction: decision.jurisdiction,
    user_reported_facts: facts,
    previous_evidence_ids: context.evidence.map((item) => item.id),
  });
}

function usageSummary(value: unknown): { inputTokens: number | null; outputTokens: number | null } {
  const parsed = z.looseObject({
    input_tokens: z.number().int().min(0).optional(),
    output_tokens: z.number().int().min(0).optional(),
  }).safeParse(value);
  return parsed.success
    ? { inputTokens: parsed.data.input_tokens ?? null, outputTokens: parsed.data.output_tokens ?? null }
    : { inputTokens: null, outputTokens: null };
}

/** Official Responses API adapter. It is stateless: every turn resends reduced manual context. */
export class OfficialConversationEngine implements ConversationEngine {
  readonly mode = 'live' as const;
  readonly usesExternalAI = true;

  constructor(
    private readonly client: OpenAI,
    private readonly model = DEFAULT_MODEL,
    private readonly now: () => number = Date.now,
  ) {
    if (!model.trim()) throw new Error('OPENAI_MODEL is required.');
  }

  async plan(conversation: ConversationView): Promise<PlannerDecision> {
    const startedAt = this.now();
    try {
      const context = buildModelContext(conversation);
      const response = await this.client.responses.parse({
        model: this.model,
        store: false,
        max_output_tokens: 900,
        reasoning: { effort: 'none' },
        instructions: [
          `You are planner ${PLANNER_VERSION} for an Australian worker-rights demo.`,
          'Return only the supplied schema. Do not browse. Do not give legal advice in planner fields.',
          'Facts may only quote exact text from a user message and must carry that message ID.',
          'Keep one person/case per conversation; ask for a new session before discussing another case.',
          'Use a free semantic search query; source_groups only route approved sources.',
          'Set jurisdiction UNKNOWN unless it is explicitly present in a user quote or active user-reported fact.',
          'Use explain_previous only when no new legal claim is needed; otherwise use research.',
        ].join(' '),
        input: JSON.stringify(context),
        text: { format: zodTextFormat(rawPlannerOutputSchema, 'kyr_turn_plan_v4') },
      }, { maxRetries: 0, timeout: PLANNER_TIMEOUT_MS });
      const envelope = plannerEnvelopeSchema.safeParse(response);
      if (!envelope.success || envelope.data.model !== this.model) throw new Error('Planner response envelope failed validation.');
      const decision = hardenPlannerDecision(adaptPlannerOutput(envelope.data.output_parsed), conversation);
      console.info('kyr_ai_stage', {
        stage: 'planner', status: 'completed', model: envelope.data.model,
        latencyMs: Math.max(0, this.now() - startedAt), ...usageSummary(envelope.data.usage),
      });
      return decision;
    } catch (error) {
      console.warn('kyr_ai_stage', { stage: 'planner', status: 'failed', latencyMs: Math.max(0, this.now() - startedAt) });
      throw error;
    }
  }

  async answer(conversation: ConversationView, decision: PlannerDecision): Promise<EngineAnswer> {
    if (!decision.needsNewEvidence) return directAnswer(conversation, decision);
    const jurisdiction = activeJurisdiction(conversation) === 'UNKNOWN'
      ? decision.jurisdiction
      : activeJurisdiction(conversation);
    const pool = routeSources(decision.sourceGroups, jurisdiction);
    if (pool.sources.length === 0 || pool.allowedDomains.length === 0) return researchFallback(conversation.conversationState.language);
    const startedAt = this.now();
    try {
      // The official REST API exposes max_tool_calls; SDK 7.15's stable REST type omits it.
      const request: ResponseCreateParamsNonStreaming & { max_tool_calls: 1 } = {
        model: this.model,
        store: false,
        max_output_tokens: 1_200,
        max_tool_calls: 1,
        parallel_tool_calls: false,
        reasoning: { effort: 'none' },
        include: ['web_search_call.action.sources'],
        tools: [{
          type: 'web_search',
          external_web_access: true,
          filters: { allowed_domains: pool.allowedDomains },
          search_context_size: 'low',
        }],
        tool_choice: 'required',
        instructions: [
          'You are a careful worker-rights information assistant for Australia, not a lawyer or emergency service.',
          'Use the web tool exactly once and rely only on pages returned from the permitted domains.',
          'Write in the requested language, distinguish general information from next steps, and state uncertainty.',
          'Every output_text block must contain at least one native URL citation supporting its legal or procedural claims.',
          'Do not request or repeat names, addresses, visa numbers, account details or other identifying data.',
        ].join(' '),
        input: compactResearchInput(conversation, { ...decision, jurisdiction }),
      };
      const response = await this.client.responses.create(request, { maxRetries: 0, timeout: WEB_TIMEOUT_MS });
      const result = gateResearchResponse(response, pool.sources, this.model, jurisdiction, this.now());
      console.info('kyr_ai_stage', {
        stage: 'web_research', status: 'completed', model: result.responseModel,
        latencyMs: Math.max(0, this.now() - startedAt), ...usageSummary(result.usage),
        sourceCount: result.evidence.length,
      });
      return { ...result, provenance: 'web_grounded' };
    } catch (error) {
      console.warn('kyr_ai_stage', {
        stage: 'web_research',
        status: error instanceof CitationGateError ? error.code : 'failed',
        latencyMs: Math.max(0, this.now() - startedAt),
      });
      return researchFallback(conversation.conversationState.language);
    }
  }
}
