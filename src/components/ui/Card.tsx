/**
 * Card — the single card/panel surface primitive (Phase 3, de-vibe-coding, Jul 2026).
 *
 * Collapses the ~100 hand-copied `bg-slate-900 border border-slate-800 rounded-xl`
 * shells into ONE owner. This file is the SANCTIONED home for the card shell's raw
 * color/radius classes (like globals.css owns the hex tokens) — new code should reach
 * for <Card> instead of re-typing the shell, so the surface stays consistent.
 *
 * Visual NO-OP: renders exactly today's dominant card (ground fill, slate-800 hairline,
 * rounded-card corners). Variants:
 *   - as:        element tag (default 'div')
 *   - padding:   'none' | 'sm' | 'md' (default) | 'lg'  → p-0 / p-3 / p-5 / p-6
 *   - interactive: adds hover-lift (border brightens + shadow-raised) for clickable cards
 *   - elevation: 'flat' (default) | 'raised'          → shadow-raised at rest
 * Any className is appended, so per-card accents (e.g. an emerald ring) still work.
 */
import type { ElementType, ReactNode, HTMLAttributes } from 'react';

type Padding = 'none' | 'sm' | 'md' | 'lg';

const PAD: Record<Padding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6',
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  padding?: Padding;
  interactive?: boolean;
  elevation?: 'flat' | 'raised';
  children?: ReactNode;
  className?: string;
}

export default function Card({
  as: Tag = 'div',
  padding = 'md',
  interactive = false,
  elevation = 'flat',
  className = '',
  children,
  ...rest
}: CardProps) {
  const base = 'bg-slate-900 border border-slate-800 rounded-card';
  const rest_ = [
    elevation === 'raised' ? 'shadow-raised' : '',
    interactive
      ? 'transition-colors hover:border-slate-700 hover:shadow-raised cursor-pointer'
      : '',
    PAD[padding],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={`${base} ${rest_}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

/** CardHeader — optional title/subtitle/actions row for consistent card tops. */
export function CardHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`.trim()}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
