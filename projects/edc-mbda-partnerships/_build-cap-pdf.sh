#!/bin/bash
set -e
cd "$(dirname "$0")"
SRC="_mindy-ai-capability-for-servexo.md"
OUT_HTML="_cap.html"; OUT_PDF="Mindy-AI-Capability-Servexo-DLA.pdf"; CSS="_cap.css"
cat > "$CSS" <<'CSS'
body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:820px;margin:0 auto;padding:14px 26px;color:#1a1a1a;line-height:1.4;font-size:11.5px}
h1{font-size:18px;border-bottom:2px solid #1e3a8a;padding-bottom:5px;margin:0 0 6px;color:#1e3a8a;line-height:1.25}
h2{font-size:13px;color:#1e3a8a;margin:14px 0 4px;border-bottom:1px solid #e5e9f2;padding-bottom:2px;break-after:avoid}
p{margin:5px 0}
ul{margin:4px 0;padding-left:18px}
li{margin:2px 0}
strong{color:#111}
hr{display:none}
em{color:#555}
a{color:#1d4ed8;text-decoration:none}
@page{margin:0.5in}
CSS
pandoc "$SRC" --from gfm --to html5 --standalone --embed-resources --css "$CSS" -o "$OUT_HTML"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$OUT_PDF" "file://$(pwd)/$OUT_HTML" 2>/dev/null
rm -f "$OUT_HTML" "$CSS"
echo "✅ $OUT_PDF ($(du -h "$OUT_PDF" | cut -f1))"
