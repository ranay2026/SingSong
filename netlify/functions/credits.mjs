// GET /api/credits — remaining sunoapi.org credits for the account.
import { guard, suno, json, handleError } from '../lib/suno.mjs';

export default async (req) => {
  const blocked = guard(req);
  if (blocked) return blocked;
  try {
    const data = await suno('/api/v1/generate/credit');
    return json({ credits: typeof data.data === 'number' ? data.data : Number(data.data) || 0 });
  } catch (err) {
    return handleError(err);
  }
};

export const config = { path: '/api/credits' };
