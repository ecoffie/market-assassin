/**
 * Markdown -> designed "Institute paper" HTML renderer.
 *
 * POSITIONING PAGES ONLY (see src/lib/gov/shell.ts). Turns a research white paper written in
 * markdown (src/content/institute/*.md) into the same designed, printable page as the live
 * Competition Gap paper — same shell, same fonts, same Download-PDF button, same print @media.
 *
 * The markdown is the SOURCE OF TRUTH — it is rendered verbatim (escaped), never rewritten. This
 * keeps every author-written caveat, quote, and citation byte-exact. A small, deliberately-limited
 * markdown subset is supported (headings, bold/italic, blockquotes, tables, lists, hr, links) —
 * enough for these papers, nothing that could execute.
 */
import { GOV_CSS, govBrand } from '@/lib/gov/shell';

export interface PaperMeta {
  slug: string;
  title: string;
  subtitle: string;
  audience: string;
  number: string; // "White Paper No. 2" etc. — legacy label; the CLASS is `concept` below.
  description: string; // <meta> + gallery text
  // ── The Institute's type system (Eric): the Observatory is the ONLY source of authority.
  // These are RESEARCH CONCEPTS, not Institute Publications — real, sourced hypotheses awaiting
  // the standard that would let the Institute publish the conclusion. `awaits` is the permanent
  // OBS-### id of that standard, or null when the supporting standard is not yet defined (we NEVER
  // invent an OBS id). Kept indexable + honestly labeled — never hidden, never overclaimed.
  concept?: {
    awaits: string | null;        // 'OBS-###' or null (standard not yet defined)
    awaitsName?: string;          // human name of the awaited standard, when known
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline markdown -> HTML on an already HTML-escaped string. Bold, italic, links, code. */
function inline(s: string): string {
  let t = esc(s);
  // links [text](url) — url is validated to http(s) or mailto only
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, txt, url) => `<a href="${url}">${txt}</a>`);
  // bold **x**
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // italic *x* (not touching ** already consumed)
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // inline code `x`
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

/** Block-level markdown -> the paper's HTML. Deliberately small + line-based. */
function renderMarkdown(md: string): string {
  // Drop the leading H1 title block + the "audience/draft" lines — the page hero handles those.
  // We keep everything from the first `---` divider onward as the body.
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  // Skip past the front matter: title (#), the ### subtitle, the **audience** line, the Draft line,
  // and the first horizontal rule. We locate the first '---' and start after it.
  const firstHr = lines.findIndex((l) => l.trim() === '---');
  if (firstHr >= 0) i = firstHr + 1;

  const flushParagraph = (buf: string[]) => {
    const text = buf.join(' ').trim();
    if (text) out.push(`<p>${inline(text)}</p>`);
    buf.length = 0;
  };

  let para: string[] = [];
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();

    // blank line -> paragraph break
    if (trimmed === '') { flushParagraph(para); i++; continue; }

    // horizontal rule
    if (trimmed === '---' || trimmed === '***') { flushParagraph(para); out.push('<hr class="phr">'); i++; continue; }

    // headings
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(/^(#{2,4})\s+(.*)$/))) {
      flushParagraph(para);
      const level = m[1].length; // 2,3,4
      const cls = level === 2 ? 'paper-h2' : level === 3 ? 'paper-h3' : 'paper-h4';
      out.push(`<h${level === 2 ? 2 : 3} class="${cls}">${inline(m[2])}</h${level === 2 ? 2 : 3}>`);
      i++; continue;
    }

    // blockquote (may be multi-line; supports a trailing "— attribution" line)
    if (trimmed.startsWith('>')) {
      flushParagraph(para);
      const q: string[] = [];
      let cite = '';
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const qline = lines[i].trim().replace(/^>\s?/, '');
        const cm = qline.match(/^—\s*\*?(.*?)\*?$/); // "— *DemandStar pricing page*"
        if (cm) cite = cm[1]; else if (qline) q.push(qline);
        i++;
      }
      const body = inline(q.join(' '));
      out.push(`<blockquote class="pq">${body}${cite ? `<span class="cite">&mdash; ${inline(cite)}</span>` : ''}</blockquote>`);
      continue;
    }

    // table (| a | b |)
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\s*\|[-\s:|]+\|\s*$/.test(lines[i + 1])) {
      flushParagraph(para);
      const rows: string[][] = [];
      // header
      rows.push(trimmed.split('|').slice(1, -1).map((c) => c.trim()));
      i += 2; // skip header + divider
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      const head = rows[0].map((c) => `<th>${inline(c)}</th>`).join('');
      const bodyRows = rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="ptable-wrap"><table class="ptable"><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table></div>`);
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph(para);
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="plist">${items.join('')}</ul>`);
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph(para);
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol class="plist">${items.join('')}</ol>`);
      continue;
    }

    // default: accumulate into a paragraph
    para.push(trimmed);
    i++;
  }
  flushParagraph(para);
  return out.join('\n');
}

const PAPER_CSS = `
  body{background:var(--paper-2)}
  .doc{max-width:820px;margin:0 auto;background:var(--paper);box-shadow:0 1px 0 var(--line),0 30px 60px -40px rgba(15,27,45,.35)}
  .docbar{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--paper) 90%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--hair)}
  .docbar .in{max-width:820px;margin:0 auto;padding:0 40px;height:56px;display:flex;align-items:center;justify-content:space-between;gap:16px}
  .docbar .dl{font-family:var(--sans);font-weight:600;font-size:13.5px;color:var(--paper);background:var(--teal-deep);padding:9px 15px;border-radius:8px;text-decoration:none;border:0;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
  .docbar .dl:hover{background:var(--teal)}
  .docbar .back{font-family:var(--sans);font-size:13.5px;color:var(--ink-soft);text-decoration:none;font-weight:500}
  .docbar .back:hover{color:var(--teal-deep)}

  .cover{padding:88px 64px 56px}
  .cover .tag{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--teal-deep);font-weight:600}
  .cover h1{font-family:var(--serif);font-weight:600;font-size:clamp(34px,5vw,48px);line-height:1.1;letter-spacing:-.015em;margin:22px 0 0;max-width:20ch}
  .cover .sub{font-family:var(--serif);font-size:clamp(19px,2.4vw,23px);font-style:italic;color:var(--ink-soft);margin:16px 0 0;max-width:34ch;line-height:1.35}
  .cover .rule{width:64px;height:3px;background:var(--teal);margin:26px 0 0}
  .cover .meta{margin-top:24px;font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);line-height:1.9}

  .content{padding:12px 64px 64px}
  .content .paper-h2{font-family:var(--serif);font-size:26px;line-height:1.2;font-weight:600;margin:44px 0 0;letter-spacing:-.01em}
  .content .paper-h3{font-family:var(--serif);font-size:19px;font-weight:600;margin:30px 0 0}
  .content p{font-size:16.5px;line-height:1.66;color:var(--ink-soft);margin:14px 0 0}
  .content b{color:var(--ink);font-weight:600}
  .content em{font-style:italic}
  .content code{font-family:var(--mono);font-size:13.5px;background:var(--paper-2);border:1px solid var(--hair);border-radius:5px;padding:1px 5px}
  .content a{color:var(--teal-deep)}
  .phr{height:1px;background:var(--line);border:0;margin:34px 0}
  .pq{margin:22px 0 0;border-left:3px solid var(--teal);padding:8px 0 8px 22px;font-family:var(--serif);font-size:19px;line-height:1.45;font-style:italic;color:var(--ink)}
  .pq .cite{display:block;margin-top:10px;font-family:var(--mono);font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-style:normal}
  .plist{margin:14px 0 0;padding-left:26px}
  .plist li{font-size:16.5px;line-height:1.6;color:var(--ink-soft);margin:8px 0 0}
  .plist li b{color:var(--ink)}
  .ptable-wrap{margin:22px 0 0;overflow-x:auto}
  .ptable{width:100%;border-collapse:collapse;font-size:15px}
  .ptable th{text-align:left;font-family:var(--mono);font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-soft);font-weight:700;padding:11px 14px;border-bottom:2px solid var(--line);background:var(--paper-2)}
  .ptable td{padding:11px 14px;border-bottom:1px solid var(--hair);color:var(--ink-soft);vertical-align:top}
  .ptable tr:last-child td{border-bottom:0}
  .ptable td b{color:var(--ink)}

  @media (max-width:760px){ .cover,.content{padding-left:26px;padding-right:26px} .docbar .in{padding:0 20px} }

  /* How Mindy measures this — the closing block on every paper */
  .measures{padding-top:8px}
  .mband{margin-top:36px;background:var(--ink);color:var(--paper);border-radius:18px;padding:36px 34px}
  .mband .meyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--teal);font-weight:700}
  .mband .paper-h2{color:var(--paper);font-family:var(--serif);font-size:24px;font-weight:600;margin:8px 0 0}
  .mband p{color:color-mix(in srgb,var(--paper) 82%,transparent);font-size:16px;line-height:1.6;margin:12px 0 0}
  .mmetrics{margin:18px 0 0;padding:0;list-style:none}
  .mmetrics li{position:relative;padding:11px 0 11px 26px;border-top:1px solid color-mix(in srgb,var(--paper) 14%,transparent);font-size:15.5px;line-height:1.5;color:color-mix(in srgb,var(--paper) 86%,transparent)}
  .mmetrics li:first-child{border-top:0}
  .mmetrics li::before{content:"";position:absolute;left:2px;top:18px;width:8px;height:8px;border-radius:50%;background:var(--teal)}
  .mmetrics li b{color:var(--paper);font-weight:600}
  .mtag{display:inline-block;font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;font-weight:700;color:var(--teal);border:1px solid color-mix(in srgb,var(--teal) 40%,transparent);border-radius:999px;padding:2px 7px;margin:0 4px;vertical-align:middle}
  .mnote{font-size:14px !important;color:color-mix(in srgb,var(--paper) 66%,transparent) !important;margin-top:16px !important}
  .content a.mcta,.mcta{display:inline-flex;align-items:center;gap:6px;margin-top:20px;font-family:var(--sans);font-weight:600;font-size:15px;color:var(--paper);background:var(--teal-deep);padding:11px 18px;border-radius:9px;text-decoration:none}
  .content a.mcta:hover,.mcta:hover{background:var(--teal);color:var(--paper)}

  @media print{
    @page{size:letter;margin:0.7in 0.72in}
    :root{--paper:#fff;--paper-2:#fff}
    body{background:#fff;font-size:11pt}
    .docbar,.top,footer.gov{display:none}
    .mband{background:#0f1b2d !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;break-inside:avoid}
    .mcta{display:none}
    .doc{max-width:none;box-shadow:none;margin:0}
    .cover,.content{padding:0}
    .cover{break-after:page}
    .content .paper-h2{font-size:16pt;break-after:avoid;margin-top:22pt}
    .content p{font-size:10.5pt;line-height:1.5;color:#1a2433}
    .pq,.ptable-wrap{break-inside:avoid}
    a{color:#0a5c5b;text-decoration:none}
  }
`;

/**
 * The "How Mindy Measures This" block — appended to every paper. Converts "buy our software"
 * into "here's how we quantify the problem" (Eric's critique). GROUNDED, honestly labeled:
 * Reach / Visibility / Matches are CURRENT capabilities (the discovery engine already runs);
 * Small-business Participation + Geographic Reach are labeled "(in a pilot)" because they depend
 * on the agency data we onboard. We deliberately do NOT list a competition/bids-changed number —
 * that's a pilot OUTCOME, not a current claim.
 */
const MEASURES_BLOCK = `
<div class="content measures">
  <div class="mband">
    <span class="meyebrow">How Mindy measures this</span>
    <h2 class="paper-h2" style="margin-top:8px">The problem in this paper, quantified.</h2>
    <p style="margin-top:12px">We're not asking you to take the argument on faith. For a real requirement, Mindy measures:</p>
    <ul class="mmetrics">
      <li><b>Supplier Reach</b> &mdash; how many qualified firms could be reached beyond your current channels</li>
      <li><b>Opportunity Visibility</b> &mdash; whether a solicitation is discoverable to firms that don't already know your office</li>
      <li><b>Qualified Vendor Matches</b> &mdash; capable suppliers identified for a specific requirement, including new entrants</li>
      <li><b>Small-Business Participation</b> <span class="mtag">measured in a pilot</span> &mdash; the change in qualified small-business firms engaged</li>
      <li><b>Geographic Reach</b> <span class="mtag">measured in a pilot</span> &mdash; where in the region the reached suppliers are based</li>
    </ul>
    <p class="mnote">Reach, visibility, and matches come from the public-record discovery engine Mindy already runs. Participation and geographic reach are measured against a baseline once an agency's own procurement data is onboarded &mdash; which is why we start with a pilot.</p>
    <a class="mcta" href="/pilot">Apply for a Supplier Discovery pilot &rarr;</a>
  </div>
</div>`;

// The Institute's type system: these documents are RESEARCH CONCEPTS, not Institute Publications.
// The banner + footer state that honestly and link to the maturity ladder — never hidden, never
// dressed up as a finished finding. Live maturity of the awaited standard is looked up from the
// Observatory registry so the label never goes stale as a metric graduates.
import { methodologyById } from '@/lib/analytics/observatory-methodology';

const MATURITY_LABEL: Record<string, string> = {
  production: 'Production', beta: 'Beta', collecting: 'Collecting', research: 'Research',
};

function conceptStatusLine(concept: NonNullable<PaperMeta['concept']>): string {
  if (!concept.awaits) return 'Supporting standard: not yet defined';
  const std = methodologyById(concept.awaits);
  const name = concept.awaitsName || std?.name || '';
  const mat = std ? MATURITY_LABEL[std.lifecycle] ?? std.lifecycle : 'unknown';
  return `Supporting standard: <b>${esc(concept.awaits)}${name ? ' &middot; ' + esc(name) : ''}</b> &middot; maturity <b>${esc(mat)}</b>`;
}

/** The top banner: reclassifies the document as a Research Concept, honestly + indexably. */
export function conceptBanner(concept: NonNullable<PaperMeta['concept']>): string {
  return `<div class="concept-banner">
    <div class="cb-in">
      <div class="cb-tag">Research Concept</div>
      <p class="cb-lede">This is ongoing research by the Mindy Institute — <b>not yet an Institute publication</b>. The Institute publishes a conclusion only once the supporting Observatory standards reach publication maturity.</p>
      <p class="cb-status">${conceptStatusLine(concept)}. Publication status: <b>Research Concept</b>. <a href="/research/how-we-publish">How we publish &rarr;</a></p>
    </div>
  </div>`;
}

/** The footer Publication Status block — the transparent record at the end of every concept. */
export function conceptFooter(concept: NonNullable<PaperMeta['concept']>): string {
  const eligible = concept.awaits
    ? `Not yet eligible &mdash; awaiting ${esc(concept.awaits)}.`
    : 'Not yet eligible &mdash; a supporting standard has not been defined.';
  return `<footer class="concept-footer">
    <div class="cf-h">Publication Status</div>
    <dl class="cf-dl">
      <dt>Classification</dt><dd>Research Concept</dd>
      <dt>Supporting standard</dt><dd>${concept.awaits ? esc(concept.awaits) + (concept.awaitsName ? ' &middot; ' + esc(concept.awaitsName) : '') : 'Not yet defined'}</dd>
      <dt>Publication eligibility</dt><dd>${eligible}</dd>
    </dl>
    <p class="cf-note">When the supporting standard reaches Production, this concept may be revised and published as an official Institute publication. It will remain archived here as the precursor. See <a href="/research">the Mindy Institute</a> and <a href="/research/how-we-publish">why some research isn't published yet</a>.</p>
  </footer>`;
}

export const CONCEPT_CSS = `
  .concept-banner{background:var(--paper,#faf7f2);border:1px solid var(--hair,#e6e0d6);border-left:3px solid var(--teal-deep,#0f766e);border-radius:12px;margin:0 0 30px;padding:18px 22px}
  .concept-banner .cb-tag{display:inline-block;font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--teal-deep,#0f766e);background:rgba(15,118,110,.08);border-radius:5px;padding:3px 9px}
  .concept-banner .cb-lede{font-family:var(--sans);font-size:15px;line-height:1.5;color:var(--ink,#1a1a1a);margin:10px 0 0;max-width:64ch}
  .concept-banner .cb-status{font-family:var(--sans);font-size:13.5px;color:var(--ink-soft,#4a4a4a);margin:8px 0 0}
  .concept-banner .cb-status a,.concept-footer a{color:var(--teal-deep,#0f766e);text-decoration:none;font-weight:600}
  .concept-footer{margin:44px 0 0;padding-top:22px;border-top:1px solid var(--hair,#e6e0d6)}
  .concept-footer .cf-h{font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#8a8a8a)}
  .concept-footer .cf-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin:12px 0 0;font-family:var(--sans);font-size:14px}
  .concept-footer .cf-dl dt{color:var(--muted,#8a8a8a)}
  .concept-footer .cf-dl dd{color:var(--ink,#1a1a1a);margin:0;font-weight:500}
  .concept-footer .cf-note{font-family:var(--sans);font-size:13px;color:var(--ink-soft,#4a4a4a);margin:14px 0 0;max-width:66ch;line-height:1.55}
`;

/** Render a paper markdown string + its metadata into the full HTML document. */
export function renderPaper(meta: PaperMeta, markdown: string): string {
  const bodyHtml = renderMarkdown(markdown);
  const banner = meta.concept ? conceptBanner(meta.concept) : '';
  const footer = meta.concept ? conceptFooter(meta.concept) : '';
  // Reclassify the cover tag: "Research Concept", never "White Paper No. N" (the Observatory is
  // the only source of publication authority — these are concepts awaiting a standard).
  const coverTag = meta.concept ? 'The Mindy Institute &middot; Research Concept' : `The Mindy Institute for Public Procurement &middot; ${esc(meta.number)}`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)} — The Mindy Institute for Public Procurement</title>
<meta name="description" content="${esc(meta.description)}">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<style>${GOV_CSS}${PAPER_CSS}${CONCEPT_CSS}</style>
</head><body>
<div class="top"><div class="wrap" style="justify-content:space-between">${govBrand()}<a class="topcta" href="/pilot">Run a pilot</a></div></div>
<div class="docbar"><div class="in">
  <a class="back" href="/institute">&larr; The Institute</a>
  <button class="dl" onclick="window.print()"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg> Download PDF</button>
</div></div>
<article class="doc">
  <section class="cover">
    <span class="tag">${coverTag}</span>
    <h1>${esc(meta.title)}</h1>
    <p class="sub">${esc(meta.subtitle)}</p>
    <div class="rule"></div>
    <div class="meta">${esc(meta.audience)}<br>Published by GovCon Giants AI &middot; getmindy.ai/institute<br>All figures cited as published; every quotation is from the source's own materials</div>
  </section>
  ${banner}
  <div class="content">${bodyHtml}</div>
  ${MEASURES_BLOCK}
  ${footer}
</article>
</body></html>`;
}
