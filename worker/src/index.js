/**
 * GeekMagic Resizer — cloud storage Worker (KV edition)
 *
 * Uses Cloudflare Workers KV instead of R2 — no credit card required.
 * Free tier: 100k reads/day, 1k writes/day, 1 GB storage, 25 MB per value.
 * A 240×240 image is typically well under 1 MB, so limits are never hit.
 *
 * Routes:
 *   POST /api/upload   — store a converted file (raw body)
 *   GET  /api/recent   — list the most recent conversions (JSON)
 *   GET  /f/<key>      — download/serve a stored file
 *
 * KV layout:
 *   "meta"      → JSON array of the last MAX_FILES item descriptors
 *   "file:<id>" → raw binary of the stored image
 */

const MAX_FILES = 20;
const MAX_SIZE  = 10 * 1024 * 1024; // 10 MB per file (KV limit is 25 MB)
const FILE_TTL  = 60 * 60 * 24 * 30; // 30 days auto-expiry

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Filename',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (url.pathname === '/api/upload' && request.method === 'POST') return upload(request, env, url);
      if (url.pathname === '/api/recent' && request.method === 'GET')  return recent(env, url);
      if (url.pathname.startsWith('/f/'))                               return serve(url, env);
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message || 'Internal error' }, 500);
    }
  },
};

/* ── POST /api/upload ── */
async function upload(request, env, url) {
  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: 'Empty body' }, 400);
  if (body.byteLength > MAX_SIZE) return json({ error: 'File too large (max 10 MB)' }, 413);

  const type = request.headers.get('Content-Type') || '';
  if (!type.startsWith('image/')) return json({ error: 'Only image uploads allowed' }, 415);

  const rawName = request.headers.get('X-Filename') || 'conversion';
  const name    = sanitize(rawName);
  const id      = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileKey = `file:${id}`;
  const ext     = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : 'bin';

  await env.KV.put(fileKey, body, {
    expirationTtl: FILE_TTL,
    metadata: { name, type },
  });

  // Update metadata list
  const meta = await getMeta(env);
  const item = { id, name, type, size: body.byteLength, uploaded: Date.now() };
  meta.unshift(item);

  // Prune stale entries beyond MAX_FILES
  const pruned = meta.slice(MAX_FILES);
  await Promise.all(pruned.map(i => env.KV.delete(`file:${i.id}`)));

  await env.KV.put('meta', JSON.stringify(meta.slice(0, MAX_FILES)));

  return json({ ...item, url: fileUrl(url.origin, id, ext) }, 201);
}

/* ── GET /api/recent ── */
async function recent(env, url) {
  const meta = await getMeta(env);
  const items = meta.map(i => ({
    ...i,
    url: fileUrl(url.origin, i.id, i.name.includes('.') ? i.name.slice(i.name.lastIndexOf('.') + 1) : 'bin'),
  }));
  return json({ items });
}

/* ── GET /f/<id> ── */
async function serve(url, env) {
  // URLs look like /f/<id>.<ext>; the KV key is just file:<id>, so drop the
  // trailing extension (the id itself never contains a dot).
  const raw     = decodeURIComponent(url.pathname.slice('/f/'.length));
  const id      = raw.replace(/\.[^.]+$/, '');
  const fileKey = `file:${id}`;
  const { value, metadata } = await env.KV.getWithMetadata(fileKey, { type: 'arrayBuffer' });
  if (!value) return json({ error: 'Not found' }, 404);

  const name = metadata?.name || id;
  const type = metadata?.type || 'application/octet-stream';
  return new Response(value, {
    headers: {
      ...CORS,
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

/* ── Helpers ── */
async function getMeta(env) {
  const raw = await env.KV.get('meta');
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function fileUrl(origin, id, ext) {
  return `${origin}/f/${encodeURIComponent(id)}.${ext}`;
}

function sanitize(name) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'conversion';
}
