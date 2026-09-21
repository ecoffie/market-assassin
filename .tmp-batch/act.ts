import { extractBusinessActivity } from '@/lib/beginner/activity';
import { deriveCompanyKeywords } from '@/mcp/tools/company-keywords';
const inputs = [
  'can a 2 person garbage company do government contracts',
  'I clean office buildings',
  'we do IT support for small offices',
  'staffing agency',
  'I run a small construction company',
  'I own a landscaping business',
  'physical security guard services',
  'we cater events',
  'trucking company',
  'we install commercial roofing',
  'I do commercial cleaning and small construction jobs',
  'I help businesses',
  'I do stuff',
  'fix doors',
  'work with lidar for uas drones',
  'I do window washing',
  'zzqwxjunkterm999xyz',
];
async function main() {
  for (const s of inputs) {
    const d = await deriveCompanyKeywords({ description: s, limit: 12 });
    const a = extractBusinessActivity(s, d.keywords);
    console.log(JSON.stringify(s).padEnd(56), '=> head=' + JSON.stringify(a.head).padEnd(18), a.confidence.padEnd(5), a.rung.padEnd(8), 'terms=' + JSON.stringify(a.terms));
  }
}
main();
