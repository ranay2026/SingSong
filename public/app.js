import { prepareAudio, blobToDataUrl, Recorder, MAX_RECORD_SECONDS } from './audio.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const HISTORY_KEY = 'singsong.jobs.v1';
const PASSWORD_KEY = 'singsong.password';
const POLL_MS = 5000;
const MAX_POLL_MS = 15 * 60 * 1000;

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode etc. */
    }
  },
};

// ---------- API ----------
async function api(path, options = {}) {
  const password = store.get(PASSWORD_KEY, '');
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}) };
  if (password) headers['x-app-password'] = password;
  const res = await fetch(path, { ...options, headers });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {
      error:
        res.status === 413 ? 'That file is too large.'
        : res.status === 404 ? 'API not found (404) — the Netlify Functions did not deploy. Check the Functions tab in Netlify.'
        : `Server error (${res.status}).`,
    };
  }
  if (res.status === 401 && data.code === 'password') {
    const entered = window.prompt('This SingSong is private. Enter the password:');
    if (entered) {
      store.set(PASSWORD_KEY, entered);
      return api(path, options);
    }
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function refreshCredits() {
  const el = $('#credits');
  try {
    const { credits } = await api('/api/credits');
    el.querySelector('span').textContent = `${credits.toLocaleString()} credits`;
    el.classList.toggle('low', credits < 20);
    el.title = 'Remaining sunoapi.org credits';
    el.classList.remove('err');
  } catch (err) {
    // Show the real reason instead of hiding it.
    el.querySelector('span').textContent = 'Credits unavailable';
    el.title = err.message + ' (click for details)';
    el.classList.add('err');
    console.warn('Credits check failed:', err.message);
  }
}
$('#credits').addEventListener('click', () => {
  const el = $('#credits');
  if (el.classList.contains('err')) {
    showError(`Couldn't load credits: ${el.title.replace(' (click for details)', '')} — open /api/health for a full diagnosis.`);
  } else {
    refreshCredits();
  }
});

// ---------- Tabs ----------
let mode = 'simple';
function setMode(next) {
  mode = next;
  $$('.tab').forEach((t) => {
    const on = t.dataset.mode === next;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== next));
  $$('[data-hide-in-mode]').forEach((el) => (el.hidden = el.dataset.hideInMode === next));
  syncVoiceMode();
  hideError();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

function voiceMode() {
  return $('input[name="voiceMode"]:checked').value;
}
const LYRICS_HINT = {
  inspire: '(optional — paste what you have and Suno will expand on it)',
  cover: '(needed for vocals — type the words you sang; Suno can’t pick them up from the recording)',
  extend: '(optional — lyrics for the part that comes next, e.g. a [Bridge])',
};
function syncVoiceMode() {
  const vm = mode === 'voice' ? voiceMode() : null;
  $$('[data-only-voice]').forEach((el) => (el.hidden = vm !== el.dataset.onlyVoice));
  $$('[data-hide-for-voice]').forEach((el) => (el.hidden = vm === el.dataset.hideForVoice));
  $$('[data-hide-for="accompany"]').forEach((el) => (el.hidden = vm === 'accompany'));
  if (vm && LYRICS_HINT[vm]) $('#voiceLyricsHint').textContent = LYRICS_HINT[vm];
}
$$('input[name="voiceMode"]').forEach((r) => r.addEventListener('change', syncVoiceMode));

// One instrumental setting, two switches (Write tab + More options).
const instrMain = $('#instrumental');
const instrWrite = $('#instrumentalWrite');
instrWrite.addEventListener('change', () => (instrMain.checked = instrWrite.checked));
instrMain.addEventListener('change', () => (instrWrite.checked = instrMain.checked));

// Suggestion chips fill their target field.
$$('.chips').forEach((group) => {
  group.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const target = $('#' + group.dataset.target);
    if ('append' in group.dataset && target.value.trim()) {
      const cur = target.value.trim();
      target.value = `${cur}${/[.!?]$/.test(cur) ? '' : '.'} ${chip.textContent}.`;
    } else {
      target.value = chip.textContent + ('append' in group.dataset ? '.' : '');
    }
    target.focus();
  });
});

// Character counter for lyrics
const lyricsEl = $('#lyrics');
lyricsEl.addEventListener('input', () => {
  $('[data-count="lyrics"]').textContent = `${lyricsEl.value.length} / 5000`;
});

