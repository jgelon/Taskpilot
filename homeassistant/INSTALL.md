# TaskPilot — Home Assistant Integration

This integration adds two sensors to Home Assistant:

| Entity | Description |
|---|---|
| `sensor.taskpilot_open_tasks` | Number of currently open tasks |
| `sensor.taskpilot_overdue_tasks` | Number of overdue open tasks |

---

## Step 1 — Generate an API key in TaskPilot

1. Open TaskPilot → **⚙ Settings** (gear icon, top-right)
2. Go to the **🔑 API Keys** tab
3. Enter a name (e.g. `Home Assistant`) and click **Generate Key**
4. **Copy the key immediately** — it's only shown once

---

## Step 2 — Install the integration

Copy the `custom_components/taskpilot` folder into your Home Assistant
`config/custom_components/` directory:

```
your-ha-config/
└── custom_components/
    └── taskpilot/
        ├── __init__.py
        ├── sensor.py
        ├── config_flow.py
        ├── manifest.json
        ├── strings.json
        └── translations/
            └── en.json
```

Then restart Home Assistant.

---

## Step 3 — Add the integration

**Via UI (recommended):**
1. Go to **Settings → Devices & Services → Add Integration**
2. Search for **TaskPilot**
3. Fill in:
   - **Instance name**: anything you like (e.g. `TaskPilot`)
   - **API URL**: `https://todo.your-domain.com/api`
     *(the `/api` path — Nginx proxies this to the backend)*
   - **API Key**: the key you generated in Step 1
   - **Poll interval**: how often to fetch (default 300s = 5 minutes)

**Via configuration.yaml (alternative):**
Not supported — use the UI config flow above.

---

## Example automations

### Notify when overdue tasks exist

```yaml
automation:
  - alias: "Notify overdue tasks"
    trigger:
      - platform: numeric_state
        entity_id: sensor.taskpilot_overdue_tasks
        above: 0
    action:
      - service: notify.mobile_app_your_phone
        data:
          title: "TaskPilot ⚠️"
          message: "You have {{ states('sensor.taskpilot_overdue_tasks') }} overdue tasks!"
```

### Dashboard card

```yaml
type: entities
title: TaskPilot
entities:
  - entity: sensor.taskpilot_open_tasks
    name: Open Tasks
    icon: mdi:clipboard-list-outline
  - entity: sensor.taskpilot_overdue_tasks
    name: Overdue Tasks
    icon: mdi:clipboard-alert-outline
```

---

## Troubleshooting

**"Cannot connect"** — verify the API URL is reachable from your HA instance.
The URL should be your TaskPilot public URL with `/api` appended:
`https://todo.your-domain.com/api`

**"Invalid API key"** — regenerate the key in TaskPilot settings.

**Sensors show `unavailable`** — check HA logs for errors from the `taskpilot` integration.
