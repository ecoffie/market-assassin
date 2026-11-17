'use client';

/**
 * Word-style proposal editor with Ask Mindy beside it (owner request 2026-11-17, mockup approved).
 *
 *  - LEFT: the proposal's sections with a status dot; click to jump.
 *  - CENTER: one white letter-size page per proposal, one editable block per section. Formatting
 *    (styles, bold/italic/underline, lists) uses the browser's editing commands; every paste and
 *    every saved draft passes through sanitizeEditorHtml, so only the safe subset is ever stored.
 *  - RIGHT: Ask Mindy — Draft this section, Check against the RFP, Add past performance, Find an
 *    image, Rewrite with Mindy (selection), free chat. Answers come back with Replace / Insert.
 *  - Images: free-to-use search (Wikimedia Commons + Openverse) with the credit line in the
 *    caption, or upload your own (downscaled in the browser).
 *  - Export: PDF and Word built in the browser from the same blocks, plus the existing full
 *    submission package (.docx) when the panel offers it.
 *
 * Edits autosave per section (POST /api/app/proposal/drafts) and are also handed to the parent as
 * plain text, so the compliance scan and the package export keep reading the edited words.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, ChevronLeft, Copy, Download, Image as ImageIcon, Italic, List, ListOrdered, Loader2, Redo2,
  Search, Send, Sparkles, Underline, Undo2, Upload, X,
} from 'lucide-react';
import { authedFetch } from '../authHeaders';
import {
  countWords, figureHtml, htmlToText, sanitizeEditorHtml, textToHtml,
} from '@/lib/proposal/editor-html';
import { buildDocx, buildPdf, exportFileName, type DocFont, type LoadedImage } from '@/lib/proposal/export-document';
import { isProxyableImageUrl, type ImageResult } from '@/lib/proposal/image-search';
import { streamProposalChat, type ProposalChatTurn } from '@/lib/proposal/chat-stream';

export interface EditorSectionDef { id: string; label: string; targetWords: number }
export interface EditorDraft { draft: string; html?: string; wordCount?: number; generatedAt: number }

interface Props {
  email: string;
  title: string;
  subtitle?: string;
  pipelineId?: string | null;
  rfpText: string;
  rfpFileName: string;
  /** The file name drafts are archived under (draft-all's `fileName`); edits save to the same batch. */
  saveFileName: string;
  sections: EditorSectionDef[];
  drafts: Record<string, EditorDraft | undefined>;
  onSectionChange: (id: string, text: string, html: string) => void;
  onDraftSection?: (id: string) => Promise<void> | void;
  draftingSection?: string | null;
  canDraft: boolean;
  draftError?: string | null;
  complianceSummary?: { done: number; total: number } | null;
  onExportPackage?: () => void;
  exportingPackage?: boolean;
  onClose: () => void;
}

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
type Msg = { role: 'user' | 'assistant'; content: string; done: boolean; target?: 'replace' | 'insert'; error?: boolean };

const WORDS_PER_PAGE = 500;
const PREFS_KEY = 'mindy_proposal_editor_prefs';

function readPrefs(): { font: DocFont; size: number } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { font: p.font === 'arial' ? 'arial' : 'times', size: [10, 11, 12].includes(p.size) ? p.size : 12 };
  } catch { return { font: 'times', size: 12 }; }
}

/** Any image source → JPEG data URL + size (remote images go through the same-origin proxy). */
async function loadImageAsJpeg(src: string): Promise<LoadedImage | null> {
  let url = src;
  if (!src.startsWith('data:')) {
    if (!isProxyableImageUrl(src)) return null;
    url = `/api/app/proposal/image-proxy?url=${encodeURIComponent(src)}`;
  }
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try { await img.decode(); } catch { return null; }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: canvas.width, height: canvas.height };
}

