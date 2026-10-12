'use strict';
/*
 * POST /api/diagnostic
 * Body: { action: 'start' | 'next' | 'finish', ... }  (see api/_lib/engine.js)
 *
 * Env vars (Vercel > Project > Settings > Environment Variables):
 *   ANTHROPIC_API_KEY  required for the adaptive AI mode (without it the diagnostic runs in rules mode)
 *   OPENAI_API_KEY     optional, turns on recorded voice notes in every browser (see _lib/transcribe.js)
 *   ALLOWED_ORIGINS    optional, comma-separated, e.g. https://diagnostic.edodaves.com
 *   DIAG_MODEL_FAST / DIAG_MODEL_DEEP  optional model overrides
 */
const { handle } = require('./_lib/engine');

// Light per-instance rate limit so nobody can run up the API bill from one IP.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS = 60;
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_CALLS;
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 6000000) { data = ''; req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

module.exports = async function diagnostic(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  if (allowed.length && origin && allowed.indexOf(origin) === -1) return send(res, 403, { error: 'origin_not_allowed' });

  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'too_many_requests' });

  let body = req.body;
  if (body === undefined) body = await readBody(req);
  else if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }

  try {
    const out = await handle(body || {});
    return send(res, out && out.error ? 400 : 200, out);
  } catch (e) {
    console.error('[diagnostic] fatal:', e);
    return send(res, 500, { error: 'server_error' });
  }
};
