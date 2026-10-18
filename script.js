'use strict';

const pages = {
  home: { title: 'תוכן העניינים', number: '01' },
  new: { title: 'חדש', subtitle: 'הסרטים מהתוספת האחרונה למחברת', latest: true, number: '02' },
  all: { title: 'סרטים', subtitle: 'כל הסיפורים, במקום אחד', number: '03' },
  how: { title: 'איך', subtitle: 'טכניקות, ספריות וכלים ליצירת סרטים', category: 'איך', number: '04' }
};
const grid = document.querySelector('#grid');
const search = document.querySelector('#search');
const sort = document.querySelector('#sort');
const heartsOnly = document.querySelector('#hearts-only');
let films = [];
let latestAdded = '';
let loaded = false;
let loading = false;
let activePage = 'home';
let selectedFilm = null;
const dateLabel = iso => iso.split('-').reverse().join('.');
// Keep stored category values and existing links compatible with older backups.
const categoryNames = { 'פסטיבל': 'סרטי פסטיבלים', 'קהילה': 'יצירה מהקהילה', 'הדגמה רשמית': 'אהבתי', 'סרטים': 'סרטים', 'איך': 'איך' };

function isLoved(film) {
  const preferences = FilmEditor.get(film.id);
  return Boolean(preferences.liked) || (preferences.category || film.category) === 'הדגמה רשמית';
}

function heartIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'heart-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 21C7 16.5 3 13.3 3 9.3 3 6.4 5.2 4.5 7.7 4.5c1.7 0 3.3.9 4.3 2.4 1-1.5 2.6-2.4 4.3-2.4 2.5 0 4.7 1.9 4.7 4.8 0 4-4 7.2-9 11.7z');
  svg.append(path);
  return svg;
}

function belongsToPage(film, page) {
  const override = FilmEditor.get(film.id).category;
  const effective = override || film.category;
  if (page.latest) return override ? override === 'חדש' : film.added === latestAdded && film.category !== 'איך';
  if (!page.category) return effective !== 'איך' && effective !== 'חדש';
  return effective === page.category;
}

function arrowIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'arrow-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 18 18 6M6 6h12v12');
  svg.append(path);
  return svg;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

// When dates match, the record appended last is the most recent addition.
function newestFirst(a, b) {
  return b.added.localeCompare(a.added) || films.indexOf(b) - films.indexOf(a);
}

