"""Config flow for TaskPilot integration."""
from __future__ import annotations

import aiohttp
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from . import DOMAIN, DEFAULT_SCAN_INTERVAL

STEP_USER_DATA_SCHEMA = vol.Schema({
    vol.Required("name", default="TaskPilot"): str,
    vol.Required("api_url"): str,
    vol.Required("api_key"): str,
    vol.Optional("scan_interval", default=DEFAULT_SCAN_INTERVAL): vol.All(
        vol.Coerce(int), vol.Range(min=30, max=3600)
    ),
})


class TaskPilotConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for TaskPilot."""

    VERSION = 1

    async def async_step_user(self, user_input=None) -> FlowResult:
        errors = {}

        if user_input is not None:
            # Validate the connection
            url = user_input["api_url"].rstrip("/") + "/tasks/stats"
            headers = {"X-API-Key": user_input["api_key"]}
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        url, headers=headers,
                        timeout=aiohttp.ClientTimeout(total=10)
                    ) as resp:
                        if resp.status == 401:
                            errors["api_key"] = "invalid_auth"
                        elif resp.status != 200:
                            errors["base"] = "cannot_connect"
                        else:
                            await self.async_set_unique_id(
                                f"taskpilot_{user_input['api_url']}"
                            )
                            self._abort_if_unique_id_configured()
                            return self.async_create_entry(
                                title=user_input["name"],
                                data=user_input,
                            )
            except aiohttp.ClientError:
                errors["base"] = "cannot_connect"

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )
