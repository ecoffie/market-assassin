'use client';
/**
 * HomeSearch — the universal search bar on /home-v5. Wraps the default top section (map +
 * "Today in your market") as children; on search it swaps that section for Google-style
 * blended results (opportunities + contractor knowledge cards + a contract passthrough),
 * fetched from /api/app/home-search. Clear returns to the default view.
 */
import { useRef, useState } from 'react';
import { Search, X, Building2, ExternalLink } from 'lucide-react';
import HeroOpportunityMap from './HeroOpportunityMap';

type Opp = { notice_id: string; title: string; department: string; naics_code: string; response_deadline: string | null; set_aside_description: string | null; notice_type: string | null; ui_link: string | null; set: string; lat: number | null; lng: number | null };
type Firm = { uei: string; company: string; slug: string; state: string; total_contract_value: number; award_count: number };
type Group = { key: string; label: string; color: string };
type Results = { q: string; opportunities: Opp[]; contractors: Firm[]; contractPiid: string | null; setGroups: Group[] };

const EXAMPLES = ['drones', 'Lockheed Martin', 'demolition', 'janitorial services'];

function fmt$(n: number) {
  if (!n) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
function dueLabel(d: string | null): string {
  if (!d) return '';
  const days = Math.round((new Date(d.slice(0, 10) + 'T00:00').getTime() - Date.now()) / 864e5);
  if (days < 0) return 'closed';
  if (days === 0) return 'due today';
  return `${days}d left`;
}
function firmProfileUrl(f: Firm) {
  return `/app?${new URLSearchParams({ panel: 'contractors', view: 'profile', slug: f.slug, company: f.company }).toString()}`;
}

export default function HomeSearch({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<Results | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function doSearch(q: string) {
    if (!q) return;
    setValue(q);
    setLoading(true);
    try {
      const r = await fetch(`/api/app/home-search?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      setRes({ q, opportunities: data.opportunities || [], contractors: data.contractors || [], contractPiid: data.contractPiid || null, setGroups: data.setGroups || [] });
    } catch {
      setRes({ q, opportunities: [], contractors: [], contractPiid: null, setGroups: [] });
    } finally {
      setLoading(false);
    }
  }
  function submit(e: React.FormEvent) { e.preventDefault(); doSearch(value.trim()); }
  function clear() { setRes(null); setValue(''); inputRef.current?.focus(); }

  const total = res ? res.opportunities.length + res.contractors.length + (res.contractPiid ? 1 : 0) : 0;

  return (
    <div className="hsearch">
      <style>{CSS}</style>

      <div className="hs-top">
        <form className="hs-bar" onSubmit={submit}>
          <Search className="hs-ic" size={17} strokeWidth={2.25} />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search a company, contract #, UEI, or market…"
            aria-label="Search opportunities, companies, contracts, or a market"
          />
          {res && !loading && <button type="button" className="hs-clear" onClick={clear} aria-label="Clear search"><X size={15} strokeWidth={2.4} /></button>}
          <button type="submit" className="hs-go" disabled={loading}>{loading ? <span className="hs-spin" /> : 'Search'}</button>
        </form>
        {!res && (
          <div className="hs-chips">
            <span className="hs-try">Try</span>
            {EXAMPLES.map((x) => <button key={x} type="button" className="hs-chip" onClick={() => doSearch(x)}>{x}</button>)}
          </div>
        )}
      </div>

      {res ? (
        <section className="hs-results">
          <div className="hs-head"><b>{total}</b> result{total === 1 ? '' : 's'} for <span className="hs-q">&ldquo;{res.q}&rdquo;</span><button className="hs-back" onClick={clear}>← back to my market</button></div>
          <div className="hs-grid">
            <div className="hs-main">
              {res.contractPiid && (
                <a className="hs-card hs-contract" href={`https://www.usaspending.gov/search/?keyword=${encodeURIComponent(res.contractPiid)}`} target="_blank" rel="noreferrer">
                  <div className="hs-kick">Contract / solicitation</div>
                  <div className="hs-ct-t">{res.contractPiid}</div>
                  <div className="hs-ct-s">Look up this award on USASpending <ExternalLink size={12} /></div>
                </a>
              )}
              {res.opportunities.length === 0 && !res.contractPiid && (
                <div className="hs-empty">No open opportunities match &ldquo;{res.q}&rdquo;. Try a broader term, a company name, or a contract number.</div>
              )}
              {res.opportunities.map((o) => (
                <a className="hs-card" key={o.notice_id} href={o.ui_link || 'https://sam.gov/search'} target="_blank" rel="noreferrer">
                  <div className="hs-o-top">
                    {o.notice_type && <span className="hs-badge">{o.notice_type.slice(0, 22)}</span>}
                    {o.response_deadline && <span className={`hs-due${dueLabel(o.response_deadline) === 'due today' || /^[0-3]d/.test(dueLabel(o.response_deadline)) ? ' hot' : ''}`}>{dueLabel(o.response_deadline)}</span>}
                  </div>
                  <div className="hs-o-t">{o.title}</div>
                  <div className="hs-o-m">{o.department}{o.naics_code ? ` · NAICS ${o.naics_code}` : ''}{o.set_aside_description ? ` · ${o.set_aside_description}` : ''}</div>
                </a>
              ))}
            </div>

            <aside className="hs-side">
              {res.contractors.length === 0 ? (
                <div className="hs-side-empty">No matching companies.</div>
              ) : (
                <>
                  <a className="hs-know" href={firmProfileUrl(res.contractors[0])}>
                    <div className="hs-know-ic"><Building2 size={20} strokeWidth={1.75} /></div>
                    <div className="hs-know-t">{res.contractors[0].company}</div>
                    <div className="hs-know-s">Federal contractor{res.contractors[0].state ? ` · ${res.contractors[0].state}` : ''}</div>
                    <div className="hs-know-stats">
                      <div><div className="hs-n">{fmt$(res.contractors[0].total_contract_value)}</div><div className="hs-l">federal obligated</div></div>
                      <div><div className="hs-n">{(res.contractors[0].award_count || 0).toLocaleString()}</div><div className="hs-l">awards</div></div>
                    </div>
                    <div className="hs-know-go">View full profile →</div>
                  </a>
                  {res.contractors.slice(1, 4).map((f) => (
                    <a className="hs-firm" key={f.uei} href={firmProfileUrl(f)}>
                      <Building2 size={15} strokeWidth={1.75} />
                      <span className="hs-firm-n">{f.company}</span>
                      <span className="hs-firm-v">{fmt$(f.total_contract_value)}</span>
                    </a>
                  ))}
                </>
              )}
              {(() => {
                const pins = res.opportunities.filter((o) => o.lat != null && o.lng != null).map((o) => ({ lat: o.lat as number, lng: o.lng as number, set: o.set, label: o.title }));
                return pins.length > 0 ? <div className="hs-sidemap"><HeroOpportunityMap pins={pins} setGroups={res.setGroups} /></div> : null;
              })()}
            </aside>
          </div>
        </section>
      ) : children}
    </div>
  );
}

