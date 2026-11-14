import json,csv,os,re,html
B='/Users/ericcoffie/Market Assasin/market-assassin/.claude/worktrees/data-core-benchmark/docs/benchmarks/data-core-hidden-opportunity-v1'
N={json.loads(l)['notice_id']:json.loads(l) for l in open(B+'/notices.jsonl')}
rows=list(csv.DictReader(open(B+'/review/review_sheet.csv')))
order={'gate-unseen':0,'recovered':1,'random':2}
rows.sort(key=lambda r:(order[r['kind']],r['review_id']))
def clean(t): t=re.sub(r'<[^>]+>',' ',t or ''); t=re.sub(r'&[a-z#0-9]+;',' ',t); return re.sub(r'\s+',' ',t).strip()
items=[]
for r in rows:
  n=N[r['notice_id']]
  ex=r['scope_excerpt']; quote=ex.split(' || ',1)[1] if ' || ' in ex else ex
  items.append(dict(id=r['review_id'],kind=r['kind'],biz=r['business'],desc=r['customer_description'],title=r['title'],sol=r['solicitation_number'],
    naics=r['naics'],psc=r['psc'],agency=r['agency'],url=r['sam_url'],why=r['why_traditional_missed_or_found'],sem=r['why_semantic_included'],
    note=ex.split(' || ',1)[0] if ' || ' in ex else '',quote=quote,proposed=r['proposed_label'],r1=r['reviewer_1'],r2=r['reviewer_2'],adj=r['adjudicated'],
    item=r['item_id'],descr=clean(n['description'])[:4000],sow=clean(n['sow_text'])[:6000]))
data=json.dumps(items,ensure_ascii=False).replace('</','<\\/')
tpl=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'review_page.tpl.html')).read()
open('/private/tmp/claude-501/-Users-ericcoffie-Market-Assasin-market-assassin/0ca5b0bd-b43d-4d58-834d-b2ae5cfabe06/scratchpad/review/label-review.html','w').write(tpl.replace('__DATA__',data))
print(len(items), sum(len(i['descr'])+len(i['sow']) for i in items))
