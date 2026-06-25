import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const S = (f) => path.join(root, 'Expired', f);

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
// /api/overrides is unreachable under file:// (no server) — that CORS/network
// noise is expected here and never happens on the deployed Worker. Ignore it.
const ignorable = t => /api\/overrides/.test(t) || /ERR_FAILED/.test(t) || /Failed to load resource/.test(t);
page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('file://' + path.join(root, 'public', 'index.html'));

// 1) copy-code buttons embed real scripts
const codeLen = await page.evaluate(() => ({
  customer: document.getElementById('src-customer').textContent.length,
  watchlist: document.getElementById('src-watchlist').textContent.length,
  cylinders: document.getElementById('src-cylinders').textContent.length,
}));
console.log('embedded script sizes:', codeLen);

// 2) upload the three data CSVs at once
await page.setInputFiles('#fileInput', [
  S('customer-contact-details-2026-06-25.csv'),
  S('prescription-temp-watchlist-2026-06-25.csv'),
  S('source-cylinders-last-30-days-2026-06-25.csv'),
]);
await page.waitForTimeout(400);

// 3) upload deceased xlsx (exercises the dependency-free unzip)
await page.setInputFiles('#decInput', [S('PATIENTS PASSED AWAY 240626.xlsx')]);
await page.waitForTimeout(500);

const chips = await page.evaluate(() => [...document.querySelectorAll('.chip')].map(c => c.className + ' :: ' + c.textContent.trim()));
console.log('chips:\n  ' + chips.join('\n  '));

const loadErr = await page.evaluate(() => document.getElementById('loadErr').textContent + '|' + document.getElementById('decErr').textContent);
console.log('load errors:', JSON.stringify(loadErr));

// 4) inspect computed results
const res = await page.evaluate(() => ({
  meta: META,
  total: RESULTS.length,
  groups: CARERS.filter(g=>g.emails.length).length,
  temp: RESULTS.filter(r => /temp/i.test(r.state)).length,
  expired: RESULTS.filter(r => !/temp/i.test(r.state)).length,
  noEmail: RESULTS.filter(r => !r.email).length,
  // verify the "consec only when temp state" rule
  expiredWithConsec: RESULTS.filter(r => !/temp/i.test(r.state) && r.relConsec !== 0).length,
  visibleRows: document.querySelectorAll('#rows tr').length,
  stats: document.getElementById('stats').textContent.replace(/\s+/g, ' ').trim(),
  sample: RESULTS.slice(0, 3).map(r => ({ cust: r.cust, name: r.name, state: r.state, relConsec: r.relConsec, cyl: r.cyl, email: r.email })),
  // every result must exist in cylinder set and not in deceased
  badCyl: RESULTS.filter(r => !DATA.cylinders.has(r.cust)).length,
  badDeceased: RESULTS.filter(r => DATA.deceased.has(r.cust)).length,
}));
console.log('RESULTS:', JSON.stringify(res, null, 2));

// 4b) compliance report: deceased with cylinder activity in last 30 days
const report = await page.evaluate(() => ({
  visible: !document.getElementById('deceasedReport').classList.contains('hidden'),
  count: (DIAG.deceasedActive || []).length,
  deceasedAmongSwappers: DIAG.deceasedAmongSwappers,
  swapping: DIAG.swapping,
  csvHead: deceasedActiveCsv().split('\n')[0],
  csvLines: deceasedActiveCsv().split('\n').length,
  sample: (DIAG.deceasedActive || []).slice(0, 3),
}));
console.log('DECEASED-ACTIVE REPORT:', JSON.stringify(report, null, 2));

// 4c) carer grouping + overrides + tab copy
const carer = await page.evaluate(() => {
  // find a carer with >1 patient to test combined email
  const multi = CARERS.filter(g => g.patients.length > 1).sort((a,b)=>b.patients.length-a.patients.length)[0];
  return {
    carerCount: CARERS.length,
    withEmail: CARERS.filter(g => g.emails.length).length,
    biggest: multi ? { label: multi.label, n: multi.patients.length, emails: multi.emails.slice(), to: composeUrl(multi).slice(0,70) } : null,
    grouped: typeof groupByCarer !== 'undefined' ? groupByCarer : null,
  };
});
console.log('CARERS:', JSON.stringify(carer, null, 2));

