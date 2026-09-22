/**
 * The canonical discovery fixture set — shared by the golden-plan test and the cross-surface gate.
 * Adding a fixture here extends BOTH: its plan is locked, and every migrated surface must match it.
 */
import type { DiscoveryInput } from '../plan';

export const FIXTURES: Array<{ id: string; cls: string; input: DiscoveryInput }> = [
  { id: '541320', cls: 'exact 6-digit NAICS', input: { query: '541320' } },
  { id: '5413', cls: 'partial NAICS', input: { query: '5413' } },
  { id: 'pam', cls: 'ordinary keyword', input: { query: 'pam' } },
  { id: 'ai governance', cls: 'short concept query', input: { query: 'ai governance' } },
  { id: 'artificial intelligence governance', cls: 'short concept query (long form)', input: { query: 'artificial intelligence governance' } },
  { id: 'cybersecurity', cls: 'cyber taxonomy', input: { query: 'cybersecurity' } },
  { id: 'janitorial', cls: 'distinctive keyword + industry preset', input: { query: 'janitorial' } },
  { id: 'market research', cls: 'distinctive + generic', input: { query: 'market research' } },
  { id: 'zzzxxyyqqq', cls: 'nonsense', input: { query: 'zzzxxyyqqq' } },
  { id: 'veterans affairs', cls: 'agency name typed as query', input: { query: 'veterans affairs' } },
  { id: 'agency=VA janitorial', cls: 'explicit agency param', input: { query: 'janitorial', agency: 'VA' } },
  { id: 'management', cls: 'generic single term', input: { query: 'management' } },
  { id: 'drones', cls: 'term of art', input: { query: 'drones' } },
  { id: '"ai governance"', cls: 'quoted exact phrase', input: { query: '"ai governance"' } },
  { id: '8a', cls: 'set-aside term', input: { query: '8a' } },
  { id: 'follow-on support', cls: 'hyphenated compound', input: { query: 'follow-on support' } },
  { id: 'Show me USDA opportunities', cls: 'NL wrapper → agency', input: { query: 'Show me USDA opportunities' } },
  { id: 'SDVOSB cybersecurity opportunities in Virginia', cls: 'set-aside + capability + state', input: { query: 'SDVOSB cybersecurity opportunities in Virginia' } },
  { id: 'cyber cloud compliance network server', cls: 'capability list', input: { query: 'cyber cloud compliance network server' } },
  { id: 'cyber, cloud', cls: 'explicit alternatives', input: { query: 'cyber, cloud' } },
  { id: 'Pro Audio', cls: 'generic modifier + distinctive', input: { query: 'Pro Audio' } },
  { id: '541512 -computers', cls: 'anchored exclusion', input: { query: '541512 -computers' } },
  { id: '-computers', cls: 'naked exclusion', input: { query: '-computers' } },
  { id: 'agency=USDA', cls: 'USDA alias collision', input: { query: '', agency: 'USDA' } },
  { id: 'agency=VA', cls: 'VA/Naval collision', input: { query: '', agency: 'VA' } },
  { id: 'Naval facilities in Nevada', cls: 'VA/Naval collision (free text)', input: { query: 'Naval facilities in Nevada' } },
];