const weight = $('#audioWeight');
weight.addEventListener('input', () => ($('#audioWeightOut').textContent = `${weight.value}%`));

// ---------- Voice note ----------
let voice = null; // { blob, url (uploaded), duration }
const recorder = new Recorder();
let recTimer = null;
let recStart = 0;

function fmtTime(s) {
  if (s == null || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

async function useAudio(blob, label) {
  hideError();
  $('#voiceInfo').textContent = 'Preparing…';
  $('#voicePreview').hidden = false;
  try {
    const prepared = await prepareAudio(blob);
    voice = { blob: prepared.blob, url: null, duration: prepared.duration };
    const audio = $('#voiceAudio');
    if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
    audio.dataset.url = URL.createObjectURL(prepared.blob);
    audio.src = audio.dataset.url;
    const short = prepared.duration && prepared.duration < 6 ? ' · a bit short, 6s+ works best' : '';
    $('#voiceInfo').textContent = `${label}${prepared.duration ? ' · ' + fmtTime(prepared.duration) : ''}${short}${prepared.note ? ' · ' + prepared.note : ''}`;
    $('#voiceBox').classList.add('has-voice');
  } catch (err) {
    clearVoice();
    showError(err.message);
  }
}

function clearVoice() {
  voice = null;
  const audio = $('#voiceAudio');
  if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
  audio.removeAttribute('src');
  delete audio.dataset.url;
  $('#voicePreview').hidden = true;
  $('#voiceBox').classList.remove('has-voice');
  $('#fileInput').value = '';
}
$('#clearVoice').addEventListener('click', clearVoice);

$('#fileInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) useAudio(file, file.name);
});

const recBtn = $('#recBtn');
if (!Recorder.supported()) {
  recBtn.disabled = true;
  $('#recLabel').textContent = 'Recording not supported';
}
recBtn.addEventListener('click', async () => {
  if (recBtn.classList.contains('recording')) return stopRecording();
  try {
    await recorder.start();
  } catch {
    showError('Microphone access was blocked. Allow it in your browser, or upload a file instead.');
    return;
  }
  recBtn.classList.add('recording');
  recStart = Date.now();
  recTimer = setInterval(() => {
    const s = (Date.now() - recStart) / 1000;
    $('#recLabel').textContent = `Recording ${fmtTime(s)} — tap to stop`;
    if (s >= MAX_RECORD_SECONDS) stopRecording();
  }, 250);
  $('#recLabel').textContent = 'Recording 0:00 — tap to stop';
});

async function stopRecording() {
  clearInterval(recTimer);
  recBtn.classList.remove('recording');
  $('#recLabel').textContent = 'Tap to re-record';
  const blob = await recorder.stop();
  if (blob && blob.size) useAudio(blob, 'Voice note');
}

// ---------- Form ----------
function showError(msg) {
  const el = $('#formError');
  el.textContent = msg;
  el.hidden = false;
}
function hideError() {
  $('#formError').hidden = true;
}

function setBusy(busy, label) {
  const btn = $('#goBtn');
  btn.disabled = busy;
  btn.classList.toggle('busy', busy);
  $('span', btn).textContent = label || 'Create my song';
}

function collect() {
  const common = {
    model: $('#model').value,
    vocalGender: $('#vocalGender').value,
    instrumental: $('#instrumental').checked,
    negativeTags: $('#negativeTags').value,
  };
  if (mode === 'simple') {
    const prompt = $('#prompt').value.trim();
    if (!prompt) throw new Error('Tell us what the song should be about.');
    return { ...common, mode: 'simple', prompt, style: $('#simpleStyle').value, label: prompt };
  }
  if (mode === 'custom') {
    const style = $('#style').value.trim();
    const lyrics = $('#lyrics').value.trim();
    if (!style && !lyrics) throw new Error('Add a style or some lyrics.');
    if (!lyrics && !common.instrumental) throw new Error('Add lyrics, or tick "Instrumental" below the lyrics.');
    return { ...common, mode: 'custom', title: $('#title').value, style, lyrics, label: $('#title').value.trim() || style || 'My song' };
  }
  if (!voice) throw new Error('Record or upload a voice note first.');
  const vm = voiceMode();
  const description = $('#voiceDesc').value.trim();
  const title = $('#voiceTitle').value.trim();
  const coverLyrics = $('#voiceLyrics').value.trim();
  if (vm === 'cover' && !common.instrumental && !coverLyrics) {
    $('#voiceLyrics').focus();
    throw new Error('Keep my melody needs the words to sing. Type the lyrics from your recording (Suno can’t pick them up from the audio), turn on Instrumental, or choose “Music behind my voice” to keep your own vocals.');
  }
  const VOICE_LABEL = { inspire: 'Full song from voice note', cover: 'Voice note melody', extend: 'Voice note, continued', accompany: 'Voice note + backing track' };
  return {
    ...common,
    mode: vm,
    instrumental: vm === 'accompany' ? false : common.instrumental,
    description,
    style: $('#voiceStyle').value,
    title: vm === 'inspire' ? '' : title,
    lyrics: vm === 'accompany' ? '' : $('#voiceLyrics').value,
    duration: vm === 'cover' && $('#voiceLength').value ? Number($('#voiceLength').value) : undefined,
    sourceDuration: voice.duration || undefined,
    audioWeight: vm === 'inspire' ? undefined : Number(weight.value) / 100,
    label: (vm !== 'inspire' && title) || description.slice(0, 80) || VOICE_LABEL[vm],
  };
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  let input;
  try {
    input = collect();
  } catch (err) {
    showError(err.message);
    return;
  }

  try {
    if (['inspire', 'cover', 'extend', 'accompany'].includes(input.mode)) {
      if (!voice.url) {
        setBusy(true, 'Uploading voice note…');
        const base64Data = await blobToDataUrl(voice.blob);
        const { url } = await api('/api/upload', { method: 'POST', body: JSON.stringify({ base64Data }) });
        voice.url = url;
      }
      input.uploadUrl = voice.url;
    }
    setBusy(true, 'Sending to the studio…');
    const { label, ...payload } = input;
    const { taskId } = await api('/api/generate', { method: 'POST', body: JSON.stringify(payload) });
    const job = { taskId, label, mode: input.mode, model: input.model, style: input.style || '', createdAt: Date.now(), status: 'PENDING', tracks: [] };
    jobs.unshift(job);
    saveJobs();
    renderJob(job, true);
    poll(job);
    refreshCredits();
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(false);
  }
});

