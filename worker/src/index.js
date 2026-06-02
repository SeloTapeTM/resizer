/**
 * GeekMagic Resizer — cloud storage Worker
 *
 * Stores the most recent converted files in an R2 bucket so a conversion
 * made on one device can be downloaded from another. Only the last
 * MAX_FILES uploads are kept; older ones are pruned on each upload.
 *
 * Routes:
 *   POST /api/upload   — store a converted file (raw body)
 *   GET  /api/recent   — list the most recent conversions (JSON)
 *   GET  /f/<key>      — download/serve a stored file
 */

const MAX_FILES = 20;
const MAX_SIZE  = 12 * 1024 * 1024; // 12 MB per file
const PREFIX    = 'conversions/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Filename',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    try {
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        return await upload(request, env, url);
      }
      if (url.pathname === '/api/recent' && request.method === 'GET') {
        return await recent(env, url);
      }
      if (url.pathname.startsWith('/f/')) {
        return await serve(url, env);
      }
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
  if (body.byteLength > MAX_SIZE) return json({ error: 'File too large' }, 413);

  const rawName  = request.headers.get('X-Filename') || 'conversion';
  const name     = sanitizeName(rawName);
  const type     = request.headers.get('Content-Type') || 'application/octet-stream';
  if (!type.startsWith('image/')) return json({ error: 'Only image uploads allowed' }, 415);

  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : 'bin';
  const key = `${PREFIX}${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  await env.BUCKET.put(key, body, {
    httpMetadata: { contentType: type },
    customMetadata: { name },
  });

  await prune(env);

  return json(toItem(key, name, type, body.byteLength, Date.now(), url.origin), 201);
}

/* ── GET /api/recent ── */
async function recent(env, url) {
  const objects = await listAll(env);
  objects.sort((a, b) => b.uploaded - a.uploaded);
  const items = objects.slice(0, MAX_FILES).map(o =>
    toItem(
      o.key,
      o.customMetadata?.name || o.key.split('/').pop(),
      o.httpMetadata?.contentType || 'application/octet-stream',
      o.size,
      o.uploaded.getTime ? o.uploaded.getTime() : +new Date(o.uploaded),
      url.origin
    )
  );
  return json({ items });
}

/* ── GET /f/<key> ── */
async function serve(url, env) {
  const key = decodeURIComponent(url.pathname.slice('/f/'.length));
  if (!key.startsWith(PREFIX)) return json({ error: 'Not found' }, 404);

  const obj = await env.BUCKET.get(key);
  if (!obj) return json({ error: 'Not found' }, 404);

  const name = obj.customMetadata?.name || key.split('/').pop();
  const headers = new Headers(CORS);
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${name}"`);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

/* ── Helpers ── */
function toItem(key, name, type, size, uploaded, origin) {
  return { key, name, type, size, uploaded, url: `${origin}/f/${encodeURIComponent(key)}` };
}

function sanitizeName(name) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'conversion';
}

async function listAll(env) {
  const out = [];
  let cursor;
  do {
    const res = await env.BUCKET.list({
      prefix: PREFIX,
      cursor,
      include: ['httpMetadata', 'customMetadata'],
    });
    out.push(...res.objects);
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return out;
}

async function prune(env) {
  const objects = await listAll(env);
  if (objects.length <= MAX_FILES) return;
  objects.sort((a, b) => b.uploaded - a.uploaded);
  const stale = objects.slice(MAX_FILES);
  await Promise.all(stale.map(o => env.BUCKET.delete(o.key)));
}
