import type { ConversationView } from '../../../shared/contracts';
import {
  SOURCE_REGISTRY, type Jurisdiction, type SourceGroup, type SourceRecord,
} from './registry';

const LOCATION_ALIASES: ReadonlyArray<{ value: Jurisdiction; pattern: RegExp }> = [
  { value: 'NSW', pattern: /\b(?:NSW|New South Wales|Sydney)\b/i },
  { value: 'VIC', pattern: /\b(?:VIC|Victoria|Melbourne)\b/i },
  { value: 'QLD', pattern: /\b(?:QLD|Queensland|Brisbane)\b/i },
  { value: 'WA', pattern: /\b(?:WA|Western Australia|Perth)\b/i },
  { value: 'SA', pattern: /\b(?:SA|South Australia|Adelaide)\b/i },
  { value: 'TAS', pattern: /\b(?:TAS|Tasmania|Hobart)\b/i },
  { value: 'ACT', pattern: /\b(?:ACT|Australian Capital Territory|Canberra)\b/i },
  { value: 'NT', pattern: /\b(?:NT|Northern Territory|Darwin)\b/i },
];

export function detectJurisdiction(text: string): { jurisdiction: Jurisdiction; quote: string } | null {
  for (const candidate of LOCATION_ALIASES) {
    const match = candidate.pattern.exec(text);
    if (match?.[0]) return { jurisdiction: candidate.value, quote: match[0] };
  }
  return null;
}

export function activeJurisdiction(conversation: ConversationView): Jurisdiction {
  const fact = [...conversation.userFacts].reverse().find((item) => item.key === 'jurisdiction' && item.status === 'user_reported');
  const value = fact?.value.toUpperCase();
  return ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].includes(value ?? '')
    ? value as Jurisdiction
    : 'UNKNOWN';
}

export function inferGroups(text: string): SourceGroup[] {
  const rules: ReadonlyArray<[SourceGroup, RegExp]> = [
    ['payslips', /\b(?:payslip|pay slip|phiếu lương|bảng kê lương)\b/iu],
    ['super', /\b(?:super|superannuation|hưu trí)\b/iu],
    ['dismissal', /\b(?:dismiss|fired|sa thải|đuổi việc|termination)\b/iu],
    ['visa', /\b(?:visa|thị thực|sponsor)\b/iu],
    ['work_safety', /\b(?:safe|safety|unsafe|injury|nguy hiểm|an toàn|tai nạn|sàn.*trơn)\b/iu],
    ['workers_compensation', /\b(?:compensation|workers comp|bồi thường)\b/iu],
    ['discrimination', /\b(?:discriminat|phân biệt đối xử|harass)\b/iu],
    ['housing', /\b(?:rent|tenant|housing|nhà ở|thuê nhà)\b/iu],
    ['privacy', /\b(?:privacy|riêng tư|camera|recording)\b/iu],
    ['leave', /\b(?:leave|nghỉ phép|sick day)\b/iu],
    ['pay', /\b(?:pay|wage|salary|lương|overtime|tiền công)\b/iu],
    ['legal_help', /\b(?:legal help|lawyer|tư vấn|trợ giúp|support)\b/iu],
  ];
  const groups = rules.filter(([, pattern]) => pattern.test(text)).map(([group]) => group);
  return groups.length > 0 ? [...new Set(groups)] : ['employment_general'];
}

function jurisdictionMatches(source: SourceRecord, jurisdiction: Jurisdiction): boolean {
  if (source.jurisdictions.includes('AU') || source.jurisdictions.includes('AU_NATIONAL_SYSTEM')) return true;
  if (jurisdiction === 'UNKNOWN') return false;
  return source.jurisdictions.includes(jurisdiction);
}

export interface SourcePool {
  sources: SourceRecord[];
  allowedDomains: string[];
  sourceIds: string[];
}

export function routeSources(
  groups: readonly SourceGroup[],
  jurisdiction: Jurisdiction,
  options: { allowConditional?: boolean } = {},
): SourcePool {
  const wanted = new Set(groups.length > 0 ? groups : ['employment_general']);
  const maximum = wanted.size > 3 ? 14 : 8;
  const sources = SOURCE_REGISTRY.filter((candidate) => {
    if (candidate.mode === 'disabled' || candidate.mode === 'link_only') return false;
    if (candidate.mode === 'conditional_search' && !options.allowConditional) return false;
    if (!jurisdictionMatches(candidate, jurisdiction)) return false;
    return candidate.topics.some((topic) => wanted.has(topic));
  }).sort((a, b) => {
    const roleOrder = { official_guidance: 0, legislation: 1, community_legal_support: 2, service_link: 3 } as const;
    return roleOrder[a.role] - roleOrder[b.role] || a.id.localeCompare(b.id);
  }).slice(0, maximum);
  return {
    sources,
    sourceIds: sources.map((item) => item.id),
    allowedDomains: [...new Set(sources.flatMap((item) => item.allowed_hosts))],
  };
}

