# חדרים פנויים — גבעת רם והר הצופים

Pick a room or hall at Givat Ram or Mount Scopus (toggle at the top) and see when lectures and recitations occupy it. You can also go the other way: pick a building and a time and see which rooms are free. The data comes from the [Hebrew University Shnaton](https://shnaton.huji.ac.il/).

- `index.html`, `app.js`, `style.css`: the page (static, GitHub Pages)
- `core.js`: pure logic (room status, free rooms, search), tested in `test/`
- `combo.js`: the searchable dropdowns. Search ignores quote marks (מדמח = מדמ״ח) and also reads Hebrew typed on an English keyboard (nsnj = מדמח)
- `campuses.js`: the campuses (Shnaton campus code, area)
- `data/<campus>.json`: rooms and meetings, rebuilt daily
- `buildings/<campus>.json`: extra names per building (e.g. הנדסה = בניין מדמ״ח). The aliases come from the university IT department's [Wi-Fi coverage list](https://ca.huji.ac.il/book/%D7%A4%D7%A8%D7%99%D7%A1%D7%AA-%D7%AA%D7%A7%D7%A9%D7%95%D7%A8%D7%AA-%D7%90%D7%9C%D7%97%D7%95%D7%98%D7%99%D7%AA-%D7%A7%D7%9E%D7%A4%D7%95%D7%A1-%D7%90%D7%93%D7%9E%D7%95%D7%A0%D7%93-%D7%99-%D7%A1%D7%A4%D7%A8%D7%90), its "Campus Strolls" guide and the [campus map](https://experience.arcgis.com/experience/497c430ee2f74ae392b17e55d0e8c7f7).
- `manifest.webmanifest`, `sw.js`, `icons/`: installable app (PWA) that works offline. `sw.js` loads from the network first and falls back to the saved copy. Bump `CACHE` in `sw.js` when the list of files changes. The icons are drawn by `tools/make-icons.py`
- Closest free room: walking routes are computed on the device over `paths/<campus>.json`: only the paths and roads of the university's own campus maps ([Givat Ram](https://experience.arcgis.com/experience/20ad3eaec52143d6a73ecdac63390310), [Mount Scopus](https://experience.arcgis.com/experience/10504f10215441c4866e47d03a962e02)), never across lawns or hedges, built by `tools/paths.mjs`. Building locations, outlines and many aliases (departments) come from the same maps. The user's location is never sent or saved
- `tools/rooms.mjs`: builds `data/<campus>.json` from the Shnaton API. It runs once a day from `.github/workflows/data.yml` and commits only when something changed.

The Shnaton API has no CORS, so the page can't query it live; it reads `data/<campus>.json`.

```bash
node tools/rooms.mjs          # refresh data/*.json
node tools/paths.mjs scopus   # rebuild a campus's walking network from the campus map
node --test test/      # tests
python3 -m http.server # then open http://localhost:8000
```

Covers only sessions listed in the Shnaton: no exams and no one-off events.

## Privacy

- No accounts, analytics, cookies or tracking.
- Location (for "הכי קרוב אליי") is used only in the page's memory while it's open. It is never sent anywhere or saved, and the walking routes are computed on the device.
- Favorites and the last room are saved only in the browser (localStorage).
- The only requests are to the site itself (Cloudflare Pages), including the Heebo font in `fonts/` (SIL Open Font License, `fonts/OFL.txt`). No third-party services.
