#!/bin/bash
# Build a single standalone PDF from the DLA SBIR one-pager (partner attachment).
# Same pipeline as build-pdf.sh: md→HTML (pandoc) → PDF (headless Chrome).
set -e
cd "$(dirname "$0")"
SRC="DLA-NV012-ONE-PAGER.md"
OUT_HTML="_onepager.html"
OUT_PDF="DLA-SBIR-One-Pager.pdf"
CSS_FILE="_onepager.css"

# Write CSS to a REAL file (process-substitution <(...) paths don't survive into
# the headless-Chrome render — the styles get dropped + the page overflows).
cat > "$CSS_FILE" <<'CSS'
body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:820px;margin:0 auto;padding:12px 24px;color:#1a1a1a;line-height:1.32;font-size:11.5px}
h1{font-size:17px;border-bottom:2px solid #1e3a8a;padding-bottom:4px;margin:0 0 4px;color:#1e3a8a;line-height:1.2}
h2{font-size:12.5px;color:#1e3a8a;margin:11px 0 3px;border-bottom:1px solid #e5e9f2;padding-bottom:2px;break-after:avoid}
p{margin:4px 0}
ul{margin:3px 0;padding-left:18px}
li{margin:1px 0}
hr{display:none}
table{border-collapse:collapse;width:100%;margin:6px 0;font-size:11px}
th,td{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top}
th{background:#1e3a8a;color:#fff}
tr:nth-child(even){background:#f5f7fb}
strong{color:#111}
blockquote{border-left:3px solid #7c3aed;margin:6px 0;padding:3px 10px;background:#faf8ff;color:#444}
em{color:#555}
a{color:#1d4ed8;text-decoration:none}
@page{margin:0.45in}
CSS

# Inline the CSS into the HTML (--embed via self-contained) so Chrome needs no
# external file at render time.
pandoc "$SRC" \
  --from gfm --to html5 --standalone --embed-resources \
  --css "$CSS_FILE" \
  -o "$OUT_HTML"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT_PDF" "file://$(pwd)/$OUT_HTML" 2>/dev/null

rm -f "$OUT_HTML" "$CSS_FILE"
echo "✅ $OUT_PDF  ($(du -h "$OUT_PDF" | cut -f1))"
