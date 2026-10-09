'use strict';

// Try larger versions of the same YouTube image before lower-resolution ones.
// A missing YouTube thumbnail can be a 120px placeholder with HTTP 200.
window.FilmImages = (() => {
  function thumbnail(source) {
    try {
      const url = new URL(source);
      if (!['img.youtube.com', 'i.ytimg.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/vi(?:_webp)?\/([\w-]{11})\/((?:maxres|sd|hq|mq)?(?:default|[123]))\.(?:jpg|webp)$/);
      if (!match) return null;
      return { origin: url.origin, id: match[1], frame: /[123]$/.test(match[2]) ? match[2].slice(-1) : 'default' };
    } catch { return null; }
  }

  function key(source) {
    const image = thumbnail(source);
    return image ? `${image.id}/${image.frame}` : source;
  }

  function candidates(source) {
    const image = thumbnail(source);
    if (!image) return [{ source, allowSmall: true }];
    return ['maxres', 'sd', 'hq', 'mq', ''].map(size => ({
      source: `${image.origin}/vi/${image.id}/${size}${image.frame}.jpg`,
      allowSmall: size === ''
    }));
  }

  const loads = new WeakMap();
  function load(image, sources, { onReady, onExhausted } = {}) {
    loads.get(image)?.abort();
    const controller = new AbortController();
    loads.set(image, controller);
    const seen = new Set();
    const queue = sources.filter(Boolean).flatMap(candidates).filter(candidate => {
      if (seen.has(candidate.source)) return false;
      seen.add(candidate.source);
      return true;
    });
    let current;
    function next() {
      current = queue.shift();
      if (current) image.src = current.source;
      else {
        controller.abort();
        onExhausted?.();
      }
    }
    image.addEventListener('error', next, { signal: controller.signal });
    image.addEventListener('load', () => {
      if (!current.allowSmall && image.naturalWidth <= 120) { next(); return; }
      image.classList.toggle('low-resolution', image.naturalWidth < 480);
      controller.abort();
      onReady?.(current.source);
    }, { signal: controller.signal });
    next();
  }

  return { load, key };
})();
