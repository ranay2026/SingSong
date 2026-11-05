// Pure request/response mapping logic (unit-testable, no network).
import { clean, clamp01, MODELS, normaliseTrack } from './suno.mjs';

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export const VOICE_MODES = ['inspire', 'cover', 'extend', 'accompany'];

function joinStyle(style, notes) {
  return [style, notes].filter(Boolean).join('. ').slice(0, 1000);
}

export function buildRequest(input, cbUrl) {
  const mode = input.mode;
  const model = MODELS.includes(input.model) ? input.model : 'V6';
  const instrumental = Boolean(input.instrumental);
  const vocalGender = input.vocalGender === 'm' || input.vocalGender === 'f' ? input.vocalGender : undefined;
  const title = clean(input.title, 80);
  const style = clean(input.style, 1000);
  const lyrics = clean(input.lyrics, 5000);
  const negativeTags = clean(input.negativeTags, 1000);

  if (mode === 'simple') {
    const prompt = clean(input.prompt, 3000);
    if (!prompt && !style) throw new Error('Describe the song you want.');
    return {
      path: '/api/v1/generate',
      body: {
        customMode: false,
        instrumental,
        model,
        prompt,
        // Non-custom mode requires at least one of style/lyrics/attachments,
        // so fall back to the description when no explicit style is given.
        style: style || prompt.slice(0, 1000),
        callBackUrl: cbUrl,
      },
    };
  }

  if (mode === 'custom') {
    if (!style && !lyrics && !negativeTags) throw new Error('Add a style or some lyrics.');
    if (!instrumental && !lyrics) throw new Error('Add lyrics, or tick "Instrumental".');
    const body = { customMode: true, instrumental, model, callBackUrl: cbUrl };
    if (title) body.title = title;
    if (style) body.style = style;
    if (!instrumental) body.lyrics = lyrics;
    if (negativeTags) body.negativeTags = negativeTags;
    if (vocalGender && !instrumental) body.vocalGender = vocalGender;
    return { path: '/api/v1/generate', body };
  }

  if (VOICE_MODES.includes(mode)) {
    const uploadUrl = clean(input.uploadUrl, 2000);
    if (!isHttpUrl(uploadUrl)) throw new Error('Upload or record a voice note first.');
    const audioWeight = clamp01(input.audioWeight);
    const description = clean(input.description, 3000);
    // Endpoints other than "inspire" have no free-text prompt field, so the
    // description is folded into the style text, which Suno reads as guidance.
    const styleWithNotes = joinStyle(style, description);

    if (mode === 'inspire') {
      // Full-length NEW song, using the voice note as an audio reference.
      // Non-custom mode: prompt = the idea, lyrics = optional attachment Suno can expand on.
      const body = { customMode: false, instrumental, model, audioUrls: [uploadUrl], callBackUrl: cbUrl };
      const prompt = clean([description, title ? `Title: ${title}` : ''].filter(Boolean).join('\n'), 3000);
      if (prompt) body.prompt = prompt;
      if (style) body.style = style;
      if (lyrics && !instrumental) body.lyrics = lyrics;
      return { path: '/api/v1/generate', body };
    }

    if (mode === 'cover') {
      // Re-records the voice note keeping its melody. `duration` lets it run longer than the clip.
      // Suno only sings what is in `lyrics` (it does not transcribe the upload), so
      // without lyrics the result is an instrumental.
      if (!instrumental && !lyrics) {
        throw new Error('Keep my melody needs lyrics to sing. Type the words from your recording, or turn on Instrumental.');
      }
      const body = { uploadUrl, model, instrumental, callBackUrl: cbUrl };
      if (title) body.title = title;
      if (styleWithNotes) body.style = styleWithNotes;
      if (lyrics && !instrumental) body.lyrics = lyrics;
      if (negativeTags) body.negativeTags = negativeTags;
      if (vocalGender && !instrumental) body.vocalGender = vocalGender;
      if (audioWeight !== undefined) body.audioWeight = audioWeight;
      const duration = Math.round(Number(input.duration));
      if (Number.isFinite(duration) && duration >= 10) body.duration = Math.min(360, duration);
      return { path: '/api/v1/generate/upload-cover', body };
    }

    if (mode === 'extend') {
      // Keeps the voice note and continues the song from where it ends (e.g. into a bridge/chorus).
      const body = { uploadUrl, model, instrumental, callBackUrl: cbUrl };
      const extTitle = clean(input.title, 100);
      if (extTitle) body.title = extTitle;
      if (styleWithNotes) body.style = styleWithNotes;
      if (lyrics && !instrumental) body.lyrics = lyrics;
      if (negativeTags) body.negativeTags = negativeTags;
      if (vocalGender && !instrumental) body.vocalGender = vocalGender;
      if (audioWeight !== undefined) body.audioWeight = audioWeight;
      const src = Number(input.sourceDuration);
      // continueAt must be > 0 and < the clip length; continue from just before the end.
      if (Number.isFinite(src) && src > 2) body.continueAt = Math.floor((src - 0.5) * 10) / 10;
      return { path: '/api/v1/generate/upload-extend', body };
    }

    // accompany → add-instrumental requires title, tags and negativeTags.
    const body = {
      uploadUrl,
      model,
      title: title || 'My SingSong',
      tags: styleWithNotes || 'acoustic pop, warm, full band',
      negativeTags: negativeTags || 'noise, distortion, low quality',
      callBackUrl: cbUrl,
    };
    if (audioWeight !== undefined) body.audioWeight = audioWeight;
    return { path: '/api/v1/generate/add-instrumental', body };
  }

  throw new Error('Unknown mode.');
}

const FAILED = new Set(['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'CALLBACK_EXCEPTION', 'SENSITIVE_WORD_ERROR', 'FAILED']);
const FAIL_TEXT = {
  CREATE_TASK_FAILED: 'Suno could not create the task.',
  GENERATE_AUDIO_FAILED: 'Suno failed to generate the audio.',
  SENSITIVE_WORD_ERROR: 'Your text contains words Suno does not allow. Try rephrasing.',
};

export function summarise(data = {}) {
  const status = data.status || 'PENDING';
  const response = data.response || {};
  const rawTracks = response.sunoData || response.data || [];
  const tracks = (Array.isArray(rawTracks) ? rawTracks : []).map(normaliseTrack);
  const failed = FAILED.has(status);
  // CALLBACK_EXCEPTION only means Suno couldn't reach our callback; tracks may still exist.
  const done = status === 'SUCCESS' || (status === 'CALLBACK_EXCEPTION' && tracks.some((t) => t.audioUrl));
  return {
    status,
    done,
    failed: failed && !done,
    error: failed && !done ? data.errorMessage || FAIL_TEXT[status] || 'Generation failed.' : null,
    tracks,
  };
}

