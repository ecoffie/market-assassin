'use client';

import { useEffect, useState } from 'react';

interface KittLoaderProps {
  message?: string;
  subMessage?: string;
  variant?: 'blue' | 'amber' | 'cyan';
}

export default function KittLoader({
  message = 'Analyzing Market Intelligence...',
  subMessage = 'Scanning federal contracting data',
  variant = 'cyan'
}: KittLoaderProps) {
  const [loadingPhase, setLoadingPhase] = useState(0);

  const phases = [
    { message: 'Scanning USAspending.gov...', icon: '🔍' },
    { message: 'Analyzing agency spending patterns...', icon: '📊' },
    { message: 'Identifying buyer contacts...', icon: '👥' },
    { message: 'Mapping subcontracting opportunities...', icon: '🔗' },
    { message: 'Generating strategic insights...', icon: '💡' },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setLoadingPhase((prev) => (prev + 1) % phases.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [phases.length]);

  const colorClasses = {
    blue: {
      glow: 'shadow-[0_0_20px_rgba(59,130,246,0.6)]',
      bar: 'bg-blue-500',
      text: 'text-blue-400',
      border: 'border-blue-500/30',
    },
    amber: {
      glow: 'shadow-[0_0_20px_rgba(245,158,11,0.6)]',
      bar: 'bg-amber-500',
      text: 'text-amber-400',
      border: 'border-amber-500/30',
    },
    cyan: {
      glow: 'shadow-[0_0_20px_rgba(34,211,238,0.6)]',
      bar: 'bg-cyan-400',
      text: 'text-cyan-400',
      border: 'border-cyan-500/30',
    },
  };

  const colors = colorClasses[variant];

  return (
    <div className="flex flex-col items-center justify-center py-16">
      {/* Main loader container */}
      <div className={`relative bg-slate-900/80 backdrop-blur-sm rounded-2xl p-8 border ${colors.border} max-w-md w-full`}>
        {/* KITT-style scanning bar */}
        <div className="relative h-3 bg-slate-800 rounded-full overflow-hidden mb-6">
          <div
            className={`absolute h-full w-1/3 ${colors.bar} ${colors.glow} rounded-full animate-kitt`}
          />
        </div>

        {/* Icon and message */}
        <div className="text-center space-y-3">
          <div className="text-4xl animate-bounce-slow">
            {phases[loadingPhase].icon}
          </div>
          <h3 className={`text-xl font-bold ${colors.text}`}>
            {message}
          </h3>
          <p className="text-slate-400 text-sm animate-pulse">
            {phases[loadingPhase].message}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mt-6">
          {phases.map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === loadingPhase
                  ? `${colors.bar} scale-125 ${colors.glow}`
                  : index < loadingPhase
                    ? `${colors.bar} opacity-60`
                    : 'bg-slate-600'
              }`}
            />
          ))}
        </div>

        {/* Decorative corner accents */}
        <div className={`absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 ${colors.border} rounded-tl-lg`} />
        <div className={`absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 ${colors.border} rounded-tr-lg`} />
        <div className={`absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 ${colors.border} rounded-bl-lg`} />
        <div className={`absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 ${colors.border} rounded-br-lg`} />
      </div>

      {/* Sub message */}
      <p className="text-slate-500 text-xs mt-4 text-center">
        {subMessage}
      </p>
    </div>
  );
}
