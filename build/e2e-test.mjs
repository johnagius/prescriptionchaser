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
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
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
  groups: GROUPS.size,
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

// 5) sorting: click "Consec. Temps" header twice, ensure order changes
await page.click('th[data-k="relConsec"]');
const firstAsc = await page.evaluate(() => RESULTS[0].relConsec);
await page.click('th[data-k="relConsec"]');
const firstDesc = await page.evaluate(() => RESULTS[0].relConsec);
console.log('sort relConsec asc-first/desc-first:', firstAsc, firstDesc);

// 6) compose URL sanity for a multi-patient group
const url = await page.evaluate(() => {
  const g = [...GROUPS.values()].find(g => g.patients.length > 1) || [...GROUPS.values()][0];
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
if (res.badCyl !== 0) fail.push('result without cylinder swap leaked through');
if (res.badDeceased !== 0) fail.push('deceased patient leaked through');
if (res.meta.deceased <= 0) fail.push('xlsx deceased parse produced 0 ids');
if (!url.startsWith('https://outlook.office.com/mail/deeplink/compose?to=')) fail.push('bad compose url');
if (errors.length) fail.push('runtime errors: ' + errors.join(' | '));

if (fail.length) { console.error('\nFAILURES:\n - ' + fail.join('\n - ')); process.exit(1); }
console.log('\nALL CHECKS PASSED');
