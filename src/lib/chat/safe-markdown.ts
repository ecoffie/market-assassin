/**
 * Safe markdown subset for Ask Mindy answers (2026-11-15: the map drawer showed **bold**, "- " bullets,
 * ### headings and raw [text](https://…) links literally, and long URLs ran off the bubble).
 *
 * SECURITY CONTRACT: the model's text is HTML-ESCAPED FIRST, then a small markdown subset is turned into
 * markup that this function writes itself. No model text ever reaches the output unescaped, so <script>,
 * event-handler attributes and markup injection come out as text. Links are emitted only for http(s) URLs;
 * any other scheme (javascript:, data:, vbscript:, …) renders as plain text. Links open in a new tab with
 * rel="noopener noreferrer" and show their text (a bare URL shows its host, not the full URL).
 *
 * Supported: **bold**, __bold__, *italic*, _italic_, `code`, # … ###### headings, "- " / "* " / "• "
 * bullets, "1." / "1)" numbered lists, [text](http…) links, bare http(s) URLs, blank-line paragraphs, and
 * GFM pipe tables (a header row, a |---| separator row, then body rows; cells get inline formatting).
 *
 * SELF-CONTAINED ON PURPOSE: no imports and no references outside the function body, because the map
 * page ships it to the browser via Function.prototype.toString (SAFE_MARKDOWN_SCRIPT below). Keep it
 * plain ES5-style so the serialized source runs in every browser without build helpers.
 */
