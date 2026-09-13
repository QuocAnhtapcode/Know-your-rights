import type { ConversationView } from '../../../shared/contracts';

export const CONTEXT_VERSION = 'v4.1' as const;
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 9_000;
const MIN_RECENT_MESSAGES = 4;

export function redactIdentifiers(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email removed]')
    .replace(/(?:\+?61|0)[\s()-]*(?:\d[\s()-]*){8,10}/gu, '[phone removed]')
    .replace(/\b(?:passport|visa(?:\s+number)?|bank(?:\s+account)?|tài khoản|hộ chiếu|số visa)\s*[:#-]?\s*[A-Z0-9-]{5,}\b/giu, '[identifier removed]')
    .replace(/https?:\/\/\S+/giu, '[link removed]');
}

export function approximateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

export interface ModelContext {
  contextVersion: typeof CONTEXT_VERSION;
  language: 'vi' | 'en';
  recentMessages: Array<{ id: string; role: 'user' | 'assistant'; text: string; sourceIds: string[] }>;
  userFacts: Array<{ key: string; value: string; sourceMessageId: string; quote: string }>;
  state: ConversationView['conversationState'];
  evidence: Array<{ id: string; title: string; url: string; jurisdiction: string; retrievedAt: string }>;
  approximateTokens: number;
}

/** Builds manual stateless context. ConversationView cannot contain owner/quota/attempt metadata. */
export function buildModelContext(
  conversation: ConversationView,
  tokenBudget = DEFAULT_CONTEXT_TOKEN_BUDGET,
): ModelContext {
  const hardBudget = Math.max(1_000, Math.min(12_000, tokenBudget));
  const facts = conversation.userFacts.filter((fact) => fact.status === 'user_reported').slice(-40).map((fact) => ({
    key: fact.key,
    value: redactIdentifiers(fact.value),
    sourceMessageId: fact.sourceMessageId,
    quote: redactIdentifiers(fact.quote),
  }));
  const referenced = new Set(conversation.messages.slice(-12).flatMap((message) => message.sourceIds));
  const evidence = conversation.evidenceLedger
    .filter((item) => referenced.size === 0 || referenced.has(item.id))
    .slice(-20)
    .map(({ id, title, url, jurisdiction, retrievedAt }) => ({ id, title, url, jurisdiction, retrievedAt }));

  const fixed = JSON.stringify({ facts, state: conversation.conversationState, evidence });
  let remainingCharacters = Math.max(0, hardBudget * 4 - fixed.length - 2_000);
  const selected: ModelContext['recentMessages'] = [];
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]!;
    const text = redactIdentifiers(message.text);
    const estimated = text.length + 180;
    if (selected.length >= MIN_RECENT_MESSAGES && estimated > remainingCharacters) break;
    selected.unshift({ id: message.id, role: message.role, text, sourceIds: [...message.sourceIds] });
    remainingCharacters = Math.max(0, remainingCharacters - estimated);
    if (selected.length >= 16) break;
  }
  const withoutCount = {
    contextVersion: CONTEXT_VERSION,
    language: conversation.conversationState.language,
    recentMessages: selected,
    userFacts: facts,
    state: conversation.conversationState,
    evidence,
  };
  const approximate = approximateTokens(JSON.stringify(withoutCount));
  if (approximate > hardBudget) throw new Error('Context exceeds the configured token budget.');
  return { ...withoutCount, approximateTokens: approximate };
}

