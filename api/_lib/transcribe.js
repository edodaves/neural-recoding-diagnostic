'use strict';
/*
 * Voice notes recorded in the browser get transcribed here.
 * Claude's API doesn't take audio, so this uses OpenAI's transcription endpoint.
 *
 * Switches on when OPENAI_API_KEY is set in Vercel. Without it, the page falls back
 * to the browser's own speech-to-text, which only works in Chrome, Safari and Edge.
 *
 * Optional env var:
 *   TRANSCRIBE_MODEL  default gpt-transcribe; retries with whisper-1 if the model is rejected
 */

const MAX_BYTES = 3.3 * 1024 * 1024;   // about 2.5 minutes of audio, under Vercel's 4.5 MB request limit
const TYPES = {
  'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav'
};

const key = () => String(process.env.OPENAI_API_KEY || '').trim();
const available = () => !!key();

async function callOpenAI(buf, mime, ext, model, timeoutMs) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), 'voice-note.' + ext);
  form.append('model', model);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key() },
      body: form,
      signal: ctrl.signal
    });
    const raw = await r.text();
    if (!r.ok) {
      const err = new Error('openai_' + r.status + ' ' + raw.slice(0, 200));
      err.status = r.status;
      throw err;
    }
    const data = JSON.parse(raw);
    return String(data.text || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

async function transcribe(body) {
  if (!available()) return { error: 'transcribe_off' };
  const mime = String(body.mime || '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[mime];
  if (!ext) return { error: 'bad_audio_type' };
  const b64 = String(body.audio || '');
  if (!b64) return { error: 'empty_audio' };
  if (b64.length > Math.ceil(MAX_BYTES * 4 / 3) + 16) return { error: 'audio_too_large' };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'empty_audio' };

  const model = String(process.env.TRANSCRIBE_MODEL || 'gpt-transcribe').trim();
  try {
    return { text: await callOpenAI(buf, mime, ext, model, 45000) };
  } catch (e) {
    if (model !== 'whisper-1' && (e.status === 400 || e.status === 404)) {
      console.error('[diagnostic] transcription with ' + model + ' failed, retrying with whisper-1:', e.message);
      return { text: await callOpenAI(buf, mime, ext, 'whisper-1', 45000) };
    }
    throw e;
  }
}

module.exports = { transcribe, available };
