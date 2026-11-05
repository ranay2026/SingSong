# SingSong 🎵

A small web app that makes AI songs with the [sunoapi.org](https://sunoapi.org) API.

- **✨ Describe it**: type an idea ("a birthday song for Maya who loves tacos") and Suno writes the lyrics and music.
- **✍️ Write it**: your own title, style and lyrics, or an instrumental.
- **🎤 From my voice**: record a voice note in the browser or upload one (mp3, m4a, wav, ogg/opus, webm), describe what you want ("use my hum as the chorus", "build a bridge"), optionally paste lyrics, then pick:
  - **Full song from my idea** (default): a complete, full-length new song using the voice note as an audio reference (`/api/v1/generate` with `audioUrls`)
  - **Keep my melody**: re-sings your exact tune, with a chosen length of 1 to 4 minutes (`/api/v1/generate/upload-cover` + `duration`)
  - **Continue it**: keeps your recording and writes what comes next (`/api/v1/generate/upload-extend`)
  - **Music behind my voice**: keeps your real vocals and adds a backing track (`/api/v1/generate/add-instrumental`)

Each request returns two takes. You can play them, read the lyrics and download them.

**Edit a take:** every finished take has an **Edit this take** button, so you can pick the better of the two and refine it. The result comes back as two new takes, and you can keep editing:
- **Pace**: slower, faster, much faster or half-time, with an optional target BPM (re-records the take via `upload-cover` with `taskId` + `audioId`)
- **Change the feel**: a new genre, mood or singer, keeping the original style as a base or replacing it
- **Re-record**: same style, a fresh performance; edit the lyrics to change words
- **Make it longer**: continue from the end, or rewrite the last 30 seconds, with optional lyrics for the new part (`/api/v1/generate/extend`) Your song history is saved in your browser.

## Tech stack

There's no build step and no dependencies.

```
public/                  static frontend (HTML/CSS/vanilla JS), served by Netlify
  index.html
  app.js                 UI, polling, history
  audio.js               mic recording + converts voice notes to small mono WAV
  styles.css
netlify/functions/       serverless API (Netlify Functions v2, Node 18+)
  generate.mjs           POST /api/generate  → starts a Suno task
  status.mjs             GET  /api/status    → polls /api/v1/generate/record-info
  upload.mjs             POST /api/upload    → Suno file upload (base64), returns a temporary URL
  credits.mjs            GET  /api/credits   → remaining credits
  callback.mjs           POST /api/callback  → acknowledges Suno's required callBackUrl
netlify/lib/             shared helpers (bundled into the functions)
netlify.toml
```

The Suno API key is used **only** inside the Netlify Functions, so it never reaches the browser and is **not** stored in this repo.

## Deploying on Netlify

1. In Netlify: **Add new site → Import an existing project → GitHub →** pick this repo, branch `main`.
   The settings come from `netlify.toml` (publish dir `public`, functions dir `netlify/functions`, no build command).
2. Go to **Site configuration → Environment variables** and add:
   | Key | Value |
   |---|---|
   | `SUNO_API_KEY` | your sunoapi.org API key |
   | `APP_PASSWORD` | *(optional)* if set, visitors must enter this password before generating, so strangers can't spend your credits |
3. **Deploys → Trigger deploy** so the functions pick up the variables.

## Notes and limits

- Models: `V6` (default), `V6_WILD` and `V6_MINI`, the current models in the sunoapi.org docs.
- Songs usually take 1–3 minutes. The app polls every 5 seconds and can stream the first take before the final file is ready.
- Suno keeps generated files for about 14–15 days, and uploaded voice notes are deleted after 3 days, so download what you want to keep.
- Voice notes are converted in the browser to mono WAV, up to about 2 minutes, to fit Netlify's ~6 MB function request limit.
- Each generation uses sunoapi.org credits. The credit balance is shown in the top-right corner.

## Local development

```bash
npm i -g netlify-cli
SUNO_API_KEY=your_key netlify dev
```
