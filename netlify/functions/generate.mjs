// POST /api/generate — start a Suno music task.
// Modes:
//   simple     → /api/v1/generate (customMode: false), lyrics written by Suno
//   custom     → /api/v1/generate (customMode: true), your own title/style/lyrics
//   inspire    → /api/v1/generate with audioUrls, a full-length new song guided by a voice note + description
//   cover      → /api/v1/generate/upload-cover, re-records the voice note keeping its melody (optional duration)
//   extend     → /api/v1/generate/upload-extend, continues the song from the end of the voice note
//   accompany  → /api/v1/generate/add-instrumental, keeps your voice and adds backing music
//   remix      → /api/v1/generate/upload-cover with taskId+audioId, re-records a chosen take (pace / feel / re-record)
//   extendTrack→ /api/v1/generate/extend, makes a chosen take longer
import { guard, suno, json, handleError, callbackUrl } from '../lib/suno.mjs';
import { buildRequest } from '../lib/tasks.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const blocked = guard(req);
  if (blocked) return blocked;

  let input;
  try {
    input = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  let request;
  try {
    request = buildRequest(input || {}, callbackUrl(req));
  } catch (err) {
    return json({ error: err.message }, 400);
  }

  try {
    const data = await suno(request.path, { method: 'POST', body: request.body });
    const taskId = data.data && data.data.taskId;
    if (!taskId) return json({ error: 'Suno did not return a task id.' }, 502);
    return json({ taskId });
  } catch (err) {
    return handleError(err);
  }
};

export const config = { path: '/api/generate' };
