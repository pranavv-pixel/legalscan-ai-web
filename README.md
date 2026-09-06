# LegalScan AI — Legal Metrology Compliance Scanner
### SIH Problem Statement 26034 — Ministry of Consumer Affairs, Food & Public Distribution

A working web app (runs on laptop **and** mobile, same codebase) that scans a
packaged-commodity label, extracts the mandatory declarations, checks them
against the Legal Metrology (Packaged Commodities) Rules 2011, and gives an
inspector / manufacturer / consumer an instant verdict — with real login
accounts and a real cloud database behind it.

No coding needed to run it. Two things to do, both explained below.

---

## ▶️ Run it in 3 steps

### Step 1 — Get a free Firebase project (one-time, ~5 minutes)
Real accounts and a real shared database need a backend. Firebase is Google's
free one, and it means the accounts/data are truly yours (not a fake demo
login). Full copy-paste instructions are already written at the top of
`js/firebase-config.js` — open that file and follow Steps 1–5, then paste
your project's keys into the `firebaseConfig` object in that same file.

*(Skip this step to still preview the whole UI — you'll just see a banner
saying login isn't configured yet.)*

### Step 2 — Start the app on your laptop
- **Windows:** double-click `run_windows.bat`
- **Mac / Linux:** double-click `run_mac.sh` (or run `bash run_mac.sh` in Terminal)

Your browser opens automatically at `http://localhost:8000`. Sign up, pick a
role, and start scanning.

> Why a script instead of just opening `index.html`? The rule set
> (`rules.json`) is loaded as data, not hard-coded — exactly what the problem
> statement asks for, so officials can amend rules without touching code.
> Browsers only allow that data-loading over `http://`, not by double-clicking
> the file directly. The script just starts a tiny local server for you.

### Step 3 — Open it on your phone
With the laptop script still running and your phone on the **same Wi‑Fi**:
1. On the laptop, find its local IP (Windows: `ipconfig` → "IPv4 Address";
   Mac: `ifconfig` → "inet").
2. On the phone's browser, go to `http://<that-IP>:8000` — e.g. `http://192.168.1.7:8000`.
3. Use "Open Camera" to scan a label directly, or upload a photo.

For a public demo link (not just same Wi‑Fi), deploy the same folder for free
with `firebase deploy` (Firebase Hosting) or by dragging the folder into
Netlify Drop — no code changes needed.

---

## What's inside, mapped to the problem statement

| Requirement (from PS 26034) | Where it lives |
|---|---|
| Web + mobile app, one codebase | Single responsive app (`index.html`), works in any browser, phone or laptop |
| Camera scan, image upload, batch upload | "New Inspection" screen — Choose Images / Open Camera, multi-file |
| Auto-crop, contrast enhance, skew handling groundwork | Image preprocessing pipeline in `app.js` before OCR |
| OCR extraction of MRP, net quantity, mfg date, manufacturer, consumer care, country of origin | `rules-engine.js` field extractors, driven by `rules.json` |
| Multilingual OCR (Hindi + English + regional) | Language picker on New Inspection (English, +Hindi, +Marathi/Gujarati/Tamil/Telugu/Kannada/Bengali/Punjabi) via Tesseract.js |
| Font-size / prominence check | `minFontProminenceRatio` check against declaration text height |
| Rule-based validation, dynamic (not hardcoded) | `rules.json` — editable live from the in-app **Rules & Standards** screen |
| Confidence scoring per field, not blind pass/fail | Each finding shows a % confidence, not just yes/no |
| Violation severity (critical vs minor) | `severity` field per rule, colour-coded findings |
| Compliance reports, PDF + editable export | Export PDF / CSV / JSON buttons on the Result screen |
| Central compliance database, repeat-offender tracking | Firestore `inspections` collection, linked to manufacturer + history |
| Dashboard for inspections/violations | Dashboard screen with live stats |
| Search & retrieval of past scans | Inspection History screen — search + filters |
| Analytics (trends by category/status) | Analytics screen with charts |
| Role-based access (inspector / manufacturer / consumer) | Real Firebase Authentication + role picker at sign-up |
| Consumer: quick scan + one-tap report violation | "Continue as Consumer" + Report Violation button |
| Manufacturer: pre-market self-check, dispute flagged results | Manufacturer role view + Raise Dispute button |
| Inspector: field logging, geotag, case management | Attach Location (GPS), full inspection list across all users |
| Appeal / dispute mechanism | "Raise Dispute" → flips status to Needs Review for officer follow-up |
| Human-review fallback for low-confidence scans | Low-confidence fields are marked "Needs Review" rather than auto-failed |
| Secure login | Real email/password accounts via Firebase Auth (not a fake demo login) |

**Being upfront about one limitation** (worth saying in a demo, judges like
honesty): the on-device OCR (Tesseract.js) needs an internet connection the
first time it downloads its language files per session; after that it runs
client-side. A production version would cache those files with a service
worker for full offline use — noted as a next step, not built into this
prototype.

---

## Files in this folder
All files sit in one flat folder (no subfolders) — this is deliberate, so
uploading to GitHub on mobile just works with no folder-creation steps:
- `index.html` — the whole app UI
- `style.css` — styling, responsive for mobile
- `app.js` — app logic, screens, Firebase calls
- `rules-engine.js` — OCR field-matching + scoring logic
- `firebase-config.js` — **edit this** with your Firebase keys (Step 1 above)
- `rules.json` — the editable rule set (also editable live in-app)
- `run_windows.bat`, `run_mac.sh` — one-click local server launchers

## Deploying on GitHub Pages (mobile-friendly)
1. Create a new **public** repo, e.g. `legalscan-ai-web`.
2. Add each file above via **Add file → Create new file**, typing just the
   plain filename (e.g. `style.css`, `app.js`) — no folder prefix needed.
3. Settings → Pages → Source: Deploy from a branch → Branch: `main`,
   folder: `/(root)` → Save.
4. Your live link: `https://<your-username>.github.io/legalscan-ai-web/`
