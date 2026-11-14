import csv,sys,re,json,urllib.request,urllib.error,concurrent.futures as cf,time,http.client,ssl
from urllib.parse import urlparse,urljoin
rows=list(csv.DictReader(open(sys.argv[1])))
class NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k): return None
op=urllib.request.build_opener(NoRedir)
UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
def fetch(u):
    t=time.time()
    req=urllib.request.Request(u,headers={'User-Agent':UA})
    try:
        r=op.open(req,timeout=60); code=r.status; h=r.headers; body=r.read(400000).decode('utf8','ignore')
    except urllib.error.HTTPError as e:
        code=e.code; h=e.headers; body=e.read(400000).decode('utf8','ignore')
    except Exception as e:
        return {'status':'ERR','err':str(e)[:120],'ms':int((time.time()-t)*1000)}
    robots=re.search(r'<meta name="robots" content="([^"]+)"',body)
    canon=re.search(r'<link rel="canonical" href="([^"]+)"',body)
    title=re.search(r'<title>([^<]*)</title>',body)
    return {'status':code,'loc':h.get('location'),'xcache':h.get('x-vercel-cache'),'xrobots':h.get('x-robots-tag'),
      'robots':robots.group(1) if robots else None,'canon':canon.group(1) if canon else None,
      'title':title.group(1)[:120] if title else None,'len':len(body),'ms':int((time.time()-t)*1000),
      'notfound_text':('could not be found' in body or 'Page Not Found' in body or 'NEXT_HTTP_ERROR_FALLBACK;404' in body)}
def one(x):
    u=x['URL'];a=fetch(u);a['url']=u;a['crawled']=x['Last crawled']
    hops=[];cur=a
    while cur.get('status') in (301,302,307,308) and cur.get('loc') and len(hops)<5:
        nu=urljoin(u if not hops else hops[-1]['url'],cur['loc']);cur=fetch(nu);cur['url']=nu;hops.append(cur)
    a['hops']=hops
    return a
out=[]
with cf.ThreadPoolExecutor(6) as ex:
    for i,r in enumerate(ex.map(one,rows)):
        out.append(r)
        if i%100==0: print(i,flush=True,file=sys.stderr)
json.dump(out,open(sys.argv[2],'w'),indent=0)
