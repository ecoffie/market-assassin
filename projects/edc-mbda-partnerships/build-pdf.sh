#!/bin/bash
# Build ONE combined PDF from the partnerships docs with a TOC + working
# internal cross-links. md→HTML (pandoc) → PDF (headless Chrome).
set -e
cd "$(dirname "$0")"

OUT_HTML="_combined.html"
OUT_PDF="GovCon-Partnerships-Brief.pdf"

# Order: brief first (the read), then playbook + runbooks, then strategy/funding,
# then research. Each becomes a section the TOC + cross-links jump to.
DOCS=(
  "TEAM-BRIEF-JUNE-2026.md"
  "GOV-DEMO-PLAYBOOK.md"
  "DISA-DEMO-PITCH-RUNBOOK.md"
  "OSBP-DEMO-PITCH-RUNBOOK.md"
  "MICC-DEMO-PITCH-RUNBOOK.md"
  "GOVT-GTM-STRATEGY.md"
  "FUNDING-STRATEGY.md"
  "AFWERX-ENDUSER-OUTREACH.md"
  "AFWERX-SBIR-READINESS.md"
  "landscape-research-phase2.md"
  "grant-nofo-tracker.md"
  "PRD-edc-mbda-partnerships.md"
  "JD-head-public-sector-partnerships-funding.md"
  "advisor-recruitment-brief.md"
  "DISA-VEHICLE-WATCH-SPEC.md"
  "MICC-MRR-SPEC.md"
  "ONE-PAGER.md"
  "outreach-templates.md"
)

# Build a single markdown stream. For each doc: insert a page break + an HTML
# anchor whose id is the .md filename (so links to "FOO.md" resolve to #FOO.md).
TMP="_merged.md"
: > "$TMP"
for f in "${DOCS[@]}"; do
  [ -f "$f" ] || { echo "skip (missing): $f"; continue; }
  printf '\n\n<div class="page-break"></div>\n\n' >> "$TMP"
  printf '<a id="%s"></a>\n\n' "$f" >> "$TMP"
  cat "$f" >> "$TMP"
  printf '\n\n' >> "$TMP"
done

# Rewrite cross-doc links: [text](FOO.md)  ->  [text](#FOO.md)
# and [text](FOO.md#frag) -> [text](#FOO.md). Only touches .md links, leaves
# http(s) links and the PDF/CSV refs alone.
perl -i -pe 's/\]\(([A-Za-z0-9._-]+\.md)(#[^)]*)?\)/](#$1)/g' "$TMP"

pandoc "$TMP" \
  --from gfm \
  --to html5 \
  --standalone \
  --toc --toc-depth=2 \
  --metadata title="GovCon Partnerships & Government Sales — Team Brief (June 2026)" \
  --css <(cat <<'CSS'
body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:850px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.5;font-size:13px}
h1{font-size:22px;border-bottom:2px solid #1e3a8a;padding-bottom:6px;margin-top:8px;color:#1e3a8a}
h2{font-size:17px;color:#1e3a8a;margin-top:22px}
h3{font-size:14px;color:#333}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12px}
th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#1e3a8a;color:#fff}
tr:nth-child(even){background:#f5f7fb}
code{background:#eef;padding:1px 4px;border-radius:3px;font-size:11px}
pre{background:#f5f5f7;padding:10px;border-radius:5px;overflow:auto;font-size:11px}
a{color:#1d4ed8;text-decoration:none}
blockquote{border-left:3px solid #7c3aed;margin:8px 0;padding:4px 12px;background:#faf8ff;color:#444}
.page-break{page-break-before:always}
#TOC{background:#f5f7fb;border:1px solid #d6deeb;border-radius:6px;padding:12px 18px;margin-bottom:18px}
#TOC ul{list-style:none;padding-left:14px}
#TOC>ul{padding-left:0}
@media print{a{color:#1d4ed8}}
CSS
) \
  -o "$OUT_HTML"

# HTML -> PDF via headless Chrome (preserves internal #anchor links)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT_PDF" "file://$(pwd)/$OUT_HTML" 2>/dev/null

rm -f "$TMP" "$OUT_HTML"
echo "✅ $OUT_PDF  ($(du -h "$OUT_PDF" | cut -f1))"
