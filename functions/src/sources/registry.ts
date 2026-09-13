import { z } from 'zod';

export const SOURCE_REGISTRY_VERSION = '2026-09-13.v4.2' as const;
export const sourceIdSchema = z.enum([
  'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10',
  'S11', 'S12', 'S13', 'S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S20',
  'S21', 'S22', 'S23', 'S24', 'S25', 'S26', 'S27', 'S28', 'S29',
]);
export type SourceId = z.infer<typeof sourceIdSchema>;

export const sourceGroupSchema = z.enum([
  'employment_general', 'pay', 'payslips', 'leave', 'super', 'dismissal', 'visa',
  'work_safety', 'workers_compensation', 'discrimination', 'housing', 'privacy',
  'legal_help', 'language_help', 'urgent_support',
]);
export type SourceGroup = z.infer<typeof sourceGroupSchema>;

export const jurisdictionSchema = z.enum(['UNKNOWN', 'AU', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']);
export type Jurisdiction = z.infer<typeof jurisdictionSchema>;

export type SourceMode = 'search' | 'conditional_search' | 'link_only' | 'disabled';
export type ReviewStatus = 'page_read' | 'indexed_only' | 'needs_review';

export interface SourceRecord {
  id: SourceId;
  name: string;
  canonical_host: string;
  allowed_hosts: readonly string[];
  approved_paths: readonly string[];
  mode: SourceMode;
  role: 'official_guidance' | 'community_legal_support' | 'legislation' | 'service_link';
  jurisdictions: readonly string[];
  topics: readonly SourceGroup[];
  seed_urls: readonly string[];
  review_status: ReviewStatus;
  reviewed_at: string;
  owner_role: 'content_owner';
  notes: string;
}

const reviewed_at = '2026-09-12';
const source = (record: Omit<SourceRecord, 'reviewed_at' | 'owner_role'>): SourceRecord => ({
  ...record, reviewed_at, owner_role: 'content_owner',
});

/** Versioned allowlist metadata only. This is not a claim that every page on a host was reviewed. */
export const SOURCE_REGISTRY: readonly SourceRecord[] = [
  source({ id: 'S01', name: 'Rights of Migrant Workers in Community', canonical_host: 'migrants.org.au', allowed_hosts: ['migrants.org.au'], approved_paths: [], mode: 'search', role: 'community_legal_support', jurisdictions: ['NSW'], topics: ['employment_general', 'pay', 'payslips', 'visa', 'legal_help'], seed_urls: ['https://migrants.org.au/legal-help/'], review_status: 'page_read', notes: 'NSW migrant-worker support; never promise eligibility or response time.' }),
  source({ id: 'S02', name: 'Fair Work Ombudsman', canonical_host: 'www.fairwork.gov.au', allowed_hosts: ['www.fairwork.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['AU_NATIONAL_SYSTEM'], topics: ['employment_general', 'pay', 'payslips', 'leave', 'super', 'dismissal'], seed_urls: ['https://www.fairwork.gov.au/tools-and-resources/language-help/vietnamese', 'https://www.fairwork.gov.au/pay-and-wages', 'https://www.fairwork.gov.au/workplace-problems/common-workplace-problems/my-pay-doesnt-seem-right', 'https://www.fairwork.gov.au/workplace-problems/fixing-a-workplace-problem/resolving-disputes-with-our-help'], review_status: 'page_read', notes: 'Check coverage before individual conclusions.' }),
  source({ id: 'S03', name: 'Fair Work Commission', canonical_host: 'www.fwc.gov.au', allowed_hosts: ['www.fwc.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['AU'], topics: ['dismissal', 'employment_general'], seed_urls: ['https://www.fwc.gov.au/apply-or-lodge/deadlines'], review_status: 'page_read', notes: 'Do not calculate a personal deadline without the event and procedure.' }),
  source({ id: 'S04', name: 'Department of Home Affairs', canonical_host: 'immi.homeaffairs.gov.au', allowed_hosts: ['immi.homeaffairs.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['AU'], topics: ['visa', 'employment_general'], seed_urls: ['https://immi.homeaffairs.gov.au/visas/employing-and-sponsoring-someone/migrant-worker-protections'], review_status: 'page_read', notes: 'No prediction of visa outcome or individual eligibility.' }),
  source({ id: 'S05', name: 'Australian Taxation Office', canonical_host: 'www.ato.gov.au', allowed_hosts: ['www.ato.gov.au'], approved_paths: [], mode: 'conditional_search', role: 'official_guidance', jurisdictions: ['AU'], topics: ['super'], seed_urls: ['https://www.ato.gov.au/calculators-and-tools/super-report-unpaid-super-contributions-from-my-employer'], review_status: 'indexed_only', notes: 'Runtime access was previously incomplete; never rely on snippets alone.' }),
  source({ id: 'S06', name: 'Federal Register of Legislation', canonical_host: 'www.legislation.gov.au', allowed_hosts: ['www.legislation.gov.au'], approved_paths: [], mode: 'search', role: 'legislation', jurisdictions: ['AU'], topics: ['employment_general', 'pay', 'dismissal'], seed_urls: ['https://www.legislation.gov.au/C2009A00028/latest/text'], review_status: 'page_read', notes: 'Advanced source; verify current text and exceptions.' }),
  source({ id: 'S07', name: 'SafeWork NSW', canonical_host: 'www.safework.nsw.gov.au', allowed_hosts: ['www.safework.nsw.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['NSW'], topics: ['work_safety'], seed_urls: ['https://www.safework.nsw.gov.au/advice-and-resources/translated-resources/vietnamese-health-and-safety-resources'], review_status: 'page_read', notes: 'NSW workplace safety only.' }),
  source({ id: 'S08', name: 'State Insurance Regulatory Authority NSW', canonical_host: 'www.sira.nsw.gov.au', allowed_hosts: ['www.sira.nsw.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['NSW'], topics: ['workers_compensation'], seed_urls: ['https://www.sira.nsw.gov.au/workers-compensation/what-to-do-after-an-injury'], review_status: 'page_read', notes: 'Check current reform notices.' }),
  source({ id: 'S09', name: 'Independent Review Office NSW', canonical_host: 'www.iro.nsw.gov.au', allowed_hosts: ['www.iro.nsw.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['NSW'], topics: ['workers_compensation', 'legal_help'], seed_urls: ['https://www.iro.nsw.gov.au/'], review_status: 'page_read', notes: 'Not a general wage-dispute body.' }),
  source({ id: 'S10', name: 'Safe Work Australia', canonical_host: 'www.safeworkaustralia.gov.au', allowed_hosts: ['www.safeworkaustralia.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['AU'], topics: ['work_safety', 'workers_compensation'], seed_urls: ['https://www.safeworkaustralia.gov.au/safety-topic/hazards/workplace-violence-and-aggression/overview', 'https://www.safeworkaustralia.gov.au/doc/workplace-violence-and-aggression-advice-workers', 'https://www.safeworkaustralia.gov.au/doc/preventing-workplace-violence-and-aggression-guide', 'https://www.safeworkaustralia.gov.au/law-and-regulation/whs-regulators-and-workers-compensation-authorities-contact-information'], review_status: 'page_read', notes: 'National framework/directory, not the local enforcer.' }),
  source({ id: 'S11', name: 'WorkSafe Victoria', canonical_host: 'www.worksafe.vic.gov.au', allowed_hosts: ['www.worksafe.vic.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['VIC'], topics: ['work_safety', 'workers_compensation'], seed_urls: ['https://www.worksafe.vic.gov.au/'], review_status: 'page_read', notes: 'Victoria only.' }),
  source({ id: 'S12', name: 'WorkSafe Queensland', canonical_host: 'www.worksafe.qld.gov.au', allowed_hosts: ['www.worksafe.qld.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['QLD'], topics: ['work_safety', 'workers_compensation'], seed_urls: ['https://www.worksafe.qld.gov.au/'], review_status: 'page_read', notes: 'Queensland only.' }),
  source({ id: 'S13', name: 'WorkSafe Western Australia', canonical_host: 'www.worksafe.wa.gov.au', allowed_hosts: ['www.worksafe.wa.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['WA'], topics: ['work_safety'], seed_urls: ['https://www.worksafe.wa.gov.au/workers-and-others-workplace'], review_status: 'page_read', notes: 'Not a complete source for WA wage law.' }),
  source({ id: 'S14', name: 'SafeWork South Australia', canonical_host: 'www.safework.sa.gov.au', allowed_hosts: ['www.safework.sa.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['SA'], topics: ['work_safety'], seed_urls: ['https://www.safework.sa.gov.au/'], review_status: 'page_read', notes: 'South Australia only.' }),
  source({ id: 'S15', name: 'WorkSafe Tasmania', canonical_host: 'worksafe.tas.gov.au', allowed_hosts: ['worksafe.tas.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['TAS'], topics: ['work_safety'], seed_urls: ['https://worksafe.tas.gov.au/'], review_status: 'page_read', notes: 'Tasmania only.' }),
  source({ id: 'S16', name: 'WorkSafe ACT', canonical_host: 'www.worksafe.act.gov.au', allowed_hosts: ['www.worksafe.act.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['ACT'], topics: ['work_safety'], seed_urls: ['https://www.worksafe.act.gov.au/'], review_status: 'page_read', notes: 'ACT only.' }),
  source({ id: 'S17', name: 'NT WorkSafe', canonical_host: 'worksafe.nt.gov.au', allowed_hosts: ['worksafe.nt.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['NT'], topics: ['work_safety'], seed_urls: ['https://worksafe.nt.gov.au/'], review_status: 'page_read', notes: 'Northern Territory only.' }),
  source({ id: 'S18', name: 'Anti-Discrimination NSW', canonical_host: 'antidiscrimination.nsw.gov.au', allowed_hosts: ['antidiscrimination.nsw.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['NSW'], topics: ['discrimination'], seed_urls: ['https://antidiscrimination.nsw.gov.au/need-help/community-languages/vietnamese.html'], review_status: 'page_read', notes: 'Determine the issue and jurisdiction; do not assume unlawfulness.' }),
  source({ id: 'S19', name: 'Australian Human Rights Commission', canonical_host: 'humanrights.gov.au', allowed_hosts: ['humanrights.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['AU'], topics: ['discrimination'], seed_urls: ['https://humanrights.gov.au/complaints'], review_status: 'page_read', notes: 'Federal pathway; unfair treatment is not automatically unlawful discrimination.' }),
  source({ id: 'S20', name: 'Legal Aid NSW', canonical_host: 'www.legalaid.nsw.gov.au', allowed_hosts: ['www.legalaid.nsw.gov.au'], approved_paths: [], mode: 'search', role: 'community_legal_support', jurisdictions: ['NSW'], topics: ['legal_help', 'employment_general', 'dismissal', 'discrimination'], seed_urls: ['https://www.legalaid.nsw.gov.au/my-problem-is-about/my-job'], review_status: 'page_read', notes: 'Check service eligibility and scope.' }),
  source({ id: 'S21', name: 'Immigration Advice and Rights Centre', canonical_host: 'iarc.org.au', allowed_hosts: ['iarc.org.au'], approved_paths: [], mode: 'search', role: 'community_legal_support', jurisdictions: ['NSW'], topics: ['visa', 'legal_help'], seed_urls: ['https://iarc.org.au/'], review_status: 'page_read', notes: 'Programs have their own eligibility; do not promise access.' }),
  source({ id: 'S22', name: 'Redfern Legal Centre', canonical_host: 'rlc.org.au', allowed_hosts: ['rlc.org.au'], approved_paths: [], mode: 'search', role: 'community_legal_support', jurisdictions: ['NSW'], topics: ['legal_help', 'employment_general', 'discrimination'], seed_urls: ['https://rlc.org.au/'], review_status: 'page_read', notes: 'Check each service area and eligibility.' }),
  source({ id: 'S23', name: 'Migrant Workers Centre', canonical_host: 'www.migrantworkers.org.au', allowed_hosts: ['www.migrantworkers.org.au'], approved_paths: [], mode: 'search', role: 'community_legal_support', jurisdictions: ['VIC'], topics: ['legal_help', 'employment_general', 'pay', 'visa'], seed_urls: ['https://www.migrantworkers.org.au/'], review_status: 'page_read', notes: 'Victoria organisation; distinct from RMWC NSW.' }),
  source({ id: 'S24', name: "Tenants' Union of NSW", canonical_host: 'www.tenants.org.au', allowed_hosts: ['www.tenants.org.au'], approved_paths: [], mode: 'search', role: 'community_legal_support', jurisdictions: ['NSW'], topics: ['housing', 'legal_help'], seed_urls: ['https://www.tenants.org.au/'], review_status: 'page_read', notes: 'Housing rights depend on the arrangement.' }),
  source({ id: 'S25', name: 'TIS National', canonical_host: 'www.tisnational.gov.au', allowed_hosts: ['www.tisnational.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['AU'], topics: ['language_help', 'legal_help'], seed_urls: ['https://www.tisnational.gov.au/'], review_status: 'page_read', notes: 'Do not promise availability or cost without current evidence.' }),
  source({ id: 'S26', name: 'NSW Anti-slavery Commissioner — help and support', canonical_host: 'dcj.nsw.gov.au', allowed_hosts: ['dcj.nsw.gov.au'], approved_paths: ['/legal-and-justice/our-commissioners/anti-slavery-commissioner/reporting-help-and-support.html'], mode: 'link_only', role: 'service_link', jurisdictions: ['NSW'], topics: ['urgent_support', 'legal_help'], seed_urls: ['https://dcj.nsw.gov.au/legal-and-justice/our-commissioners/anti-slavery-commissioner/reporting-help-and-support.html'], review_status: 'page_read', notes: 'Exact reviewed link only; never search the host in MVP.' }),
  source({ id: 'S27', name: '1800RESPECT', canonical_host: '1800respect.org.au', allowed_hosts: ['1800respect.org.au'], approved_paths: [], mode: 'search', role: 'community_legal_support', jurisdictions: ['AU'], topics: ['urgent_support'], seed_urls: ['https://1800respect.org.au/'], review_status: 'page_read', notes: 'Not an employment regulator or emergency service.' }),
  source({ id: 'S28', name: 'Office of the Australian Information Commissioner', canonical_host: 'www.oaic.gov.au', allowed_hosts: ['www.oaic.gov.au'], approved_paths: [], mode: 'search', role: 'official_guidance', jurisdictions: ['AU'], topics: ['privacy'], seed_urls: ['https://www.oaic.gov.au/privacy/your-privacy-rights'], review_status: 'page_read', notes: 'Employee records and other exceptions require care.' }),
  source({ id: 'S29', name: 'Triple Zero information', canonical_host: 'www.infrastructure.gov.au', allowed_hosts: ['www.infrastructure.gov.au'], approved_paths: ['/media-communications/phone/triple-zero'], mode: 'link_only', role: 'service_link', jurisdictions: ['AU'], topics: ['urgent_support'], seed_urls: ['https://www.infrastructure.gov.au/media-communications/phone/triple-zero'], review_status: 'page_read', notes: 'Exact emergency-information link only; never search the host for employment law.' }),
] as const;

if (SOURCE_REGISTRY.length !== 29 || new Set(SOURCE_REGISTRY.map((item) => item.id)).size !== 29) {
  throw new Error('Source registry must contain exactly S01-S29 once each.');
}

export const SOURCES_BY_ID = new Map<SourceId, SourceRecord>(SOURCE_REGISTRY.map((item) => [item.id, item]));
