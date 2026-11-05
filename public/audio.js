// Browser-side audio helpers: record a voice note and convert any clip to a small
// mono WAV so it fits within Netlify's ~6 MB function body limit and is in a
// format Suno reliably accepts (WhatsApp .opus / browser .webm aren't always).

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_RECORD_SECONDS = 120;

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

async function decode(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await blob.arrayBuffer();
    return await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  } finally {
    ctx.close && ctx.close();
  }
}

async function renderMono(audioBuffer, rate) {
  const length = Math.ceil(audioBuffer.duration * rate);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Offline(1, length, rate);
  const src = off.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  // Normalise quiet phone recordings so Suno can hear the melody.
  const data = rendered.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0.01 && peak < 0.9) {
    const gain = 0.9 / peak;
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
  return data;
}

/**
 * Make a voice note upload-ready.
 * Returns { blob, duration, note } or throws an Error with a friendly message.
 */
export async function prepareAudio(blob) {
  let decoded = null;
  try {
    decoded = await decode(blob);
  } catch {
    decoded = null;
  }

  if (decoded) {
    const dur = decoded.duration;
    if (dur < 3) throw new Error('That clip is very short — record at least a few seconds (6+ works best).');
    // Choose a sample rate that keeps the WAV under the upload limit.
    const rate = [24000, 22050, 16000].find((r) => dur * r * 2 + 44 <= MAX_UPLOAD_BYTES);
    if (rate) {
      const samples = await renderMono(decoded, rate);
      return { blob: encodeWav(samples, rate), duration: dur, note: '' };
    }
    // Too long for WAV — send the original compressed file if it's small enough.
    if (blob.size <= MAX_UPLOAD_BYTES && /mpeg|mp3|mp4|m4a|aac/.test(blob.type || '')) {
      return { blob, duration: dur, note: '' };
    }
    throw new Error(`That clip is ${Math.round(dur)}s long. Please trim it to about 2 minutes.`);
  }

  // Browser couldn't decode it — upload as-is if it's small.
  if (blob.size <= MAX_UPLOAD_BYTES) return { blob, duration: null, note: 'Uploaded in its original format.' };
  throw new Error('That file is too large (max 4 MB) and couldn’t be converted in your browser.');
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the audio file.'));
    r.readAsDataURL(blob);
  });
}

/** Simple MediaRecorder wrapper. */
export class Recorder {
  constructor() {
    this.chunks = [];
    this.stream = null;
    this.rec = null;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data && e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec) return resolve(null);
      this.rec.onstop = () => {
        this.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
        this.rec = null;
        resolve(blob);
      };
      this.rec.stop();
    });
  }
}
