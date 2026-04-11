# TaskPilot 🧭

A mobile-first task management app running on Docker.  
**Stack:** Node.js + Express (API) · Angular (Frontend) · Nginx (Reverse Proxy) · SQLite storage · Authentik OIDC

---

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/) installed
- Traefik running as an external reverse proxy (on the `frontend` Docker network)
- Authentik running for authentication (on the `authentik_authentik_backend` Docker network)

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 2. Set up Authentik

In Authentik → **Applications** → **Create**:
- **Provider type**: OAuth2/OIDC
- **Client type**: Confidential
- **Redirect URI**: `https://your-app-domain.com/`  ← trailing slash required
- **Scopes**: `openid`, `profile`, `email`
- Copy the **Client ID** into your `.env`

### 3. Run

```bash
docker compose up --build
```

---

## Environment Variables

All configuration lives in a single `.env` file next to `docker-compose.yml`.

| Variable | Description | Example |
|---|---|---|
| `APP_URL` | Full public URL. Used for OIDC redirect URI and CORS. | `https://tasks.your-domain.com` |
| `APP_DOMAIN` | Hostname only. Used by Traefik's `Host()` rule. | `tasks.your-domain.com` |
| `AUTHENTIK_URL` | Public Authentik URL. Used for browser login and token issuer validation. | `https://auth.your-domain.com` |
| `AUTHENTIK_INTERNAL_URL` | Internal Authentik URL for backend JWKS fetch (bypasses Traefik). | `http://authentik-server:9000` |
| `OIDC_CLIENT_ID` | Client ID from your Authentik OIDC application. | `abc123xyz` |

---

## Architecture

```
Browser / Mobile
      │  HTTPS
      ▼
┌─────────────────────┐
│  Traefik (external) │  ← routes your domain → frontend
└──────────┬──────────┘
           │ HTTP :80
           ▼
┌─────────────────────┐
│  Nginx (frontend)   │  ← serves Angular SPA
│  /api/* → proxy     │  ← proxies API to backend
└──────────┬──────────┘
           │ HTTP :3010 (internal)
           ▼
┌─────────────────────┐     ┌──────────────────────┐
│  Node.js API        │────▶│  Authentik           │
│  (backend)          │     │  (JWKS, internal net)│
└──────────┬──────────┘     └──────────────────────┘
           │
           ▼
┌─────────────────────┐
│  ./data/tasks.db    │  ← SQLite, bind-mounted from host
└─────────────────────┘
```

---

## Features

| Feature | Description |
|---|---|
| ➕ Create Task | Name, description, duration, priority 1–4, due date, category, recurring schedule |
| 📋 View Tasks | Filter by status, category chips, sort by any field with ↑↓ toggle |
| ⚡ Get a Task | Enter available time → best-fit task suggestion with accept/skip flow |
| ✏️ Edit Task | Change any field including category and recurrence. Mark done, reopen, delete. |
| 🏷 Categories | Color-coded categories with full add/edit/delete management in Settings |
| 🔁 Recurring Tasks | Auto-reopens with shifted due date on close. Daily/weekly/monthly/custom. |
| ⚠️ Overdue Banner | Home screen warning with count of overdue tasks, taps to filtered list |
| 🔢 Open Count | Open task count badge on the View Tasks home button |
| ⚙️ Settings Panel | Slide-over panel (gear icon, top-right) for category management and import/export |
| ⇅ Import / Export | Export all tasks to CSV (with IDs). Import CSV with upsert-by-ID logic. |
| 🔐 Authentication | OIDC login via Authentik. All API calls require a valid Bearer token. |
| 👤 User Tracking | Tasks record `createdBy` and `closedBy` with timestamps (visible in edit view) |

---

## Categories

Categories are managed from the **Settings** panel (⚙ gear icon in the top-right header).

- Add a category with a name and colour (preset swatches or custom colour picker)
- Edit name and colour at any time
- Delete a category — tasks are unassigned (not deleted)
- Filter the task list by category using the chip bar below the status filter
- Category is shown as a coloured badge on each task card

---

## Task Priority

| Level | Label | Use when |
|---|---|---|
| 1 | Critical | Must be done ASAP |
| 2 | High | Important, do soon |
| 3 | Medium | Normal tasks |
| 4 | Low | Nice to have |

---

## Get a Task — Sorting Algorithm

1. **Urgent first** — due within 30 days, sorted soonest first
2. **Priority** — P1 before P4 for non-urgent tasks
3. **Due date within priority** — tasks with a due date rank above those without
4. **Age** — oldest added task wins as tiebreaker

Skipped tasks are excluded for the remainder of that session.

---

## Recurring Tasks

When a recurring task is closed, a new open copy is created with the due date shifted forward.

| Option | Interval |
|---|---|
| Daily | 1 day |
| Weekly | 7 days |
| Monthly | 30 days |
| Custom | Your specified number of days |

---

## Data Storage

Tasks are stored in `./data/tasks.db` (SQLite) next to `docker-compose.yml`.

### Migrating from JSON (older versions)

```bash
docker compose build
docker run --rm -v $(pwd)/data:/data -w /app --entrypoint node taskpilot-api migrate-json-to-sqlite.js
docker compose up -d
```

### Backup

```bash
cp ./data/tasks.db ./data/tasks.backup.$(date +%Y%m%d).db
```

---

## API Endpoints

All require `Authorization: Bearer <token>` except `/health`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/categories` | List all categories |
| `POST` | `/categories` | Create category |
| `PUT` | `/categories/:id` | Update category |
| `DELETE` | `/categories/:id` | Delete category (tasks unassigned) |
| `GET` | `/tasks?status=open&sort=priority&order=asc&categoryId=<id>` | List tasks |
| `POST` | `/tasks` | Create task |
| `PUT` | `/tasks/:id` | Update task |
| `DELETE` | `/tasks/:id` | Delete task |
| `GET` | `/tasks/stats` | Overdue + open counts |
| `POST` | `/tasks/suggest` | Best task for available time |
| `GET` | `/tasks/export` | Download CSV |
| `POST` | `/tasks/import` | Upload CSV (upsert by ID) |
| `GET` | `/health` | Health check |

### Task filter params
- `status`: `open` · `closed` · `all`
- `sort`: `dateAdded` · `priority` · `dueDate` · `name` · `estimatedDuration`
- `order`: `asc` · `desc`
- `categoryId`: category UUID, or `none` for uncategorised tasks

---

## Docker Networks

| Network | Type | Purpose |
|---|---|---|
| `internal` | bridge | Frontend ↔ API communication |
| `frontend` | external | Traefik → frontend routing |
| `authentik_authentik_backend` | external | API → Authentik JWKS fetch |

---

## Development (without Docker)

```bash
# Backend
cd backend && npm install
export AUTHENTIK_URL=https://auth.your-domain.com
export AUTHENTIK_INTERNAL_URL=http://authentik-server:9000
export OIDC_CLIENT_ID=your-client-id
export FRONTEND_URL=http://localhost:4200
export DATA_FILE=./data/tasks.db
node server.js

# Frontend
cd frontend && npm install
# Edit src/environments/environment.ts
ng serve
```