/** An uploaded picture, downscaled to at most 1600px on its long side. */
async function fileToDataUrl(file: File): Promise<string | null> {
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─────────────────────────── one editable section ─────────────────────────── */

function SectionEditable({
  id, html, font, size, onInput, onFocus, registerRef, onSelectionChange,
}: {
  id: string; html: string; font: DocFont; size: number;
  onInput: (id: string, html: string) => void;
  onFocus: (id: string) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  onSelectionChange: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Only push html into the DOM when it differs (a new draft, an inserted image) — never on the
  // user's own typing, or the caret would jump.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }, [html]);

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dt = e.clipboardData;
    const file = Array.from(dt.files || []).find((f) => f.type.startsWith('image/'));
    if (file) {
      fileToDataUrl(file).then((src) => { if (src) document.execCommand('insertHTML', false, figureHtml(src, '', '')); });
      return;
    }
    const rich = dt.getData('text/html');
    const plain = dt.getData('text/plain');
    const clean = rich ? sanitizeEditorHtml(rich) : textToHtml(plain);
    document.execCommand('insertHTML', false, clean);
  };

  return (
    <div
      ref={(el) => { ref.current = el; registerRef(id, el); }}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Section text"
      spellCheck
      onInput={() => ref.current && onInput(id, ref.current.innerHTML)}
      onFocus={() => onFocus(id)}
      onKeyUp={onSelectionChange}
      onMouseUp={onSelectionChange}
      onPaste={onPaste}
      className="mindy-doc outline-none min-h-[3em]"
      style={{
        fontFamily: font === 'arial' ? 'Arial, Helvetica, sans-serif' : '"Times New Roman", Times, serif',
        fontSize: `${size}pt`,
        lineHeight: 1.5,
        color: '#1b2430',
      }}
    />
  );
}

/* ─────────────────────────────────── editor ─────────────────────────────────── */

export default function ProposalEditor(props: Props) {
  const {
    email, title, subtitle, pipelineId, rfpText, rfpFileName, saveFileName, sections, drafts,
    onSectionChange, onDraftSection, draftingSection, canDraft, draftError, complianceSummary,
    onExportPackage, exportingPackage, onClose,
  } = props;

  // Full-screen editor: the page behind it does not scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Enter makes a new paragraph (<p>), not a <div>, so the page, the save and the export agree.
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* older browsers */ }
    return () => { document.body.style.overflow = prev; };
  }, []);

  const [prefs, setPrefs] = useState<{ font: DocFont; size: number }>({ font: 'times', size: 12 });
  useEffect(() => { setPrefs(readPrefs()); }, []);
  const setPref = (p: Partial<{ font: DocFont; size: number }>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...p };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* optional */ }
      return next;
    });
  };

  // html per section, rebuilt from the draft text whenever a NEW draft arrives (generatedAt moves).
  const [html, setHtml] = useState<Record<string, string>>({});
  const stampRef = useRef<Record<string, number>>({});
  const [redrafted, setRedrafted] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const fresh: Record<string, string> = {};
    const rebuilt: Record<string, string> = {};
    for (const s of sections) {
      const d = drafts[s.id];
      if (!d) continue;
      const prevStamp = stampRef.current[s.id];
      if (prevStamp === d.generatedAt) continue;
      stampRef.current[s.id] = d.generatedAt;
      const h = d.html ? sanitizeEditorHtml(d.html) : textToHtml(d.draft || '');
      fresh[s.id] = h;
      // A NEW draft replaced a section that was already open: save it, so a reload keeps it.
      if (prevStamp !== undefined) rebuilt[s.id] = h;
    }
    if (Object.keys(fresh).length) setHtml((prev) => ({ ...prev, ...fresh }));
    if (Object.keys(rebuilt).length) setRedrafted(rebuilt);
  }, [drafts, sections]);

  const [active, setActive] = useState<string>(sections[0]?.id || '');
  useEffect(() => {
    if (!sections.some((s) => s.id === active) && sections[0]) setActive(sections[0].id);
  }, [sections, active]);
  const activeDef = sections.find((s) => s.id === active) || sections[0];

  /* ── autosave ── */
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Set<string>>(new Set());
  const saveSection = useCallback(async (id: string, sectionHtml: string) => {
    const def = sections.find((s) => s.id === id);
    const text = htmlToText(sectionHtml);
    setSaveState('saving');
    try {
      const res = await authedFetch(`/api/app/proposal/drafts?email=${encodeURIComponent(email)}`, email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: id, label: def?.label || id, fileName: saveFileName, html: sectionHtml, text }),
      });
      pending.current.delete(id);
      setSaveState(res.ok ? (pending.current.size ? 'unsaved' : 'saved') : 'error');
    } catch {
      setSaveState('error');
    }
  }, [email, saveFileName, sections]);

  const editorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => { editorRefs.current[id] = el; }, []);

  useEffect(() => {
    if (!redrafted) return;
    for (const [id, h] of Object.entries(redrafted)) void saveSection(id, h);
    setRedrafted(null);
  }, [redrafted, saveSection]);

  const latestHtml = useRef<Record<string, string>>({});
  const changeSection = useCallback((id: string, sectionHtml: string) => {
    latestHtml.current[id] = sectionHtml;
    // A section typed from scratch: the parent creates its draft with generatedAt 0, so mark it
    // as already in sync and the editor never resets the text under the caret.
    if (stampRef.current[id] === undefined) stampRef.current[id] = 0;
    setHtml((prev) => ({ ...prev, [id]: sectionHtml }));
    onSectionChange(id, htmlToText(sectionHtml), sectionHtml);
    pending.current.add(id);
    setSaveState('unsaved');
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => saveSection(id, sectionHtml), 1500);
  }, [onSectionChange, saveSection]);

  // Flush pending saves when the editor closes.
  useEffect(() => () => {
    for (const id of Array.from(pending.current)) {
      clearTimeout(timers.current[id]);
      const latest = latestHtml.current[id];
      if (latest !== undefined) void saveSection(id, latest);
    }
  }, [saveSection]);

  /* ── selection (for Rewrite / image insert at the caret) ── */
  const savedRange = useRef<Range | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const captureSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const host = Object.values(editorRefs.current).find((el) => el && el.contains(range.commonAncestorContainer));
    if (!host) return;
    savedRange.current = range.cloneRange();
    setSelectedText(sel.toString().trim());
  }, []);
  useEffect(() => {
    const onSel = () => captureSelection();
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [captureSelection]);

  const restoreRange = (): boolean => {
    const r = savedRange.current;
    if (!r) return false;
    const host = Object.values(editorRefs.current).find((el) => el && el.contains(r.commonAncestorContainer));
    if (!host) return false;
    host.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    return true;
  };

  /**
   * Insert BLOCKS (paragraphs, a figure) after the paragraph holding the caret in section `id`, or
   * at the end of it. Done on the DOM rather than with insertHTML: the browser would put a figure or
   * several paragraphs INSIDE the current paragraph, which breaks the caption and the export.
   */
  const insertIntoSection = (id: string, fragment: string) => {
    const el = editorRefs.current[id];
    if (!el) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = sanitizeEditorHtml(fragment) || fragment;
    const r = savedRange.current;
    let block: Node | null = r && el.contains(r.endContainer) ? r.endContainer : null;
    while (block && block.parentNode !== el) block = block.parentNode;
    const nodes = Array.from(tpl.content.childNodes);
    if (block) {
      let after: Node = block;
      for (const n of nodes) { el.insertBefore(n, after.nextSibling); after = n; }
    } else {
      for (const n of nodes) el.appendChild(n);
    }
    changeSection(id, el.innerHTML);
    savedRange.current = null;
  };

  const exec = (cmd: string, value?: string) => {
    restoreRange();
    document.execCommand(cmd, false, value);
    const el = editorRefs.current[active];
    if (el) changeSection(active, el.innerHTML);
  };

  const scrollTo = (id: string) => {
    setActive(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ── counts ── */
  const words = useMemo(() => {
    const per: Record<string, number> = {};
    for (const s of sections) per[s.id] = countWords(htmlToText(html[s.id] || ''));
    return per;
  }, [html, sections]);
  const totalWords = Object.values(words).reduce((a, b) => a + b, 0);
  const pages = Math.max(1, Math.ceil(totalWords / WORDS_PER_PAGE));

  /* ── Ask Mindy ── */
  const [tab, setTab] = useState<'ask' | 'images'>('ask');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const replaceRangeRef = useRef<Range | null>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight }); }, [messages]);

  const ask = async (shown: string, prompt: string, target: Msg['target']) => {
    if (streaming) return;
    if (target === 'replace') replaceRangeRef.current = savedRange.current?.cloneRange() || null;
    const history: ProposalChatTurn[] = messages.filter((m) => m.done && !m.error).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: shown, done: true }, { role: 'assistant', content: '', done: false, target }]);
    setStreaming(true);
    try {
      await streamProposalChat({
        email, message: prompt, rfpText, rfpFileName, history, pipelineId,
        onToken: (t) => setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + t };
          return next;
        }),
      });
      setMessages((prev) => { const next = [...prev]; next[next.length - 1] = { ...next[next.length - 1], done: true }; return next; });
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: (e as Error).message || 'Mindy could not answer. Try again.', done: true, error: true };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  };

  const sectionText = (id: string) => htmlToText(html[id] || '');
  const label = activeDef?.label || 'this section';
  const quick = {
    check: () => ask(
      `Check "${label}" against the RFP`,
      `Check my "${label}" section against the solicitation's requirements. List anything the RFP asks for that this section is missing or only partly covers, as short bullets, each with the RFP reference if there is one. If it covers everything, say so.\n\nMy section:\n\n${sectionText(active) || '(empty)'}`,
      undefined,
    ),
    pastPerf: () => ask(
      `Add past performance to "${label}"`,
      `Write one or two short paragraphs for my "${label}" section that cite my most relevant past performance from my Vault (contract, agency, what we delivered, results). Use only contracts that are in my Vault and write [CONFIRM] where a detail is missing. Reply with only the text to insert.`,
      'insert',
    ),
    rewrite: () => {
      if (!selectedText) return;
      setTab('ask');
      void ask(
        `Rewrite: "${selectedText.slice(0, 120)}${selectedText.length > 120 ? '…' : ''}"`,
        `Rewrite this text from my "${label}" section so it is clearer, stronger and more specific to the solicitation. Keep every fact and do not add new facts. Reply with only the rewritten text.\n\n"""${selectedText}"""`,
        'replace',
      );
    },
  };

  const sendChat = () => {
    const m = chatInput.trim();
    if (!m) return;
    setChatInput('');
    void ask(m, `[I'm working on the "${label}" section of my proposal.]\n\n${m}`, 'insert');
  };

  const applyAnswer = (msg: Msg, how: 'replace' | 'insert') => {
    const frag = textToHtml(msg.content.trim());
    if (how === 'replace' && replaceRangeRef.current) {
      savedRange.current = replaceRangeRef.current;
      const host = Object.entries(editorRefs.current).find(([, el]) => el && el.contains(replaceRangeRef.current!.commonAncestorContainer));
      if (host && restoreRange()) {
        // One paragraph replaces the selection inline; several become blocks of their own.
        const single = /^<p>((?:(?!<\/?p>)[\s\S])*)<\/p>$/.exec(frag);
        document.execCommand('insertHTML', false, single ? single[1] : frag);
        changeSection(host[0], sanitizeEditorHtml(host[1]!.innerHTML));
        replaceRangeRef.current = null;
        return;
      }
    }
    insertIntoSection(active, frag);
  };

  const draftActive = async () => {
    if (!onDraftSection || !activeDef) return;
    if ((words[active] || 0) > 0 && !window.confirm(`Replace what's in "${activeDef.label}" with a new draft from Mindy?`)) return;
    await onDraftSection(active);
  };

  /* ── images ── */
  const [imgQuery, setImgQuery] = useState('');
  const [imgResults, setImgResults] = useState<ImageResult[] | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgUnavailable, setImgUnavailable] = useState<string[]>([]);
  const [picked, setPicked] = useState<ImageResult | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const searchImages = async (q = imgQuery) => {
    const query = q.trim();
    if (query.length < 2) return;
    setImgLoading(true);
    setImgError(null);
    setPicked(null);
    try {
      const res = await authedFetch(`/api/app/proposal/images?email=${encodeURIComponent(email)}&q=${encodeURIComponent(query)}`, email);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) { setImgError(data?.error || 'Image search failed. Try again.'); setImgResults(null); return; }
      setImgResults(data.results || []);
      setImgUnavailable(data.unavailable || []);
    } catch {
      setImgError('Image search failed. Try again.');
    } finally {
      setImgLoading(false);
    }
  };

  const openImages = () => {
    setTab('images');
    if (!imgQuery) {
      const q = title.replace(/[—–-].*$/, '').split(/\s+/).slice(0, 5).join(' ');
      setImgQuery(q);
      if (q.length >= 2) void searchImages(q);
    }
  };

  const insertPicked = () => {
    if (!picked) return;
    const caption = `${picked.title ? `${picked.title}. ` : ''}${picked.credit}`;
    insertIntoSection(active, figureHtml(picked.imageUrl, picked.title, caption));
    setPicked(null);
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const src = await fileToDataUrl(file);
    if (!src) { setImgError('That file is not a picture we can use. Try a JPG or PNG.'); return; }
    insertIntoSection(active, figureHtml(src, file.name.replace(/\.[^.]+$/, ''), ''));
  };

  /* ── export ── */
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<null | 'pdf' | 'docx'>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const runExport = async (kind: 'pdf' | 'docx') => {
    setExportOpen(false);
    setExporting(kind);
    setExportError(null);
    try {
      const input = {
        title,
        subtitle,
        sections: sections.map((s) => ({ label: s.label, html: editorRefs.current[s.id]?.innerHTML ?? html[s.id] ?? '' })),
        font: prefs.font,
        fontSize: prefs.size,
        loadImage: loadImageAsJpeg,
      };
      const blob = kind === 'pdf' ? await buildPdf(input) : await buildDocx(input);
      download(blob, exportFileName(title, kind));
    } catch (e) {
      console.error('[ProposalEditor] export failed', e);
      setExportError('Export failed. Try again.');
    } finally {
      setExporting(null);
    }
  };

  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'unsaved' ? 'Unsaved changes' : saveState === 'error' ? 'Not saved. Keep this tab open and try again.' : 'All changes saved';
  const statusDot = (id: string) => {
    if (draftingSection === id) return 'bg-[#b45309]';
    return (words[id] || 0) > 0 ? 'bg-[#22a06b]' : 'border-2 border-[#9aa5b1] bg-transparent';
  };
  const toolBtn = 'h-8 min-w-8 px-1.5 rounded-md inline-flex items-center justify-center gap-1.5 text-[13px] text-[#111c26] hover:bg-[#eff5ff] disabled:opacity-40';
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the editor's selection on toolbar clicks

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#eef1f5] text-[#111c26]" role="dialog" aria-modal="true" aria-label="Proposal editor" data-testid="proposal-editor">
      <style>{`
        .mindy-doc h2,.mindy-doc h3,.mindy-doc-title{font-family:inherit!important;letter-spacing:normal!important}
        .mindy-doc h2{font-size:1.4em;font-weight:700;margin:.8em 0 .3em}
        .mindy-doc h3{font-size:1.15em;font-weight:600;margin:.7em 0 .25em}
        .mindy-doc p{margin:0 0 .7em}
        .mindy-doc ul{list-style:disc;padding-left:1.6em;margin:0 0 .7em}
        .mindy-doc ol{list-style:decimal;padding-left:1.6em;margin:0 0 .7em}
        .mindy-doc figure{margin:.8em 0;text-align:center}
        .mindy-doc img{max-width:100%;max-height:4in;display:inline-block}
        .mindy-doc figcaption{font-size:.8em;font-style:italic;color:#5a6675;margin-top:.3em}
        .mindy-doc:empty:before{content:'Start typing, or ask Mindy to draft this section.';color:#8a95a3;font-style:italic}
      `}</style>

      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 h-14 bg-white border-b border-[#e6eaef] shrink-0">
        <button type="button" onClick={onClose} aria-label="Back to Proposal Assist" className="h-9 w-9 rounded-lg inline-flex items-center justify-center hover:bg-[#f0f3f7]">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold truncate">{title}</p>
          <p className="text-xs text-[#5a6675] truncate">{subtitle ? `${subtitle} · ` : ''}{saveLabel}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {complianceSummary && complianceSummary.total > 0 && (
            <span className="hidden md:inline text-[13px] font-semibold text-[#137a4e] bg-[#e8f6ef] rounded-full px-3 py-1.5">
              {complianceSummary.done} of {complianceSummary.total} requirements marked done
            </span>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              aria-expanded={exportOpen}
              disabled={!!exporting}
              className="h-9 px-4 rounded-lg bg-[#006aff] hover:bg-[#0057d1] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? 'Exporting…' : 'Export'}
            </button>
            {exportOpen && (
              <div role="menu" className="absolute right-0 top-11 z-30 w-72 bg-white border border-[#e6eaef] rounded-xl shadow-xl p-1.5">
                <button type="button" role="menuitem" onClick={() => runExport('pdf')} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[#eff5ff]">
                  <span className="block text-sm font-semibold">PDF (.pdf)</span>
                  <span className="block text-xs text-[#5a6675]">Ready to submit, laid out like the page</span>
                </button>
                <button type="button" role="menuitem" onClick={() => runExport('docx')} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[#eff5ff]">
                  <span className="block text-sm font-semibold">Word (.docx)</span>
                  <span className="block text-xs text-[#5a6675]">Keep editing in Microsoft Word</span>
                </button>
                {onExportPackage && (
                  <button type="button" role="menuitem" disabled={exportingPackage} onClick={() => { setExportOpen(false); onExportPackage(); }} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[#eff5ff] disabled:opacity-50">
                    <span className="block text-sm font-semibold">Full submission package (.docx)</span>
                    <span className="block text-xs text-[#5a6675]">Adds the compliance matrix and checklist</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 px-4 py-1.5 bg-white border-b border-[#e6eaef] shrink-0" role="toolbar" aria-label="Formatting">
        <label className="sr-only" htmlFor="pe-style">Text style</label>
        <select id="pe-style" defaultValue="" onMouseDown={() => captureSelection()} onChange={(e) => { if (e.target.value) exec('formatBlock', e.target.value); e.target.value = ''; }} className="h-8 rounded-md border border-[#d4dae2] bg-white px-2 text-[13px]">
          <option value="" disabled>Text style</option>
          <option value="p">Normal text</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>
        <label className="sr-only" htmlFor="pe-font">Font</label>
        <select id="pe-font" value={prefs.font} onChange={(e) => setPref({ font: e.target.value as DocFont })} className="h-8 rounded-md border border-[#d4dae2] bg-white px-2 text-[13px]">
          <option value="times">Times New Roman</option>
          <option value="arial">Arial</option>
        </select>
        <label className="sr-only" htmlFor="pe-size">Font size</label>
        <select id="pe-size" value={prefs.size} onChange={(e) => setPref({ size: Number(e.target.value) })} className="h-8 rounded-md border border-[#d4dae2] bg-white px-2 text-[13px]">
          {[10, 11, 12].map((n) => <option key={n} value={n}>{n} pt</option>)}
        </select>
        <span className="w-px h-6 bg-[#e6eaef] mx-1" />
        <button type="button" aria-label="Bold" onMouseDown={keep} onClick={() => exec('bold')} className={toolBtn}><Bold className="h-4 w-4" /></button>
        <button type="button" aria-label="Italic" onMouseDown={keep} onClick={() => exec('italic')} className={toolBtn}><Italic className="h-4 w-4" /></button>
        <button type="button" aria-label="Underline" onMouseDown={keep} onClick={() => exec('underline')} className={toolBtn}><Underline className="h-4 w-4" /></button>
        <span className="w-px h-6 bg-[#e6eaef] mx-1" />
        <button type="button" aria-label="Bulleted list" onMouseDown={keep} onClick={() => exec('insertUnorderedList')} className={toolBtn}><List className="h-4 w-4" /></button>
        <button type="button" aria-label="Numbered list" onMouseDown={keep} onClick={() => exec('insertOrderedList')} className={toolBtn}><ListOrdered className="h-4 w-4" /></button>
        <button type="button" onMouseDown={keep} onClick={openImages} className={toolBtn}><ImageIcon className="h-4 w-4" />Image</button>
        <span className="w-px h-6 bg-[#e6eaef] mx-1" />
        <button type="button" aria-label="Undo" onMouseDown={keep} onClick={() => exec('undo')} className={toolBtn}><Undo2 className="h-4 w-4" /></button>
        <button type="button" aria-label="Redo" onMouseDown={keep} onClick={() => exec('redo')} className={toolBtn}><Redo2 className="h-4 w-4" /></button>
        <span className="w-px h-6 bg-[#e6eaef] mx-1" />
        <button
          type="button"
          onMouseDown={keep}
          onClick={quick.rewrite}
          disabled={!selectedText || streaming}
          title={selectedText ? 'Rewrite the selected text' : 'Select some text first'}
          className="h-8 px-3 rounded-md bg-[#eff5ff] text-[#005ee0] text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />Rewrite with Mindy
        </button>
        <span className="ml-auto text-[13px] text-[#5a6675]">About {pages} page{pages === 1 ? '' : 's'}</span>
      </div>
      {(exportError || draftError) && (
        <div className="px-4 py-2 text-sm text-[#b42318] bg-[#fef3f2] border-b border-[#fecdca]">{exportError || draftError}</div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Sections */}
        <nav aria-label="Proposal sections" className="hidden md:flex w-60 shrink-0 flex-col gap-0.5 bg-white border-r border-[#e6eaef] p-3 overflow-y-auto">
          <span className="px-2 pb-2 text-xs font-bold tracking-wider uppercase text-[#5a6675]">Sections</span>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollTo(s.id)}
              aria-current={active === s.id ? 'true' : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${active === s.id ? 'bg-[#eff5ff] text-[#005ee0] font-semibold' : 'text-[#111c26] hover:bg-[#f7f9fb]'}`}
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${statusDot(s.id)}`} />
              <span className="truncate">{s.label}</span>
            </button>
          ))}
          <p className="mt-auto pt-3 border-t border-[#e6eaef] text-xs text-[#5a6675] flex flex-wrap gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#22a06b]" />Has text</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#b45309]" />Drafting</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border-2 border-[#9aa5b1]" />Empty</span>
          </p>
        </nav>

        {/* Page */}
        <main className="flex-1 min-w-0 overflow-y-auto px-4 py-7">
          <article className="mx-auto w-full max-w-[816px] bg-white shadow-[0_1px_3px_rgba(17,28,38,.12),0_8px_24px_rgba(17,28,38,.06)] px-6 sm:px-[72px] py-[72px]" style={{ fontFamily: prefs.font === 'arial' ? 'Arial, Helvetica, sans-serif' : '"Times New Roman", Times, serif' }}>
            <h1 className="mindy-doc-title text-[22px] font-bold mb-1">{title}</h1>
            {subtitle && <p className="text-sm text-[#5a6675] mb-6">{subtitle}</p>}
            {sections.map((s) => (
              <section key={s.id} id={`sec-${s.id}`} className="scroll-mt-4 mb-8">
                <div className="flex items-center gap-3 border-b border-[#e6eaef] pb-1 mb-3">
                  <h2 className="mindy-doc-title text-lg font-bold text-[#111c26]">{s.label}</h2>
                  <span className="ml-auto text-xs text-[#5a6675]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>{words[s.id] || 0} / {s.targetWords} words</span>
                </div>
                {draftingSection === s.id && (
                  <p className="mb-2 inline-flex items-center gap-2 text-sm text-[#b45309]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}><Loader2 className="h-4 w-4 animate-spin" />Mindy is drafting this section…</p>
                )}
                <SectionEditable
                  id={s.id}
                  html={html[s.id] ?? ''}
                  font={prefs.font}
                  size={prefs.size}
                  onInput={(id, h) => changeSection(id, h)}
                  onFocus={setActive}
                  registerRef={registerRef}
                  onSelectionChange={captureSelection}
                />
              </section>
            ))}
          </article>
        </main>

        {/* Ask Mindy */}
        <aside aria-label="Ask Mindy" className="hidden lg:flex w-[380px] shrink-0 flex-col bg-white border-l border-[#e6eaef] min-h-0">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#e6eaef]">
            <span className="h-8 w-8 rounded-lg bg-[#006aff] text-white inline-flex items-center justify-center"><Sparkles className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="text-[15px] font-bold">Ask Mindy</p>
              <p className="text-xs text-[#5a6675] truncate">Helping with: {label}</p>
            </div>
          </div>
          <div className="flex border-b border-[#e6eaef] px-2" role="tablist">
            {(['ask', 'images'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => (t === 'images' ? openImages() : setTab('ask'))}
                className={`px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tab === t ? 'border-[#006aff] text-[#005ee0]' : 'border-transparent text-[#5a6675] hover:text-[#111c26]'}`}>
                {t === 'ask' ? 'Ask Mindy' : 'Images'}
              </button>
            ))}
          </div>

          {tab === 'ask' ? (
            <>
              <div ref={chatScroll} className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={!canDraft || !onDraftSection || !!draftingSection} onClick={draftActive}
                    title={canDraft ? undefined : 'Load the solicitation first so Mindy has something to draft from'}
                    className="min-h-11 rounded-xl border border-[#cfe1ff] bg-[#eff5ff] text-[#005ee0] text-[13px] font-semibold text-left px-3 py-2 disabled:opacity-50">
                    {draftingSection === active ? 'Drafting…' : 'Draft this section'}
                  </button>
                  <button type="button" disabled={streaming} onClick={quick.check} className="min-h-11 rounded-xl border border-[#d4dae2] bg-white text-[13px] font-semibold text-left px-3 py-2 disabled:opacity-50">Check against the RFP</button>
                  <button type="button" disabled={streaming} onClick={quick.pastPerf} className="min-h-11 rounded-xl border border-[#d4dae2] bg-white text-[13px] font-semibold text-left px-3 py-2 disabled:opacity-50">Add past performance</button>
                  <button type="button" onClick={openImages} className="min-h-11 rounded-xl border border-[#d4dae2] bg-white text-[13px] font-semibold text-left px-3 py-2">Find an image</button>
                </div>
                {messages.length === 0 && (
                  <p className="text-sm text-[#5a6675] leading-relaxed">
                    Mindy reads the solicitation and your Vault. Select text on the page and press <b>Rewrite with Mindy</b>, or ask anything about this section below.
                  </p>
                )}
                {messages.map((m, i) => m.role === 'user' ? (
                  <div key={i} className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-[#eff5ff] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">{m.content}</div>
                ) : (
                  <div key={i} className={`max-w-[95%] rounded-2xl rounded-bl-md px-3 py-2.5 text-sm leading-relaxed ${m.error ? 'bg-[#fef3f2] text-[#b42318]' : 'bg-[#f4f6f9]'}`}>
                    <div className="whitespace-pre-wrap">{m.content || (m.done ? '' : <span className="inline-flex items-center gap-2 text-[#5a6675]"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</span>)}</div>
                    {m.done && !m.error && m.content.trim() && (
                      <div className="flex flex-wrap gap-2 mt-2.5">
                        {m.target === 'replace' && (
                          <button type="button" onClick={() => applyAnswer(m, 'replace')} className="h-9 px-3 rounded-lg bg-[#006aff] hover:bg-[#0057d1] text-white text-[13px] font-semibold">Replace</button>
                        )}
                        <button type="button" onClick={() => applyAnswer(m, 'insert')}
                          className={m.target === 'replace' ? 'h-9 px-3 rounded-lg border border-[#d4dae2] bg-white text-[13px] font-semibold' : 'h-9 px-3 rounded-lg bg-[#006aff] hover:bg-[#0057d1] text-white text-[13px] font-semibold'}>
                          Insert into {label}
                        </button>
                        <button type="button" onClick={() => navigator.clipboard?.writeText(m.content)} aria-label="Copy answer" className="h-9 w-9 rounded-lg inline-flex items-center justify-center text-[#5a6675] hover:bg-white"><Copy className="h-4 w-4" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); sendChat(); }} className="p-3 border-t border-[#e6eaef]">
                <label className="flex items-center gap-2 min-h-11 pl-3 pr-1.5 border border-[#d4dae2] rounded-xl focus-within:border-[#006aff]">
                  <span className="sr-only">Ask Mindy about this section</span>
                  <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask Mindy about this section…" className="flex-1 bg-transparent outline-none text-sm" />
                  <button type="submit" disabled={streaming || !chatInput.trim()} aria-label="Send" className="h-8 w-8 rounded-lg bg-[#006aff] text-white inline-flex items-center justify-center disabled:opacity-50"><Send className="h-4 w-4" /></button>
                </label>
              </form>
            </>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
              <form onSubmit={(e) => { e.preventDefault(); void searchImages(); }}>
                <label className="flex items-center gap-2 min-h-11 pl-3 pr-1.5 border border-[#d4dae2] rounded-xl focus-within:border-[#006aff]">
                  <Search className="h-4 w-4 text-[#5a6675]" aria-hidden />
                  <span className="sr-only">Search for an image</span>
                  <input value={imgQuery} onChange={(e) => setImgQuery(e.target.value)} placeholder="e.g. cutter in dry dock" className="flex-1 bg-transparent outline-none text-sm" />
                  <button type="submit" disabled={imgLoading} className="h-8 px-3 rounded-lg bg-[#006aff] text-white text-[13px] font-semibold disabled:opacity-50">Search</button>
                </label>
              </form>
              <p className="text-xs text-[#5a6675] leading-relaxed">Only pictures that are free to use in a proposal (public domain or open licenses). The credit line goes in the caption.</p>
              {imgError && <p className="text-sm text-[#b42318]">{imgError}</p>}
              {imgLoading && <p className="inline-flex items-center gap-2 text-sm text-[#5a6675]"><Loader2 className="h-4 w-4 animate-spin" />Searching…</p>}
              {!imgLoading && imgResults && imgResults.length === 0 && (
                <p className="text-sm text-[#5a6675]">{imgUnavailable.length >= 2 ? 'Image search is unavailable right now. Try again in a minute, or upload your own.' : 'No free-to-use pictures matched those words. Try fewer or different words.'}</p>
              )}
              {!imgLoading && imgResults && imgResults.length > 0 && imgUnavailable.length === 1 && (
                <p className="text-xs text-[#92400e]">One image source did not answer, so you may see fewer results.</p>
              )}
              {imgResults && imgResults.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {imgResults.map((r) => (
                    <button key={r.id} type="button" onClick={() => setPicked(r)} aria-pressed={picked?.id === r.id}
                      className={`rounded-xl overflow-hidden bg-white text-left flex flex-col ${picked?.id === r.id ? 'ring-2 ring-[#006aff]' : 'border border-[#e6eaef]'}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.thumbUrl} alt={r.title || 'Search result'} loading="lazy" referrerPolicy="no-referrer" className="h-24 w-full object-cover bg-[#e6eaef]" />
                      <span className="px-2 py-1.5 text-[11px] leading-snug text-[#5a6675]">
                        <span className="block truncate text-[#111c26]">{r.title || 'Untitled'}</span>
                        {r.sourceLabel} · {r.license}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!picked} onClick={insertPicked} className="h-10 px-4 rounded-lg bg-[#006aff] hover:bg-[#0057d1] text-white text-[13px] font-semibold disabled:opacity-50">Insert into page</button>
                <button type="button" onClick={() => uploadRef.current?.click()} className="h-10 px-4 rounded-lg border border-[#d4dae2] bg-white text-[13px] font-semibold inline-flex items-center gap-2"><Upload className="h-4 w-4" />Upload your own</button>
                {picked?.pageUrl && <a href={picked.pageUrl} target="_blank" rel="noopener noreferrer" className="h-10 px-2 inline-flex items-center text-[13px] font-semibold text-[#005ee0]">License details</a>}
                {picked && <button type="button" onClick={() => setPicked(null)} aria-label="Clear selection" className="h-10 w-10 rounded-lg inline-flex items-center justify-center text-[#5a6675] hover:bg-[#f7f9fb]"><X className="h-4 w-4" /></button>}
              </div>
              <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={onUpload} />
            </div>
          )}
        </aside>
      </div>

      {/* Status bar */}
      <footer className="flex items-center gap-5 px-4 h-8 bg-white border-t border-[#e6eaef] text-xs text-[#5a6675] shrink-0">
        <span>About {pages} page{pages === 1 ? '' : 's'}</span>
        <span>{totalWords.toLocaleString()} words</span>
        {activeDef && <span className="hidden sm:inline">{activeDef.label}: {words[active] || 0} of {activeDef.targetWords} words</span>}
      </footer>
    </div>
  );
}