// ---------- Jobs / results ----------
let jobs = store.get(HISTORY_KEY, []).filter((j) => Date.now() - j.createdAt < 14 * 24 * 3600 * 1000);
function saveJobs() {
  store.set(HISTORY_KEY, jobs.slice(0, 30));
  $('#resultsHead').hidden = jobs.length === 0;
}

const MODE_LABEL = { simple: 'Described', custom: 'Written', inspire: 'From voice', cover: 'Voice melody', extend: 'Voice, continued', accompany: 'Voice + music', edit: 'Edited' };
const STATUS_LABEL = {
  PENDING: ['Queued', 10],
  TEXT_SUCCESS: ['Writing lyrics', 35],
  FIRST_SUCCESS: ['First take ready', 75],
  SUCCESS: ['Done', 100],
};

function jobEl(taskId) {
  return document.querySelector(`.job[data-task="${CSS.escape(taskId)}"]`);
}

function renderJob(job, prepend = false) {
  let el = jobEl(job.taskId);
  if (!el) {
    el = $('#jobTpl').content.firstElementChild.cloneNode(true);
    el.dataset.task = job.taskId;
    const list = $('#jobs');
    prepend ? list.prepend(el) : list.append(el);
  }
  $('.job-title', el).textContent = job.label;
  const when = new Date(job.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('.job-sub', el).textContent = `${MODE_LABEL[job.mode] || ''} · ${when}`;

  const [label, pct] = job.error ? ['Failed', 100] : STATUS_LABEL[job.status] || ['Working', 20];
  const badge = $('.badge', el);
  badge.textContent = label;
  badge.className = 'badge ' + (job.error ? 'bad' : job.status === 'SUCCESS' ? 'good' : 'busy');
  $('.progress', el).hidden = job.status === 'SUCCESS' || !!job.error;
  $('.bar', el).style.width = pct + '%';

  const errEl = $('.job-error', el);
  errEl.hidden = !job.error;
  errEl.textContent = job.error || '';

  const tracksEl = $('.tracks', el);
  job.tracks.forEach((t, i) => {
    let tEl = tracksEl.children[i];
    if (!tEl) {
      tEl = $('#trackTpl').content.firstElementChild.cloneNode(true);
      $('.show-lyrics', tEl).addEventListener('click', () => {
        const pre = $('.track-lyrics', tEl);
        pre.hidden = !pre.hidden;
      });
      $('.edit-take', tEl).addEventListener('click', () => openEditor(job, i, tEl));
      tracksEl.append(tEl);
    }
    const img = $('img', tEl);
    if (t.imageUrl && img.src !== t.imageUrl) img.src = t.imageUrl;
    $('.cover', tEl).classList.toggle('empty', !t.imageUrl);
    $('.track-title', tEl).textContent = `${t.title || job.label}${job.tracks.length > 1 ? ` · take ${i + 1}` : ''}`;
    $('.track-tags', tEl).textContent = [t.tags, t.duration ? fmtTime(t.duration) : ''].filter(Boolean).join(' · ');
    const src = t.audioUrl || t.streamUrl;
    const audio = $('audio', tEl);
    // Only swap the source when the final file arrives and nothing is playing.
    if (src && audio.dataset.src !== src && (audio.paused || !audio.dataset.src)) {
      audio.src = src;
      audio.dataset.src = src;
    }
    const dl = $('.dl', tEl);
    dl.hidden = !t.audioUrl;
    if (t.audioUrl) dl.href = t.audioUrl;
    const lyrBtn = $('.show-lyrics', tEl);
    lyrBtn.hidden = !t.lyrics;
    $('.track-lyrics', tEl).textContent = t.lyrics || '';
    // Editing needs a finished take with its Suno audio id.
    $('.edit-take', tEl).hidden = !(job.status === 'SUCCESS' && t.id && t.audioUrl);
  });
  $('#resultsHead').hidden = jobs.length === 0;
}

// ---------- Edit a take (pace / feel / re-record / longer) ----------
const PACE = {
  slower: { label: 'slower', style: 'slower tempo, relaxed pace', factor: 1.15 },
  faster: { label: 'faster', style: 'faster tempo, more driving', factor: 0.88 },
  muchfaster: { label: 'much faster', style: 'much faster tempo, high energy, uptempo', factor: 0.8 },
  halftime: { label: 'half-time', style: 'half-time feel, laid-back groove', factor: 1.1 },
};

// Drop old tempo descriptors so they don't fight the new pace.
function stripTempo(style) {
  return style
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/\b\d+\s*bpm\b|tempo|half-?time|double-?time/i.test(s))
    .join(', ');
}

