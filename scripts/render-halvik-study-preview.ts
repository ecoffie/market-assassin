/** Writes a local DRAFT preview of Transaction Study 001 (noindex, draft banner). Never publishes. */
import { writeFileSync } from 'node:fs';
import { renderHalvikStudyHtml } from '../src/lib/analytics/transaction-studies/halvik-tetra-tech-html';
const out = process.argv[2] ?? 'halvik-tetra-tech-draft.html';
writeFileSync(out, renderHalvikStudyHtml({ canonical: 'https://getmindy.ai/research/halvik-tetra-tech', draft: true }));
console.log('wrote', out);
