// GET /api/health — diagnostics for setup problems. Never reveals the key itself.
import { json, getCredits, SunoError } from '../lib/suno.mjs';

export default async () => {
  const raw = process.env.SUNO_API_KEY || '';
  const key = raw.trim();
  const report = {
    functionsDeployed: true,
    apiKeyConfigured: Boolean(key),
    apiKeyLength: key.length,
    apiKeyHadWhitespace: raw !== key,
    passwordEnabled: Boolean(process.env.APP_PASSWORD),
    siteUrl: process.env.URL || null,
    sunoReachable: null,
    credits: null,
    problem: null,
  };
  if (!key) {
    report.problem = 'SUNO_API_KEY is not set. Add it in Netlify → Site configuration → Environment variables (scope: Functions or All), then trigger a new deploy.';
    return json(report, 500);
  }
  try {
    report.credits = await getCredits();
    report.sunoReachable = true;
  } catch (err) {
    report.sunoReachable = err instanceof SunoError && err.code !== undefined;
    report.problem = err.message;
    report.sunoCode = err.code ?? null;
  }
  return json(report, report.problem ? 502 : 200);
};

export const config = { path: '/api/health' };
