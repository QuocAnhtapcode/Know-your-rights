import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ConversationView } from '../../../shared/contracts';
import type { SourceRecord } from '../sources/registry';

export const CITATION_GATE_VERSION = 'citation-gate-v4.2' as const;

const citationSchema = z.looseObject({
  type: z.literal('url_citation'),
  url: z.string().url(),
  title: z.string().max(500).optional(),
  start_index: z.number().int().min(0),
  end_index: z.number().int().positive(),
});
const textBlockSchema = z.looseObject({
  type: z.literal('output_text'),
  text: z.string().min(1).max(16_000),
  annotations: z.array(z.unknown()).min(1).max(40),
});
const messageSchema = z.looseObject({
  type: z.literal('message'), status: z.literal('completed'),
  phase: z.enum(['commentary', 'final_answer']).nullable().optional(),
  content: z.array(z.unknown()).min(1).max(12),
});
const webCallSchema = z.looseObject({
  type: z.literal('web_search_call'), status: z.literal('completed'), action: z.unknown(),
});
const responseSchema = z.looseObject({
  status: z.literal('completed'), model: z.string().min(1).max(100),
  output: z.array(z.unknown()).min(1).max(32), usage: z.unknown().optional(),
});

export class CitationGateError extends Error {
  constructor(readonly code: 'response_invalid' | 'web_call_missing' | 'citation_missing' | 'source_policy_failed') {
    super(code);
  }
}

function actionUrls(action: unknown): string[] {
  if (!action || typeof action !== 'object') return [];
  const object = action as Record<string, unknown>;
  const urls: string[] = [];
  if (typeof object.url === 'string') urls.push(object.url);
  if (Array.isArray(object.sources)) {
    for (const source of object.sources) {
      if (source && typeof source === 'object' && typeof (source as Record<string, unknown>).url === 'string') {
        urls.push((source as Record<string, unknown>).url as string);
      }
    }
  }
  return urls;
}

function matchingSource(value: string, allowedSources: readonly SourceRecord[]): { source: SourceRecord; url: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const source = allowedSources.find((candidate) => candidate.allowed_hosts.includes(url.hostname));
    if (!source || source.mode === 'disabled' || source.mode === 'link_only') return null;
    if (source.approved_paths.length > 0 && !source.approved_paths.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) return null;
    return { source, url: url.toString() };
  } catch {
    return null;
  }
}

function validOffsets(text: string, start: number, end: number): boolean {
  if (start >= end) return false;
  // Providers may count Unicode code points while JavaScript indexes UTF-16 code units.
  return end <= text.length || end <= Array.from(text).length;
}

export interface GroundedResearchResult {
  text: string;
  sourceIds: string[];
  evidence: ConversationView['evidenceLedger'];
  usage: unknown;
  responseModel: string;
}

/** Fails the entire researched answer; it never strips a bad citation while retaining its claim. */
export function gateResearchResponse(
  raw: unknown,
  allowedSources: readonly SourceRecord[],
  expectedModel: string,
  jurisdiction: string,
  now = Date.now(),
): GroundedResearchResult {
  const response = responseSchema.safeParse(raw);
  if (!response.success || response.data.model !== expectedModel) throw new CitationGateError('response_invalid');
  let webCalls = 0;
  const consulted: string[] = [];
  const blocks: Array<{ text: string; citations: Array<z.infer<typeof citationSchema>> }> = [];

  for (const item of response.data.output) {
    if (item && typeof item === 'object' && (item as Record<string, unknown>).type === 'web_search_call') {
      const call = webCallSchema.safeParse(item);
      if (!call.success) throw new CitationGateError('response_invalid');
      webCalls += 1;
      consulted.push(...actionUrls(call.data.action));
      continue;
    }
    if (!item || typeof item !== 'object' || (item as Record<string, unknown>).type !== 'message') continue;
    const message = messageSchema.safeParse(item);
    if (!message.success) throw new CitationGateError('response_invalid');
    // Reasoning models can emit an uncited commentary message before the cited final answer.
    // Commentary is never returned to the user; phase-absent and final messages remain fail-closed.
    if (message.data.phase === 'commentary') continue;
    for (const candidate of message.data.content) {
      if (!candidate || typeof candidate !== 'object' || (candidate as Record<string, unknown>).type !== 'output_text') continue;
      const block = textBlockSchema.safeParse(candidate);
      if (!block.success) throw new CitationGateError('citation_missing');
      const citations = block.data.annotations.map((annotation) => {
        const parsed = citationSchema.safeParse(annotation);
        if (!parsed.success || !validOffsets(block.data.text, parsed.data.start_index, parsed.data.end_index)) {
          throw new CitationGateError('response_invalid');
        }
        if (!matchingSource(parsed.data.url, allowedSources)) throw new CitationGateError('source_policy_failed');
        return parsed.data;
      });
      blocks.push({ text: block.data.text, citations });
    }
  }
  if (webCalls < 1) throw new CitationGateError('web_call_missing');
  if (blocks.length < 1 || blocks.some((block) => block.citations.length < 1)) throw new CitationGateError('citation_missing');
  const checkedConsulted = consulted.map((url) => matchingSource(url, allowedSources));
  if (consulted.length < 1 || checkedConsulted.some((match) => match === null)) throw new CitationGateError('source_policy_failed');

  const evidenceByUrl = new Map<string, ConversationView['evidenceLedger'][number]>();
  for (const block of blocks) {
    for (const citation of block.citations) {
      const match = matchingSource(citation.url, allowedSources)!;
      if (!evidenceByUrl.has(match.url)) {
        const suffix = createHash('sha256').update(match.url).digest('hex').slice(0, 12);
        evidenceByUrl.set(match.url, {
          id: `${match.source.id}-${suffix}`,
          title: citation.title?.trim() || match.source.name,
          url: match.url,
          retrievedAt: new Date(now).toISOString(),
          jurisdiction,
        });
      }
    }
  }
  const evidence = [...evidenceByUrl.values()];
  if (evidence.length < 1 || evidence.length > 20) throw new CitationGateError('citation_missing');
  return {
    text: blocks.map((block) => block.text).join('\n\n'),
    sourceIds: evidence.map((item) => item.id),
    evidence,
    usage: response.data.usage ?? null,
    responseModel: response.data.model,
  };
}

export function validateDirectSourceIds(sourceIds: readonly string[], conversation: ConversationView): string[] {
  const available = new Set(conversation.evidenceLedger.map((item) => item.id));
  if (sourceIds.some((id) => !available.has(id))) throw new CitationGateError('source_policy_failed');
  return [...new Set(sourceIds)];
}
