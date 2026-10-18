'use strict';

// Personal choices stay in this browser. Only an explicit export creates a file.
window.FilmEditor = (() => {
  const categories = ['חדש', 'פסטיבל', 'קהילה', 'הדגמה רשמית', 'פחות אהבתי'];
  const choices = new Map();
  let database;
  let storageAvailable = true;
  const ready = new Promise((resolve, reject) => {
    const request = indexedDB.open('ai-brill-film-preferences', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('films', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage is blocked'));
    request.onsuccess = () => {
      database = request.result;
      const read = database.transaction('films').objectStore('films').getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        for (const record of read.result) {
          try { choices.set(record.id, validateRecord(record)); } catch { /* Ignore invalid old records. */ }
        }
        resolve();
      };
    };
  }).catch(() => { storageAvailable = false; });

  function validateRecord(record) {
    if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 100) throw new Error('Invalid film');
    const clean = { id: record.id };
    if (Object.hasOwn(record, 'poster')) {
      if (typeof record.poster !== 'string' || record.poster.length > 4000000) throw new Error('Invalid image');
      const raster = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(record.poster);
      let https = false;
      try { const url = new URL(record.poster); https = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password; } catch { /* Not a URL. */ }
      if (!raster && !https) throw new Error('Invalid image');
      clean.poster = record.poster;
    }
    if (Object.hasOwn(record, 'durationSeconds')) {
      const duration = record.durationSeconds;
      if (duration !== null && (!Number.isInteger(duration) || duration <= 0 || duration >= 86400)) throw new Error('Invalid duration');
      clean.durationSeconds = duration;
    }
    if (Object.hasOwn(record, 'category')) {
      if (!categories.includes(record.category)) throw new Error('Invalid category');
      clean.category = record.category;
    }
    if (Object.hasOwn(record, 'liked')) {
      if (record.liked !== true) throw new Error('Invalid like');
      clean.liked = true;
    }
    for (const field of ['createdDate', 'publishedDate']) {
      if (Object.hasOwn(record, field)) {
        if (record[field] !== null && !FilmDates.valid(record[field])) throw new Error('Invalid film date');
        clean[field] = record[field];
      }
    }
    return clean;
  }

  async function persist(records, removeId) {
    await ready;
    if (!storageAvailable || !database) throw new Error('Storage unavailable');
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('films', 'readwrite');
      const store = transaction.objectStore('films');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Save aborted'));
      if (removeId) store.delete(removeId);
      for (const record of records) store.put(record);
    });
    if (removeId) choices.delete(removeId);
    for (const record of records) choices.set(record.id, record);
  }

  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    return (hours ? `${hours}:${String(minutes).padStart(2, '0')}` : String(minutes)) + ':' + String(value % 60).padStart(2, '0');
  }

  function parseTime(value) {
    if (!value.trim()) return null;
    if (!/^(?:\d{1,2}:)?\d{1,3}:[0-5]\d$/.test(value.trim())) throw new Error('כתבי משך בפורמט דקות:שניות, למשל 02:35.');
    const parts = value.trim().split(':').map(Number);
    if (parts.length === 3 && parts[1] > 59) throw new Error('מספר הדקות בשעה צריך להיות קטן מ־60.');
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    if (seconds <= 0 || seconds >= 86400) throw new Error('המשׁך צריך להיות גדול מאפס וקטן מ־24 שעות.');
    return seconds;
  }

  function youtubeId(film) {
    for (const candidate of [film.watchUrl, film.poster]) {
      try {
        const url = new URL(candidate);
        let id;
        if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) id = url.searchParams.get('v') || url.pathname.split('/')[2];
        if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
        if (['img.youtube.com', 'i.ytimg.com'].includes(url.hostname)) id = url.pathname.split('/')[2];
        if (/^[\w-]{11}$/.test(id || '')) return id;
      } catch { /* The film may have an embedded image or a creator-page link. */ }
    }
    return null;
  }

  const dialog = document.querySelector('#film-editor');
  const form = document.querySelector('#editor-form');
  const message = document.querySelector('#editor-message');
  const duration = document.querySelector('#film-duration');
  const save = document.querySelector('#save-film-preferences');
  const restore = document.querySelector('#restore-film-defaults');
  const preview = document.querySelector('#frame-preview');
  const backupStatus = document.querySelector('#preferences-status');
  let activeFilm;
  let selectedPoster;
  let session = 0;

  function showMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle('is-error', error);
  }

  function selectPoster(src, label) {
    selectedPoster = src;
    preview.hidden = false;
    FilmImages.load(preview, [src], { onExhausted: () => { preview.hidden = true; } });
    document.querySelector('#selected-frame').hidden = false;
    document.querySelector('#frame-selection-label').textContent = label;
    document.querySelectorAll('.frame-choice').forEach(button => button.setAttribute('aria-pressed', String(FilmImages.key(button.dataset.src) === FilmImages.key(src))));
  }

  function makeChoice(src, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'frame-choice';
    button.dataset.src = src;
    button.setAttribute('aria-pressed', String(FilmImages.key(src) === FilmImages.key(selectedPoster)));
    const image = document.createElement('img');
    image.alt = '';
    const text = document.createElement('span');
    text.textContent = label;
    FilmImages.load(image, [src], {
      onReady: resolved => { button.dataset.src = resolved; },
      onExhausted: () => {
        button.disabled = true;
        button.title = 'התמונה אינה זמינה כרגע';
        image.hidden = true;
        text.textContent = `${label} — לא זמין`;
      }
    });
    button.append(image, text);
    button.addEventListener('click', () => {
      selectPoster(button.dataset.src, label);
      showMessage('הפריים נבחר. לחצי על ״שמירה בכרטיס״ כדי לשמור.');
    });
    return button;
  }

  async function open(film) {
    await ready;
    session++;
    activeFilm = film;
    const current = choices.get(film.id) || {};
    selectedPoster = current.poster || film.poster || null;
    form.reset();
    document.querySelector('#editor-film-title').textContent = film.title;
    const seconds = current.durationSeconds ?? film.durationSeconds;
    duration.value = seconds ? formatTime(seconds) : '';
    duration.setCustomValidity('');
    for (const field of ['createdDate', 'publishedDate']) document.getElementById(field).value = current[field] ?? film[field] ?? '';
    document.querySelector('#selected-frame').hidden = !selectedPoster;
    if (selectedPoster) selectPoster(selectedPoster, 'התמונה הנוכחית');
    const options = document.querySelector('#frame-options');
    options.replaceChildren();
    const candidates = [];
    if (film.poster) candidates.push({ src: film.poster, label: 'התמונה המקורית' });
    candidates.push(...(film.posterOptions || []));
    const id = youtubeId(film);
    if (id) {
      for (let index = 1; index <= 3; index++) candidates.push({ src: `https://img.youtube.com/vi/${id}/maxres${index}.jpg`, label: `פריים ${index}` });
    } else if (film.posterFallback) {
      candidates.push({ src: film.posterFallback, label: 'תמונה ממקור הצפייה' });
    }
    const seen = new Set();
    for (const { src, label } of candidates) {
      const key = FilmImages.key(src);
      if (seen.has(key)) continue;
      seen.add(key);
      options.append(makeChoice(src, label));
    }
    document.querySelector('#frame-options-hint').textContent = seen.size > 1
      ? 'בחרי תמונה ולחצי על ״שמירה בכרטיס״. התמונות נאספו ממקורות הסרט; חלקן עשויות להציג את אותו רגע.'
      : seen.size === 1
        ? 'כרגע מוכרת לסרט הזה רק תמונה אחת. אפשר גם לבחור תמונה ששמרת במכשיר.'
        : 'עדיין אין תמונות לבחירה לסרט הזה. אפשר לבחור תמונה ששמרת במכשיר.';
    showMessage(storageAvailable ? '' : 'הדפדפן אינו מאפשר שמירה כרגע. אפשר לאפשר אחסון לאתר ולרענן, או להשתמש בדפדפן אחר.', !storageAvailable);
    save.disabled = !storageAvailable;
    restore.disabled = !storageAvailable;
    dialog.showModal();
  }

  function announceChange(id) {
    dialog.close();
    window.dispatchEvent(new CustomEvent('film-preferences-changed', { detail: { id } }));
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    let seconds;
    try { seconds = parseTime(duration.value); }
    catch (error) { showMessage(error.message, true); duration.focus(); return; }
    const id = activeFilm.id;
    const record = { id };
    for (const field of ['createdDate', 'publishedDate']) {
      const value = document.getElementById(field).value.trim();
      if (value && !FilmDates.valid(value)) { showMessage('כתבי תאריך תקין: 2025, 2025-03 או 2025-03-21.', true); document.getElementById(field).focus(); return; }
      if (value && value !== activeFilm[field]) record[field] = value;
    }
    const category = choices.get(id)?.category;
    if (category) record.category = category;
    if (selectedPoster && selectedPoster !== activeFilm.poster) record.poster = selectedPoster;
    if (seconds !== (activeFilm.durationSeconds || null)) record.durationSeconds = seconds;
    save.disabled = restore.disabled = true;
    showMessage('שומרים את הבחירה…');
    try {
      if (Object.keys(record).length === 1) await persist([], id);
      else await persist([validateRecord(record)]);
      announceChange(id);
    } catch {
      showMessage('הבחירה לא נשמרה. ייתכן שאין מקום פנוי או שאחסון האתר חסום בדפדפן. הפריים עדיין זמין כאן לניסיון נוסף.', true);
    } finally { save.disabled = restore.disabled = !storageAvailable; }
  });

  restore.addEventListener('click', async () => {
    save.disabled = restore.disabled = true;
    try {
      const id = activeFilm.id;
      const current = choices.get(id) || {};
      const retained = { id };
      for (const field of ['category', 'createdDate', 'publishedDate']) if (Object.hasOwn(current, field)) retained[field] = current[field];
      if (Object.keys(retained).length > 1) await persist([retained]);
      else await persist([], id);
      announceChange(id);
    }
    catch { showMessage('לא הצלחנו לשחזר את ברירת המחדל. נסי שוב.', true); }
    finally { save.disabled = restore.disabled = !storageAvailable; }
  });
  document.querySelector('#close-editor').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { session++; });

  function snapshot(source, width, height) {
    const scale = Math.min(1, 1920 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.95);
  }
  document.querySelector('#frame-image-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    const currentSession = session;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20000000) {
      showMessage('בחרי תמונת JPG, PNG או WebP עד 20MB.', true);
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      if (session === currentSession) {
        selectPoster(snapshot(bitmap, bitmap.width, bitmap.height), 'הפריים שבחרת מהמכשיר');
        showMessage('הפריים מוכן לשמירה.');
      }
      bitmap.close();
    } catch { if (session === currentSession) showMessage('לא הצלחנו לפתוח את התמונה.', true); }
  });

  document.querySelector('#export-preferences').addEventListener('click', async () => {
    await ready;
    if (!choices.size) { backupStatus.textContent = 'עדיין אין בחירות אישיות לגיבוי.'; return; }
    const data = JSON.stringify({ version: 1, films: [...choices.values()] }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ai-brill-personal-frames.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupStatus.textContent = 'קובץ הגיבוי הורד. אפשר לטעון אותו במחברת במכשיר אחר.';
  });
  document.querySelector('#import-preferences').addEventListener('change', async event => {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 20000000) throw new Error('Backup too large');
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !Array.isArray(data.films) || data.films.length > 1000) throw new Error('Invalid backup');
      const records = data.films.map(validateRecord);
      await persist(records);
      window.dispatchEvent(new CustomEvent('film-preferences-changed', { detail: {} }));
      backupStatus.textContent = `נטענו בחירות עבור ${records.length} סרטים. בחירות אחרות נשמרו.`;
    } catch { backupStatus.textContent = 'הגיבוי לא נטען. ודאי שזה קובץ גיבוי של המחברת ושיש מקום פנוי בדפדפן.'; }
    input.value = '';
  });

  async function like(id, on) {
    await ready;
    const current = { ...choices.get(id), id };
    if (on) current.liked = true;
    else delete current.liked;
    if (Object.keys(current).length === 1) await persist([], id);
    else await persist([validateRecord(current)]);
    window.dispatchEvent(new CustomEvent('film-preferences-changed', { detail: { id } }));
  }

  async function move(id, category) {
    await ready;
    await persist([validateRecord({ ...choices.get(id), id, category })]);
    window.dispatchEvent(new CustomEvent('film-preferences-changed', { detail: { id, moved: true } }));
  }

  return { ready, open, formatTime, move, like, categories, get: id => choices.get(id) || {} };
})();
