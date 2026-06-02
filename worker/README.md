# Cloud storage Worker

A small [Cloudflare Worker](https://workers.cloudflare.com/) that stores the
**last 20** converted files in an [R2](https://developers.cloudflare.com/r2/)
bucket, so a conversion made on one device can be downloaded from another.

> ⚠️ Stored files are **public** — anyone with the link (or who opens the app)
> can see and download them. Don't save anything private.

## Endpoints

| Method | Path           | Description                          |
|--------|----------------|--------------------------------------|
| `POST` | `/api/upload`  | Store a file (raw body + `X-Filename` header) |
| `GET`  | `/api/recent`  | List the most recent conversions (JSON) |
| `GET`  | `/f/<key>`     | Download/serve a stored file         |

Only the newest 20 files are kept; older ones are pruned automatically on each
upload. Each file is capped at 12 MB.

## Deploy

1. **Install Wrangler** and log in:
   ```bash
   npm install
   npx wrangler login
   ```

2. **Create the R2 bucket** (name must match `wrangler.toml`):
   ```bash
   npx wrangler r2 bucket create geekmagic-conversions
   ```

3. **Deploy:**
   ```bash
   npm run deploy
   ```
   Wrangler prints your Worker URL, e.g.
   `https://geekmagic-resizer-store.<you>.workers.dev`.

4. **Point the frontend at it** — open `../index.html` and set:
   ```js
   const API_BASE = 'https://geekmagic-resizer-store.<you>.workers.dev';
   ```
   Commit and redeploy the static site. The "☁ Save to cloud" button and
   "Recent conversions" gallery activate automatically once `API_BASE` is set.

## Local development

```bash
npm run dev   # serves the Worker on http://localhost:8787 with a local R2
```

Set `API_BASE = 'http://localhost:8787'` in `index.html` to test end-to-end.

## Cost

Comfortably within Cloudflare's free tier: Workers allow 100k requests/day and
R2 includes 10 GB storage + generous free operations — far more than a handful
of 240×240 images needs.
