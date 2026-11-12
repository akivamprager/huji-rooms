# חדרים בגבעת רם

Pick a room or hall at Givat Ram and see when lectures and recitations occupy it. You can also go the other way: pick a building and a time and see which rooms are free. The data comes from the [Hebrew University Shnaton](https://shnaton.huji.ac.il/).

- `index.html`, `app.js`, `style.css`: the page (static, GitHub Pages)
- `core.js`: pure logic (room status, free rooms, search), tested in `test/`
- `tools/rooms.mjs`: builds `data.json` from the Shnaton API. It runs once a day from `.github/workflows/data.yml` and commits only when something changed.

The Shnaton API has no CORS, so the page can't query it live; it reads `data.json`.

```bash
node tools/rooms.mjs   # refresh data.json
node --test test/      # tests
python3 -m http.server # then open http://localhost:8000
```

Covers only sessions listed in the Shnaton: no exams and no one-off events.