const CSS = `
.hsearch{--s:#17141f;--s2:#1e1a2b;--line:#2a2438;--line2:#372f4d;--ink:#f6f4ff;--ink2:#c5bfd8;--mut:#8a8399;--violet2:#a855f7;--emerald:#10b981;--grad:linear-gradient(135deg,#7c3aed,#a855f7 55%,#6d28d9)}
.hsearch *{box-sizing:border-box}
.hsearch .hs-top{max-width:600px;margin:0 0 20px}
.hsearch .hs-bar{position:relative;display:flex;align-items:center;gap:0;height:42px;border-radius:11px;background:linear-gradient(180deg,#211c31,#191527);border:1px solid var(--line2);padding-left:38px;padding-right:5px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 6px 18px -12px rgba(0,0,0,.6);transition:border-color .15s,box-shadow .15s}
.hsearch .hs-bar:focus-within{border-color:var(--violet2);box-shadow:0 0 0 3px rgba(168,85,247,.16),0 8px 24px -12px rgba(0,0,0,.6)}
.hsearch .hs-ic{position:absolute;left:13px;color:var(--mut)}
.hsearch .hs-bar:focus-within .hs-ic{color:var(--violet2)}
.hsearch .hs-bar input{flex:1;min-width:0;height:100%;background:transparent;border:0;outline:none;font-size:14px;color:var(--ink);font-family:inherit}
.hsearch .hs-bar input::placeholder{color:var(--mut)}
.hsearch .hs-clear{width:28px;height:28px;display:grid;place-items:center;border:0;background:transparent;color:var(--mut);border-radius:7px;cursor:pointer;flex:none}
.hsearch .hs-clear:hover{color:var(--ink);background:var(--line)}
.hsearch .hs-go{flex:none;height:32px;min-width:76px;display:grid;place-items:center;border:0;border-radius:8px;background:var(--grad);color:#fff;font-size:13px;font-weight:800;font-family:inherit;cursor:pointer;box-shadow:0 6px 16px -6px rgba(124,58,237,.7)}
.hsearch .hs-go:hover{filter:brightness(1.08)}
.hsearch .hs-go:disabled{cursor:default}
.hsearch .hs-spin{width:15px;height:15px;border:2px solid rgba(255,255,255,.55);border-top-color:transparent;border-radius:50%;animation:hspin .7s linear infinite}
@keyframes hspin{to{transform:rotate(360deg)}}
.hsearch .hs-chips{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:11px;padding-left:2px}
.hsearch .hs-try{font-size:12px;color:var(--mut);font-weight:600}
.hsearch .hs-chip{font-size:12.5px;font-weight:600;color:var(--ink2);background:var(--s);border:1px solid var(--line);border-radius:99px;padding:5px 12px;cursor:pointer}
.hsearch .hs-chip:hover{border-color:var(--violet2);color:var(--ink)}

.hsearch .hs-head{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--ink2);margin-bottom:14px}
.hsearch .hs-head b{color:var(--ink)}
.hsearch .hs-q{color:var(--violet2);font-weight:600}
.hsearch .hs-back{margin-left:auto;background:none;border:0;color:var(--mut);font-size:13px;font-weight:600;cursor:pointer}
.hsearch .hs-back:hover{color:var(--ink)}
.hsearch .hs-sidemap{position:relative;height:230px;border-radius:14px;overflow:hidden;border:1px solid var(--line);margin-top:9px}
.hsearch .hs-grid{display:grid;grid-template-columns:1fr 320px;gap:18px;align-items:start}
@media(max-width:900px){.hsearch .hs-grid{grid-template-columns:1fr}}
.hsearch .hs-main{display:flex;flex-direction:column;gap:10px;min-width:0}
.hsearch .hs-card{display:block;background:var(--s);border:1px solid var(--line);border-radius:14px;padding:15px 17px;text-decoration:none}
.hsearch .hs-card:hover{border-color:var(--line2)}
.hsearch .hs-o-top{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.hsearch .hs-badge{font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#d8b4fe;background:rgba(124,58,237,.16);padding:3px 8px;border-radius:6px}
.hsearch .hs-due{margin-left:auto;font-size:11.5px;font-weight:800;color:var(--mut)}
.hsearch .hs-due.hot{color:#fb7185}
.hsearch .hs-o-t{font-size:15px;font-weight:700;color:var(--ink);line-height:1.32}
.hsearch .hs-o-m{font-size:12.5px;color:var(--mut);margin-top:5px;line-height:1.4}
.hsearch .hs-contract .hs-kick{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.hsearch .hs-contract .hs-ct-t{font-size:17px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums;margin:5px 0 4px}
.hsearch .hs-contract .hs-ct-s{font-size:12.5px;color:var(--violet2);font-weight:700;display:inline-flex;align-items:center;gap:5px}
.hsearch .hs-empty{background:var(--s);border:1px solid var(--line);border-radius:14px;padding:26px;color:var(--mut);font-size:13.5px;line-height:1.5;text-align:center}
.hsearch .hs-side{display:flex;flex-direction:column;gap:9px}
.hsearch .hs-side-empty{color:var(--mut);font-size:13px;padding:14px 4px}
.hsearch .hs-know{display:block;background:radial-gradient(120% 100% at 90% 0%,rgba(124,58,237,.22),transparent 55%),var(--s2);border:1px solid var(--line2);border-radius:16px;padding:18px;text-decoration:none}
.hsearch .hs-know-ic{color:var(--violet2);margin-bottom:10px}
.hsearch .hs-know-t{font-size:17px;font-weight:800;color:var(--ink);line-height:1.2}
.hsearch .hs-know-s{font-size:12px;color:var(--mut);margin-top:3px}
.hsearch .hs-know-stats{display:flex;gap:22px;margin:14px 0 4px}
.hsearch .hs-know-stats .hs-n{font-size:18px;font-weight:800;color:var(--ink);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.hsearch .hs-know-stats .hs-l{font-size:11px;color:var(--mut);margin-top:2px}
.hsearch .hs-know-go{margin-top:12px;font-size:13px;font-weight:800;color:var(--violet2)}
.hsearch .hs-firm{display:flex;align-items:center;gap:9px;background:var(--s);border:1px solid var(--line);border-radius:11px;padding:10px 12px;text-decoration:none;color:var(--ink2)}
.hsearch .hs-firm:hover{border-color:var(--line2);color:var(--ink)}
.hsearch .hs-firm>svg{color:var(--mut);flex:none}
.hsearch .hs-firm-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.hsearch .hs-firm-v{font-size:12px;font-weight:800;color:var(--emerald);font-variant-numeric:tabular-nums}
`;