function filmDuration(film) {
  const seconds = FilmEditor.get(film.id).durationSeconds ?? film.durationSeconds;
  return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

function compareFilms(a, b) {
  if (sort.value === 'title') return a.title.localeCompare(b.title) || newestFirst(a, b);
  if (sort.value === 'oldest' || sort.value === 'newest') {
    const first = FilmDates.effective(a, FilmEditor.get(a.id));
    const second = FilmDates.effective(b, FilmEditor.get(b.id));
    if (!first && !second) return a.title.localeCompare(b.title);
    if (!first) return 1;
    if (!second) return -1;
    const difference = first.sortKey.localeCompare(second.sortKey);
    return (sort.value === 'oldest' ? difference : -difference) || a.title.localeCompare(b.title);
  }
  if (sort.value === 'shortest' || sort.value === 'longest') {
    const first = filmDuration(a);
    const second = filmDuration(b);
    // Unknown durations stay last in both directions.
    if (first === null && second === null) return newestFirst(a, b);
    if (first === null) return 1;
    if (second === null) return -1;
    return (sort.value === 'shortest' ? first - second : second - first) || newestFirst(a, b);
  }
  return newestFirst(a, b);
}

function externalLink(label, url, className, filmTitle) {
  const link = node('a', undefined, className);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${label} — ${filmTitle} (נפתח בלשונית חדשה)`);
  return link;
}

function card(film) {
  const article = node('article', undefined, 'card');
  article.id = `film-${film.id}`;
  const preferences = FilmEditor.get(film.id);
  const photo = externalLink('לצפייה בסרט', film.watchUrl, 'film-photo', film.title);
  const media = node('div', undefined, 'film-media');
  const color = [...film.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  const art = node('div', undefined, `paper-art art-${color}`);
  art.setAttribute('aria-hidden', 'true');
  const artTitle = node('span', film.title, 'art-title');
  artTitle.dir = 'auto';
  const artCaption = node('span', 'A STORY TO KEEP', 'art-caption');
  artCaption.dir = 'ltr';
  art.append(artTitle, artCaption);
  media.append(art);
  const poster = preferences.poster || film.poster;
  if (poster) {
    const image = node('img', undefined, 'poster');
    image.alt = `תמונה מתוך ${film.title}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    FilmImages.load(image, [poster, preferences.poster && film.poster, film.posterFallback], { onExhausted: () => image.remove() });
    media.append(image);
  }
  const number = node('span', `NO. ${film.id}`, 'film-number');
  number.dir = 'ltr';
  photo.append(media, number);
  const details = node('div', undefined, 'film-details');
  const seconds = filmDuration(film);
  const duration = node('span', undefined, 'film-duration');
  if (Number.isInteger(seconds) && seconds > 0) {
    const time = node('time', FilmEditor.formatTime(seconds));
    time.dateTime = `PT${seconds}S`;
    time.dir = 'ltr';
    duration.append(document.createTextNode('משך צפייה: '), time);
    duration.title = 'אורך גרסת הסרט המקושרת לצפייה';
  } else {
    duration.textContent = 'אורך הסרט טרם צוין';
    duration.classList.add('duration-unknown');
  }
  const edit = node('button', 'עריכת הכרטיס', 'edit-film');
  edit.type = 'button';
  edit.setAttribute('aria-label', `עריכת הכרטיס — ${film.title}`);
  edit.addEventListener('click', () => FilmEditor.open(film));
  details.append(duration, edit);
  const body = node('div', undefined, 'card-body');
  const top = node('div', undefined, 'topline');
  const category = preferences.category || film.category;
  const categoryClass = { 'קהילה': 'community', 'הדגמה רשמית': 'official', 'פסטיבל': 'festival', 'פחות אהבתי': 'disliked', 'חדש': 'new', 'סרטים': 'films', 'איך': 'how' }[category];
  const source = externalLink('מקור ומידע', film.sourceUrl, 'source', film.title);
  source.append(document.createTextNode('מקור ומידע '), arrowIcon());
  top.append(node('span', category === 'הדגמה רשמית' ? categoryNames[category] : category, `badge category-${categoryClass}`), source);
  const title = node('h2', film.title);
  title.dir = 'auto';
  const creator = node('p', film.creator, 'creator');
  creator.dir = 'auto';
  const tool = node('p', undefined, 'tool');
  tool.append(node('strong', 'כלי יצירה:'), node('bdi', film.tools || 'לא אומת'));
  const moveField = node('div', undefined, 'move-film');
  const moveLabel = node('label', 'להעביר לקטגוריה');
  const moveSelect = node('select');
  moveSelect.id = `category-${film.id}`;
  moveLabel.htmlFor = moveSelect.id;
  moveSelect.setAttribute('aria-label', `להעביר לקטגוריה — ${film.title}`);
  const placeholder = node('option', 'בחירת קטגוריה…');
  placeholder.value = ''; placeholder.disabled = true; placeholder.selected = true;
  moveSelect.append(placeholder);
  const names = categoryNames;
  for (const value of FilmEditor.moveCategories) {
    const option = node('option', names[value] || value);
    option.value = value;
    moveSelect.append(option);
  }
  moveSelect.addEventListener('change', async () => {
    const destination = moveSelect.value;
    moveSelect.disabled = true;
    try {
      await FilmEditor.move(film.id, destination);
      document.querySelector('#move-status').textContent = `${film.title} הועבר ל״${names[destination] || destination}״.`;
    } catch {
      moveSelect.disabled = false; moveSelect.value = '';
      document.querySelector('#move-status').textContent = 'ההעברה לא נשמרה. בדקי שאחסון האתר מותר בדפדפן ונסי שוב.';
    }
  });
  moveField.append(moveLabel, moveSelect);
  const filmDate = FilmDates.effective(film, preferences);
  const dateLine = node('p', undefined, 'film-date');
  if (filmDate) {
    const time = node('time', FilmDates.label(filmDate.value));
    time.dateTime = filmDate.value; time.dir = 'ltr';
    dateLine.append(document.createTextNode(`${filmDate.label}: `), time);
  } else dateLine.textContent = 'תאריך יצירה או פרסום לא ידוע';
  body.append(top, title, creator, dateLine, node('p', film.description, 'blurb'), tool, moveField);
  const loved = isLoved(film);
  const heart = node('button', undefined, 'heart-toggle');
  heart.type = 'button';
  heart.setAttribute('aria-pressed', String(loved));
  heart.setAttribute('aria-label', loved ? `להסיר את ${film.title} מהמסומנים בלב` : `לסמן את ${film.title} בלב`);
  heart.title = loved ? 'מסומן בלב - לחיצה מסירה' : 'לסמן בלב';
  heart.append(heartIcon());
  heart.addEventListener('click', async () => {
    heart.disabled = true;
    try { await FilmEditor.like(film.id, !isLoved(film)); }
    catch { heart.setAttribute('aria-label', 'הסימון לא נשמר. בדקי שאחסון האתר מותר בדפדפן.'); }
    finally { heart.disabled = false; }
  });
  article.append(photo, details, body, heart);
  return article;
}

function updateContents() {
  document.querySelector('#total-films').textContent = films.filter(film => film.category !== 'איך' && film.category !== 'חדש').length;
  const latest = [...films].filter(film => film.category !== 'איך').sort(newestFirst);
  document.querySelector('#last-updated').textContent = latest.length ? `תוספת אחרונה · ${dateLabel(latest[0].added)}` : 'הסיפור הראשון עוד לפנינו';
  document.querySelectorAll('[data-count]').forEach(element => {
    const page = pages[element.dataset.count];
    const count = films.filter(film => belongsToPage(film, page)).length;
    element.textContent = count;
    element.setAttribute('aria-label', `${count} סרטים`);
  });
  const recent = document.querySelector('#recent-films');
  recent.replaceChildren(...latest.slice(0, 3).map(film => {
    const link = node('a', undefined, 'recent-link');
    link.href = `#film/${encodeURIComponent(film.id)}`;
    link.append(node('bdi', film.title), arrowIcon());
    return link;
  }));
  if (!latest.length) recent.append(node('p', 'המחברת מחכה לסרט הראשון.', 'loading-copy'));
}

