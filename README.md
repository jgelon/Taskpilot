# TaskPilot 🧭

A mobile-first task management app running on Docker.  
**Stack:** Node.js + Express (API) · Angular (Frontend) · Nginx (Reverse Proxy) · JSON file storage · Authentik OIDC

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

The app will be available at your configured `APP_URL`.

---

## Environment Variables

All configuration lives in a single `.env` file next to `docker-compose.yml`. Copy `.env.example` to get started.

| Variable | Description | Example |
|---|---|---|
| `APP_URL` | Full public URL of the app. Used for OIDC redirect URI and CORS. | `https://tasks.your-domain.com` |
| `APP_DOMAIN` | Hostname only, no scheme. Used by Traefik's `Host()` routing rule. | `tasks.your-domain.com` |
| `AUTHENTIK_URL` | Public Authentik URL. Used by the browser for login and by the backend for token issuer validation. | `https://auth.your-domain.com` |
| `AUTHENTIK_INTERNAL_URL` | Internal Authentik URL used by the backend to fetch JWKS keys directly, bypassing Traefik. Defaults to `http://authentik-server:9000`. | `http://authentik-server:9000` |
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
│  (backend)          │     │  (JWKS key fetch,    │
└──────────┬──────────┘     │   internal network)  │
           │                └──────────────────────┘
           ▼
┌─────────────────────┐
│  ./data/tasks.json  │  ← bind-mounted from host filesystem
└─────────────────────┘
```

**Key points:**
- The API is never exposed publicly — Nginx proxies `/api/*` to it internally
- The API joins the `authentik_authentik_backend` network to fetch JWKS keys directly without going through Traefik
- JWKS URI is discovered automatically from Authentik's OpenID configuration document at startup
- Tasks are stored in `./data/tasks.json` on the host filesystem, next to `docker-compose.yml`

---

## Data Storage

Tasks are stored in `./data/tasks.json` relative to `docker-compose.yml`. Docker creates the `data/` folder automatically on first run.

### Migrating from a named volume (older versions)

```bash
# Export from old named volume
docker run --rm -v taskpilot-data:/data alpine cat /data/tasks.json > ./data/tasks.json

# Start with bind mount
docker compose up -d
```

### Backup

```bash
cp ./data/tasks.json ./data/tasks.backup.$(date +%Y%m%d).json
```

---

## Features

| Feature | Description |
|---|---|
| ➕ Create Task | Name, description (optional), duration, priority 1–4, due date (optional). Tagged with creator's name. |
| 📋 View Tasks | Filter by open/closed/all. Shows who created and who closed each task. Tap to edit. |
| ⚡ Get a Task | Enter available time → get best-fit task. Accept or skip, mark done or keep open. |
| ✏️ Edit Task | Change any field, mark done, reopen, or delete. |
| 🔐 Authentication | OIDC login via Authentik. All API calls require a valid token. |
| 👤 User Tracking | Tasks record `createdBy` and `closedBy` with timestamps. |

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

Given your available time, open tasks that fit are sorted by:

1. **Urgent first** — tasks due within 30 days are prioritised above all others, sorted by due date (soonest first)
2. **Priority** — for non-urgent tasks, P1 beats P2 beats P3 beats P4
3. **Due date within priority** — tasks with a due date rank above tasks without one; sooner dates rank higher
4. **Age** — oldest added task wins as a final tiebreaker

You can skip a suggested task to see the next one. Skipped tasks are excluded for the rest of that session.

---

## API Endpoints

All endpoints require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/tasks` | List all tasks |
| `POST` | `/tasks` | Create a task |
| `PUT` | `/tasks/:id` | Update a task |
| `DELETE` | `/tasks/:id` | Delete a task |
| `POST` | `/tasks/suggest` | Get best task for available time |
| `GET` | `/health` | Health check (no auth required) |

### Task object

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "estimatedDuration": 30,
  "priority": 2,
  "dueDate": "2026-05-01",
  "dateAdded": "2026-04-01T10:00:00.000Z",
  "status": "open",
  "createdBy": "username",
  "createdByName": "Full Name",
  "closedBy": null,
  "closedByName": null,
  "closedAt": null
}
```

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
# Set env vars first
export AUTHENTIK_URL=https://auth.your-domain.com
export AUTHENTIK_INTERNAL_URL=http://authentik-server:9000
export OIDC_CLIENT_ID=your-client-id
export FRONTEND_URL=http://localhost:4200
node server.js
# API on http://localhost:3010
```

**Frontend:**
```bash
cd frontend
npm install
# Edit src/environments/environment.ts with your values
ng serve
# App on http://localhost:4200
```
