'use client';

/**
 * MindyInsightCard — daily quote card rendered client-side via Canvas.
 *
 * Content Reaper pattern #1 (visual quote cards) ported for in-app
 * surfaces only. Browser does the Canvas rendering — no Vercel OG,
 * no Puppeteer, no Supabase Storage. Just canvas.toDataURL('image/png').
 *
 * Themes cycle by day-of-week (4 Mindy-palette gradients). Single
 * layout — variety comes from the theme rotation, not 5 layout shapes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getMIApiHeaders } from './authHeaders';

interface InsightData {
  quote: string;
  format: string;
  source: 'ai_briefing' | 'deterministic_data' | 'fallback';
  attribution?: string;
  themeIndex: number;
  insightDate: string;
}

interface MindyInsightCardProps {
  email: string | null;
}

const THEMES: Array<{
  bg1: string; bg2: string; accent: string; ink: string; sub: string;
}> = [
  // 0 — navy → purple (default Mindy gradient)
  { bg1: '#0f172a', bg2: '#581c87', accent: '#a78bfa', ink: '#f8fafc', sub: '#cbd5e1' },
  // 1 — emerald → navy
  { bg1: '#022c22', bg2: '#0f172a', accent: '#34d399', ink: '#f8fafc', sub: '#a7f3d0' },
  // 2 — purple → magenta
  { bg1: '#4c1d95', bg2: '#831843', accent: '#f472b6', ink: '#f8fafc', sub: '#fbcfe8' },
  // 3 — slate → blue
  { bg1: '#1e293b', bg2: '#1e40af', accent: '#60a5fa', ink: '#f8fafc', sub: '#bfdbfe' },
];

export function MindyInsightCard({ email }: MindyInsightCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hidden, setHidden] = useState(false);

  const fetchInsight = useCallback(async (force = false) => {
    if (!email) {
      setLoading(false);
      return;
    }
    try {
      // Pass the user's LOCAL date so the daily insight rotates at THEIR
      // midnight, not UTC midnight (which flipped mid-evening for US users
      // and made the card look "stuck all day").
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const url = `/api/app/dashboard/insight?email=${encodeURIComponent(email)}&localDate=${localDate}${force ? '&refresh=1' : ''}`;
      const res = await fetch(url, { headers: getMIApiHeaders(email) });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.insight) setInsight(data.insight);
    } catch {
      // silently fail — card just won't render
    }
  }, [email]);

  // Fetch today's insight on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchInsight(false);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fetchInsight]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchInsight(true);
    setRefreshing(false);
  }, [fetchInsight]);

  // Render the canvas whenever insight changes
  useEffect(() => {
    if (!insight || !canvasRef.current) return;
    drawCard(canvasRef.current, insight);
  }, [insight]);

  if (hidden || (!loading && !insight)) return null;

  return (
    <div className="relative rounded-2xl overflow-hidden shadow-lg shadow-purple-900/20 border border-white/5 mb-6 bg-slate-900">
      {/* Refresh — force a new insight on demand (bypasses the daily
          cache). The card is otherwise pinned per-day by design. */}
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="absolute top-2 right-10 z-10 text-white/60 hover:text-white text-sm leading-none w-6 h-6 flex items-center justify-center rounded-full bg-black/30 hover:bg-black/50 disabled:opacity-50"
        aria-label="New insight"
        title="Show a different insight"
      >
        <span className={refreshing ? 'inline-block animate-spin' : ''}>↻</span>
      </button>
      {/* Dismiss */}
      <button
        onClick={() => setHidden(true)}
        className="absolute top-2 right-2 z-10 text-white/60 hover:text-white text-lg leading-none w-6 h-6 flex items-center justify-center rounded-full bg-black/30 hover:bg-black/50"
        aria-label="Hide insight"
        title="Hide for this session"
      >
        ×
      </button>

      {/* Loading shimmer */}
      {loading && (
        <div className="h-[110px] bg-gradient-to-br from-slate-800 to-slate-900 animate-pulse" />
      )}

      {/* The Canvas — 1200x200 = aspect ratio 6:1, ~half the previous
          vertical footprint per Eric (2026-05-27): "i think its too
          large probably half size". */}
      <canvas
        ref={canvasRef}
        width={1200}
        height={200}
        className={`block w-full h-auto ${loading ? 'hidden' : ''}`}
        aria-label={insight?.quote || 'Mindy Insight'}
      />

      {/* Source attribution + share button (small footer below the canvas) */}
      {insight && (
        <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-400">
          <span>
            💡 Mindy Insight ·{' '}
            <span className="text-slate-500">
              {insight.source === 'ai_briefing' ? 'from today\'s briefing' :
               insight.source === 'deterministic_data' ? 'from your data' :
               'federal contracting'}
            </span>
            {insight.attribution && <span className="text-slate-500"> · {insight.attribution}</span>}
          </span>
          <button
            onClick={() => copyCardImage(canvasRef.current)}
            className="text-slate-400 hover:text-emerald-300 transition"
            title="Copy as image"
          >
            ⎘ Copy
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Canvas drawing ------------------------------------------------

function drawCard(canvas: HTMLCanvasElement, insight: InsightData) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Honor device pixel ratio for sharper text on retina
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = 1200;
  const cssHeight = 200;  // halved from 400 per Eric's "too large" feedback
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.scale(dpr, dpr);

  const theme = THEMES[insight.themeIndex % THEMES.length];

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, cssWidth, cssHeight);
  grad.addColorStop(0, theme.bg1);
  grad.addColorStop(1, theme.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // Compact-layout constants tuned for 200px height
  const PAD_X = 48;
  const TOP_Y = 28;

  // Subtle accent line top-left
  ctx.fillStyle = theme.accent;
  ctx.fillRect(PAD_X, TOP_Y, 40, 3);

  // Eyebrow label — smaller for the compact layout
  ctx.fillStyle = theme.accent;
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('MINDY INSIGHT', PAD_X, TOP_Y + 12);

  // Quote text — autosize based on length, tighter range for compact card
  const quote = insight.quote;
  let fontSize = 36;
  if (quote.length > 60) fontSize = 30;
  if (quote.length > 100) fontSize = 24;
  if (quote.length > 140) fontSize = 20;
  ctx.fillStyle = theme.ink;
  ctx.font = `700 ${fontSize}px Georgia, "Times New Roman", serif`;

  // Word-wrap manually
  const maxWidth = cssWidth - PAD_X * 2;
  const words = quote.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (ctx.measureText(candidate).width > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  // Vertically center the block of lines below the eyebrow,
  // above the footer
  const lineHeight = fontSize * 1.15;
  const blockHeight = lines.length * lineHeight;
  const quoteRegionTop = TOP_Y + 32;
  const quoteRegionBottom = cssHeight - 28;
  const startY = quoteRegionTop + Math.max(0, (quoteRegionBottom - quoteRegionTop - blockHeight) / 2);

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], PAD_X, startY + i * lineHeight);
  }

  // Footer brand (smaller, tucked at bottom)
  ctx.fillStyle = theme.sub;
  ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText('mindy', PAD_X, cssHeight - 14);

  // Format pill in top-right — smaller
  if (insight.format) {
    const pillText = insight.format.toUpperCase();
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'top';
    const pillW = ctx.measureText(pillText).width + 18;
    const pillX = cssWidth - PAD_X - pillW;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, pillX, TOP_Y + 8, pillW, 20, 10);
    ctx.fill();
    ctx.fillStyle = theme.sub;
    ctx.fillText(pillText, pillX + 9, TOP_Y + 13);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function copyCardImage(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  try {
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
    });
  } catch (err) {
    // Fallback: download instead
    try {
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `mindy-insight-${new Date().toISOString().split('T')[0]}.png`;
      link.click();
    } catch {
      console.error('Copy failed:', err);
    }
  }
}
