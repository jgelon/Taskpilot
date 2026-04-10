# TaskPilot 🧭

A mobile-first task management app running on Docker.  
**Stack:** Node.js + Express (API) · Angular (Frontend) · Nginx (Reverse Proxy) · File-based JSON storage

---

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/) installed

### Run

```bash
git clone <your-repo>
cd taskpilot
docker compose up --build
```

Then open **http://localhost:8080** in your browser (or on your phone via your machine's local IP).

---

## Architecture

```
Browser / Mobile
      │
      ▼
┌─────────────────┐
│  Nginx (: 8080) │  ← serves Angular SPA
│  /api/* → proxy │
└────────┬────────┘
         │ /api/*
         ▼
┌─────────────────┐
│  Node.js API    │  ← Express REST API (:3000, internal)
│  (:3000)        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Docker Volume  │  ← tasks.json (persisted)
│  taskpilot-data │
└─────────────────┘
```

- The **frontend** container builds Angular and serves it via Nginx
- The **api** container runs the Express REST API (not exposed publicly)
- Nginx proxies `/api/` calls to the backend internally
- Task data is persisted in a named Docker volume (`taskpilot-data`)

---

## Features

| Feature | Description |
|---|---|
| ➕ Create Task | Name, description (optional), duration, priority 1–4, due date (optional) |
| 📋 View Tasks | Filter by open/closed/all, tap to edit |
| ⚡ Get a Task | Enter available time → get best-fit task by due date → priority → age |
| ✏️ Edit Task | Change any field, mark done, or delete |
| 🔄 Accept/Decline | Accept a suggested task; decline to see the next one |
| 💾 Persistence | Tasks survive container restarts via Docker volume |

---

## Task Priority

| Level | Label | Use when |
|---|---|---|
| 1 | Critical | Must be done ASAP |
| 2 | High | Important, do soon |
| 3 | Medium | Normal tasks |
| 4 | Low | Nice to have |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/tasks` | List all tasks |
| POST | `/tasks` | Create a task |
| PUT | `/tasks/:id` | Update a task |
| DELETE | `/tasks/:id` | Delete a task |
| POST | `/tasks/suggest` | Get best task for available time |
| GET | `/health` | Health check |

### Task Suggestion Logic
`POST /tasks/suggest` with body `{ "availableMinutes": 30, "excludeIds": [] }`

Finds open tasks fitting within `availableMinutes`, sorted by:
1. **Due date** — soonest first (tasks without due date go last)
2. **Priority** — 1 (Critical) before 4 (Low)
3. **Date added** — oldest first

---

## Development (without Docker)

**Backend:**
```bash
cd backend
npm install
node server.js
# API on http://localhost:3000
```

**Frontend:**
```bash
cd frontend
npm install
ng serve
# App on http://localhost:4200 (proxies to localhost:3000)
```

---

## Customisation

| What | Where |
|---|---|
| Change port | `docker-compose.yml` → `ports: "8080:80"` |
| Use a different data path | `docker-compose.yml` → `DATA_FILE` env var |
| Swap volume for bind mount | Replace `taskpilot-data:/data` with `./data:/data` |
