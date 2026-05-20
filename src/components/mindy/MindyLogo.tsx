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
  const logoHeight = Math.round(size * 0.799);

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
