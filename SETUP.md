# Setup

One-time setup to get from this code to a working deployment: a Firebase
project for storage, the GitHub Actions cron job checking prices, and the
Next.js dashboard on Vercel.

## 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) → **Add project** → give it any name → you can decline Google Analytics (not needed).
2. In the new project, go to **Build → Firestore Database → Create database**.
   - Choose **Production mode** (locked by default — this app never touches Firestore from the browser, so there's nothing to open up).
   - Pick any region close to you.
   - This is the free **Spark** plan — no billing required for this app's volume.
3. Go to **Firestore Database → Rules**, replace the contents with what's in [`firestore.rules`](firestore.rules) (deny-all — both the cron job and the Next.js app talk to Firestore server-side with the Admin SDK, which bypasses these rules entirely; they only matter for direct client access, which this app never does), and click **Publish**.

## 2. Generate a service account key

1. In the Firebase console: **⚙️ Project settings → Service accounts**.
2. Click **Generate new private key** → confirm. A JSON file downloads.
3. Open that file — you'll paste its **entire contents** (as one value) into both GitHub Actions secrets and Vercel env vars in the steps below. Keep it somewhere safe; it's not committed to the repo (`.gitignore` already excludes `*.json` key files you might drop locally, but don't add it to the repo regardless).

This one key is used by **both** the Python cron job and the Next.js app — they're two separate trusted server contexts reading/writing the same Firestore database.

## 3. Composite indexes

Two of the queries in `flight_tracker/db.py` (get_last_price, get_price_history_since) and one in the expiry check need composite indexes, since they combine an equality filter with a range/order on a different field. [`firestore.indexes.json`](firestore.indexes.json) declares them. Two ways to create them:

- **Easiest**: just run the app (see steps below). The first time each query runs without its index, Firestore raises an error containing a direct link — click it, confirm in the console, wait a minute for the index to build, re-run. Do this once per missing index and you're done.
- **Or, with the Firebase CLI**: `npm install -g firebase-tools`, `firebase login`, `firebase use --add` (pick your project), then `firebase deploy --only firestore:indexes`.

## 4. SerpApi + Gemini keys

- SerpApi (Google Flights data): sign up at [serpapi.com](https://serpapi.com/manage-api-key), free tier is ~100 searches/month.
- Gemini (AI reasoning layer): go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with a Google account, click **Create API key**. Free tier, no credit card required.

## 5. GitHub Actions (the cron job)

In your repo: **Settings → Secrets and variables → Actions**, add these **secrets**:

| Name | Value |
|---|---|
| `SERPAPI_KEY` | from step 4 — still needed as the fallback provider, see below |
| `GEMINI_API_KEY` | from step 4 |
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | e.g. `587` |
| `SMTP_USER` | your email address |
| `SMTP_PASSWORD` | a Gmail **App Password**, not your normal password |
| `EMAIL_FROM` | usually same as `SMTP_USER` |
| `EMAIL_TO` | where price alerts go |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | paste the **entire JSON file** from step 2 |

Optionally add a repo **variable** `GEMINI_MODEL` if you want something other than the default `gemini-3.6-flash`.

Optionally add a repo **variable** `FLIGHT_PROVIDER` set to `serpapi` to force the original provider — default is `fast_flights` (scrapes Google Flights directly, no paid quota), which falls back to SerpApi automatically per-search on failure or for round-trip routes (not implemented for fast_flights yet — see `flight_tracker/flight_provider.py`).

The workflow (`.github/workflows/price-check.yml`) is already scheduled for 08:00 and 19:00 Asia/Ho_Chi_Minh. You can also trigger it manually from the Actions tab (`workflow_dispatch`), optionally scoped to specific route IDs.

## 6. Vercel (the dashboard)

1. Import the repo into Vercel.
2. In **Project Settings → General → Root Directory**, set it to `web`.
3. In **Project Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | same as above |
| `GEMINI_MODEL` | optional |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | same JSON as above |
| `APP_PASSWORD` | a password you choose — gates the whole dashboard |
| `SESSION_SECRET` | a random string, e.g. output of `openssl rand -hex 32` |
| `GH_REPO` | your repo as `owner/repo`, e.g. `hlhngoc/flight-price-tracker` — optional, see below |
| `GH_DISPATCH_TOKEN` | a GitHub PAT — optional, see below |
| `GH_REF` | branch to run the workflow on, e.g. `main` — optional, defaults to `main` |

4. Deploy. Visit the URL, log in with `APP_PASSWORD`.

### Immediate price check when adding an event (optional)

Without `GH_REPO`/`GH_DISPATCH_TOKEN` set, routes created from an event just sit there until the next scheduled cron run (up to ~12h) — nothing breaks, they're still tracked. Set these two to make `/api/events` kick off an immediate check (via `workflow_dispatch`, scoped to just the newly created routes) right after Gemini picks the slots:

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Repository access: only this repo. Permissions: **Actions → Read and write**.
3. Copy the token into `GH_DISPATCH_TOKEN`; set `GH_REPO` to `owner/repo`.

The dashboard's write endpoints (`/api/events`, `/api/routes`) call Gemini and will call SerpApi indirectly (via routes the cron job then tracks), so keep `APP_PASSWORD` private — anyone with it can create events/routes and consume your API quotas.

## 7. Local development

**Python side:**
```
pip install -r requirements.txt
cp .env.example .env   # fill in the same values as the GitHub secrets above
python -m flight_tracker.cli add-route --origin HAN --destination SGN
python -m flight_tracker.cli check-routes
```

**Web side:**
```
cd web
npm install
cp .env.local.example .env.local   # fill in the same values as the Vercel env vars above
npm run dev
```
