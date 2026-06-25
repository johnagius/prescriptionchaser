# Prescription Chaser

A single-page tool that finds the oxygen patients you need to chase for a renewed
prescription — people whose prescription is **expired** or living on **temporary
approvals**, who are **still actively swapping cylinders** (last 30 days), and who
are **not on the deceased list**. It then lets you fire off the chase-up emails
through Outlook with one click.

> **Privacy:** every file you load is processed **entirely inside your browser**.
> Nothing is uploaded, sent to a server, or stored anywhere. The only thing kept
> between sessions is a local note of which email addresses you contacted in the
> last 24 hours (so re-runs don't double-send) — and that lives only in your own
> browser's `localStorage`.

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

Click any column header to sort. Use the search box to filter. Email buttons
open a pre-filled **Outlook compose** tab (one combined email per recipient, so
an administrator with several patients gets a single message). Anyone emailed in
the last 24h is greyed-out and skipped. Use **Open next 10** repeatedly with
pop-ups allowed for the page.

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
src/worker.js         Cloudflare Worker that serves public/ as static assets.
wrangler.toml         Worker config.
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

You can also just open `public/index.html` directly in Chrome — it works with no
server at all.

### Run the test

```sh
npm install
node build/e2e-test.mjs
```
