(async function captureCustomerContactDetails() {
    "use strict";

    const configuration = {
        scrollDelayMilliseconds: 350,
        maximumScrollSteps: 4000,
        scrollAmountRatio: 0.55,
        logEachStep: false,
        downloadCsvOnFinish: true,
        // Set true to drop "(CLOSED)" customers. Left false so you capture
        // everyone; a "Closed" column lets you filter later in Excel.
        skipClosedAccounts: false,
        // OPTIONAL: paste the Customer No. list from your prescription watchlist
        // here to capture ONLY those customers, e.g. ["D01894","D01070"].
        // Leave the array empty to capture every customer on the page.
        onlyCustomerNumbers: []
    };

    const customerNumberRegex = /\b[A-Z]\d{5}\b/;

    function normaliseText(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .replace(/[ \t]+/g, " ")
            .replace(/\n\s*/g, "\n")
            .trim();
    }
    function oneLineText(value) {
        return normaliseText(value).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
    }
    function cleanValue(value) {
        const s = oneLineText(value);
        if (/^[_\-–—.·•\u2022]+$/.test(s)) return ""; // placeholder dashes / underscores
        return s;
    }
    function getElementText(el) {
        if (!el) return "";
        return normaliseText(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "");
    }
    function isElementVisible(el) {
        if (!el || el.nodeType !== 1) return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const s = window.getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
        return true;
    }
    function getCellElements(rowElement) {
        if (!rowElement) return [];
        let cells = Array.from(rowElement.querySelectorAll('[role="gridcell"], [role="cell"], td, th'));
        if (cells.length === 0) cells = Array.from(rowElement.children || []);
        return cells.filter(isElementVisible).sort((a, b) =>
            a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    }
    function getVisiblePotentialRowElements() {
        return Array.from(document.querySelectorAll('[role="row"], tr')).filter(row => {
            if (!isElementVisible(row)) return false;
            const t = oneLineText(getElementText(row));
            if (!customerNumberRegex.test(t)) return false; // must contain a D##### customer no.
            if (t.length > 2000) return false;
            return true;
        });
    }
    function findLabelCenter(labelRegex) {
        const preferred = Array.from(document.querySelectorAll('[role="columnheader"], th')).filter(isElementVisible);
        for (const el of preferred) {
            const t = oneLineText(getElementText(el)).replace(/[↑↓]/g, "").trim();
            if (labelRegex.test(t)) {
                const r = el.getBoundingClientRect();
                return r.left + r.width / 2;
            }
        }
        const fallback = Array.from(document.querySelectorAll("body *")).filter(isElementVisible);
        for (const el of fallback) {
            const t = oneLineText(getElementText(el)).replace(/[↑↓]/g, "").trim();
            if (labelRegex.test(t)) {
                const r = el.getBoundingClientRect();
                if (r.width > 10 && r.height > 5) return r.left + r.width / 2;
            }
        }
        return null;
    }

    let cachedColumnCenters = null, cachedColumnCentersTs = 0;
    function getColumnCenters() {
        const now = Date.now();
        if (cachedColumnCenters && now - cachedColumnCentersTs < 1500) return cachedColumnCenters;
        cachedColumnCenters = {
            number:  findLabelCenter(/^No\.?$/i),
            name:    findLabelCenter(/^Name$/i),
            idCard:  findLabelCenter(/^ID\s*Card\s*No\.?$/i),
            email:   findLabelCenter(/^E-?mail$/i),
            mobile1: findLabelCenter(/^Mobile\s*Phone\s*No\.?$/i),       // "Mobile Phone No."
            mobile2: findLabelCenter(/^Mobile\s*Phone\s*No\.?\s*2$/i),   // "Mobile Phone No. 2"
            phone:   findLabelCenter(/^Phone\s*No\.?$/i)                 // "Phone No."
        };
        cachedColumnCentersTs = now;
        return cachedColumnCenters;
    }

    // Map each column to its nearest cell, but enforce uniqueness so the three
    // phone-like columns (Mobile / Mobile 2 / Phone) never read the same cell.
    function assignColumns(cells, centers) {
        const result = {};       // key -> cell element | null
        const claim = new Map(); // cell element -> { key, dist }
        for (const key of Object.keys(centers)) {
            const center = centers[key];
            result[key] = null;
            if (center == null || cells.length === 0) continue;
            let best = null, bestDist = Infinity;
            for (const c of cells) {
                const r = c.getBoundingClientRect();
                const d = Math.abs((r.left + r.width / 2) - center);
                if (d < bestDist) { bestDist = d; best = c; }
            }
            if (!best) continue;
            const prev = claim.get(best);
            if (!prev || bestDist < prev.dist) {
                if (prev) result[prev.key] = null; // evict the farther column
                claim.set(best, { key, dist: bestDist });
                result[key] = best;
            } // else: this column loses the contested cell, stays null
        }
        return result;
    }

    function extractCustomerRow(rowElement) {
        const flat = oneLineText(getElementText(rowElement));
        if (!customerNumberRegex.test(flat)) return null;

        const cells = getCellElements(rowElement);
        const cc = getColumnCenters();
        const cols = assignColumns(cells, cc);
        const val = key => cleanValue(getElementText(cols[key]));

        // Customer No.
        let customerNumber = "";
        const noMatch = (val("number") || "").match(customerNumberRegex);
        if (noMatch) customerNumber = noMatch[0];
        else { const rm = flat.match(customerNumberRegex); if (rm) customerNumber = rm[0]; }
        if (!customerNumber) return null;

        // Name (+ closed flag)
        let rawName = val("name");
        if (customerNumberRegex.test(rawName) && rawName.replace(customerNumberRegex, "").trim() === "") rawName = "";
        const isClosed = /\(CLOSED\)/i.test(rawName) || /\(CLOSED\)/i.test(flat);
        const name = rawName.replace(/\s*\(CLOSED\)\s*/ig, " ").trim();

        const idCard = val("idCard");
        const email  = val("email");
        const mobile1 = val("mobile1");
        const mobile2 = val("mobile2");
        const phone   = val("phone");

        return { customerNumber, name, isClosed, idCard, email, mobile1, mobile2, phone, rawRowText: flat };
    }

    function findScrollableAncestor(el) {
        let cur = el ? el.parentElement : null;
        const cands = [];
        while (cur && cur !== document.documentElement) {
            if (isElementVisible(cur) && cur.scrollHeight > cur.clientHeight + 20 && cur.clientHeight > 150 && cur.clientWidth > 300) cands.push(cur);
            cur = cur.parentElement;
        }
        return cands[0] || document.scrollingElement || document.documentElement || document.body;
    }
    function getScrollTop(s) {
        if (s === document.scrollingElement || s === document.documentElement || s === document.body)
            return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
        return s.scrollTop;
    }
    function setScrollTop(s, v) {
        if (s === document.scrollingElement || s === document.documentElement || s === document.body) {
            window.scrollTo(0, v); document.documentElement.scrollTop = v; document.body.scrollTop = v; return;
        }
        s.scrollTop = v;
        s.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    function getScrollHeight(s) {
        if (s === document.scrollingElement || s === document.documentElement || s === document.body)
            return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.body.offsetHeight, document.documentElement.offsetHeight);
        return s.scrollHeight;
    }
    function getClientHeight(s) {
        if (s === document.scrollingElement || s === document.documentElement || s === document.body)
            return window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
        return s.clientHeight;
    }
    function wait(ms) { return new Promise(r => window.setTimeout(r, ms)); }

    function escapeTsv(v) {
        return String(v == null ? "" : v).replace(/\t/g, " ").replace(/\r/g, " ").replace(/\n/g, " ").trim();
    }
    function escapeCsv(v) {
        const s = String(v == null ? "" : v);
        if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    async function copyTextToClipboard(text) {
        try { if (typeof copy === "function") { copy(text); return true; } } catch (e) {}
        try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) {}
        try {
            const ta = document.createElement("textarea");
            ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px"; ta.style.top = "-9999px";
            document.body.appendChild(ta); ta.focus(); ta.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            return ok;
        } catch (e) { return false; }
    }

    function downloadAsFile(text, filename, mimeType) {
        try {
            const blob = new Blob([text], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1500);
            return true;
        } catch (e) { console.error("Download failed:", e); return false; }
    }

    // Keep one record per customer, filling any blank field as more renders appear.
    function mergeIntoMap(map, rec) {
        const existing = map.get(rec.customerNumber);
        if (!existing) { map.set(rec.customerNumber, { ...rec }); return true; }
        for (const k of ["name", "idCard", "email", "mobile1", "mobile2", "phone"]) {
            if (!existing[k] && rec[k]) existing[k] = rec[k];
        }
        if (rec.isClosed) existing.isClosed = true;
        return false;
    }
    function collectVisibleRowsIntoMap(map) {
        let added = 0;
        for (const row of getVisiblePotentialRowElements()) {
            const rec = extractCustomerRow(row);
            if (!rec) continue;
            if (mergeIntoMap(map, rec)) added++;
        }
        return added;
    }

    console.clear();
    console.log("Scanning Customers list. Do not click inside the page until this finishes.");

    const initialRows = getVisiblePotentialRowElements();
    if (initialRows.length === 0) {
        console.error("No customer rows detected. Make sure the Customers grid is visible.");
        return;
    }

    const scrollEl = findScrollableAncestor(initialRows[0]);
    console.log("Detected scroll element:", scrollEl);
    console.log("Columns located:", getColumnCenters());

    setScrollTop(scrollEl, 0);
    await wait(configuration.scrollDelayMilliseconds * 2);

    const collected = new Map();
    let sameCount = 0;

    for (let step = 0; step < configuration.maximumScrollSteps; step++) {
        const added = collectVisibleRowsIntoMap(collected);
        const cur = getScrollTop(scrollEl);
        const max = Math.max(0, getScrollHeight(scrollEl) - getClientHeight(scrollEl));
        const amt = Math.max(120, Math.floor(getClientHeight(scrollEl) * configuration.scrollAmountRatio));
        const next = Math.min(max, cur + amt);
        if (configuration.logEachStep) console.log("step", step + 1, "added", added, "total", collected.size, "scroll", cur, "/", max);
        if (next <= cur + 1) sameCount++;
        else {
            setScrollTop(scrollEl, next);
            await wait(configuration.scrollDelayMilliseconds);
            if (Math.abs(getScrollTop(scrollEl) - cur) <= 1) sameCount++;
            else sameCount = 0;
        }
        if (sameCount >= 4) break;
    }
    await wait(configuration.scrollDelayMilliseconds);
    collectVisibleRowsIntoMap(collected);

    let records = Array.from(collected.values());

    // Optional filter to just the customers you care about (e.g. watchlist)
    const onlySet = new Set((configuration.onlyCustomerNumbers || []).map(s => String(s).trim().toUpperCase()));
    const totalBeforeFilters = records.length;
    if (onlySet.size > 0) records = records.filter(r => onlySet.has(r.customerNumber.toUpperCase()));
    if (configuration.skipClosedAccounts) records = records.filter(r => !r.isClosed);

    // Sort by Customer No. (natural numeric within the letter prefix)
    records.sort((a, b) => a.customerNumber.localeCompare(b.customerNumber, undefined, { numeric: true }));

    const headers = [
        "Customer No.", "Name", "Closed", "ID Card No.",
        "Email", "Mobile Phone No.", "Mobile Phone No. 2", "Phone No."
    ];
    const rowToArr = r => [
        r.customerNumber, r.name, r.isClosed ? "Yes" : "No", r.idCard,
        r.email, r.mobile1, r.mobile2, r.phone
    ];

    const tsv = [headers.map(escapeTsv).join("\t")]
        .concat(records.map(r => rowToArr(r).map(escapeTsv).join("\t")))
        .join("\n");
    const csv = [headers.map(escapeCsv).join(",")]
        .concat(records.map(r => rowToArr(r).map(escapeCsv).join(",")))
        .join("\n");

    const copied = await copyTextToClipboard(tsv);

    const fileStamp = new Date().toISOString().slice(0, 10);
    const csvFilename = `customer-contact-details-${fileStamp}.csv`;
    const tsvFilename = `customer-contact-details-${fileStamp}.tsv`;

    let downloaded = false;
    if (configuration.downloadCsvOnFinish) {
        downloaded = downloadAsFile(csv, csvFilename, "text/csv;charset=utf-8");
    }

    const byCustomerNumber = {};
    for (const r of records) byCustomerNumber[r.customerNumber] = r;

    window.customerContactScan = {
        totalCustomersFound: totalBeforeFilters,
        totalAfterFilters: records.length,
        onlyCustomerNumbersApplied: onlySet.size > 0,
        skipClosedApplied: configuration.skipClosedAccounts,
        records,
        byCustomerNumber,
        lookup: no => byCustomerNumber[String(no).trim().toUpperCase()] || null,
        contactCsv: csv,
        contactTsv: tsv,
        downloadCsv: () => downloadAsFile(csv, csvFilename, "text/csv;charset=utf-8"),
        downloadTsv: () => downloadAsFile(tsv, tsvFilename, "text/tab-separated-values;charset=utf-8")
    };

    const missingEmail = records.filter(r => !r.email).length;
    const missingAnyPhone = records.filter(r => !r.mobile1 && !r.mobile2 && !r.phone).length;

    console.log("Finished.");
    console.log("Customers found on page:", totalBeforeFilters);
    if (onlySet.size > 0) console.log("Filtered to onlyCustomerNumbers:", records.length, "/", onlySet.size, "requested");
    if (configuration.skipClosedAccounts) console.log("Closed accounts excluded.");
    console.log("Rows in output:", records.length);
    console.log("  - without an email:", missingEmail);
    console.log("  - without any phone:", missingAnyPhone);
    console.log("TSV copied to clipboard:", copied);
    console.log("CSV auto-downloaded:", downloaded, "→", csvFilename);
    console.log("Re-download anytime: customerContactScan.downloadCsv() or .downloadTsv()");
    console.log("Look up one customer: customerContactScan.lookup('D01894')");

    console.table(records.map(r => ({
        "Customer No.": r.customerNumber,
        "Name": r.name,
        "Closed": r.isClosed ? "Yes" : "No",
        "ID Card No.": r.idCard,
        "Email": r.email,
        "Mobile": r.mobile1,
        "Mobile 2": r.mobile2,
        "Phone": r.phone
    })));
})();
