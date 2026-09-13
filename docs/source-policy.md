# Source registry and web-grounding policy

Registry version: `2026-09-12.v4`. The executable source of truth is `functions/src/sources/registry.ts`.

The registry is an allowlist, not a claim that every page on a host is accurate, current or reviewed. The router selects a small topic/jurisdiction subset; an empty pool fails closed. URLs supplied by the model are never trusted. The gate requires a completed native web-search call, native URL annotations on every output-text block, exact HTTPS host matching, permitted paths and membership in the selected pool.

`conditional_search` requires an explicit server decision. `link_only` pages may appear in Help but their host is never searched in the MVP. ATO S05 remains conditional and `indexed_only`; S26/S29 remain exact-path link-only.

| ID | Source / host | Role | Jurisdiction | Mode | Review |
|---|---|---|---|---|---|
| S01 | Rights of Migrant Workers in Community — `migrants.org.au` | community legal support | NSW | search | page read |
| S02 | Fair Work Ombudsman — `www.fairwork.gov.au` | official guidance | national system | search | page read |
| S03 | Fair Work Commission — `www.fwc.gov.au` | official guidance | AU | search | page read |
| S04 | Department of Home Affairs — `immi.homeaffairs.gov.au` | official guidance | AU | search | page read |
| S05 | Australian Taxation Office — `www.ato.gov.au` | official guidance | AU | conditional search | indexed only |
| S06 | Federal Register of Legislation — `www.legislation.gov.au` | legislation | AU | search | page read |
| S07 | SafeWork NSW — `www.safework.nsw.gov.au` | official guidance | NSW | search | page read |
| S08 | SIRA NSW — `www.sira.nsw.gov.au` | official guidance | NSW | search | page read |
| S09 | Independent Review Office — `www.iro.nsw.gov.au` | official guidance | NSW | search | page read |
| S10 | Safe Work Australia — `www.safeworkaustralia.gov.au` | official guidance | AU | search | page read |
| S11 | WorkSafe Victoria — `www.worksafe.vic.gov.au` | official guidance | VIC | search | page read |
| S12 | WorkSafe Queensland — `www.worksafe.qld.gov.au` | official guidance | QLD | search | page read |
| S13 | WorkSafe Western Australia — `www.worksafe.wa.gov.au` | official guidance | WA | search | page read |
| S14 | SafeWork South Australia — `www.safework.sa.gov.au` | official guidance | SA | search | page read |
| S15 | WorkSafe Tasmania — `worksafe.tas.gov.au` | official guidance | TAS | search | page read |
| S16 | WorkSafe ACT — `www.worksafe.act.gov.au` | official guidance | ACT | search | page read |
| S17 | NT WorkSafe — `worksafe.nt.gov.au` | official guidance | NT | search | page read |
| S18 | Anti-Discrimination NSW — `antidiscrimination.nsw.gov.au` | official guidance | NSW | search | page read |
| S19 | Australian Human Rights Commission — `humanrights.gov.au` | official guidance | AU | search | page read |
| S20 | Legal Aid NSW — `www.legalaid.nsw.gov.au` | community legal support | NSW | search | page read |
| S21 | Immigration Advice and Rights Centre — `iarc.org.au` | community legal support | NSW | search | page read |
| S22 | Redfern Legal Centre — `rlc.org.au` | community legal support | NSW | search | page read |
| S23 | Migrant Workers Centre — `www.migrantworkers.org.au` | community legal support | VIC | search | page read |
| S24 | Tenants' Union of NSW — `www.tenants.org.au` | community legal support | NSW | search | page read |
| S25 | TIS National — `www.tisnational.gov.au` | official guidance | AU | search | page read |
| S26 | NSW Anti-slavery Commissioner support — `dcj.nsw.gov.au` | service link | NSW | link only, exact path | page read |
| S27 | 1800RESPECT — `1800respect.org.au` | community support | AU | search | page read |
| S28 | OAIC — `www.oaic.gov.au` | official guidance | AU | search | page read |
| S29 | Triple Zero information — `www.infrastructure.gov.au` | service link | AU | link only, exact path | page read |

## Routing and answer rules

- Free-text semantic queries preserve the user's intent; enums choose source groups only.
- National sources and the matching state sources may be combined. A NSW→VIC correction is applied before routing and must remove NSW-only sources from the new pool.
- The browser cannot submit domains or source IDs. Domain aliases and approved paths are server metadata.
- Existing evidence IDs can be reused only for `explain_previous`; a new current rule, amount, deadline or legal claim requires fresh research.
- Search context is reduced and identifier-redacted, but hosted search may still receive case context. Do not promise otherwise.
- The gate failing means the entire researched answer is replaced with a no-guess fallback. It never deletes an invalid citation while leaving the unsupported claim.
- Human evaluation checks whether evidence supports each important claim, not only whether a link exists.

## Review workflow after the hackathon

Assign a content owner, record page-level review dates, test redirects/host aliases, document jurisdiction and eligibility caveats, and disable stale sources. A scheduled link check may flag changes but must not automatically convert an unreviewed page into an approved legal source.
