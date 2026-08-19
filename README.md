# TaskTable

A lightweight personal task tracker with a docs sidebar. Go + SQLite backend, vanilla JS frontend — no frameworks, no build step.

## Features

- **Today view** — surfaces tasks with a follow-up date of today or a due date within 5 days
- **Pending / Done sections** — grouped by project, collapsible
- **Priorities (P0–P5), tags, related URLs** on every task
- **Search** — by content, tag, priority, and creation date range, per section
- **Docs sidebar** — organize reference links in a project → topic → doc tree
- **Done summary** — per-project and per-tag rollups of completed work

## Requirements

- Go 1.23+
- Python 3 (serves the static frontend)
- SQLite (bundled via [go-sqlite3](https://github.com/mattn/go-sqlite3))

## Running

```sh
./run.sh    # builds the backend and starts both servers in the background
./stop.sh   # stops them
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080

The SQLite database is created automatically at `backend/tasktable.db` on first run.

## Layout

```
backend/    Go API server (main.go) + SQLite database
frontend/   index.html, app.js, style.css (vanilla JS)
run.sh      build & restart both servers
stop.sh     stop both servers
```

## Note on browser caching

The frontend is served by `python3 -m http.server`, which lets browsers cache aggressively. When changing `app.js` or `style.css`, bump the `?v=N` query param in `index.html` so browsers pick up the new version.
