"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { DISCLOSURES, type DisclosureKey } from '@/lib/disclosures';

// A small "(i)" that opens a short methods note.
//
// Deliberately a button rather than the `<span title>` this replaces: `title`
// never appears on touch devices and a span is not keyboard-focusable, so the
// previous version was invisible to anyone not using a mouse. Since this is now
// the app's vehicle for methodological disclosure, that mattered.
//
// The panel is portalled to <body> and positioned `fixed`, which is not
// over-engineering — an in-flow panel loses two fights at once in the sidebar:
// `aside` is `overflow-y-auto`, so it CLIPS descendants at its edges, and later
// siblings (buttons with their own backgrounds and shadows) paint over it.
// Both were visible on screen before this. Fixed + portal sidesteps clipping
// and stacking together, and lets the panel be clamped to the viewport.
export const InfoTip = ({
  text,
  topic,
  label,
}: {
  /** Literal text, or omit and pass `topic` to read from the disclosure registry. */
  text?: string;
  topic?: DisclosureKey;
  /** Accessible name; defaults to the disclosure title. */
  label?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const body = text ?? (topic ? DISCLOSURES[topic].text : '');
  const name = label ?? (topic ? DISCLOSURES[topic].title : 'More information');

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const W = 240, M = 8;
    // Prefer growing leftward from the icon, then clamp into the viewport.
    const left = Math.max(M, Math.min(r.right - W, window.innerWidth - W - M));
    const below = r.bottom + 6;
    const h = panel.current?.offsetHeight ?? 0;
    const top = h && below + h > window.innerHeight - M
      ? Math.max(M, r.top - h - 6)   // flip above when it would fall off the bottom
      : below;
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const reflow = () => place();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    // The sidebar scrolls, so the anchor moves under a fixed panel.
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
    };
  }, [open, place]);

  if (!body) return null;

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }}
        aria-expanded={open}
        aria-label={name}
        title={body}
        className="inline-flex align-middle ml-1 opacity-50 hover:opacity-100 focus-visible:opacity-100 cursor-help"
      >
        <Info className="w-3 h-3" aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panel}
          role="tooltip"
          onMouseDown={e => e.stopPropagation()}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: 240 }}
          className="fixed z-[200] p-2 text-[11px] leading-snug normal-case tracking-normal font-normal text-left
            bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] shadow-[3px_3px_0px_var(--border)]"
        >
          <span className="block font-bold mb-1">{name}</span>
          {body}
        </div>,
        document.body,
      )}
    </>
  );
};

export default InfoTip;
