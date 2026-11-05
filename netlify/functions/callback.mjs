// POST /api/callback — Suno requires a callBackUrl. The app polls /api/status for
// results, so this endpoint simply acknowledges the notification.
export default async (req) => {
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const d = body && body.data;
      console.log('Suno callback', d && d.task_id, d && d.callbackType, body && body.code);
    } catch {
      /* ignore malformed callbacks */
    }
  }
  return new Response(JSON.stringify({ status: 'received' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const config = { path: '/api/callback' };
