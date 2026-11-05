// GET /api/status?taskId=... — poll a music task (works for generate, upload-cover and add-instrumental).
import { guard, suno, json, handleError } from '../lib/suno.mjs';
import { summarise } from '../lib/tasks.mjs';

export default async (req) => {
  const blocked = guard(req);
  if (blocked) return blocked;
  const taskId = new URL(req.url).searchParams.get('taskId');
  if (!taskId || !/^[\w-]{1,128}$/.test(taskId)) return json({ error: 'Missing or invalid taskId.' }, 400);

  try {
    const data = await suno(`/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
    return json(summarise(data.data || {}));
  } catch (err) {
    return handleError(err);
  }
};

export const config = { path: '/api/status' };