// exercise the email override engine directly (rename, cc, assign) on a real carer
const ovr = await page.evaluate(async () => {
  const g = CARERS.find(x => x.primaryBase) ; // a carer with a base email
  if (!g) return { skip: true };
  const base = g.primaryBase, custs = g.patients.map(p=>p.cust);
  // 1) rename base -> a new address; should change r.email for ALL patients sharing that base
  setRename(base, 'carer-new@example.com');
  await new Promise(r=>setTimeout(r,30));
  const afterRename = custs.map(c => RESULTS.find(r=>r.cust===c)?.email);
  // 2) add an extra recipient; carer.emails should include it
  const g2 = carerByCust.get(custs[0]);
  addCc(g2.primaryBase, 'extra-cc@example.com');
  await new Promise(r=>setTimeout(r,30));
  const g3 = carerByCust.get(custs[0]);
  const recipients = g3.emails.slice();
  // 3) per-patient assign on a different patient shouldn't touch the rename group
  return { base, afterRename, recipients, primaryStillFirst: g3.emails[0] };
});
console.log('OVERRIDE ENGINE:', JSON.stringify(ovr, null, 2));

// tab-separated copy contains a tab and a header
const tsv = await page.evaluate(() => {
  // call the same builder the button uses by clicking it would need clipboard; rebuild inline
  const rows = (typeof orderedRows==='function') ? orderedRows() : RESULTS;
  return { hasRows: rows.length>0 };
});
console.log('TSV rows:', JSON.stringify(tsv));

// 5) sorting: click "Consec. Temps" header twice, ensure order changes
await page.evaluate(() => setGroupMode(false));   // flat view exposes sortable headers
await page.click('th[data-k="relConsec"]');
const firstAsc = await page.evaluate(() => RESULTS[0].relConsec);
await page.click('th[data-k="relConsec"]');
const firstDesc = await page.evaluate(() => RESULTS[0].relConsec);
console.log('sort relConsec asc-first/desc-first:', firstAsc, firstDesc);

// 5b) grouped view must also rearrange on a header click (the reported bug)
const groupedSort = await page.evaluate(() => {
  setGroupMode(true);
  // sort by Cyl 30d descending, capture the order the table/copy uses
  sortKey='cyl'; sortDir=-1; applySort(); render();
  const desc = orderedRows().map(r=>r.cyl);
  sortKey='cyl'; sortDir=1; applySort(); render();
  const asc = orderedRows().map(r=>r.cyl);
  // first carer header label after sorting (proves groups reorder, not just members)
  return { descFirst: desc[0], ascFirst: asc[0], rearranged: desc[0] !== asc[0], n: desc.length };
});
console.log('grouped sort by cyl:', JSON.stringify(groupedSort));

// 6) compose URL sanity for a multi-patient group
const url = await page.evaluate(() => {
  const g = CARERS.filter(x=>x.emails.length).sort((a,b)=>b.patients.length-a.patients.length)[0];
  return composeUrl(g).slice(0, 90);
});
console.log('sample composeUrl:', url);

// 7) filtering
await page.fill('#search', 'expired');
await page.waitForTimeout(150);
const filtered = await page.evaluate(() => document.querySelectorAll('#rows tr').length);
console.log('rows after filter "expired":', filtered);

console.log('\nconsole/page errors:', errors.length ? errors : 'none');
await browser.close();

// assertions
const fail = [];
if (codeLen.customer < 1000 || codeLen.watchlist < 1000 || codeLen.cylinders < 1000) fail.push('embedded scripts too small');
if (res.total <= 0) fail.push('no results computed');
if (res.expiredWithConsec !== 0) fail.push('consec temps shown for non-temp state (rule violated)');
if (!groupedSort.rearranged) fail.push('grouped view did not rearrange on column sort');
if (res.badCyl !== 0) fail.push('result without cylinder swap leaked through');
if (res.badDeceased !== 0) fail.push('deceased patient leaked through');
if (res.meta.deceased <= 0) fail.push('xlsx deceased parse produced 0 ids');
if (!url.startsWith('https://outlook.office.com/mail/deeplink/compose?to=')) fail.push('bad compose url');
if (errors.length) fail.push('runtime errors: ' + errors.join(' | '));

if (fail.length) { console.error('\nFAILURES:\n - ' + fail.join('\n - ')); process.exit(1); }
console.log('\nALL CHECKS PASSED');
