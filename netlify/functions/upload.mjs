// POST /api/upload — send a voice note (base64 data URL) to Suno's temporary file storage.
// Returns a public downloadUrl that the cover / add-instrumental endpoints can read.
// Files are deleted automatically by sunoapi.org after 3 days.
import { guard, suno, json, handleError, UPLOAD_BASE } from '../lib/suno.mjs';

// Netlify synchronous functions accept ~6 MB request bodies.
const MAX_BASE64_CHARS = 5_800_000;
const EXT = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/flac': 'flac' };

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const blocked = guard(req);
  if (blocked) return blocked;

  let input;
  try {
    input = await req.json();
  } catch {
    return json({ error: 'Voice note is too large or the upload was malformed.' }, 400);
  }

  const dataUrl = typeof input?.base64Data === 'string' ? input.base64Data : '';
  const match = /^data:(audio\/[\w.+-]+)(?:;[\w=.-]+)*;base64,/.exec(dataUrl);
  if (!match) return json({ error: 'Please upload an audio file.' }, 400);
  if (dataUrl.length > MAX_BASE64_CHARS) return json({ error: 'Voice note is too large (max ~4 MB). Try a shorter clip.' }, 413);

  const ext = EXT[match[1]] || 'audio';
  const fileName = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const data = await suno('/api/file-base64-upload', {
      method: 'POST',
      base: UPLOAD_BASE,
      body: { base64Data: dataUrl, uploadPath: 'singsong/voice-notes', fileName },
    });
    const url = data.data && data.data.downloadUrl;
    if (!url) return json({ error: 'Upload succeeded but no URL was returned.' }, 502);
    return json({ url });
  } catch (err) {
    return handleError(err);
  }
};

export const config = { path: '/api/upload' };
