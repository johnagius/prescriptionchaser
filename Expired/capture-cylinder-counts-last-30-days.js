(async function captureCylinderCountsPerSource() {
    "use strict";

    const configuration = {
        scrollDelayMilliseconds: 350,
        maximumScrollSteps: 6000,
        scrollAmountRatio: 0.55,
        logEachStep: false,
        downloadCsvOnFinish: true
        // READ ONLY: this script never clicks rows or changes Business Central
        // data. It only scrolls the pivot and reads the grouped values.
        // Make sure the page is already filtered to the period you want
        // (here: Posting Date 26/05/26..25/06/26 = last 30 days).
    };

    const sourceNumberRegex = /\b[A-Z]\d{5}\b/;      // e.g. D02367
    const bracketCountRegex = /\((\d+(?:\.\d+)?)\)/;  // e.g. the (3) in "D02367 (3)"

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
    // Parse a UK/US formatted number: "3.00", "1,697.00" -> 3, 1697. Letters -> null.
    function parseNumber(value) {
        const t = oneLineText(value).replace(/[,\s]+/g, "");
        if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
        return parseFloat(t);
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
    function getDataRowElements() {
        return Array.from(document.querySelectorAll('[role="row"], tr')).filter(row => {
            if (!isElementVisible(row)) return false;
            const t = oneLineText(getElementText(row));
            if (!sourceNumberRegex.test(t)) return false; // a data row must hold a Source No.
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
            source:   findLabelCenter(/^Source\s*No\.?$/i),
            quantity: findLabelCenter(/^Sum\s*\(\s*Quantity\s*\)$/i) || findLabelCenter(/quantity/i)
        };
        cachedColumnCentersTs = now;
        return cachedColumnCenters;
    }
    function findCellNearestColumnCenter(cells, columnCenter) {
        if (columnCenter == null || !Array.isArray(cells) || cells.length === 0) return null;
        let best = null, bestDist = Infinity;
        for (const c of cells) {
            const r = c.getBoundingClientRect();
            const d = Math.abs((r.left + r.width / 2) - columnCenter);
            if (d < bestDist) { bestDist = d; best = c; }
        }
        return best;
    }
    function getCellTextNearestColumnCenter(cells, columnCenter) {
        return getElementText(findCellNearestColumnCenter(cells, columnCenter));
    }

    function extractRow(rowElement) {
        const flat = oneLineText(getElementText(rowElement));
        if (!sourceNumberRegex.test(flat)) return null;

        const cells = getCellElements(rowElement);
        const cc = getColumnCenters();

        // Source No. (from the source cell, falling back to the whole row)
        const sourceCellText = getCellTextNearestColumnCenter(cells, cc.source) ||
            (cells[0] ? getElementText(cells[0]) : "") || flat;
        const srcMatch = sourceCellText.match(sourceNumberRegex) || flat.match(sourceNumberRegex);
        if (!srcMatch) return null;
        const sourceNo = srcMatch[0];

        // Bracket count e.g. the (3) in "D02367 (3)"
        const brMatch = sourceCellText.match(bracketCountRegex) || flat.match(bracketCountRegex);
        const bracketCount = brMatch ? parseFloat(brMatch[1]) : null;

        // Sum(Quantity) from the right column
        let quantity = parseNumber(getCellTextNearestColumnCenter(cells, cc.quantity));
        if (quantity == null) {
            // fallback: rightmost cell that parses to a number
            for (let i = cells.length - 1; i >= 0; i--) {
                const v = parseNumber(getElementText(cells[i]));
                if (v != null) { quantity = v; break; }
            }
        }
        if (quantity == null && bracketCount != null) quantity = bracketCount;
        if (quantity == null) return null;

        return { sourceNo, quantity, bracketCount, rawRowText: flat };
    }

    // Read the pivot's own "Total" row so we can verify nothing was missed.
    function findPageTotalQuantity() {
        const rows = Array.from(document.querySelectorAll('[role="row"], tr'));
        for (const r of rows) {
            if (!isElementVisible(r)) continue;
            const flat = oneLineText(getElementText(r));
            if (/^Total\b/i.test(flat) && !sourceNumberRegex.test(flat)) {
                const nums = flat.match(/-?[\d,]+\.\d+|-?[\d,]+/g);
                if (nums && nums.length) {
                    const v = parseNumber(nums[nums.length - 1]);
                    if (v != null) return v;
                }
            }
        }
        return null;
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

    // One record per Source No. (the pivot already groups, but virtualization
    // re-renders the same rows as you scroll, so we de-dupe).
    function mergeIntoMap(map, rec) {
        const existing = map.get(rec.sourceNo);
        if (!existing) { map.set(rec.sourceNo, { ...rec }); return true; }
        // keep the populated values; prefer a real quantity if one was missing
        if ((existing.quantity == null) && rec.quantity != null) existing.quantity = rec.quantity;
        if ((existing.bracketCount == null) && rec.bracketCount != null) existing.bracketCount = rec.bracketCount;
        return false;
    }
    function collectVisibleRowsIntoMap(map) {
        let added = 0;
        for (const row of getDataRowElements()) {
            const rec = extractRow(row);
            if (!rec) continue;
            if (mergeIntoMap(map, rec)) added++;
        }
        return added;
    }

    console.clear();
    console.log("Reading Source No. vs cylinders. Do not click inside the page until this finishes.");

    const pageTotalQuantity = findPageTotalQuantity();

    const initialRows = getDataRowElements();
    if (initialRows.length === 0) {
        console.error("No data rows detected. Make sure the pivot is showing Source No. rows.");
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

    const records = Array.from(collected.values());

    // Sort by cylinders taken, biggest first
    records.sort((a, b) => (b.quantity - a.quantity) || a.sourceNo.localeCompare(b.sourceNo, undefined, { numeric: true }));

    const headers = ["Source No.", "Cylinders", "Bracket Count"];
    const rowToArr = r => [r.sourceNo, r.quantity, r.bracketCount == null ? "" : r.bracketCount];

    const tsv = [headers.map(escapeTsv).join("\t")]
        .concat(records.map(r => rowToArr(r).map(escapeTsv).join("\t")))
        .join("\n");
    const csv = [headers.map(escapeCsv).join(",")]
        .concat(records.map(r => rowToArr(r).map(escapeCsv).join(",")))
        .join("\n");

    const copied = await copyTextToClipboard(tsv);

    const fileStamp = new Date().toISOString().slice(0, 10);
    const csvFilename = `source-cylinders-last-30-days-${fileStamp}.csv`;
    const tsvFilename = `source-cylinders-last-30-days-${fileStamp}.tsv`;

    let downloaded = false;
    if (configuration.downloadCsvOnFinish) {
        downloaded = downloadAsFile(csv, csvFilename, "text/csv;charset=utf-8");
    }

    const scrapedTotalQuantity = records.reduce((acc, r) => acc + (r.quantity || 0), 0);
    const mismatches = records.filter(r => r.bracketCount != null && r.bracketCount !== r.quantity);

    const bySourceNo = {};
    for (const r of records) bySourceNo[r.sourceNo] = r;

    window.cylinderCountScan = {
        records,
        bySourceNo,
        rowCount: records.length,
        scrapedTotalQuantity,
        pageTotalQuantity,
        totalsMatch: pageTotalQuantity == null ? null : Math.abs(scrapedTotalQuantity - pageTotalQuantity) < 0.001,
        bracketVsQuantityMismatches: mismatches,
        lookup: no => bySourceNo[String(no).trim().toUpperCase()] || null,
        cylinderCsv: csv,
        cylinderTsv: tsv,
        downloadCsv: () => downloadAsFile(csv, csvFilename, "text/csv;charset=utf-8"),
        downloadTsv: () => downloadAsFile(tsv, tsvFilename, "text/tab-separated-values;charset=utf-8")
    };

    console.log("Finished.");
    console.log("Source numbers captured:", records.length);
    console.log("Cylinders total (scraped):", scrapedTotalQuantity);
    if (pageTotalQuantity != null) {
        const ok = Math.abs(scrapedTotalQuantity - pageTotalQuantity) < 0.001;
        console.log("Page 'Total' row:", pageTotalQuantity, ok ? "✓ matches — all rows captured" : "✗ MISMATCH — increase scrollDelay/maxSteps and re-run");
    } else {
        console.log("Page 'Total' row: not found (could not auto-verify completeness).");
    }
    console.log("Bracket vs Sum(Quantity) mismatches:", mismatches.length, mismatches.length ? "(see cylinderCountScan.bracketVsQuantityMismatches)" : "(bracket count == quantity for every row)");
    console.log("TSV copied to clipboard:", copied);
    console.log("CSV auto-downloaded:", downloaded, "→", csvFilename);
    console.log("Re-download anytime: cylinderCountScan.downloadCsv() or .downloadTsv()");
    console.log("Look up one source: cylinderCountScan.lookup('D00415')");

    console.table(records.map(r => ({
        "Source No.": r.sourceNo,
        "Cylinders": r.quantity,
        "Bracket": r.bracketCount
    })));
})();