function render() {
  if (activePage === 'home') return;
  const page = pages[activePage];
  const query = search.value.trim().toLocaleLowerCase();
  const inPage = films.filter(film => belongsToPage(film, page));
  document.querySelector('#collection-eyebrow').textContent = page.latest && latestAdded ? `התוספת האחרונה: ${dateLabel(latestAdded)} · וגם סרטים שהעברת לכאן` : page.subtitle;
  const visible = inPage.filter(film => {
    if (heartsOnly.checked && !isLoved(film)) return false;
    const category = FilmEditor.get(film.id).category || film.category;
    return [film.title, film.creator, film.tools || '', film.description, categoryNames[category] || category].join(' ').toLocaleLowerCase().includes(query);
  });
  visible.sort(compareFilms);
  document.querySelector('#date-sort-note').hidden = !['newest', 'oldest'].includes(sort.value);
  grid.replaceChildren(...visible.map(card));
  document.querySelector('#count').textContent = loaded ? `${visible.length} מתוך ${inPage.length} ${page.category === 'איך' ? 'פריטים' : 'סרטים'}` : 'טוענים את הסרטים…';
  document.querySelector('#empty').hidden = !loaded || visible.length > 0;
  document.querySelector('#reset').hidden = !query;
  document.querySelector('#page-note').textContent = query ? `תוצאות עבור ״${search.value.trim()}״` : 'כל סרט הוא עולם קטן.';
}

function focusSelectedFilm() {
  if (!selectedFilm || !loaded) return;
  const article = document.getElementById(`film-${selectedFilm}`);
  if (article) {
    article.tabIndex = -1;
    article.focus({ preventScroll: true });
    article.scrollIntoView({ block: 'start' });
  }
}

function navigate(moveFocus = false) {
  const hash = location.hash.slice(1);
  selectedFilm = null;
  if (hash.startsWith('film/')) {
    try { selectedFilm = decodeURIComponent(hash.slice(5)); } catch { selectedFilm = null; }
    activePage = 'all';
  } else {
    activePage = Object.hasOwn(pages, hash) ? hash : 'home';
  }
  search.value = '';
  const isHome = activePage === 'home';
  document.querySelector('#home-page').hidden = !isHome;
  document.querySelector('#collection-page').hidden = isHome;
  document.querySelectorAll('[data-page]').forEach(tab => {
    if (tab.dataset.page === activePage) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  const page = pages[activePage];
  document.title = `${page.title} | המחברת שלי`;
  if (!isHome) {
    document.querySelector('#collection-title').textContent = page.title;
    document.querySelector('#collection-eyebrow').textContent = page.subtitle;
    document.querySelector('#chapter-label').textContent = `פרק ${page.number}`;
    document.querySelector('#collection-page-number').textContent = `${page.number} / ${page.title}`;
    render();
  }
  if (moveFocus) {
    const heading = document.querySelector(isHome ? '#home-title' : '#collection-title');
    heading.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  focusSelectedFilm();
}

async function loadFilms() {
  if (loading) return;
  loading = true;
  document.querySelector('#load-error').hidden = true;
  try {
    const [response] = await Promise.all([fetch('films.json', { cache: 'no-cache' }), FilmEditor.ready]);
    if (!response.ok) throw new Error('Film data could not be loaded');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Film data must be a list');
    films = data;
    latestAdded = films.reduce((date, film) => film.category !== 'איך' && film.added > date ? film.added : date, '');
    loaded = true;
    updateContents();
    render();
    focusSelectedFilm();
  } catch {
    document.querySelector('#load-error').hidden = false;
    document.querySelector('#recent-films').replaceChildren(node('p', 'הרשימה תופיע כשהסרטים ייטענו.', 'loading-copy'));
    if (!loaded) document.querySelector('#count').textContent = 'הסרטים לא נטענו';
  } finally {
    loading = false;
  }
}

search.addEventListener('input', render);
sort.addEventListener('change', render);
heartsOnly.addEventListener('change', render);
document.querySelector('#reset').addEventListener('click', () => {
  search.value = '';
  render();
  search.focus();
});
document.querySelector('#retry').addEventListener('click', loadFilms);
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#main').focus();
});
window.addEventListener('hashchange', () => navigate(true));
window.addEventListener('film-preferences-changed', event => {
  updateContents();
  render();
  const article = document.getElementById(`film-${event.detail.id}`);
  const target = event.detail.moved ? article?.querySelector('.move-film select') || document.querySelector('#collection-title') : article?.querySelector('.edit-film');
  target?.focus({ preventScroll: true });
});
navigate();
loadFilms();