function openEditor(job, i, tEl) {
  let panel = $('.edit', tEl);
  if (panel) {
    panel.hidden = !panel.hidden;
    return;
  }
  panel = $('#editTpl').content.firstElementChild.cloneNode(true);
  const group = 'edit-' + Math.random().toString(36).slice(2, 8);
  $$('input[type="radio"]', panel).forEach((r) => (r.name = group));
  tEl.append(panel); // full-width row under the take (.track wraps)

  const take = () => job.tracks[i] || {};
  $('.edit-lyrics', panel).value = take().lyrics || '';
  let pace = 'faster';

  const kind = () => $('input[type="radio"]:checked', panel).value;
  const sync = () => {
    const k = kind();
    $$('[data-kind]', panel).forEach((el) => (el.hidden = el.dataset.kind !== k));
    $('.edit-lyrics-wrap', panel).hidden = k === 'longer';
    if (k === 'rerecord') $('.edit-lyrics-wrap', panel).open = true;
  };
  $$('input[type="radio"]', panel).forEach((r) => r.addEventListener('change', sync));
  sync();

  $('.pace-chips', panel).addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    pace = chip.dataset.pace;
    $$('.pace-chips .chip', panel).forEach((c) => c.classList.toggle('on', c === chip));
  });
  $('.vibe-chips', panel).addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const input = $('.edit-vibe', panel);
    const cur = input.value.trim();
    input.value = cur ? `${cur}, ${chip.textContent.toLowerCase()}` : chip.textContent.toLowerCase();
    if ('genre' in chip.dataset) $('.edit-keep', panel).checked = false; // genre swap replaces the old style
  });
  $('.edit-close', panel).addEventListener('click', () => (panel.hidden = true));

  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.edit-error', panel);
    err.hidden = true;
    let req;
    try {
      req = buildEdit(job, i, panel, kind(), pace);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      return;
    }
    const btn = $('.edit-go', panel);
    btn.disabled = true;
    $('span', btn).textContent = 'Sending to the studio…';
    try {
      const { taskId } = await api('/api/generate', { method: 'POST', body: JSON.stringify(req.payload) });
      const t = take();
      const child = {
        taskId,
        label: req.label,
        mode: 'edit',
        model: req.payload.model,
        style: req.payload.style || t.tags || '',
        parent: { taskId: job.taskId, audioId: t.id, take: i + 1 },
        createdAt: Date.now(),
        status: 'PENDING',
        tracks: [],
      };
      jobs.unshift(child);
      saveJobs();
      renderJob(child, true);
      panel.hidden = true;
      const el = jobEl(taskId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 2500);
      }
      poll(child);
      refreshCredits();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      $('span', btn).textContent = 'Make the change';
    }
  });
}

