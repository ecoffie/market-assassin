'use client';

/**
 * The page's one call to action (2026-11-19, from the Hormozi landing-page Short): no form on the
 * first screen, just a big button. The button — and every other "Save My Free Seat" link on the
 * page (href="#register") — opens the step-by-step form in a dialog. A visit to …#register opens it
 * straight away so shared links still land on the form.
 */
import { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import RegistrationForm from './RegistrationForm';

export default function SeatDialog({ label = 'Save My Free Seat' }: { label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);

  const open = useCallback(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href="#register"]');
      if (!a) return;
      e.preventDefault();
      open();
    };
    document.addEventListener('click', onClick);
    if (window.location.hash === '#register') open();
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  return (
    <>
      <button type="button" className="lcb-cta lcb-cta--hero" onClick={open}>{label}</button>
      <dialog ref={ref} className="lcb-dialog" aria-label="Save your free seat"
        onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
        <button type="button" className="lcb-dialog-x" aria-label="Close" onClick={() => ref.current?.close()}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <RegistrationForm />
      </dialog>
    </>
  );
}