export function renderSafeMarkdown(input: string): string {
  var MAX = 60000;
  var src = String(input == null ? '' : input).slice(0, MAX).replace(/\u0000/g, '').replace(/\r\n?/g, '\n');

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function unesc(s: string): string {
    return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  // An http(s) URL with no whitespace, quotes or angle brackets (checked on the UNESCAPED value).
  function safeHref(raw: string): string | null {
    var u = unesc(raw).trim();
    if (!/^https?:\/\/[^\s"'<>`]+$/i.test(u)) return null;
    return esc(u);
  }
  function hostOf(raw: string): string {
    var m = unesc(raw).match(/^https?:\/\/([^/?#\s]+)/i);
    return m ? esc(m[1].replace(/^www\./i, '')) : 'link';
  }

  // Inline formatting on ONE line of already-escaped text. Links are cut out into placeholders first so
  // their URLs are never touched by the emphasis rules (underscores in URLs are common).
  function inline(line: string): string {
    var slots: string[] = [];
    function keep(html: string): string { slots.push(html); return '\u0000' + (slots.length - 1) + '\u0000'; }
    var s = line;
    s = s.replace(/`([^`\n]{1,400})`/g, function (_m: string, code: string) { return keep('<code>' + code + '</code>'); });
    s = s.replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g, function (m: string, text: string, url: string) {
      var href = safeHref(url);
      return href ? keep('<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>') : text;
    });
    s = s.replace(/https?:\/\/[^\s<>"'`)\]]+/gi, function (url: string) {
      var trail = '';
      var mm = url.match(/[.,;:!?]+$/);
      if (mm) { trail = mm[0]; url = url.slice(0, -trail.length); }
      var href = safeHref(url);
      return href ? keep('<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + hostOf(url) + '</a>') + trail : url + trail;
    });
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_m: string, i: string) { return slots[Number(i)] || ''; });
  }

  var lines = esc(src).split('\n');
  var out: string[] = [];
  // List state. Items are written open ("<li>…") and closed lazily, so an indented bullet can nest inside
  // the open item and a blank line between items does not end the list. (2026-11-16: a numbered answer
  // with "- " sub-bullets or blank lines between items rendered as "1., 1., 1." because each one closed
  // the <ol> and opened a new one.)
  var list: 'ul' | 'ol' | null = null;
  var liOpen = false;
  var sub = false;
  var para: string[] = [];
  function flushPara() { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } }
  function closeSub() { if (sub) { out.push('</ul>'); sub = false; } }
  function closeItem() { closeSub(); if (liOpen) { out.push('</li>'); liOpen = false; } }
  function closeList() { closeItem(); if (list) { out.push('</' + list + '>'); list = null; } }
  function indentOf(l: string): number { var m = l.match(/^[ \t]*/); return m ? m[0].replace(/\t/g, '    ').length : 0; }
  var UL_RE = /^\s*(?:[-*+]|&#8226;|•)\s+(.+)$/;
  var OL_RE = /^\s*(\d{1,3})[.)]\s+(.+)$/;
  // After a blank line, does the next non-blank line carry on the current list?
  function listContinues(from: number): boolean {
    var n = from;
    while (n < lines.length && !lines[n].trim()) n++;
    if (n >= lines.length || !list) return false;
    var nl = lines[n];
    if (list === 'ol' && OL_RE.test(nl)) return true;
    if (list === 'ul' && UL_RE.test(nl) && !OL_RE.test(nl)) return true;
    return liOpen && indentOf(nl) >= 2 && UL_RE.test(nl);
  }
  // GFM pipe table helpers (operate on already-escaped lines; "|" is not touched by esc()).
  function isTableRow(l: string): boolean { return /^\s*\|.*\|\s*$/.test(l) || (l.indexOf('|') > 0 && /\S\s*\|\s*\S/.test(l)); }
  function isTableSep(l: string): boolean { return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l) && l.indexOf('-') >= 0; }
  function cells(l: string): string[] {
    var t = l.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
    return t.split('|').map(function (c: string) { return c.trim(); });
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara(); closeList();
      var head = cells(line);
      var cols = Math.min(head.length, 20);
      var rows: string[] = [];
      var j = i + 2;
      while (j < lines.length && lines[j].trim() && isTableRow(lines[j]) && rows.length < 500) {
        var rc = cells(lines[j]);
        var tds: string[] = [];
        for (var c = 0; c < cols; c++) tds.push('<td>' + inline(rc[c] || '') + '</td>');
        rows.push('<tr>' + tds.join('') + '</tr>');
        j++;
      }
      var ths: string[] = [];
      for (var k = 0; k < cols; k++) ths.push('<th>' + inline(head[k] || '') + '</th>');
      out.push('<div class="md-table"><table><thead><tr>' + ths.join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>');
      i = j - 1;
      continue;
    }
    var h = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    var ul = line.match(UL_RE);
    var ol = line.match(OL_RE);
    var ind = indentOf(line);
    if (!line.trim()) { flushPara(); if (!listContinues(i + 1)) closeList(); continue; }
    if (h) { flushPara(); closeList(); out.push('<div class="md-h md-h' + Math.min(h[1].length, 3) + '">' + inline(h[2]) + '</div>'); continue; }
    // An indented bullet under an open item nests inside it (one level), whatever the outer list type.
    if (ul && liOpen && ind >= 2) {
      flushPara();
      if (!sub) { out.push('<ul>'); sub = true; }
      out.push('<li>' + inline(ul[1]) + '</li>');
      continue;
    }
    if (ul) { flushPara(); if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } else closeItem(); out.push('<li>' + inline(ul[1])); liOpen = true; continue; }
    if (ol) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        var start = Number(ol[1]);
        out.push(start > 1 ? '<ol start="' + start + '">' : '<ol>');
        list = 'ol';
      } else closeItem();
      out.push('<li>' + inline(ol[2])); liOpen = true;
      continue;
    }
    // An indented plain line right under an open item continues that item.
    if (liOpen && ind >= 2) { closeSub(); out.push('<br>' + inline(line.trim())); continue; }
    closeList();
    para.push(inline(line));
  }
  flushPara(); closeList();
  return out.join('');
}

/** Browser copy for pages that cannot import modules (the Opportunity Map route's inline scripts). */
export const SAFE_MARKDOWN_SCRIPT = `<script>window.__mindyMd=${renderSafeMarkdown.toString()};</script>`;
