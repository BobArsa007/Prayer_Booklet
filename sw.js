// Offline support for the prayer booklet.
// On the first online visit it saves the page, the icons AND the Amiri Arabic
// font from Google Fonts. After that everything opens from the device with no
// internet, and is quietly refreshed in the background whenever you are online.
const CACHE = "prayer-booklet-v3";
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&display=swap";
const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(FILES.map((f) => c.add(f)));
    try {
      // Save the font stylesheet, then every font file it points to.
      const r = await fetch(FONT_CSS, { mode: "cors" });
      if (r.ok) {
        const css = await r.clone().text();
        await c.put(FONT_CSS, r);
        const urls = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, "")))];
        await Promise.allSettled(urls.map((u) => c.add(u)));
      }
    } catch (err) { /* offline during install: fonts get saved on a later online visit */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const font = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!same && !font) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: same, ignoreVary: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()));
      return hit || net;
    })
  );
});
