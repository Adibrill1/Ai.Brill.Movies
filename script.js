'use strict';

const pages = {
  home: { title: 'תוכן העניינים', number: '01' },
  new: { title: 'חדש', subtitle: 'הסרטים מהתוספת האחרונה למחברת', latest: true, number: '02' },
  all: { title: 'כל הסרטים', subtitle: 'כל הסיפורים, במקום אחד', number: '03' },
  festival: { title: 'סרטי פסטיבלים', subtitle: 'סרטים שנבחרו לבמה הגדולה', category: 'פסטיבל', number: '04' },
  community: { title: 'יצירה מהקהילה', subtitle: 'יוצרים עצמאיים, רעיונות אישיים', category: 'קהילה', number: '05' },
  official: { title: 'כלים ויצירה', subtitle: 'הדגמות רשמיות ואפשרויות חדשות', category: 'הדגמה רשמית', number: '06' }
};
const grid = document.querySelector('#grid');
const search = document.querySelector('#search');
const sort = document.querySelector('#sort');
let films = [];
let latestAdded = '';
let loaded = false;
let loading = false;
let activePage = 'home';
let selectedFilm = null;
const dateLabel = iso => iso.split('-').reverse().join('.');

function belongsToPage(film, page) {
  return page.latest ? film.added === latestAdded : !page.category || film.category === page.category;
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
  const photoPlay = node('span', '▷', 'photo-play');
  photoPlay.setAttribute('aria-hidden', 'true');
  media.append(photoPlay);
  const number = node('span', `NO. ${film.id}`, 'film-number');
  number.dir = 'ltr';
  photo.append(media, number);
  const details = node('div', undefined, 'film-details');
  const seconds = preferences.durationSeconds ?? film.durationSeconds;
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
  const edit = node('button', 'בחירת פריים ומשך', 'edit-film');
  edit.type = 'button';
  edit.setAttribute('aria-label', `בחירת פריים ומשך — ${film.title}`);
  edit.addEventListener('click', () => FilmEditor.open(film));
  details.append(duration, edit);
  const body = node('div', undefined, 'card-body');
  const top = node('div', undefined, 'topline');
  const categoryClass = film.category === 'קהילה' ? 'community' : film.category === 'הדגמה רשמית' ? 'official' : 'festival';
  const added = node('time', `＋ ${dateLabel(film.added)}`);
  added.dateTime = film.added;
  added.setAttribute('aria-label', `נוסף למחברת ב־${dateLabel(film.added)}`);
  top.append(node('span', film.category, `badge category-${categoryClass}`), added);
  const title = node('h2', film.title);
  title.dir = 'auto';
  const creator = node('p', film.creator, 'creator');
  creator.dir = 'auto';
  const tool = node('p', undefined, 'tool');
  tool.append(node('strong', 'כלי יצירה:'), node('bdi', film.tools || 'לא אומת'));
  const actions = node('div', undefined, 'actions');
  const watch = externalLink('לצפייה בסרט', film.watchUrl, 'watch', film.title);
  const play = node('span', '▷');
  play.setAttribute('aria-hidden', 'true');
  watch.append(play, document.createTextNode('לצפייה בסרט'));
  const source = externalLink('מקור ומידע', film.sourceUrl, 'source', film.title);
  source.append(document.createTextNode('מקור ומידע '), arrowIcon());
  actions.append(watch, source);
  body.append(top, title, creator, node('p', film.description, 'blurb'), tool, actions);
  article.append(photo, details, body);
  return article;
}

function updateContents() {
  document.querySelector('#total-films').textContent = films.length;
  const latest = [...films].sort(newestFirst);
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
  document.querySelector('#collection-eyebrow').textContent = page.latest && latestAdded ? `נוספו למחברת ב־${dateLabel(latestAdded)}` : page.subtitle;
  const visible = inPage.filter(film => [film.title, film.creator, film.tools || '', film.description, film.category].join(' ').toLocaleLowerCase().includes(query));
  visible.sort((a, b) => sort.value === 'title' ? a.title.localeCompare(b.title) : sort.value === 'oldest' ? -newestFirst(a, b) : newestFirst(a, b));
  grid.replaceChildren(...visible.map(card));
  document.querySelector('#count').textContent = loaded ? `${visible.length} מתוך ${inPage.length} סרטים` : 'טוענים את הסרטים…';
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
  document.title = `${page.title} | מחברת הסרטים שלי`;
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
    latestAdded = films.reduce((date, film) => film.added > date ? film.added : date, '');
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
  render();
  const article = document.getElementById(`film-${event.detail.id}`);
  article?.querySelector('.edit-film')?.focus({ preventScroll: true });
});
navigate();
loadFilms();
