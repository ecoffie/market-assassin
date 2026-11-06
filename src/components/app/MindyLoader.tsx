/**
 * MindyLoader — the app's loading screen, in the same style as the map's "Building your market"
 * screen (src/app/opportunity-map/market-feedback.ts → MARKET_BOOT_HTML / .mfb-boot).
 *
 * Same look: dark navy→violet panel, "MINDY" kicker, big uppercase title, a list of what Mindy is
 * gathering with spinners, and a sweep line across the top. Same timing rule: it fades in only after
 * 300 ms (a CSS animation-delay, no timer), so a fast load never flashes it.
 *
 * Honest by construction: the steps say what is being loaded; none is ever marked done, because this
 * component does not know which request finished. It disappears when the panel has its data.
 *
 * Styles are plain CSS with literal colours (class prefix `mld-`), so the app's light theme
 * (.mi-light palette remap) cannot recolour it.
 */

const CSS = [
  '.mld{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#fff;',
  'background:radial-gradient(1200px 600px at 30% 20%,rgba(91,63,214,.55),transparent 60%),linear-gradient(135deg,#0a0e28,#211454);',
  'animation:mldIn .24s ease-out .3s both}',
  '.mld--full{min-height:calc(100dvh - 140px);border-radius:0}',
  '.mld--screen{position:fixed;inset:0;z-index:100;min-height:100dvh}',
  '.mld--section{min-height:340px;border-radius:16px}',
  '@keyframes mldIn{from{opacity:0}to{opacity:1}}',
  '.mld::after{content:"";position:absolute;left:0;top:0;width:40%;height:2px;background:linear-gradient(90deg,transparent,#8b7bff,#60a5fa,transparent);transform:translateX(-100%);animation:mldSweep 1.6s ease-in-out infinite;will-change:transform}',
  '@keyframes mldSweep{from{transform:translateX(-100%)}to{transform:translateX(250%)}}',
  '.mld-in{width:min(560px,calc(100% - 48px));padding:32px 0}',
  '.mld-k{font:800 11px/1 Inter,system-ui,sans-serif;letter-spacing:.34em;text-transform:uppercase;color:#b9b0ff}',
  '.mld-t{margin:10px 0 0;font:900 clamp(28px,4vw,46px)/1.02 Inter,system-ui,sans-serif;letter-spacing:-.01em;text-transform:uppercase;color:#fff}',
  '.mld-q{margin-top:10px;font:400 15px/1.4 Inter,system-ui,sans-serif;color:#d8d4ff}',
  '.mld-s{list-style:none;margin:24px 0 0;padding:0}',
  '.mld-st{display:flex;align-items:center;gap:14px;padding:9px 0;font:700 clamp(16px,1.8vw,20px)/1.3 Inter,system-ui,sans-serif;color:#fff;border-top:1px solid rgba(255,255,255,.08)}',
  '.mld-ic{flex:0 0 auto;width:20px;height:20px;border-radius:50%;box-sizing:border-box;border:2px solid rgba(185,176,255,.28);border-top-color:#b9b0ff;animation:mldSpin .75s linear infinite}',
  '@keyframes mldSpin{to{transform:rotate(360deg)}}',
  '.mld--section .mld-t{font-size:clamp(22px,3vw,32px)}',
  '.mld--section .mld-st{font-size:16px;padding:7px 0}',
  '@media(max-width:640px){.mld--full{min-height:calc(100dvh - 120px)}.mld-t{font-size:28px}}',
  '@media (prefers-reduced-motion:reduce){.mld,.mld::after,.mld-ic{animation:none}.mld{opacity:1}}',
].join('');

export interface MindyLoaderProps {
  /** Uppercase headline, e.g. "Loading your pursuits". */
  title: string;
  /** What is being gathered — shown as spinner rows. Keep to 2–4 plain-English items. */
  steps?: string[];
  /** One plain line under the title. */
  note?: string;
  /**
   * full    — replaces a whole panel while it loads (default)
   * section — a card-sized block inside a panel (a list that is loading)
   * screen  — covers the whole window (app start-up)
   */
  variant?: 'full' | 'section' | 'screen';
}

export default function MindyLoader({ title, steps = [], note, variant = 'full' }: MindyLoaderProps) {
  return (
    <div className={`mld mld--${variant}`} role="status" aria-live="polite" aria-label={title}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="mld-in">
        <div className="mld-k">Mindy</div>
        <h2 className="mld-t">{title}</h2>
        {note && <div className="mld-q">{note}</div>}
        {steps.length > 0 && (
          <ol className="mld-s">
            {steps.map((s, i) => (
              <li key={s} className="mld-st">
                <span className="mld-ic" style={{ animationDelay: `${i * 120}ms` }} aria-hidden="true" />
                <span>{s}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
