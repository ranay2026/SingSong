// Shared helpers for talking to sunoapi.org from Netlify Functions.
// The API key lives ONLY in the Netlify environment variable SUNO_API_KEY,
// so it is never shipped to the browser.

export const API_BASE = 'https://api.sunoapi.org';
export const UPLOAD_BASE = 'https://sunoapiorg.redpandaai.co';

// Current (non-deprecated) models per the docs.
export const MODELS = ['V6', 'V6_WILD', 'V6_MINI'];

const FRIENDLY = {
  400: 'The request had invalid or missing parameters.',
  401: 'The Suno API key was rejected. Check SUNO_API_KEY in Netlify.',
  404: 'Unknown API path.',
  405: 'Rate limit exceeded. Please wait a moment and try again.',
  413: 'Your prompt, lyrics or style text is too long.',
  429: 'The account is out of Suno credits.',
  430: 'Too many requests. Please slow down and try again shortly.',
  455: 'Suno API is under maintenance. Try again later.',
  500: 'Suno API had a server error. Try again.',
};

export class SunoError extends Error {
  constructor(message, status = 502, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Raw key value. Accepts any capitalisation (SUNO_API_KEY, Suno_API_Key, …). */
export function rawApiKey() {
  if (process.env.SUNO_API_KEY) return process.env.SUNO_API_KEY;
  const name = Object.keys(process.env).find((k) => k.toUpperCase() === 'SUNO_API_KEY');
  return name ? process.env[name] : '';
}

function apiKey() {
  return (rawApiKey() || '').trim();
}

/**
 * Common checks for every function. Returns a Response to send back if the
 * request should stop, or null when it may continue.
 * Optional APP_PASSWORD env var gates the whole app so strangers can't spend credits.
 */
export function guard(req) {
  if (!apiKey()) {
    return json({ error: 'Server is missing SUNO_API_KEY. Add it in Netlify → Site configuration → Environment variables, then redeploy.' }, 500);
  }
  const password = process.env.APP_PASSWORD;
  if (password && req.headers.get('x-app-password') !== password) {
    return json({ error: 'Password required.', code: 'password' }, 401);
  }
  return null;
}

export async function suno(path, { method = 'GET', body, base = API_BASE } = {}) {
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new SunoError('Could not reach the Suno API: ' + err.message, 502);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  const code = data && typeof data.code === 'number' ? data.code : res.status;
  if (!res.ok || !data || code !== 200 || data.success === false) {
    const msg = FRIENDLY[code] || 'Suno API error.';
    const detail = data && data.msg && data.msg !== 'success' ? ` (${data.msg})` : '';
    const status = code === 429 || code === 430 || code === 405 ? 429 : code >= 400 && code < 500 ? 400 : 502;
    throw new SunoError(msg + detail, status, code);
  }
  return data;
}

/** Where Suno should POST completion notifications. We poll anyway, so this just acks. */
export function callbackUrl(req) {
  const base = process.env.URL || new URL(req.url).origin;
  return `${base.replace(/\/$/, '')}/api/callback`;
}

export function handleError(err) {
  if (err instanceof SunoError) return json({ error: err.message, code: err.code }, err.status);
  console.error(err);
  return json({ error: 'Unexpected server error.' }, 500);
}

/** Trim a string and clamp it to max chars; returns '' for non-strings. */
export function clean(value, max) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  return max ? v.slice(0, max) : v;
}

export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

/** Normalise a track from record-info (docs show both camelCase and snake_case). */
export function normaliseTrack(t = {}) {
  return {
    id: t.id || '',
    title: t.title || 'Untitled',
    tags: t.tags || '',
    lyrics: t.prompt || '',
    duration: Number(t.duration) || null,
    audioUrl: t.audioUrl || t.audio_url || t.sourceAudioUrl || t.source_audio_url || '',
    streamUrl: t.streamAudioUrl || t.stream_audio_url || t.sourceStreamAudioUrl || t.source_stream_audio_url || '',
    imageUrl: t.imageUrl || t.image_url || t.sourceImageUrl || t.source_image_url || '',
    model: t.modelName || t.model_name || '',
  };
}

/** Read the credit balance. The docs list /api/v1/generate/credit; the quickstart uses /api/v1/get-credits. */
export async function getCredits() {
  let data;
  try {
    data = await suno('/api/v1/generate/credit');
  } catch (err) {
    if (err.code !== 404) throw err;
    data = await suno('/api/v1/get-credits');
  }
  const d = data.data;
  const n = typeof d === 'number' ? d : Number(d && typeof d === 'object' ? d.credits ?? d.balance : d);
  if (!Number.isFinite(n)) throw new SunoError('Suno returned an unexpected credits format.', 502);
  return n;
}
