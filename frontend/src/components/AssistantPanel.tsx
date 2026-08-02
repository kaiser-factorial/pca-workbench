"use client";
import { useEffect, useRef, useState } from 'react';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Sparkles, Settings2, Minus, CornerDownLeft, Info, ThumbsUp, ThumbsDown, PanelRight, PanelBottom, PictureInPicture2 } from 'lucide-react';
import {
  AppBridge, DEFAULT_BASE_URL, DEFAULT_MODEL, MUTATING_TOOLS, ModelInfo,
  runAssistantTurn, fetchModels, suggestModels, describeApiError,
} from '@/lib/assistant';
import { startOpenRouterOAuth, completeOpenRouterOAuth } from '@/lib/openrouterAuth';
import { feedbackEnabled, submitFeedback, flushFeedback } from '@/lib/feedback';

// Chat entries for display; the wire-format history is kept separately
type ChatEntry = { kind: 'user' | 'assistant' | 'tool' | 'error'; text: string };

const LS = {
  key: 'scatterlab.assistant.key',
  model: 'scatterlab.assistant.model',
  baseURL: 'scatterlab.assistant.baseurl',
  layout: 'scatterlab.assistant.layout',
};

// Panel geometry: bottom-anchored, slidable along the bottom edge, resizable
// from the left/top edges. `right` is the distance from the container's right.
type Layout = { w: number; h: number; right: number };
const DEFAULT_LAYOUT: Layout = { w: 360, h: 560, right: 16 };
const MIN_W = 300, MAX_W = 760, MIN_H = 280;

export type DockMode = 'right' | 'bottom' | 'float';

