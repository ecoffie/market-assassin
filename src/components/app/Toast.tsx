'use client';

/**
 * Toast notification system for /app.
 *
 * Linear / Vercel / Notion pattern:
 *   - bottom-right stack, newest on top
 *   - auto-dismiss after 5s (configurable)
 *   - optional Undo button (or any single action) that fires a callback
 *     before the toast disappears
 *   - success / error / info variants (color only — same shape)
 *
 * Usage:
 *   1. Wrap your panel tree in <ToastHost> (already done at /app root).
 *   2. In any child, call:
 *        const { showToast } = useToast();
 *        showToast({
 *          message: 'Added to Pipeline',
 *          action: { label: 'Undo', onClick: () => deleteIt(id) },
 *        });
 *
 * The hook never throws if there's no provider — it returns a no-op
 * showToast so server-rendered code (or stories / tests) doesn't crash.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  durationMs?: number; // default 5000
  action?: ToastAction; // single action (Undo / Retry / Open / etc.)
}

interface ActiveToast extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => void;
}

const DEFAULT_DURATION_MS = 5000;

// No-op fallback so useToast() outside the provider doesn't crash.
const NOOP_CONTEXT: ToastContextValue = { showToast: () => {} };
const ToastContext = createContext<ToastContextValue>(NOOP_CONTEXT);

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((opts: ToastOptions) => {
    // crypto.randomUUID is available in modern browsers and Node 20+;
    // fall back to a timestamped id for older runtimes.
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { ...opts, id }]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Stack rendered as portal-less fixed overlay. z-50 sits above
          the panel chrome but below modal drawers (which use z-50 too —
          if we ever ship a modal on top, raise this to z-60). */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col-reverse gap-3"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ActiveToast; onDismiss: () => void }) {
  const variant = toast.variant || 'success';
  const duration = toast.durationMs ?? DEFAULT_DURATION_MS;

  // Auto-dismiss after `duration`. Clearing the timer in cleanup
  // prevents the toast from disappearing if the component unmounts
  // first (e.g. parent re-render races).
  useEffect(() => {
    if (duration <= 0) return; // 0 = sticky
    const handle = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(handle);
  }, [duration, onDismiss]);

  // Variant styles. Match the existing /app palette: emerald for
  // success (matches "Saved" buttons), red for error, slate for info.
  const tone =
    variant === 'success'
      ? { ring: 'border-emerald-500/40', accent: 'text-emerald-400', dot: 'bg-emerald-500' }
      : variant === 'error'
      ? { ring: 'border-red-500/40', accent: 'text-red-400', dot: 'bg-red-500' }
      : { ring: 'border-slate-600/40', accent: 'text-ink-soft', dot: 'bg-slate-500' };

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-3 rounded-lg border ${tone.ring} bg-ground/95 px-4 py-3 shadow-lg backdrop-blur min-w-[260px] max-w-md`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
      <span className="flex-1 text-sm text-slate-100">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            // Fire the action then dismiss. Wrapping in try/catch so a
            // throwing onClick (e.g. user closed network) doesn't leave
            // the toast stuck on screen.
            try {
              toast.action!.onClick();
            } catch (err) {
              console.error('[Toast] action onClick threw:', err);
            }
            onDismiss();
          }}
          className={`shrink-0 text-xs font-semibold underline ${tone.accent} hover:opacity-80`}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 text-faint hover:text-ink-soft text-xs"
      >
        ✕
      </button>
    </div>
  );
}
