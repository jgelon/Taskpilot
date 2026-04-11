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
| `APP_URL` | Full public URL of the app. Used for OIDC redirect URI and CORS. | `https://tasks.your-domain.com` |
| `APP_DOMAIN` | Hostname only, no scheme. Used by Traefik's `Host()` routing rule. | `tasks.your-domain.com` |
| `AUTHENTIK_URL` | Public Authentik URL. Used by the browser for login and for token issuer validation. | `https://auth.your-domain.com` |
| `AUTHENTIK_INTERNAL_URL` | Internal Authentik URL for backend JWKS key fetch, bypassing Traefik. Defaults to `http://authentik-server:9000`. | `http://authentik-server:9000` |
| `OIDC_CLIENT_ID` | Client ID from your Authentik OIDC application. | `abc123xyz` |

---

## Architecture

```
Browser / Mobile
      │  HTTPS
      ▼
┌─────────────────────┐
│  Traefik            │  ← routes tasks.your-domain.com → frontend
│  (external)         │
└──────────┬──────────┘
           │ HTTP :80
           ▼
┌─────────────────────┐
│  Nginx (frontend)   │  ← serves Angular SPA
│  /api/* → proxy     │  ← proxies API calls to backend
└──────────┬──────────┘
           │ HTTP :3010 (internal only)
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

**Key points:**
- The API is never exposed publicly — Nginx proxies `/api/*` internally
- The API joins `authentik_authentik_backend` to fetch JWKS keys directly
- JWKS URI is auto-discovered from Authentik's OpenID configuration at startup
- Data is stored in `./data/tasks.db` (SQLite) on the host filesystem

---

## Data Storage

Tasks are stored in `./data/tasks.db` (SQLite) relative to `docker-compose.yml`. The `data/` folder is created automatically on first run.

### Migrating from JSON (upgrading from an older version)

If you have existing data in `./data/tasks.json`, run the migration before starting:

```bash
# Build first so the image exists
docker compose build

# Run the migration script
docker run --rm \
  -v $(pwd)/data:/data \
  -w /app \
  --entrypoint node \
  taskpilot-api migrate-json-to-sqlite.js

# Then start normally
docker compose up -d
```

The original `tasks.json` is kept untouched — delete it manually once you're happy.

### Backup

```bash
cp ./data/tasks.db ./data/tasks.backup.$(date +%Y%m%d).db
```

---

## Features

| Feature | Description |
|---|---|
| ➕ Create Task | Name, description (optional), duration, priority 1–4, due date (optional), recurring schedule. |
| 📋 View Tasks | Filter by open/closed/all. Sort by date, priority, due date, name, or duration. Shows overdue indicator and who closed each task. |
| ⚡ Get a Task | Enter available time → get best-fit task. Accept or skip; mark done or keep open. |
| ✏️ Edit Task | Change any field including recurrence. Mark done, reopen, or delete. |
| 🔁 Recurring Tasks | Tasks automatically reappear after being closed. Supports daily, weekly, monthly, or a custom day interval. |
| ⚠️ Overdue Banner | Home screen shows a warning with the count of overdue tasks when any exist. |
| 🔢 Open Count | Home screen shows the number of open tasks on the View Tasks button. |
| 🔐 Authentication | OIDC login via Authentik. All API calls require a valid token. |
| 👤 User Tracking | Tasks record `createdBy` and `closedBy` with timestamps, visible in the edit view. |

---

## Task Priority

| Level | Label | Use when |
|---|---|---|
| 1 | Critical | Must be done ASAP |
| 2 | High | Important, do soon |
| 3 | Medium | Normal tasks |
| 4 | Low | Nice to have |

---

## Recurring Tasks

When a recurring task is marked as done, a new open copy is automatically scheduled with a due date shifted forward by the recurrence interval. The interval is based on the task's current due date (or today if none is set).

| Option | Interval |
|---|---|
| Daily | 1 day |
| Weekly | 7 days |
| Monthly | 30 days |
| Custom | Your specified number of days |

---

## Get a Task — Sorting Algorithm

Given your available time, open tasks that fit are sorted by:

1. **Urgent first** — tasks due within 30 days are prioritised above all others, sorted by due date (soonest first)
2. **Priority** — for non-urgent tasks, P1 beats P2 beats P3 beats P4
3. **Due date within priority** — tasks with a due date rank above tasks without; sooner dates rank higher
4. **Age** — oldest added task wins as a final tiebreaker

Skipped tasks are excluded for the rest of that session.

---

## API Endpoints

All endpoints require `Authorization: Bearer <token>` except `/health`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/tasks?status=open&sort=priority&order=asc` | List tasks with optional filter and sort |
| `POST` | `/tasks` | Create a task |
| `PUT` | `/tasks/:id` | Update a task |
| `DELETE` | `/tasks/:id` | Delete a task |
| `GET` | `/tasks/stats` | Get overdue and open task counts |
| `POST` | `/tasks/suggest` | Get best task for available time |
| `GET` | `/health` | Health check |

### Sort options
`sort` can be: `dateAdded`, `priority`, `dueDate`, `name`, `estimatedDuration`  
`order` can be: `asc`, `desc`

---

## Docker Networks

| Network | Type | Purpose |
|---|---|---|
| `internal` | internal bridge | Communication between frontend and api |
| `frontend` | external | Traefik routes traffic to the frontend container |
| `authentik_authentik_backend` | external | API fetches JWKS keys directly from Authentik |

---

## Development (without Docker)

**Backend:**
```bash
cd backend
npm install
export AUTHENTIK_URL=https://auth.your-domain.com
export AUTHENTIK_INTERNAL_URL=http://authentik-server:9000
export OIDC_CLIENT_ID=your-client-id
export FRONTEND_URL=http://localhost:4200
export DATA_FILE=./data/tasks.db
node server.js
```

**Frontend:**
```bash
cd frontend
npm install
# Edit src/environments/environment.ts with your values
ng serve
```