export const AssistantPanel = ({ bridgeRef, theme, askRef, dock, onDockChange }: {
  bridgeRef: React.MutableRefObject<AppBridge>,
  theme: string | undefined,
  askRef?: React.MutableRefObject<((q: string) => void) | null>,
  dock: DockMode,
  onDockChange: (d: DockMode) => void,
}) => {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<ChatCompletionMessageParam[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  // Undo: view-state snapshot taken before the last mutating turn
  const [undoSnap, setUndoSnap] = useState<unknown>(null);
  // OAuth failure to surface inside the settings view (chat may be hidden there)
  const [authError, setAuthError] = useState('');
  // Per-message feedback state, keyed by chat index
  const [fb, setFb] = useState<Record<number, { rating: 'up' | 'down'; eventId: string; askWhy: boolean; done: boolean }>>({});

  useEffect(() => {
    setApiKey(localStorage.getItem(LS.key) ?? '');
    setModel(localStorage.getItem(LS.model) ?? DEFAULT_MODEL);
    setBaseURL(localStorage.getItem(LS.baseURL) ?? DEFAULT_BASE_URL);
    try {
      const saved = JSON.parse(localStorage.getItem(LS.layout) ?? 'null');
      if (saved && typeof saved.w === 'number') setLayout(saved);
    } catch { /* keep defaults */ }
    void flushFeedback(); // retry any feedback buffered while offline
    // Returning from OpenRouter's OAuth approval? Exchange the code for a key.
    completeOpenRouterOAuth()
      .then(key => {
        if (!key) return;
        localStorage.setItem(LS.key, key);
        localStorage.setItem(LS.baseURL, DEFAULT_BASE_URL);
        setApiKey(key);
        setBaseURL(DEFAULT_BASE_URL);
        setShowSettings(false);
        setOpen(true);
        setChat(prev => [...prev, { kind: 'tool', text: 'connected to OpenRouter — you’re all set' }]);
      })
      .catch(err => {
        setOpen(true);
        setAuthError(`Connect failed: ${err?.message ?? err} Try again, or paste a key manually.`);
      });
  }, []);

  useEffect(() => {
    // OpenRouter's catalog is public — fetch even before a key exists so the
    // model suggestions render during first-time setup
    if (open) fetchModels(baseURL, apiKey).then(setModels);
  }, [apiKey, baseURL, open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat]);

  // --- drag & resize ---------------------------------------------------------
  const beginDrag = (mode: 'move' | 'w' | 'h' | 'wh') => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const start = layout;
    const container = panelRef.current?.parentElement;
    const cw = container?.clientWidth ?? window.innerWidth;
    const ch = container?.clientHeight ?? window.innerHeight;
    let latest = start;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const next = { ...start };
      if (mode === 'move') {
        next.right = Math.min(Math.max(start.right - dx, 8), Math.max(8, cw - start.w - 8));
      }
      if (mode === 'w' || mode === 'wh') {
        const maxW = dock === 'right' ? Math.max(MIN_W, cw * 0.75) : Math.min(MAX_W, cw - start.right - 8);
        next.w = Math.min(Math.max(start.w - dx, MIN_W), maxW);
      }
      if (mode === 'h' || mode === 'wh') {
        const maxH = dock === 'bottom' ? Math.max(200, ch * 0.8) : ch - 24;
        next.h = Math.min(Math.max(start.h - dy, dock === 'bottom' ? 200 : MIN_H), maxH);
      }
      latest = next;
      setLayout(next);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      localStorage.setItem(LS.layout, JSON.stringify(latest));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const saveSettings = (key: string, mdl: string, url: string) => {
    localStorage.setItem(LS.key, key);
    localStorage.setItem(LS.model, mdl);
    localStorage.setItem(LS.baseURL, url);
    setApiKey(key); setModel(mdl); setBaseURL(url);
  };

  const clearKey = () => {
    localStorage.removeItem(LS.key);
    setApiKey('');
    setChat([]);
    historyRef.current = [];
  };

  const send = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || busy || !apiKey) return;
    setInput('');
    if (composerRef.current) composerRef.current.style.height = 'auto';
    setChat(prev => [...prev, { kind: 'user', text }, { kind: 'assistant', text: '' }]);
    setBusy(true);
    const snapBefore = bridgeRef.current.snapshot();
    let mutated = false;
    try {
      historyRef.current = await runAssistantTurn(
        apiKey, baseURL, model, historyRef.current, text, bridgeRef.current,
        {
          onText: delta => setChat(prev => {
            const next = [...prev];
            // stream into the trailing assistant bubble, adding one after tool chips
            if (next[next.length - 1]?.kind !== 'assistant') next.push({ kind: 'assistant', text: '' });
            next[next.length - 1] = { kind: 'assistant', text: next[next.length - 1].text + delta };
            return next;
          }),
          onToolUse: (name, argsSummary) => {
            if (MUTATING_TOOLS.has(name)) mutated = true;
            setChat(prev => {
              const next = prev.filter((e, i) => !(i === prev.length - 1 && e.kind === 'assistant' && e.text === ''));
              const label = argsSummary ? `${name.replaceAll('_', ' ')} · ${argsSummary}` : name.replaceAll('_', ' ');
              return [...next, { kind: 'tool', text: label }];
            });
          },
        },
      );
    } catch (err) {
      setChat(prev => [...prev, { kind: 'error', text: describeApiError(err) }]);
    } finally {
      // drop an empty trailing assistant bubble if the turn ended on a tool/error
      setChat(prev => prev.filter((e, i) => !(i === prev.length - 1 && e.kind === 'assistant' && e.text === '')));
      setUndoSnap(mutated ? snapBefore : null);
      setBusy(false);
    }
  };

  // The user message and tool calls belonging to the assistant message at idx
  const turnContext = (idx: number) => {
    let userMsg: string | null = null;
    const tools: string[] = [];
    for (let i = idx - 1; i >= 0; i--) {
      const e = chat[i];
      if (e.kind === 'user') { userMsg = e.text; break; }
      if (e.kind === 'tool') tools.unshift(e.text.split(' · ')[0]);
    }
    return { userMsg, tools };
  };

  const rate = (idx: number, rating: 'up' | 'down') => {
    if (fb[idx]) return;
    const eventId = crypto.randomUUID();
    const { tools } = turnContext(idx);
    // Instant row carries metadata only — conversation text goes with the
    // optional "why" step, where the user can see and exclude it
    void submitFeedback({ event_id: eventId, rating, model, tools });
    setFb(prev => ({ ...prev, [idx]: { rating, eventId, askWhy: true, done: false } }));
  };

  const sendReason = (idx: number, reason: string, includeExchange: boolean) => {
    const f = fb[idx];
    if (!f) return;
    const { userMsg, tools } = turnContext(idx);
    void submitFeedback({
      event_id: f.eventId,
      rating: f.rating,
      reason: reason.trim() || null,
      model,
      tools,
      user_message: includeExchange ? userMsg : null,
      assistant_message: includeExchange ? chat[idx]?.text ?? null : null,
    });
    setFb(prev => ({ ...prev, [idx]: { ...f, askWhy: false, done: true } }));
  };

  const undo = () => {
    if (!undoSnap) return;
    bridgeRef.current.restore(undoSnap);
    setUndoSnap(null);
    setChat(prev => [...prev, { kind: 'tool', text: 'reverted the assistant’s changes' }]);
  };

  // Allow the rest of the app to open the panel with a prefilled question
  if (askRef) askRef.current = (q: string) => { setOpen(true); setShowSettings(false); send(q); };

  const primary = theme === 'primary';
  const panelCls = primary
    ? 'bg-white border-[3px] border-[#111111] shadow-[6px_6px_0px_#111111]'
    : 'bg-black/85 border border-[var(--system-green)]/50 backdrop-blur-sm';
  const headerCls = primary
    ? 'bg-[#111111] text-white'
    : 'bg-transparent text-[var(--system-green)] border-b border-[var(--system-green)]/30';
  const inputCls = primary
    ? 'bg-white border border-[#111111] text-[#111111]'
    : 'bg-[var(--input)] border border-[var(--border)] text-[var(--foreground)]';

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Open the assistant"
        className={`absolute bottom-4 z-40 flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider cursor-pointer ${primary
          ? 'bauhaus-btn bg-[var(--p-red)] text-white'
          : 'bg-black/80 border border-[var(--system-green)]/60 text-[var(--system-green)] hover:bg-[var(--system-green)]/10'}`}
        style={{ right: layout.right }}
      >
        <Sparkles className="w-4 h-4" /> Assistant
      </button>
    );
  }

  const chatMode = !!apiKey && !showSettings;

  const rootProps = dock === 'float'
    ? {
        className: `absolute bottom-4 z-40 flex flex-col ${panelCls}`,
        style: {
          width: layout.w,
          right: layout.right,
          ...(chatMode ? { height: layout.h } : {}),
          maxHeight: 'calc(100% - 2rem)',
        } as React.CSSProperties,
      }
    : dock === 'right'
      ? {
          className: `relative z-40 flex flex-col flex-shrink-0 h-full min-h-0 ${panelCls}`,
          style: { width: layout.w } as React.CSSProperties,
        }
      : {
          className: `relative z-40 flex flex-col flex-shrink-0 w-full min-h-0 ${panelCls}`,
          style: { height: layout.h } as React.CSSProperties,
        };

  return (
    <div ref={panelRef} {...rootProps}>
      {/* resize handles per dock mode */}
      {(dock === 'float' || dock === 'right') && (
        <div onPointerDown={beginDrag('w')} className="absolute -left-1 top-0 bottom-0 w-2 cursor-ew-resize z-20" title="Drag to resize" />
      )}
      {(dock === 'float' || dock === 'bottom') && (
        <div onPointerDown={beginDrag('h')} className="absolute top-[-4px] left-0 right-0 h-2 cursor-ns-resize z-20" title="Drag to resize" />
      )}
      {dock === 'float' && (
        <div onPointerDown={beginDrag('wh')} className="absolute -left-1.5 top-[-6px] w-5 h-5 cursor-nwse-resize z-30" title="Drag to resize" />
      )}

      {/* header — in float mode, drag to slide the panel along the bottom */}
      <div
        onPointerDown={dock === 'float' ? beginDrag('move') : undefined}
        className={`flex items-center justify-between px-3 py-2 flex-shrink-0 select-none ${dock === 'float' ? 'cursor-grab active:cursor-grabbing' : ''} ${headerCls}`}
        title={dock === 'float' ? 'Drag to move' : undefined}
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
          <Sparkles className="w-3.5 h-3.5" /> Assistant
        </span>
        <span className="flex items-center gap-1" onPointerDown={e => e.stopPropagation()}>
          {([['right', PanelRight, 'Dock to the right'], ['bottom', PanelBottom, 'Dock to the bottom'], ['float', PictureInPicture2, 'Float (drag anywhere along the bottom)']] as const).map(([m, Icon, label]) => (
            <button
              key={m}
              onClick={() => onDockChange(m)}
              title={label}
              className={`p-1 cursor-pointer ${dock === m ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
          <span className="w-1" />
          <button onClick={() => setShowSettings(s => !s)} title="Assistant settings" className="p-1 hover:opacity-60 cursor-pointer">
            <Settings2 className="w-4 h-4" />
          </button>
          <button onClick={() => setOpen(false)} title="Minimize — your conversation is kept" className="p-1 hover:opacity-60 cursor-pointer">
            <Minus className="w-4 h-4" />
          </button>
        </span>
      </div>

      {(!apiKey || showSettings) ? (
        <SettingsForm
          primary={primary}
          inputCls={inputCls}
          apiKey={apiKey} model={model} baseURL={baseURL} models={models}
          authError={authError}
          onConnect={() => { setAuthError(''); startOpenRouterOAuth(); }}
          onSave={(k, m, u) => { saveSettings(k, m, u); setShowSettings(false); setAuthError(''); }}
          onClearKey={clearKey}
        />
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-[120px]">
            {chat.length === 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-[11px] opacity-50 leading-snug">
                  Ask about your variables, or tell me what to show — e.g. “plot PC1 vs PC2 colored
                  by Orientation”, “cluster this with k=4 and tell me what the clusters look like”.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {['Give me a tour', 'What can you do?', 'Suggest what to explore'].map(sugg => (
                    <button
                      key={sugg}
                      onClick={() => send(sugg)}
                      className={`px-2 py-1 text-[10px] cursor-pointer ${primary
                        ? 'border border-[#111111] hover:bg-[var(--p-yellow)]'
                        : 'border border-[var(--system-green)]/40 text-[var(--system-green)] hover:bg-[var(--system-green)]/10'}`}
                    >
                      {sugg}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chat.map((e, i) => (
              e.kind === 'tool' ? (
                <div key={i} className={`text-[10px] uppercase tracking-wider ${primary ? 'text-[var(--p-blue)]' : 'text-[var(--system-green)]/70'}`}>
                  ▸ {e.text}
                </div>
              ) : (
                <div key={i} className={`text-xs leading-relaxed whitespace-pre-wrap ${e.kind === 'user'
                  ? (primary ? 'font-bold' : 'text-[var(--system-green)]')
                  : e.kind === 'error' ? 'text-red-500' : ''}`}>
                  {e.kind === 'user' && <span className="opacity-50">&gt; </span>}
                  {e.text}
                  {busy && i === chat.length - 1 && e.kind === 'assistant' && <span className="animate-pulse">▌</span>}
                  {feedbackEnabled() && e.kind === 'assistant' && e.text && !(busy && i === chat.length - 1) && (
                    <FeedbackControls
                      primary={primary}
                      state={fb[i]}
                      onRate={r => rate(i, r)}
                      onReason={(reason, include) => sendReason(i, reason, include)}
                      onDismiss={() => setFb(prev => ({ ...prev, [i]: { ...prev[i], askWhy: false } }))}
                    />
                  )}
                </div>
              )
            ))}
          </div>
          <div className="px-3 pb-2 pt-1 flex-shrink-0 space-y-1.5">
            {undoSnap != null && !busy && (
              <button
                onClick={undo}
                className={`w-full py-1 text-[10px] font-bold uppercase tracking-wider cursor-pointer ${primary
                  ? 'border-2 border-[#111111] hover:bg-[var(--p-yellow)]'
                  : 'border border-[var(--system-green)]/40 text-[var(--system-green)] hover:bg-[var(--system-green)]/10'}`}
              >
                ↩ Undo assistant changes
              </button>
            )}
            <div className="flex gap-1.5 items-end">
              <textarea
                ref={composerRef}
                rows={1}
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  // auto-grow up to ~5 lines, then scroll
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px';
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                aria-label="Message the assistant"
                placeholder={busy ? 'Working…' : 'Ask or instruct…'}
                title="Enter sends · Shift+Enter for a new line"
                disabled={busy}
                className={`flex-1 min-w-0 px-2 py-1.5 text-xs outline-none resize-none leading-snug overflow-y-auto ${inputCls}`}
              />
              <button
                onClick={() => send()}
                disabled={busy || !input.trim()}
                title="Send"
                className={`px-2.5 py-1.5 disabled:opacity-30 cursor-pointer ${primary ? 'bauhaus-btn bg-[var(--p-blue)] text-white' : 'border border-[var(--system-green)]/60 text-[var(--system-green)] hover:bg-[var(--system-green)]/10'}`}
              >
                <CornerDownLeft className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[9px] leading-snug opacity-40">
              Sends column names &amp; summary stats to {baseURL.includes('openrouter') ? 'OpenRouter' : 'your API endpoint'} — never raw data rows.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

// Small ⓘ with the long-form explanation as a native tooltip
const InfoTip = ({ text }: { text: string }) => (
  <span title={text} className="inline-flex align-middle ml-1 opacity-50 hover:opacity-100 cursor-help">
    <Info className="w-3 h-3" />
  </span>
);

const SettingsForm = ({ primary, inputCls, apiKey, model, baseURL, models, authError, onConnect, onSave, onClearKey }: {
  primary: boolean, inputCls: string,
  apiKey: string, model: string, baseURL: string, models: ModelInfo[],
  authError: string,
  onConnect: () => void,
  onSave: (key: string, model: string, baseURL: string) => void,
  onClearKey: () => void,
}) => {
  const [key, setKey] = useState(apiKey);
  const [mdl, setMdl] = useState(model);
  const [url, setUrl] = useState(baseURL);
  const [modelError, setModelError] = useState('');
  const labelCls = 'text-[10px] font-bold uppercase tracking-wider opacity-60';
  const ids = models.map(m => m.id);
  const suggested = suggestModels(models);

  const trySave = () => {
    if (!key.trim() || !mdl.trim() || !url.trim()) return;
    // The catalog is already filtered to tool-capable models; a typed model
    // outside it cannot drive the app. Endpoints without a catalog (local
    // runtimes) skip this check.
    if (ids.length && !ids.includes(mdl.trim())) {
      setModelError(`"${mdl.trim()}" doesn't support tool calling on this endpoint, so it can't drive the app. Pick a suggested model or one from the list.`);
      return;
    }
    setModelError('');
    onSave(key.trim(), mdl.trim(), url.trim().replace(/\/$/, ''));
  };

  return (
    <div className="px-3 py-3 space-y-2.5 overflow-y-auto">
      {!apiKey && (
        <p className="text-[11px] leading-snug opacity-80">
          <strong>Your key, stored only in this browser.</strong>
          <InfoTip text="One OpenRouter account covers Claude, GPT, Gemini, and more. The key never appears in exported workspaces and is only ever sent to the API endpoint you configure below." />
        </p>
      )}
      {authError && <p className="text-[11px] leading-snug text-red-500">{authError}</p>}
      <button
        onClick={onConnect}
        className={`w-full py-2 text-xs font-bold cursor-pointer ${primary
          ? 'bauhaus-btn bg-[var(--p-blue)] text-white'
          : 'border border-[var(--system-green)]/60 text-[var(--system-green)] hover:bg-[var(--system-green)]/10'}`}
      >
        {apiKey ? 'Reconnect OpenRouter' : 'Connect OpenRouter'}
      </button>
      <p className="text-[10px] opacity-50 leading-snug">
        <strong>One click</strong> — approve on openrouter.ai, done. Or paste a key below.
      </p>
      <div className="space-y-1">
        <div className={labelCls}>API key</div>
        <input type="password" value={key} onChange={e => setKey(e.target.value)}
          placeholder="sk-or-…" className={`w-full px-2 py-1.5 text-xs outline-none ${inputCls}`} />
      </div>
      <div className="space-y-1">
        <div className={labelCls}>
          Model
          <InfoTip text="Suggestions are the newest full-strength model per family. Only models that support tool calling are allowed — others can't drive the app." />
        </div>
        {suggested.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggested.map(id => (
              <button
                key={id}
                onClick={() => { setMdl(id); setModelError(''); }}
                title={id}
                className={`px-1.5 py-0.5 text-[9px] cursor-pointer ${mdl === id
                  ? (primary ? 'bg-[#111111] text-white border border-[#111111]' : 'bg-[var(--system-green)] text-black border border-[var(--system-green)]')
                  : (primary ? 'border border-[#111111]/40 hover:border-[#111111]' : 'border border-[var(--system-green)]/30 text-[var(--system-green)] hover:border-[var(--system-green)]')}`}
              >
                {id.split('/')[1] ?? id}
              </button>
            ))}
          </div>
        )}
        <input type="text" value={mdl} onChange={e => { setMdl(e.target.value); setModelError(''); }} list="assistant-models"
          placeholder="provider/model-id — type to search"
          className={`w-full px-2 py-1.5 text-xs outline-none ${inputCls}`} />
        <datalist id="assistant-models">
          {ids.map(id => <option key={id} value={id} />)}
        </datalist>
        {modelError && <p className="text-[10px] leading-snug text-red-500">{modelError}</p>}
      </div>
      <div className="space-y-1">
        <div className={labelCls}>
          Endpoint
          <InfoTip text="Any OpenAI-compatible endpoint works. Default is OpenRouter; point it at a local runtime (e.g. Ollama) for a fully offline assistant." />
        </div>
        <input type="text" value={url} onChange={e => setUrl(e.target.value)}
          className={`w-full px-2 py-1.5 text-xs outline-none ${inputCls}`} />
      </div>
      <div className="flex gap-2">
        <button
          onClick={trySave}
          disabled={!key.trim() || !mdl.trim() || !url.trim()}
          className={`flex-1 py-1.5 text-xs font-bold disabled:opacity-30 cursor-pointer ${primary
            ? 'bauhaus-btn bg-[var(--p-blue)] text-white'
            : 'border border-[var(--system-green)]/60 text-[var(--system-green)] hover:bg-[var(--system-green)]/10'}`}
        >
          Save
        </button>
        {apiKey && (
          <button onClick={onClearKey} className="px-3 py-1.5 text-xs underline-offset-2 hover:underline opacity-60 cursor-pointer">
            Remove key
          </button>
        )}
      </div>
    </div>
  );
};

const FeedbackControls = ({ primary, state, onRate, onReason, onDismiss }: {
  primary: boolean,
  state?: { rating: 'up' | 'down'; askWhy: boolean; done: boolean },
  onRate: (r: 'up' | 'down') => void,
  onReason: (reason: string, includeExchange: boolean) => void,
  onDismiss: () => void,
}) => {
  const [reason, setReason] = useState('');
  const [include, setInclude] = useState(true);
  const chosen = state?.rating;
  const whyRef = useRef<HTMLDivElement>(null);
  // the box appears below the fold when rating the last message — bring it into view
  useEffect(() => {
    if (state?.askWhy) whyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [state?.askWhy]);

  return (
    <div className="mt-1 select-none">
      <div className="flex justify-end gap-1.5">
        {(['up', 'down'] as const).map(r => {
          const Icon = r === 'up' ? ThumbsUp : ThumbsDown;
          const active = chosen === r;
          return (
            <button
              key={r}
              onClick={() => onRate(r)}
              disabled={!!chosen}
              title={chosen ? 'Feedback recorded' : r === 'up' ? 'Helpful' : 'Not helpful'}
              className={`p-0.5 transition-opacity cursor-pointer disabled:cursor-default ${active
                ? (primary ? 'text-[var(--p-blue)] opacity-100' : 'text-[var(--system-green)] opacity-100')
                : chosen ? 'opacity-15' : 'opacity-30 hover:opacity-80'}`}
            >
              <Icon className="w-3 h-3" />
            </button>
          );
        })}
        {state?.done && <span className="text-[9px] opacity-40 self-center">thanks ✓</span>}
      </div>
      {state?.askWhy && (
        <div ref={whyRef} className={`mt-1 p-2 space-y-1.5 text-[10px] ${primary ? 'border border-[#111111]/30 bg-black/[0.03]' : 'border border-[var(--system-green)]/25 bg-[var(--system-green)]/5'}`}>
          <div className="opacity-70">Mind saying why? (optional)</div>
          <textarea
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            className={`w-full px-1.5 py-1 text-[10px] outline-none resize-none ${primary ? 'bg-white border border-[#111111]/40' : 'bg-[var(--input)] border border-[var(--border)] text-[var(--foreground)]'}`}
            placeholder={chosen === 'up'
              ? 'e.g. did exactly what I meant, clear interpretation, good parameter pick…'
              : 'e.g. wrong column, k didn\u2019t match the data, explanation unclear…'}
          />
          <label className="flex items-start gap-1.5 cursor-pointer opacity-70">
            <input type="checkbox" checked={include} onChange={e => setInclude(e.target.checked)} className="mt-0.5" />
            <span>Include this exchange (your message + the reply — may contain column names/summaries) to help debugging</span>
          </label>
          <div className="flex gap-2 justify-end">
            <button onClick={onDismiss} className="underline-offset-2 hover:underline opacity-50 cursor-pointer">no thanks</button>
            <button
              onClick={() => onReason(reason, include)}
              className={`px-2 py-0.5 font-bold cursor-pointer ${primary ? 'bauhaus-btn bg-[var(--p-blue)] text-white' : 'border border-[var(--system-green)]/60 text-[var(--system-green)] hover:bg-[var(--system-green)]/10'}`}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
