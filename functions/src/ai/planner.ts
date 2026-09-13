import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ConversationView } from '../../../shared/contracts';
import type { ConversationRecord } from '../session/repository';
import {
  activeJurisdiction, detectJurisdiction, hasExplicitWageProblem,
  hasExplicitWorkplaceViolence, inferGroups,
} from '../sources/router';
import { jurisdictionSchema, sourceGroupSchema, type Jurisdiction, type SourceGroup } from '../sources/registry';
import { redactIdentifiers } from './context-builder';

export const PLANNER_VERSION = 'planner-v4.3' as const;
export const turnKindSchema = z.enum([
  'conversation', 'clarify', 'explain_previous', 'prepare_summary', 'research', 'urgent_support',
]);
const factKeySchema = z.enum(['jurisdiction', 'workplace_context', 'employment_topic', 'user_goal']);

export const rawPlannerOutputSchema = z.strictObject({
  turn_kind: turnKindSchema,
  standalone_question: z.string().trim().min(1).max(1_200),
  search_query: z.string().trim().max(500),
  source_groups: z.array(sourceGroupSchema).max(10),
  jurisdiction: jurisdictionSchema,
  facts_patch: z.array(z.strictObject({
    operation: z.literal('upsert'),
    key: factKeySchema,
    value: z.string().trim().min(1).max(500),
    source_message_id: z.uuid(),
    quote: z.string().trim().min(1).max(4_000),
  })).max(12),
  state_patch: z.strictObject({
    current_topic: z.string().trim().max(200).nullable(),
    pending_question: z.string().trim().max(500).nullable(),
    language: z.enum(['vi', 'en']),
  }),
  direct_reply_blocks: z.array(z.strictObject({
    text: z.string().trim().min(1).max(4_000),
    source_ids: z.array(z.string().min(1).max(100)).max(20),
  })).max(6),
  needs_new_evidence: z.boolean(),
});

export type RawPlannerOutput = z.infer<typeof rawPlannerOutputSchema>;
export interface FactPatch {
  operation: 'upsert'; key: z.infer<typeof factKeySchema>; value: string;
  sourceMessageId: string; quote: string;
}
export interface PlannerDecision {
  turnKind: z.infer<typeof turnKindSchema>;
  standaloneQuestion: string;
  searchQuery: string;
  sourceGroups: SourceGroup[];
  jurisdiction: Jurisdiction;
  factsPatch: FactPatch[];
  statePatch: { currentTopic: string | null; pendingQuestion: string | null; language: 'vi' | 'en' };
  directReplyBlocks: Array<{ text: string; sourceIds: string[] }>;
  needsNewEvidence: boolean;
}

function unsafeQuery(value: string): boolean {
  return /https?:\/\/|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?61|0)[\s()-]*(?:\d[\s()-]*){8,10}/iu.test(value);
}

export function adaptPlannerOutput(value: unknown): PlannerDecision {
  const parsed = rawPlannerOutputSchema.parse(value);
  if (unsafeQuery(parsed.search_query)) throw new Error('Planner search query contains a prohibited identifier or URL.');
  if (parsed.needs_new_evidence !== (parsed.turn_kind === 'research')) {
    throw new Error('Planner branch and evidence requirement do not agree.');
  }
  return {
    turnKind: parsed.turn_kind,
    standaloneQuestion: parsed.standalone_question,
    searchQuery: parsed.search_query,
    sourceGroups: [...new Set(parsed.source_groups)],
    jurisdiction: parsed.jurisdiction,
    factsPatch: parsed.facts_patch.map((patch) => ({
      operation: patch.operation, key: patch.key, value: patch.value,
      sourceMessageId: patch.source_message_id, quote: patch.quote,
    })),
    statePatch: {
      currentTopic: parsed.state_patch.current_topic,
      pendingQuestion: parsed.state_patch.pending_question,
      language: parsed.state_patch.language,
    },
    directReplyBlocks: parsed.direct_reply_blocks.map((block) => ({ text: block.text, sourceIds: block.source_ids })),
    needsNewEvidence: parsed.needs_new_evidence,
  };
}

function isSimpleDirectRequest(text: string): boolean {
  return /^(?:cảm ơn|thanks|thank you|ok|okay|nói (?:dễ hiểu|ngắn)|giải thích (?:dễ hiểu|ngắn)|viết (?:giúp|cho) tôi)/iu.test(text.trim());
}

const GENERIC_SOURCE_GROUPS = new Set<SourceGroup>(['employment_general', 'legal_help', 'language_help']);
const PAY_COMPANION_GROUPS = new Set<SourceGroup>([
  'pay', 'payslips', 'employment_general', 'legal_help', 'language_help',
]);

