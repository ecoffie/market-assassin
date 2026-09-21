import Image from 'next/image';

interface MindyLogoProps {
  size?: number;
  className?: string;
  showWordmark?: boolean;
  wordmarkClassName?: string;
}

export function MindyLogo({
  size = 40,
  className = '',
  showWordmark = false,
  wordmarkClassName = 'font-semibold text-white',
}: MindyLogoProps) {
  // The refreshed 3D mark is square (1:1) — the old flat mark was ~1.25:1, hence
  // the previous 0.799 height factor. Keep width == height so it never squishes.
  const logoHeight = size;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image
        src="/brand/mindy-logo-icon.png"
        alt="Mindy AI"
        width={size}
        height={logoHeight}
        className="shrink-0 object-contain"
      />
      {showWordmark && <span className={wordmarkClassName}>Mindy</span>}
    </span>
  );
}
