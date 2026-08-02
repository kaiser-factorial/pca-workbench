// OpenRouter OAuth (PKCE): users click "Connect", approve on openrouter.ai,
// and the app receives a scoped runtime key — no copy-pasting keys.
// Flow per https://openrouter.ai/docs/use-cases/oauth-pkce:
//   1. redirect to openrouter.ai/auth with a SHA-256 code challenge
//   2. OpenRouter redirects back with ?code=
//   3. exchange code + verifier at /api/v1/auth/keys for the key

const VERIFIER_KEY = 'scatterlab.pkce.verifier';

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const buildAuthUrl = (challenge: string): string => {
  const callback = window.location.origin + window.location.pathname;
  return `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`;
};

export const startOpenRouterOAuth = async (): Promise<void> => {
  const raw = new Uint8Array(48);
  crypto.getRandomValues(raw);
  const verifier = base64url(raw);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  window.location.href = buildAuthUrl(base64url(new Uint8Array(digest)));
};

// Call on page load. Returns the new API key when the URL carries a valid
// OAuth callback, null when there is nothing to do. Scrubs ?code= from the
// URL either way so stale codes don't linger in history.
export const completeOpenRouterOAuth = async (): Promise<string | null> => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return null;
  window.history.replaceState({}, '', window.location.pathname);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) return null; // not our flow (or a replay) — ignore
  sessionStorage.removeItem(VERIFIER_KEY);
  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!res.ok) throw new Error(`OpenRouter key exchange failed (HTTP ${res.status}).`);
  const data = await res.json();
  if (typeof data?.key !== 'string') throw new Error('OpenRouter returned no key.');
  return data.key;
};
