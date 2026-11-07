'use client';

import { useEffect } from 'react';

/**
 * Zoom-style swipe indicator: a row of dots under every horizontal scroller marked `data-swipe`.
 * The current position is a wide pill; tapping a dot scrolls there. The bar only shows while the
 * scroller actually overflows, so on desktop (or when everything fits) nothing appears.
 *
 *   data-swipe="cards"  one dot per child (card carousels)
 *   data-swipe          one dot per screen-width of content (wide tables, chip rows)
 *
 * Mounted once by PublicShell; it also picks up scrollers inside HTML-string pages (the homepage).
 */
export default function SwipeDots() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    document.querySelectorAll<HTMLElement>('[data-swipe]').forEach((el) => {
      if (el.dataset.swipeWired) return;
      el.dataset.swipeWired = '1';
      const byCard = el.dataset.swipe === 'cards';
      const bar = document.createElement('div');
      bar.className = 'mp-dots';
      bar.setAttribute('aria-label', 'Scroll position');
      el.insertAdjacentElement('afterend', bar);

      const count = () =>
        byCard ? el.children.length : Math.max(1, Math.ceil(el.scrollWidth / Math.max(1, el.clientWidth)));
      const active = () => {
        if (byCard) {
          const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
          let best = 0;
          let bestD = Infinity;
          Array.from(el.children).forEach((c, i) => {
            const r = c.getBoundingClientRect();
            const d = Math.abs(r.left + r.width / 2 - mid);
            if (d < bestD) { bestD = d; best = i; }
          });
          return best;
        }
        const max = el.scrollWidth - el.clientWidth;
        return max <= 0 ? 0 : Math.round((el.scrollLeft / max) * (count() - 1));
      };
      const go = (i: number) => {
        if (byCard) {
          const c = el.children[i] as HTMLElement | undefined;
          if (c) el.scrollTo({ left: c.offsetLeft - (el.clientWidth - c.offsetWidth) / 2, behavior: 'smooth' });
        } else {
          const max = el.scrollWidth - el.clientWidth;
          el.scrollTo({ left: (max * i) / Math.max(1, count() - 1), behavior: 'smooth' });
        }
      };

      let n = -1;
      const paint = () => {
        const overflow = el.scrollWidth > el.clientWidth + 4;
        bar.hidden = !overflow;
        if (!overflow) return;
        const c = count();
        if (c !== n) {
          n = c;
          bar.innerHTML = '';
          for (let i = 0; i < c; i++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mp-dot';
            b.setAttribute('aria-label', `Go to ${i + 1} of ${c}`);
            b.addEventListener('click', () => go(i));
            bar.appendChild(b);
          }
        }
        const a = active();
        Array.from(bar.children).forEach((b, i) => {
          b.classList.toggle('on', i === a);
          if (i === a) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
        });
      };

      let raf = 0;
      const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); };
      el.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      paint();
      // Content (videos, fonts, a re-rendered table) can change the width after mount.
      const t = window.setTimeout(paint, 800);
      cleanups.push(() => {
        el.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        window.clearTimeout(t);
        bar.remove();
        delete el.dataset.swipeWired;
      });
    });

    return () => cleanups.forEach((f) => f());
  }, []);

  return null;
}
