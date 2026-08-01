"use client";
import { useEffect, useRef, useState } from 'react';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Sparkles, Settings2, X, CornerDownLeft } from 'lucide-react';
import {
  AppBridge, DEFAULT_BASE_URL, DEFAULT_MODEL, MUTATING_TOOLS,
  runAssistantTurn, fetchModels, describeApiError,
} from '@/lib/assistant';

// Chat entries for display; the wire-format history is kept separately
type ChatEntry = { kind: 'user' | 'assistant' | 'tool' | 'error'; text: string };

const LS = {
  key: 'scatterlab.assistant.key',
  model: 'scatterlab.assistant.model',
  baseURL: 'scatterlab.assistant.baseurl',
};

export const AssistantPanel = ({ bridgeRef, theme, askRef }: {
  bridgeRef: React.MutableRefObject<AppBridge>,
  theme: string | undefined,
  askRef?: React.MutableRefObject<((q: string) => void) | null>,
}) => {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);
  const [models, setModels] = useState<string[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<ChatCompletionMessageParam[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Undo: view-state snapshot taken before the last mutating turn
  const [undoSnap, setUndoSnap] = useState<unknown>(null);

  useEffect(() => {
    setApiKey(localStorage.getItem(LS.key) ?? '');
    setModel(localStorage.getItem(LS.model) ?? DEFAULT_MODEL);
    setBaseURL(localStorage.getItem(LS.baseURL) ?? DEFAULT_BASE_URL);
  }, []);

  useEffect(() => {
    if (apiKey && open) fetchModels(baseURL, apiKey).then(setModels);
  }, [apiKey, baseURL, open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat]);

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
        className={`absolute bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider cursor-pointer ${primary
          ? 'bauhaus-btn bg-[var(--p-red)] text-white'
          : 'bg-black/80 border border-[var(--system-green)]/60 text-[var(--system-green)] hover:bg-[var(--system-green)]/10'}`}
      >
        <Sparkles className="w-4 h-4" /> Assistant
      </button>
    );
  }

  return (
    <div className={`absolute bottom-4 right-4 z-40 w-[360px] flex flex-col ${panelCls}`} style={{ maxHeight: 'min(560px, calc(100% - 2rem))' }}>
      {/* header */}
      <div className={`flex items-center justify-between px-3 py-2 flex-shrink-0 ${headerCls}`}>
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
          <Sparkles className="w-3.5 h-3.5" /> Assistant
        </span>
        <span className="flex items-center gap-1">
          <button onClick={() => setShowSettings(s => !s)} title="Assistant settings" className="p-1 hover:opacity-60 cursor-pointer">
            <Settings2 className="w-4 h-4" />
          </button>
          <button onClick={() => setOpen(false)} title="Close assistant" className="p-1 hover:opacity-60 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </span>
      </div>

      {(!apiKey || showSettings) ? (
        <SettingsForm
          primary={primary}
          inputCls={inputCls}
          apiKey={apiKey} model={model} baseURL={baseURL} models={models}
          onSave={(k, m, u) => { saveSettings(k, m, u); setShowSettings(false); }}
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
            <div className="flex gap-1.5">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send(); }}
                aria-label="Message the assistant"
                placeholder={busy ? 'Working…' : 'Ask or instruct…'}
                disabled={busy}
                className={`flex-1 min-w-0 px-2 py-1.5 text-xs outline-none ${inputCls}`}
              />
              <button
                onClick={() => send()}
                disabled={busy || !input.trim()}
                title="Send"
                className={`px-2.5 disabled:opacity-30 cursor-pointer ${primary ? 'bauhaus-btn bg-[var(--p-blue)] text-white' : 'border border-[var(--system-green)]/60 text-[var(--system-green)] hover:bg-[var(--system-green)]/10'}`}
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

const SettingsForm = ({ primary, inputCls, apiKey, model, baseURL, models, onSave, onClearKey }: {
  primary: boolean, inputCls: string,
  apiKey: string, model: string, baseURL: string, models: string[],
  onSave: (key: string, model: string, baseURL: string) => void,
  onClearKey: () => void,
}) => {
  const [key, setKey] = useState(apiKey);
  const [mdl, setMdl] = useState(model);
  const [url, setUrl] = useState(baseURL);
  const labelCls = 'text-[10px] font-bold uppercase tracking-wider opacity-60';

  return (
    <div className="px-3 py-3 space-y-2.5 overflow-y-auto">
      {!apiKey && (
        <p className="text-[11px] leading-snug opacity-70">
          The assistant runs on your own key. Get one at{' '}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="underline">openrouter.ai/keys</a>{' '}
          — one key works for Claude, GPT, Gemini, and more. The key is stored only in this
          browser and is never included in exported workspaces.
        </p>
      )}
      <div className="space-y-1">
        <div className={labelCls}>API key</div>
        <input type="password" value={key} onChange={e => setKey(e.target.value)}
          placeholder="sk-or-…" className={`w-full px-2 py-1.5 text-xs outline-none ${inputCls}`} />
      </div>
      <div className="space-y-1">
        <div className={labelCls}>Model</div>
        <input type="text" value={mdl} onChange={e => setMdl(e.target.value)} list="assistant-models"
          className={`w-full px-2 py-1.5 text-xs outline-none ${inputCls}`} />
        <datalist id="assistant-models">
          {models.map(m => <option key={m} value={m} />)}
        </datalist>
      </div>
      <div className="space-y-1">
        <div className={labelCls}>Endpoint (OpenAI-compatible)</div>
        <input type="text" value={url} onChange={e => setUrl(e.target.value)}
          className={`w-full px-2 py-1.5 text-xs outline-none ${inputCls}`} />
        <p className="text-[9px] opacity-40 leading-snug">
          Default is OpenRouter. Point this at a local runtime (e.g. Ollama) for a fully offline assistant.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => key.trim() && onSave(key.trim(), mdl.trim(), url.trim().replace(/\/$/, ''))}
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
