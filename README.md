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

#### Create the OIDC application

In Authentik → **Applications** → **Create**:
- **Provider type**: OAuth2/OIDC
- **Client type**: Confidential
- **Redirect URI**: `https://your-app-domain.com/`  ← trailing slash required
- **Scopes**: `openid`, `profile`, `email`
- Copy the **Client ID** into your `.env`

#### Add the groups claim

By default Authentik does not include group membership in the token. You need to add a property mapping:

1. Go to **Customisation → Property Mappings → Create → Scope Mapping**
2. Fill in:
   - **Name**: `groups`
   - **Scope name**: `groups`
   - **Expression**:
     ```python
     return list(request.user.ak_groups.values_list("name", flat=True))
     ```
3. Go to your TaskPilot **Provider → Edit → Advanced protocol settings**
4. Under **Scopes**, add the `groups` mapping you just created
5. Add `groups` to the **Scope string** field: `openid profile email groups`

#### Create groups and assign users

In Authentik → **Directory → Groups**:

1. Create group `taskpilot-admin`
2. Add your admin users to this group

Regular users (not in any group) can still log in and use tasks — only Settings (categories, import/export) requires group membership.

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
| `ADMIN_GROUP` | Authentik group name that grants Settings access. Default: `taskpilot-admin`. | `taskpilot-admin` |

---

## Access Control

| Feature | Any logged-in user | `taskpilot-admin` group |
|---|---|---|
| View tasks | ✅ | ✅ |
| Create / edit / close tasks | ✅ | ✅ |
| Get a task suggestion | ✅ | ✅ |
| See category names on tasks | ✅ | ✅ |
| Manage categories | ❌ | ✅ |
| Import / Export CSV | ❌ | ✅ |
| Settings panel (⚙ icon) | Hidden | ✅ |

The backend enforces all restrictions independently of the frontend — a non-admin attempting a protected API call will receive `403 Forbidden` even if they bypass the UI.

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
| 📋 View Tasks | Filter by status and category, sort by any field with ↑↓ toggle |
| ⚡ Get a Task | Enter available time → best-fit task suggestion. Accept to claim it exclusively. |
| 🔒 Task claiming | Accepting a task claims it for you — others won't see it in suggestions. Home screen shows your active task and blocks getting a new one until you finish or hand it back. |
| ✏️ Edit Task | Change any field including category and recurrence. Mark done, reopen, delete. |
| 🏷 Categories | Color-coded, managed in Settings (admin only). Filter chips in task list. |
| 🔁 Recurring Tasks | Auto-reopens with shifted due date on close. Daily/weekly/monthly/custom. |
| ⚠️ Overdue Banner | Home screen warning with count of overdue tasks |
| 🔢 Open Count | Open task count badge on View Tasks home button |
| ⚙️ Settings Panel | Slide-over (gear icon, top-right, admin only): category management + import/export |
| ⇅ Import / Export | Export all tasks to CSV with IDs. Import with upsert-by-ID logic. (admin only) |
| 🔐 Authentication | OIDC login via Authentik. All API calls require a valid Bearer token. |
| 👥 Role-based access | `taskpilot-admin` group gates Settings. Enforced on both frontend and backend. |
| 👤 User Tracking | Tasks record `createdBy` and `closedBy` with timestamps (visible in edit view) |

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

Tasks are stored in `./data/tasks.db` (SQLite) next to `docker-compose.yml`. The `data/` folder is created automatically on first run.

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

All require `Authorization: Bearer <token>` except `/health`. Routes marked 🔒 also require `taskpilot-admin` group membership.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/me` | user | Current user info + isAdmin flag |
| `GET` | `/categories` | user | List all categories |
| `POST` | `/categories` | 🔒 admin | Create category |
| `PUT` | `/categories/:id` | 🔒 admin | Update category |
| `DELETE` | `/categories/:id` | 🔒 admin | Delete category |
| `GET` | `/tasks` | user | List tasks (filterable + sortable) |
| `POST` | `/tasks` | user | Create task |
| `PUT` | `/tasks/:id` | user | Update task. Pass `claim: true` to claim, `claim: false` to unclaim. |
| `DELETE` | `/tasks/:id` | user | Delete task |
| `GET` | `/tasks/stats` | user | Overdue + open counts |
| `POST` | `/tasks/suggest` | user | Best task for available time |
| `GET` | `/tasks/export` | 🔒 admin | Download CSV |
| `POST` | `/tasks/import` | 🔒 admin | Upload CSV (upsert by ID) |
| `GET` | `/health` | none | Health check |

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
export ADMIN_GROUP=taskpilot-admin
export FRONTEND_URL=http://localhost:4200
export DATA_FILE=./data/tasks.db
node server.js

# Frontend
cd frontend && npm install
# Edit src/environments/environment.ts
ng serve
```
