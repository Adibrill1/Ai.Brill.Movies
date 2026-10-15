// Run with a local preview: TEST_SITE=http://127.0.0.1:8015/ node tests/film-images.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const films = JSON.parse(fs.readFileSync(path.join(__dirname, '../films.json')));
const paola = films.find(f => f.id === '009');
const jpeg = Buffer.from(paola.poster.split(',')[1], 'base64');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
    await context.route('https://**/*', route => route.request().url().endsWith('/F_14.25.jpg') ? route.abort() : route.fulfill({ contentType: 'image/jpeg', body: jpeg }));
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto((process.env.TEST_SITE || 'http://127.0.0.1:8015/') + '#all');
    await page.waitForFunction(n => document.querySelectorAll('.card').length === n, films.length);
    const open = async id => {
      await page.locator(`#film-${id} .edit-film`).click();
      await page.locator('#film-editor').waitFor({ state: 'visible' });
    };
    const save = async () => {
      await page.locator('#save-film-preferences').click();
      await page.locator('#film-editor').waitFor({ state: 'hidden' });
    };
    assert.equal(await page.locator('video, input[accept^="video"], #capture-frame, #frame-position').count(), 0);
    assert.equal(await page.locator('.watch').count(), 0);
    for (const film of films) assert.equal(await page.locator(`#film-${film.id} .film-photo`).getAttribute('href'), film.watchUrl);
    const nonYoutube = films.filter(f => !/youtu(?:\.be|be\.com)/.test(f.watchUrl));
    assert(nonYoutube.length > 0, 'The collection includes non-YouTube films');
    for (const film of nonYoutube) {
      await open(film.id);
      assert(await page.locator('#frame-presets').isVisible());
      const expected = new Set([film.poster, ...(film.posterOptions || []).map(o => o.src), film.posterFallback].filter(Boolean)).size;
      assert.equal(await page.locator('.frame-choice').count(), expected, film.title);
      if (expected === 1) assert((await page.locator('#frame-options-hint').textContent()).includes('רק תמונה אחת'));
      await page.locator('#close-editor').click();
    }
    console.log('PASS all non-YouTube galleries visible, duplicate URLs removed, single-image hint, no video uploader');
    await page.locator('#category-009').selectOption('פחות אהבתי');
    await open('009');
    assert.equal(await page.locator('.frame-choice').count(), 7);
    await page.locator('.frame-choice').filter({ hasText: 'במכונית' }).click();
    assert.equal(await page.locator('.frame-choice[aria-pressed="true"]').count(), 1);
    await page.locator('#createdDate').fill('2025');
    await save();
    await page.reload();
    await page.waitForFunction(() => window.FilmEditor && FilmEditor.get('009').poster);
    const saved = await page.evaluate(() => FilmEditor.get('009'));
    assert.equal(saved.poster, paola.posterOptions[3].src);
    assert.equal(saved.category, 'פחות אהבתי');
    assert.equal(saved.createdDate, '2025');
    await open('009');
    assert.equal(await page.locator('.frame-choice[aria-pressed="true"]').getAttribute('data-src'), saved.poster);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.locator('#film-editor').evaluate(e => e.scrollWidth <= e.clientWidth));
    }
    await page.locator('#frame-image-file').setInputFiles({ name: 'saved-frame.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await page.waitForFunction(() => document.querySelector('#frame-selection-label').textContent === 'הפריים שבחרת מהמכשיר');
    await save();
    assert((await page.evaluate(() => FilmEditor.get('009').poster)).startsWith('data:image/jpeg;base64,'));
    console.log('PASS non-YouTube selection persists, category/date retained, image-file upload works, mobile gallery fits');
    await page.locator('.personal-settings summary').click();
    const download = page.waitForEvent('download');
    await page.locator('#export-preferences').click();
    const backup = JSON.parse(fs.readFileSync(await (await download).path()));
    assert(backup.films.find(f => f.id === '009').poster.startsWith('data:image/jpeg;base64,'));
    await open('009');
    await page.locator('#restore-film-defaults').click();
    await page.locator('#film-editor').waitFor({ state: 'hidden' });
    await page.locator('#import-preferences').setInputFiles({ name: 'images.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => FilmEditor.get('009').poster?.startsWith('data:image/jpeg;base64,'));
    assert.equal(await page.evaluate(() => FilmEditor.get('009').category), 'פחות אהבתי');
    await open('001');
    assert.equal(await page.locator('.frame-choice').count(), 4);
    await page.locator('#close-editor').click();
    await open('009');
    await page.waitForFunction(() => document.querySelector('.frame-choice[data-src$="F_14.25.jpg"]').disabled);
    assert(await page.locator('.frame-choice').filter({ hasText: 'השוק' }).isEnabled());
    assert.deepEqual(errors, []);
    console.log('PASS image backups preserved, YouTube choices unchanged, failed images disabled without blocking other choices, no JavaScript errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
