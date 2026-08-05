"use client";
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { DISCLOSURES, DISCLOSURE_SECTIONS } from '@/lib/disclosures';
import { METHODS } from '@/lib/methods';

// The long-form companion to the (i) tooltips.
//
// Every word here is READ from disclosures.ts and methods.ts — nothing is
// retyped. That is the whole point: the app already had the same facts written
// in three places and they had drifted apart (finding A3), so a fourth copy
// living in a React component would be the same mistake with better formatting.
// If a disclosure changes, the tooltip, this page and the assistant's reference
// all change together or none of them do.
//
// Portalled to <body> and `fixed`, for the reason InfoTip documents at length:
// the sidebar is `overflow-y-auto` and a positioned stacking context, and the
// plot is a WebGL canvas. Anything floating above both has to leave the tree.

type Tab = 'app' | 'methods';

export const InfoDialog = ({
  open,
  onClose,
  theme,
}: {
  open: boolean;
  onClose: () => void;
  theme?: string;
}) => {
  const [tab, setTab] = useState<Tab>('app');
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Move focus into the dialog so Escape and Tab go somewhere sensible.
    closeBtn.current?.focus();
    // The page behind must not scroll while a full-height overlay is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const bauhaus = theme === 'primary';
  const tabCls = (t: Tab) =>
    `px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide cursor-pointer border ${
      tab === t
        ? (bauhaus ? 'bg-[var(--p-blue)] text-white border-[var(--border)]' : 'bg-[var(--border)] text-[var(--primary)] border-[var(--primary)]')
        : 'border-[var(--border)] opacity-60 hover:opacity-100'
    }`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="About Scatter Lab and its methods"
      className="fixed inset-0 z-[300] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onMouseDown={e => { if (!panel.current?.contains(e.target as Node)) onClose(); }}
    >
      <div
        ref={panel}
        className={`w-full max-w-3xl my-auto border bg-[var(--card)] text-[var(--foreground)] ${
          bauhaus ? 'border-[3px] border-[var(--border)]' : 'border-[var(--border)]'
        }`}
      >
        <header className={`flex items-center justify-between gap-3 px-4 py-3 border-b ${bauhaus ? 'bg-[var(--p-blue)] text-white border-[var(--border)]' : 'border-[var(--border)]'}`}>
          <h2 className="text-sm font-bold uppercase tracking-wide">About Scatter Lab</h2>
          <button ref={closeBtn} onClick={onClose} aria-label="Close" className="opacity-70 hover:opacity-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-4 py-4 space-y-5 text-[12px] leading-relaxed">
          <p className="opacity-80">
            Scatter Lab plots high-dimensional data in two or three dimensions, and runs PCA and
            clustering over it. <strong>Everything happens in this browser tab.</strong> Your file is never
            uploaded, there is no server to send it to, and closing the tab discards it — save a workspace if you
            want it back.
          </p>
          <p className="opacity-80">
            The one exception is the assistant. If you connect an API key, your questions and a{' '}
            <em>summary</em> of the data do leave the browser, going to whichever provider the key belongs to.
            What it can see is column names, each column&apos;s range and missing count, the most frequent values
            of categorical columns, and the results of the analyses it runs — <strong>never individual rows</strong>.
            Where a column holds roughly one distinct value per row — an email address, a name, a free-text
            answer — its values are withheld entirely and only the count of them is sent, because &ldquo;the eight
            most frequent values&rdquo; of such a column is just eight rows. If even that is more than your data
            allows, leave the assistant disconnected; everything else here works without it.
          </p>

          <div className="flex gap-2 pt-1">
            <button className={tabCls('app')} onClick={() => setTab('app')}>What this app does</button>
            <button className={tabCls('methods')} onClick={() => setTab('methods')}>Methods reference</button>
          </div>

          {tab === 'app' ? (
            <div className="space-y-5">
              <p className="opacity-70 text-[11px]">
                The choices this app makes on your behalf, and what each one costs. These are the same notes
                behind the <span className="font-bold">(i)</span> icons in the sidebar.
              </p>
              {DISCLOSURE_SECTIONS.map(section => (
                <section key={section.heading} className="space-y-3">
                  <h3 className={`text-[11px] font-bold uppercase tracking-wide pb-1 border-b ${bauhaus ? 'border-[var(--border)]' : 'border-[var(--border)] opacity-80'}`}>
                    {section.heading}
                  </h3>
                  {section.keys.map(key => (
                    <div key={key}>
                      <h4 className="font-bold">{DISCLOSURES[key].title}</h4>
                      <p className="opacity-80">{DISCLOSURES[key].text}</p>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="opacity-70 text-[11px]">
                Background on the methods themselves, with citations. This is the same reference the assistant
                quotes from when you ask it to help interpret a result, so its answers and this page cannot
                disagree.
              </p>
              {Object.entries(METHODS).map(([key, chunk]) => (
                <div key={key}>
                  <h4 className="font-bold">{chunk.title}</h4>
                  <p className="opacity-80">{chunk.text}</p>
                </div>
              ))}
            </div>
          )}

          <p className="opacity-60 text-[11px] pt-2 border-t border-[var(--border)]">
            Demo dataset: Fisher&apos;s iris data, from the UCI Machine Learning Repository
            (<code>bezdekIris.data</code>, doi.org/10.24432/C56C76). Provenance and checksums are recorded in
            <code> public/demo/iris.SOURCE.md</code>.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default InfoDialog;
