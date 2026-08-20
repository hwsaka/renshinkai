/* 合気道技術教本 — Service Worker
   オフライン対応：
   ・HTML（index.html / shinsa.html）はネットワーク優先。オンラインなら常に最新を表示し、
     オフライン時のみキャッシュから表示（＝サイト更新が開くたびに反映される）。
   ・その他（CDNのライブラリ・フォント・PDF・アイコン等）はキャッシュ優先＋裏で更新。
   ※ CORE（アイコンやPDF等）を差し替えたときは VERSION を上げると全員のキャッシュが更新されます。 */
const VERSION = 'kyohon-v4';
const CORE = [
  './',
  './index.html',
  './shinsa.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 中核ファイル（軽い）は確実にキャッシュ
    await cache.addAll(CORE);
    // book.pdf は大きい場合があるため、失敗しても導入を止めない
    try { await cache.add('./book.pdf'); } catch (e) { /* あとで実行時にキャッシュされる */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ネットワーク取得にタイムアウトを設け、電波が不安定でも待たされ過ぎないようにする */
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(
      res => { clearTimeout(timer); resolve(res); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  const sameOrigin = url.origin === self.location.origin;
  const isHTML =
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.pathname.endsWith('.html');

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);

    /* ---- HTML：ネットワーク優先（最新を表示）／オフライン時はキャッシュ ---- */
    if (isHTML && sameOrigin) {
      try {
        const fresh = await fetchWithTimeout(req, 4000);
        if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
        throw e;
      }
    }

    /* ---- その他：キャッシュ優先＋裏でこっそり更新（stale-while-revalidate） ---- */
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && (fresh.ok || fresh.type === 'opaque')) await cache.put(req, fresh.clone());
        } catch (e) {}
      })());
      return cached;
    }
    // 未キャッシュ：ネットワーク取得してキャッシュに保存
    try {
      const fresh = await fetch(req);
      if (fresh && (fresh.ok || fresh.type === 'opaque')) {
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (e) {
      // オフラインで未キャッシュ：ページ遷移なら index.html を返す
      if (req.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      throw e;
    }
  })());
});
