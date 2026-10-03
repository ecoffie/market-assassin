/**
 * Public-site primitives. Each one is a thin, server-renderable wrapper over an `mp-*` class
 * from src/lib/public-site/css.ts, so route migrations change presentation by swapping
 * elements, never by inventing new colours, fonts or spacing.
 */
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TableHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ── Layout ──────────────────────────────────────────────────────────────────

export function Container({
  width = 'content',
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { width?: 'content' | 'wide' | 'prose' }) {
  return (
    <div
      className={cx('mp-container', width === 'wide' && 'mp-container--wide', width === 'prose' && 'mp-container--prose', className)}
      {...rest}
    />
  );
}

export function Section({
  chapter = false,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { chapter?: boolean }) {
  return <section className={cx('mp-section', chapter && 'mp-section--chapter', className)} {...rest} />;
}

export function SectionHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="mp-section-h">
      <h2 className="mp-label">{title}</h2>
      {action}
    </div>
  );
}

export function Rule({ strong = false }: { strong?: boolean }) {
  return <hr className={cx('mp-rule', strong && 'mp-rule--strong')} />;
}

// ── Typography ──────────────────────────────────────────────────────────────

export function Eyebrow({
  accent = false,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { accent?: boolean }) {
  return <span className={cx('mp-eyebrow', accent && 'mp-eyebrow--accent', className)} {...rest} />;
}

export function Dateline({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx('mp-dateline', className)} {...rest} />;
}

type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4';
const HEADING_CLASS = { display: 'mp-display', title: 'mp-title', subtitle: 'mp-subtitle', label: 'mp-label' } as const;

/** `as` sets the document outline; `variant` sets the look. Keep them independent. */
export function Heading({
  as: Tag = 'h2',
  variant = 'title',
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & { as?: HeadingLevel; variant?: keyof typeof HEADING_CLASS }) {
  return <Tag className={cx(HEADING_CLASS[variant], className)} {...rest} />;
}

export function Standfirst({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx('mp-standfirst', className)} {...rest} />;
}

export function Meta({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('mp-meta', className)} {...rest} />;
}

/** Ledger figures: Plex Mono, tabular. */
export function Num({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('mp-num', className)} {...rest} />;
}

export function Prose({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('mp-prose', className)} {...rest} />;
}

// ── Links and buttons ───────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary';

export function ButtonLink({
  variant = 'primary',
  size,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: 'sm' }) {
  return <a className={cx('mp-btn', `mp-btn--${variant}`, size === 'sm' && 'mp-btn--sm', className)} {...rest} />;
}

export function Button({
  variant = 'primary',
  size,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' }) {
  return (
    <button type={type} className={cx('mp-btn', `mp-btn--${variant}`, size === 'sm' && 'mp-btn--sm', className)} {...rest} />
  );
}

export function TextLink({
  quiet = false,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { quiet?: boolean }) {
  return <a className={cx('mp-link', quiet && 'mp-link--quiet', className)} {...rest} />;
}

// ── Cards, panels, stats, chips ─────────────────────────────────────────────

export function CardGrid({
  columns = 3,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { columns?: 2 | 3 }) {
  return <div className={cx('mp-cards', columns === 2 && 'mp-cards--2', className)} {...rest} />;
}

export function Card({ href, className, children }: { href?: string; className?: string; children: ReactNode }) {
  if (href) {
    return (
      <a href={href} className={cx('mp-card', className)}>
        {children}
      </a>
    );
  }
  return <div className={cx('mp-card', className)}>{children}</div>;
}

export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('mp-panel', className)} {...rest} />;
}

export function StatRow({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('mp-stats', className)} {...rest} />;
}

export function Stat({ value, label, href }: { value: ReactNode; label: ReactNode; href?: string }) {
  const inner = (
    <>
      <div className="mp-stat-v">{value}</div>
      <div className="mp-stat-l">{label}</div>
    </>
  );
  return href ? (
    <a href={href} className="mp-stat">
      {inner}
    </a>
  ) : (
    <div className="mp-stat">{inner}</div>
  );
}

/** Status chips. `warn` and `ok` are status colours; there is deliberately no accent chip. */
export function Chip({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'warn' | 'ok' }) {
  return <span className={cx('mp-chip', tone !== 'neutral' && `mp-chip--${tone}`, className)} {...rest} />;
}

export function Breadcrumbs({ items }: { items: Array<{ label: ReactNode; href?: string }> }) {
  return (
    <nav className="mp-crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, i) => (
          <li key={i}>
            {item.href && i < items.length - 1 ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span aria-current={i === items.length - 1 ? 'page' : undefined}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ── Forms ───────────────────────────────────────────────────────────────────

export function Field({
  label,
  help,
  htmlFor,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="mp-field">
      <label className="mp-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help && <span className="mp-field-help">{help}</span>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('mp-input', className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('mp-select', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('mp-textarea', className)} {...rest} />;
}

// ── Tables and code ─────────────────────────────────────────────────────────

export function Table({ className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cx('mp-table', className)} {...rest} />;
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="mp-code">
      <code>{children}</code>
    </pre>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="mp-code-inline">{children}</code>;
}