function buildEdit(job, i, panel, k, pace) {
  const t = job.tracks[i] || {};
  if (!t.id) throw new Error('This take is not ready to edit yet.');
  const base = t.tags || job.style || '';
  const name = `${t.title || job.label}${job.tracks.length > 1 ? ` (take ${i + 1})` : ''}`;
  const common = { model: job.model || 'V6', taskId: job.taskId, audioId: t.id, title: t.title || '' };
  const dur = Number(t.duration) || 0;

  if (k === 'longer') {
    const newLyrics = $('.edit-newlyrics', panel).value.trim();
    const from = $('.edit-from', panel).value;
    let continueAt;
    if (dur > 2) continueAt = from === 'rewrite' && dur > 40 ? dur - 30 : dur - 1;
    return {
      label: `${name} → longer`,
      payload: { ...common, mode: 'extendTrack', style: base, lyrics: newLyrics, instrumental: !t.lyrics && !newLyrics, continueAt },
    };
  }

  const lyrics = $('.edit-lyrics', panel).value.trim();
  const instrumental = !lyrics; // a take without lyrics stays instrumental
  let style = base;
  let what = 're-recorded';
  let duration = dur;

  if (k === 'pace') {
    const p = PACE[pace];
    const bpm = Math.round(Number($('.edit-bpm', panel).value));
    const hasBpm = Number.isFinite(bpm) && bpm >= 50 && bpm <= 220;
    style = [p.style, hasBpm ? `${bpm} bpm` : '', stripTempo(base)].filter(Boolean).join(', ');
    what = hasBpm ? `${p.label}, ${bpm} bpm` : p.label;
    duration = dur * p.factor;
  } else if (k === 'feel') {
    const vibe = $('.edit-vibe', panel).value.trim();
    if (!vibe) throw new Error('Describe the new feel, or tap one of the suggestions.');
    style = $('.edit-keep', panel).checked && base ? `${vibe}, ${base}` : vibe;
    what = vibe.length > 40 ? vibe.slice(0, 40) + '…' : vibe;
  }

  return {
    label: `${name} → ${what}`,
    payload: {
      ...common,
      mode: 'remix',
      style: style.slice(0, 1000),
      lyrics: instrumental ? '' : lyrics,
      instrumental,
      duration: duration ? Math.min(360, Math.max(10, Math.round(duration))) : undefined,
    },
  };
}

async function poll(job) {
  const started = job.pollStarted || (job.pollStarted = Date.now());
  while (!job.error && job.status !== 'SUCCESS') {
    if (Date.now() - started > MAX_POLL_MS) {
      job.error = 'This is taking longer than usual. Refresh the page later to check again.';
      job.timedOut = true;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const s = await api(`/api/status?taskId=${encodeURIComponent(job.taskId)}`);
      job.status = s.done ? 'SUCCESS' : s.status;
      if (s.tracks && s.tracks.length) job.tracks = s.tracks;
      if (s.failed) job.error = s.error;
    } catch (err) {
      // Transient network/API errors: keep trying until the timeout.
      console.warn('poll failed', err);
    }
    renderJob(job);
    saveJobs();
  }
  renderJob(job);
  saveJobs();
  if (job.status === 'SUCCESS') refreshCredits();
}

$('#clearHistory').addEventListener('click', () => {
  if (!confirm('Remove all songs from this list? (Download any you want to keep first.)')) return;
  jobs = [];
  saveJobs();
  $('#jobs').innerHTML = '';
});

// ---------- Boot ----------
jobs.forEach((j) => renderJob(j));
saveJobs();
jobs.filter((j) => (!j.error || j.timedOut) && j.status !== 'SUCCESS').forEach((j) => {
  j.error = null;
  j.timedOut = false;
  j.pollStarted = Date.now();
  poll(j);
});
refreshCredits();
setMode('simple');
