'use strict';
window.FilmDates = (() => {
  function valid(value) {
    if (typeof value !== 'string' || !/^[1-9]\d{3}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(value)) return false;
    const full = value.length === 4 ? `${value}-01-01` : value.length === 7 ? `${value}-01` : value;
    const date = new Date(`${full}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === full;
  }
  function effective(film, preferences = {}) {
    for (const [key, label] of [['createdDate', 'נוצר'], ['publishedDate', 'פורסם']]) {
      const value = preferences[key] ?? film[key];
      if (valid(value)) return { value, label, key, sortKey: value.length === 4 ? `${value}-01-01` : value.length === 7 ? `${value}-01` : value };
    }
    return null;
  }
  function label(value) { return value.split('-').reverse().join('.'); }
  return { valid, effective, label };
})();
