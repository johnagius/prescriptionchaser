# Prescription Chaser

A single-page tool that finds the oxygen patients you need to chase for a renewed
prescription — people whose prescription is **expired** or living on **temporary
approvals**, who are **still actively swapping cylinders** (last 30 days), and who
are **not on the deceased list**. It then lets you fire off the chase-up emails
through Outlook with one click.

> **Privacy:** every patient file you load is processed **entirely inside your
> browser** and never leaves it. Two small things are remembered between
> sessions: a local 24h note of who you've emailed (browser `localStorage`,
> never uploaded), and the **email corrections you choose to make**, which are
> saved to a tiny Cloudflare KV store so they follow you across devices. Nothing
> else — no patient lists, no contact files — is ever stored server-side.

Deployed as a **Cloudflare Worker** that serves the static app from `public/`.

---

## How to use it

### Step 1 — Get fresh data out of Business Central

The page has three **Copy code** buttons. For each one:

1. Open the relevant BC page (instructions below).
2. Press <kbd>F12</kbd> to open the browser console.
3. Switch the console context dropdown (top-left, usually says *top*) to
   **Multigas Production**.
4. Paste the copied code, press <kbd>Enter</kbd>. A CSV downloads automatically.

| Button | Where to run it |
| --- | --- |
| **Customer Data** | <kbd>Alt</kbd>+<kbd>Q</kbd> → type `customer` → Enter |
| **Expired / Temp Approvals** | <kbd>Alt</kbd>+<kbd>Q</kbd> → type `Prescription list` → Enter |
| **Cylinder Exchanges (30d)** | Item Ledger Entries → saved filter **John Oxygen Exchanges** → open the pivot table (turn on Analysis mode if needed) |

### Step 2 — Load the three result files

Drop the three downloaded CSVs onto the page (or click to choose). They
auto-sort themselves into the right slot based on their columns — order and
filename don't matter.

### Step 3 — Load the deceased list *(optional, encouraged)*

Drop the **PATIENTS PASSED AWAY** `.xlsx` (or any CSV containing customer
numbers). These patients are removed from the results. `.xlsx` is read in the
browser with no external library.

### Step 4 — Chase

You get a sortable, filterable table of exactly who to chase:

- **State** — Active Temp / Expired Temp / Expired.
- **Consec. Temps** — how many consecutive temporary approvals are stacked up.
  Per the agreed rule this is **only counted when the current state is itself a
  temporary approval**; a plain expired row shows `—` even if older temps sit
  beneath it.
- **Cyl 30d** — cylinders swapped in the last 30 days.
- **Email / Phone** — pulled from the Customer Data file.

Click any column header to sort (in the flat view). Use the search box to
filter by name, customer no, email, phone or state.

**Carer grouping.** Patients are grouped under one **carer** when they share an
email *or* a phone number, so a care home or relative who manages several
patients gets a single combined email. Toggle **Group by carer** to switch
between grouped sections and the flat sortable table.

**Emailing.** Email buttons open a pre-filled **Outlook compose** tab for the
whole carer (all their patients in one message). Anyone emailed in the last 24h
is greyed-out and skipped. Use **Open next 10** repeatedly with pop-ups allowed.

**Copy buttons.**
- **Copy for email (tabs)** — tab-separated, paste straight into an email or
  Word and it becomes a table (no Excel round-trip needed).
- **Copy CSV** — comma-separated for Excel.

**Editing emails (cloud-remembered).** The **✎** control on a carer opens an
editor where you can:
- **Replace** the carer's email — this renames that address *everywhere it
  appears*, so every carer whose primary is that address updates at once, while
  leaving any other address untouched.
- **Add extra recipients** — additional `To:` addresses attached to that carer
  (e.g. a second family member), without changing the primary.

Per-patient **✎** (in the flat view's email cell) sets the email for just that
one patient. All of these corrections are saved to Cloudflare KV and sync across
your devices.

**Flag to company.** Whenever a deceased patient shows cylinder movement in the
last 30 days, they appear in a separate red report above the chase list, with a
one-click CSV copy — cylinders being supplied to / not recovered from deceased
patients are a compliance issue.

---

## The computation

```
people to chase  =  (expired OR temporary-approval patients)
                    − deceased patients
                    − anyone with no cylinder swap in the last 30 days
                    + contact details (email / phone)
```

The "last 30 days" window is already baked into the cylinder export (the
**John Oxygen Exchanges** saved filter), so presence in that file = an active
swapper.

---

## Project layout

```
public/index.html     The whole app (self-contained: open it directly in a
                      browser, or serve it via the Worker).
src/worker.js         Cloudflare Worker: serves public/ as static assets and
                      exposes /api/overrides (email corrections) backed by KV.
wrangler.toml         Worker config. The KV namespace binding (OVERRIDES) is
                      auto-provisioned and appended by the deploy workflow.
Expired/              Source of truth for the three BC console scripts + the
                      sample data files used to develop and test.
build/inject-scripts.py   Copies the Expired/*.js scripts into the copy-code
                      buttons in index.html. Re-run after editing a script.
build/e2e-test.mjs    Headless browser test that loads the sample files and
                      verifies the whole pipeline.
```

The three console scripts in `Expired/` are the single source of truth. After
editing one, re-embed it:

```sh
python3 build/inject-scripts.py     # or: npm run build
```

---

## Develop & deploy

```sh
npm install
npm run dev        # wrangler dev — local preview
npm run deploy     # wrangler deploy — publish to Cloudflare
```

Deployment is automated via `.github/workflows/deploy.yml` (push to `main` or the
working branch). It uses the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
repo secrets, and before deploying it **auto-creates the KV namespace**
`prescriptionchaser-overrides` and binds it as `OVERRIDES`. If the API token
lacks *Workers KV Storage* permission, the workflow logs a warning and deploys
without cloud overrides — the app still works, falling back to local-only
storage for email corrections.

You can also just open `public/index.html` directly in Chrome — it works with no
server at all (email overrides then persist locally instead of in the cloud).

### Run the test

```sh
npm install
node build/e2e-test.mjs
```
