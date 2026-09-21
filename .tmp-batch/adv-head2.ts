import { extractBusinessActivity } from '@/lib/beginner/activity';
const INPUTS = [
  'minority owned trucking company',
  'veteran owned landscaping company',
  'I am a sole proprietor doing bookkeeping',
  'we are a new company that does painting',
  'family business doing electrical',
  'husband and wife team that cleans offices',
  'I am a general contractor',
  'black owned catering company in Atlanta',
  'service disabled veteran owned small business - welding',
  '我们做清洁工作',
  'hubzone certified janitorial',
  '8a certified IT company',
  'we are new to this and we do drywall',
  'my company is called Apex Solutions and we do roofing',
  'Smith Brothers Trucking LLC',
  'I want to sell office supplies to the government',
  'we deliver medical supplies',
  'i cut grass',
  'we do snow removal',
  'we sell PPE',
  'we are a security company',
  'we do moving and storage',
];
for (const input of INPUTS) {
  const a = extractBusinessActivity(input);
  console.log((a.head ?? 'NULL').padEnd(20), a.confidence.padEnd(5), a.rung.padEnd(8), JSON.stringify(a.terms).padEnd(50), '<=', input);
}
