'use client';

import { useEffect, useState } from 'react';

interface ConfettiCelebrationProps {
  show: boolean;
  onComplete?: () => void;
}

const COLORS = ['#1e40af', '#3b82f6', '#60a5fa', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export default function ConfettiCelebration({ show, onComplete }: ConfettiCelebrationProps) {
  const [particles, setParticles] = useState<Array<{
    id: number;
    color: string;
    left: number;
    delay: number;
    duration: number;
    size: number;
    rotation: number;
  }>>([]);

  useEffect(() => {
    if (show) {
      const newParticles = Array.from({ length: 30 }, (_, i) => ({
        id: i,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        left: randomBetween(5, 95),
        delay: randomBetween(0, 0.5),
        duration: randomBetween(2, 3.5),
        size: randomBetween(6, 12),
        rotation: randomBetween(0, 360),
      }));
      setParticles(newParticles);

      const timer = setTimeout(() => {
        setParticles([]);
        onComplete?.();
      }, 3500);

      return () => clearTimeout(timer);
    } else {
      setParticles([]);
    }
  }, [show, onComplete]);

  if (particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden">
      <style>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(-10vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(105vh) rotate(720deg);
            opacity: 0;
          }
        }
        @keyframes confetti-sway {
          0%, 100% { margin-left: 0; }
          25% { margin-left: 15px; }
          75% { margin-left: -15px; }
        }
      `}</style>
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.left}%`,
            top: '-10px',
            width: `${p.size}px`,
            height: `${p.size * 0.6}px`,
            backgroundColor: p.color,
            borderRadius: p.id % 3 === 0 ? '50%' : '2px',
            animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards, confetti-sway ${p.duration * 0.5}s ease-in-out ${p.delay}s infinite`,
            transform: `rotate(${p.rotation}deg)`,
          }}
        />
      ))}
    </div>
  );
}
