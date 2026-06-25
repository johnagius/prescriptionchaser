#!/usr/bin/env python3
"""Inject the three Business Central console scripts into public/index.html.

The scripts live in Expired/ as the single source of truth. This build step copies
their exact contents into the <script type="text/plain"> placeholders so the
"copy code" buttons hand the user identical, up-to-date code. Re-run after editing
any of the source scripts.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "Expired"
HTML = ROOT / "public" / "index.html"

MAPPING = {
    "@@CUSTOMER_SCRIPT@@":  SRC / "capture-customer-contact-details.js",
    "@@WATCHLIST_SCRIPT@@": SRC / "collect-expired-and-temp-prescriptions.js",
    "@@CYLINDER_SCRIPT@@":  SRC / "capture-cylinder-counts-last-30-days.js",
}

html = HTML.read_text(encoding="utf-8")
for token, path in MAPPING.items():
    if token not in html:
        sys.exit(f"ERROR: placeholder {token} not found in {HTML} (already built?).")
    code = path.read_text(encoding="utf-8")
    if "</script" in code.lower():
        sys.exit(f"ERROR: {path.name} contains a </script sequence and cannot be embedded safely.")
    html = html.replace(token, code)

HTML.write_text(html, encoding="utf-8")
print(f"Injected {len(MAPPING)} scripts into {HTML.relative_to(ROOT)}")
