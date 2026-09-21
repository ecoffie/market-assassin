import { extractBusinessActivity } from '@/lib/beginner/activity';
for (const [d, f] of [
  ['I help businesses', 'I collect garbage and haul it away'],
  ['I do stuff', 'we pick up trash for cities'],
  ['I help businesses', 'I haul things away'],
  ['we do IT support for small offices', ''],
] as [string,string][]) {
  const a = extractBusinessActivity([d, f].filter(Boolean).join('\n'));
  console.log(JSON.stringify(d + ' | ' + f).padEnd(60), '=>', JSON.stringify(a.head), a.confidence, JSON.stringify(a.terms));
}
