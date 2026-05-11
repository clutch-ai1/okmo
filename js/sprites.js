// js/sprites.js
// Lazy-loading sprite cache for PokeAPI sprites.
// Uses Image objects so canvas drawImage can use them directly.
// Falls back to emoji on the canvas while loading or if a load fails.

const SpriteCache = (function () {
  const cache = new Map();   // url -> { img, ready, failed }

  function get(url) {
    let entry = cache.get(url);
    if (entry) return entry;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    entry = { img, ready: false, failed: false };
    img.onload  = () => { entry.ready = true; };
    img.onerror = () => { entry.failed = true; };
    img.src = url;
    cache.set(url, entry);
    return entry;
  }

  function preload(url) { get(url); }

  // Pre-load a list of URLs (called once at startup for the first area)
  function preloadAll(urls) { urls.forEach(preload); }

  return { get, preload, preloadAll };
})();

window.SpriteCache = SpriteCache;
