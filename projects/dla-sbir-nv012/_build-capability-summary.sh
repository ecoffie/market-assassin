#!/bin/bash
set -e
cd "$(dirname "$0")"
SRC="GovCon-Giants-Mindy-Capability-Summary.md"
OUT_HTML="_cs.html"; OUT_PDF="GovCon-Giants-Mindy-Capability-Summary.pdf"; CSS="_cs.css"
cat > "$CSS" <<'CSS'
body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:820px;margin:0 auto;padding:14px 26px;color:#1a1a1a;line-height:1.42;font-size:11.5px}
h1{font-size:19px;border-bottom:2px solid #1e3a8a;padding-bottom:5px;margin:0 0 4px;color:#1e3a8a;line-height:1.25}
h1+p strong{color:#7c3aed}
h2{font-size:13.5px;color:#1e3a8a;margin:15px 0 5px;border-bottom:1px solid #e5e9f2;padding-bottom:2px;break-after:avoid}
h3{font-size:12px;color:#111;margin:10px 0 3px;break-after:avoid}
p{margin:5px 0}
ul{margin:4px 0;padding-left:18px}
li{margin:2px 0}
strong{color:#111}
em{color:#555}
a{color:#1d4ed8;text-decoration:none}
hr{display:none}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:11px}
td{border:1px solid #e5e9f2;padding:4px 8px;vertical-align:top}
tr td:first-child{background:#f5f7fb;font-weight:700;color:#1e3a8a;white-space:nowrap;width:150px}
thead{display:none}
@page{margin:0.5in}
CSS
pandoc "$SRC" --from gfm --to html5 --standalone --embed-resources --css "$CSS" -o "$OUT_HTML"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$OUT_PDF" "file://$(pwd)/$OUT_HTML" 2>/dev/null
rm -f "$OUT_HTML" "$CSS"
echo "✅ $OUT_PDF ($(du -h "$OUT_PDF" | cut -f1))"
