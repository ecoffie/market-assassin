process.env.SAM_DOCS_READONLY='on';
import { generateMarketReport } from '../src/mcp/tools/market-report';
for (const [label,args] of [['drones',{keyword:'drones'}],['thin',{keyword:'zzzz nonexistent market qqq'}]] as any[]) {
  const r:any = await generateMarketReport({...args, userEmail:'eric@govcongiants.com'});
  console.log(`\n=== ${label} ===`);
  console.log('publication_state:', r._meta?.publication_state, '| url:', r.deliverable?.url ? 'yes' : 'null');
  console.log('grounded:', r._meta?.sections_grounded+'/'+r._meta?.sections_total, '| failed:', JSON.stringify(r._meta?.sections_failed));
  console.log('section_status:', (r._meta?.section_status??[]).map((s:any)=>`${s.name}=${s.status}${s.required?'*':''}`).join(' '));
}
