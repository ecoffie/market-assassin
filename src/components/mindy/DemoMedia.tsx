/**
 * DemoMedia — a swap-ready slot for product screenshots / GIFs / videos on the
 * landing page. Renders real media when a src is provided; otherwise a labeled
 * placeholder so the homepage structure ships now and we drop assets in later.
 *
 * Pass `video` (mp4/webm or an embed URL), `image` (screenshot/GIF), or neither
 * (placeholder). Keeps the "show the product working" structure live without
 * blocking on asset production.
 */
type DemoMediaProps = {
  /** Direct video file (.mp4/.webm) — autoplays muted/looped like a GIF. */
  video?: string;
  /** Embed URL (Vimeo/YouTube) — rendered in an iframe with sound/controls. */
  embed?: string;
  /** Screenshot or animated GIF. */
  image?: string;
  /** Alt / placeholder caption describing what this demo shows. */
  caption: string;
  /** Aspect ratio box. */
  aspect?: 'video' | 'wide' | 'tall';
  className?: string;
};

export function DemoMedia({ video, embed, image, caption, aspect = 'video', className = '' }: DemoMediaProps) {
  const aspectClass =
    aspect === 'wide' ? 'aspect-[16/7]' : aspect === 'tall' ? 'aspect-[4/3]' : 'aspect-video';

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-2xl shadow-purple-900/30 ${aspectClass} ${className}`}
    >
      {embed ? (
        <iframe
          src={embed}
          title={caption}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      ) : video ? (
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={video}
          autoPlay
          muted
          loop
          playsInline
          aria-label={caption}
        />
      ) : image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={caption} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        // Placeholder until real media lands — clearly labeled, on-brand.
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-purple-950/40 to-slate-900 p-6 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 text-2xl">
            ▶
          </div>
          <p className="text-sm font-medium text-slate-300">{caption}</p>
          <p className="mt-1 text-xs text-slate-500">Demo coming soon</p>
        </div>
      )}
    </div>
  );
}
