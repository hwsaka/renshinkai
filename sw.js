/* 合気道技術教本 — Service Worker
   オフライン対応：同一オリジンの中核ファイルは導入時にキャッシュ、
   その他（CDNのライブラリ・フォント・PDF等）は一度読み込むとキャッシュに保存して次回以降オフラインでも表示。
   ※ バージョンを上げるとキャッシュが更新されます（更新反映用）。 */
const VERSION = 'kyohon-v3';
const CORE = [
  './',
  './index.html',
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

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) {
      // キャッシュ優先で即返しつつ、裏でこっそり更新（オンライン時）
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