function wageProblemSearchQuery(text: string): string | null {
  if (!hasExplicitWageProblem(text)) return null;
  if (/\b(?:final\s+pay)\b|(?:lương\s*cuối|lương\s*sau\s*khi\s*nghỉ)/iu.test(text)) {
    return 'Fair Work Ombudsman final pay unpaid wages Australia';
  }
  if (/\b(?:underpaid|underpayment|short[-\s]?paid|deducted|deduction)\b|(?:trả\s*thiếu|thiếu\s*lương|khấu\s*trừ)/iu.test(text)) {
    return 'Fair Work Ombudsman underpayment wage deductions Australia';
  }
  return 'Fair Work Ombudsman unpaid wages non-payment late pay Australia';
}

function workplaceViolenceSearchQuery(text: string): string | null {
  if (!hasExplicitWorkplaceViolence(text)) return null;
  return 'Australia workplace violence physical assault immediate safety worker support';
}

/** Adds only deterministic patches whose quote comes verbatim from the latest user message. */
export function hardenPlannerDecision(decision: PlannerDecision, conversation: ConversationView): PlannerDecision {
  const latest = [...conversation.messages].reverse().find((message) => message.role === 'user');
  if (!latest) return decision;
  const detected = detectJurisdiction(latest.text);
  const knownJurisdiction = activeJurisdiction(conversation);
  const factsPatch = [...decision.factsPatch];
  if (detected && !factsPatch.some((patch) => patch.key === 'jurisdiction')) {
    factsPatch.push({ operation: 'upsert', key: 'jurisdiction', value: detected.jurisdiction, sourceMessageId: latest.id, quote: detected.quote });
  }
  const latestInferred = inferGroups(latest.text);
  const contextualInferred = inferGroups(decision.standaloneQuestion);
  const explicitLatest = latestInferred.filter((group) => !GENERIC_SOURCE_GROUPS.has(group));
  const wageProblem = hasExplicitWageProblem(latest.text);
  const workplaceViolence = hasExplicitWorkplaceViolence(latest.text);
  const sourceGroups = workplaceViolence
    ? (['urgent_support', 'work_safety', 'legal_help'] satisfies SourceGroup[])
    : wageProblem
      ? [...new Set([
        ...explicitLatest,
        ...decision.sourceGroups.filter((group) => PAY_COMPANION_GROUPS.has(group)),
      ])].slice(0, 5)
      : [...new Set([...explicitLatest, ...decision.sourceGroups, ...contextualInferred])].slice(0, 10);
  const inferred = [...new Set([...latestInferred, ...contextualInferred])];
  const explicitLegalTopic = inferred.some((group) => ![
    'employment_general', 'legal_help', 'language_help',
  ].includes(group));
  const questionSignal = /\?|\b(?:what|when|how|can i|should i|right|rule|deadline|bao giờ|khi nào|thế nào|làm gì|quyền|được không)\b/iu.test(latest.text);
  const newLegalQuestion = !isSimpleDirectRequest(latest.text) && (explicitLegalTopic || questionSignal);
  const forceResearch = decision.turnKind === 'research' || newLegalQuestion;
  return {
    ...decision,
    factsPatch,
    sourceGroups,
    // Jurisdiction is authority-bearing routing state: never accept a model guess.
    jurisdiction: detected?.jurisdiction ?? knownJurisdiction,
    searchQuery: workplaceViolenceSearchQuery(latest.text)
      ?? wageProblemSearchQuery(latest.text)
      ?? redactIdentifiers(decision.searchQuery).slice(0, 500),
    turnKind: forceResearch ? 'research' : decision.turnKind,
    needsNewEvidence: forceResearch,
    directReplyBlocks: forceResearch ? [] : decision.directReplyBlocks,
  };
}

export function validFactPatches(record: ConversationRecord, patches: readonly FactPatch[]): FactPatch[] {
  return patches.filter((patch) => {
    const source = record.messages.find((message) => message.id === patch.sourceMessageId && message.role === 'user');
    return Boolean(source && patch.quote.length > 0 && source.text.includes(patch.quote));
  });
}

export function applyPlannerCorrection(
  record: ConversationRecord,
  decision: PlannerDecision,
  now: number,
): number {
  const patches = validFactPatches(record, decision.factsPatch);
  for (const patch of patches) {
    const current = record.userFacts.filter((fact) => fact.key === patch.key && fact.status === 'user_reported');
    if (current.some((fact) => fact.value === patch.value)) continue;
    for (const fact of current) fact.status = 'superseded';
    record.userFacts.push({
      id: randomUUID(), key: patch.key, value: patch.value,
      sourceMessageId: patch.sourceMessageId, quote: patch.quote, status: 'user_reported',
    });
  }
  record.conversationState = {
    language: decision.statePatch.language,
    currentTopic: decision.statePatch.currentTopic,
    pendingQuestion: decision.statePatch.pendingQuestion,
  };
  record.updatedAt = now;
  return patches.length;
}
