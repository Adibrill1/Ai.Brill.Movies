// Start a local preview on 8013. Date metadata below is a test fixture only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const films = JSON.parse(fs.readFileSync(path.join(__dirname, '../films.json')));
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
    await context.route('https://**/*', route => route.abort());
    await context.route('**/films.json', route => {
      const data = structuredClone(films);
      data[0].createdDate = '2020'; data[1].publishedDate = '2022-01';
      data[2].createdDate = '2021-02-03'; data[2].publishedDate = '2024-01-01';
      return route.fulfill({ json: data });
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8013/#all');
    await page.waitForFunction(n => document.querySelectorAll('.card').length === n, films.length);
    assert.equal(await page.locator('#cloud-login').count(), 0);
    await page.locator('#sort').selectOption('oldest');
    assert.deepEqual(await page.locator('.card').evaluateAll(es => es.slice(0, 3).map(e => e.id)), ['film-001', 'film-003', 'film-002']);
    await page.locator('#sort').selectOption('newest');
    assert.deepEqual(await page.locator('.card').evaluateAll(es => es.slice(0, 3).map(e => e.id)), ['film-002', 'film-003', 'film-001']);
    assert.equal(await page.locator('#film-001 .film-date time').textContent(), '2020');
    assert.equal(await page.locator('#film-002 .film-date time').textContent(), '01.2022');
    assert((await page.locator('#film-002 .film-date').textContent()).startsWith('פורסם'));
    assert((await page.locator('#film-003 .film-date').textContent()).startsWith('נוצר'));
    assert.equal(await page.locator('.film-date time').count(), 3);
    assert(await page.evaluate(() => FilmDates.valid('2024-02-29') && !FilmDates.valid('2025-02-29') && !FilmDates.valid('2025-13') && !FilmDates.valid('2025-04-31')));
    console.log('PASS creation date precedence, publication fallback, year/month precision, unknown dates last in both directions, calendar validation');
    await page.locator('#category-004').selectOption('הדגמה רשמית');
    await page.locator('#film-004 .edit-film').click();
    await page.locator('#createdDate').fill('2019-02-29'); await page.locator('#save-film-preferences').click();
    assert(await page.locator('#film-editor').isVisible()); assert(await page.locator('#editor-message.is-error').count());
    await page.locator('#createdDate').fill('2019'); await page.locator('#publishedDate').fill('2025-03-21');
    await page.locator('#save-film-preferences').click(); await page.locator('#film-editor').waitFor({ state: 'hidden' });
    await page.locator('#sort').selectOption('oldest'); assert.equal(await page.locator('.card').first().getAttribute('id'), 'film-004');
    await page.reload(); await page.waitForFunction(() => document.querySelector('#film-004 .film-date time')?.textContent === '2019');
    assert.equal(await page.locator('#film-004 .badge').textContent(), 'אהבתי');
    await page.locator('#film-004 .edit-film').click(); await page.locator('#restore-film-defaults').click(); await page.locator('#film-editor').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#film-004 .film-date time').textContent(), '2019');
    assert.equal(await page.locator('#film-004 .badge').textContent(), 'אהבתי');
    console.log('PASS manual film dates save and persist, invalid edits rejected, restoring image/duration preserves dates and categories');
    await page.locator('.personal-settings summary').click();
    const download = page.waitForEvent('download'); await page.locator('#export-preferences').click();
    const backup = await download; const data = JSON.parse(fs.readFileSync(await backup.path()));
    const record = data.films.find(f => f.id === '004'); assert.equal(record.createdDate, '2019'); assert.equal(record.publishedDate, '2025-03-21');
    await page.locator('#film-004 .edit-film').click(); await page.locator('#createdDate').fill(''); await page.locator('#save-film-preferences').click(); await page.locator('#film-editor').waitFor({ state: 'hidden' });
    assert((await page.locator('#film-004 .film-date').textContent()).startsWith('פורסם: 21.03.2025'));
    await page.locator('#import-preferences').setInputFiles({ name: 'dates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => document.querySelector('#film-004 .film-date time')?.textContent === '2019');
    await page.locator('#import-preferences').setInputFiles({ name: 'bad-date.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, films: [{ id: '004', createdDate: '2023-02-30' }] })) });
    await page.waitForFunction(() => document.querySelector('#preferences-status').textContent.startsWith('הגיבוי לא נטען'));
    assert.equal(await page.locator('#film-004 .film-date time').textContent(), '2019');
    console.log('PASS date backup export/import, removing creation override falls back to publication, invalid backup leaves choices unchanged');
    await page.locator('[data-page="new"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 10);
    const latest = films.reduce((date, f) => f.added > date ? f.added : date, '');
    assert.deepEqual((await page.locator('.card').evaluateAll(es => es.map(e => e.id))).sort(), films.filter(f => f.added === latest).map(f => 'film-' + f.id).sort());
    for (const mode of ['shortest', 'longest']) {
      await page.locator('#sort').selectOption(mode); assert(await page.locator('#date-sort-note').isHidden());
      const durations = await page.locator('.film-duration time').evaluateAll(es => es.map(e => Number(e.dateTime.slice(2, -1))));
      assert.deepEqual(durations, [...durations].sort((a, b) => mode === 'shortest' ? a - b : b - a));
    }
    await page.locator('#sort').selectOption('newest');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('.edit-film').first().click(); assert(await page.locator('#film-editor').evaluate(e => e.scrollWidth <= e.clientWidth)); await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []); console.log('PASS New still uses added date, runtime sorting unchanged, mobile/desktop layouts, no cloud UI or JavaScript errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
