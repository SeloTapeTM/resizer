# Cloud storage Worker (KV — no credit card required)

A small [Cloudflare Worker](https://workers.cloudflare.com/) that stores the
**last 20** converted files in [KV](https://developers.cloudflare.com/kv/) storage.
Unlike R2, **KV does not require a credit card** — it is included in the free Workers plan.

Free tier limits (far more than personal use needs):
| Resource | Free allowance |
|---|---|
| KV reads | 100,000 / day |
| KV writes | 1,000 / day |
| KV storage | 1 GB |
| Workers requests | 100,000 / day |

> ⚠️ Stored files are **public** — anyone who opens the app can see and download them.
> Don't save anything private.

---

## One-time setup

### 1 — Create a free Cloudflare account

Sign up at <https://dash.cloudflare.com/sign-up>. **No credit card needed.**

### 2 — Install Wrangler and log in

Run these from the `worker/` folder:

```bash
npm install
npx wrangler login
```

A browser tab opens — click **Allow** to authorize the CLI.

### 3 — Create the KV namespace

```bash
npx wrangler kv namespace create STORE
```

The output looks like:

```
🌀 Creating namespace with title "geekmagic-resizer-store-STORE"
✅ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "KV", id = "abc123def456..." }
```

**Copy that `id`** and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "abc123def456..."   # ← paste here
```

### 4 — Deploy

```bash
npm run deploy
```

Wrangler prints your Worker URL:

```
https://geekmagic-resizer-store.YOUR-SUBDOMAIN.workers.dev
```

**Copy that URL** — you'll use it as `API_BASE` in the next step.

If this is your first Worker, Wrangler will ask you to pick a `*.workers.dev` subdomain first (free, one-time).

### 5 — Verify the backend

```bash
curl https://geekmagic-resizer-store.YOUR-SUBDOMAIN.workers.dev/api/recent
# Expected: {"items":[]}
```

### 6 — Enable the cloud UI in the frontend

Open `../index.html` and find this line near the top of the `<script>` block:

```js
const API_BASE = '';
```

Change it to your Worker URL (no trailing slash):

```js
const API_BASE = 'https://geekmagic-resizer-store.YOUR-SUBDOMAIN.workers.dev';
```

### 7 — Redeploy the static site

```bash
cd ..
git add index.html
git commit -m "Enable cloud sharing"
git push
```

GitHub Pages picks up the change within a minute. That's it — the
**☁ Save to cloud** button and **Recent conversions** gallery are now live.

---

## Updating the Worker

Edit `src/index.js`, then:

```bash
npm run deploy
```

## Auto-deploy with GitHub Actions (optional)

Instead of running `wrangler deploy` by hand, the workflow at
[`.github/workflows/deploy-worker.yml`](../.github/workflows/deploy-worker.yml)
redeploys the Worker automatically whenever files under `worker/` change on
`main`. Set it up once:

1. **Create a deploy token** — Cloudflare dashboard → **My Profile** →
   **API Tokens** → **Create Token** → use the **Edit Cloudflare Workers**
   template → **Create Token** → copy it.

2. **Find your Account ID** — Cloudflare dashboard → **Workers & Pages**;
   the **Account ID** is shown in the right-hand sidebar.

3. **Add them as GitHub repository secrets** — in your repo on GitHub:
   **Settings → Secrets and variables → Actions → New repository secret**.
   Add both:
   - `CLOUDFLARE_API_TOKEN` → the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID` → the id from step 2

That's it. Push any change under `worker/` to `main` (or click **Run workflow**
on the Actions tab) and GitHub deploys it for you — your token never leaves
GitHub's encrypted secrets.

## Local development

```bash
npm run dev   # Worker on http://localhost:8787 with a local KV store
```

Set `API_BASE = 'http://localhost:8787'` in `index.html` to test end-to-end.
