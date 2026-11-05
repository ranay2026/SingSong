// GET /api/credits — remaining sunoapi.org credits for the account.
import { guard, json, handleError, getCredits } from '../lib/suno.mjs';

export default async (req) => {
  const blocked = guard(req);
  if (blocked) return blocked;
  try {
    return json({ credits: await getCredits() });
  } catch (err) {
    return handleError(err);
  }
};

export const config = { path: '/api/credits' };
