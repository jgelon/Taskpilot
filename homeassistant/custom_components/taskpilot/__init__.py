"""TaskPilot Home Assistant Integration."""
from __future__ import annotations

import logging
from datetime import timedelta

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

_LOGGER = logging.getLogger(__name__)

DOMAIN = "taskpilot"
PLATFORMS = [Platform.SENSOR]
DEFAULT_SCAN_INTERVAL = 300  # 5 minutes


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up TaskPilot from a config entry."""
    coordinator = TaskPilotCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok


class TaskPilotCoordinator(DataUpdateCoordinator):
    """Fetch data from TaskPilot API."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.api_url = entry.data["api_url"].rstrip("/")
        self.api_key = entry.data["api_key"]
        scan_interval = entry.data.get("scan_interval", DEFAULT_SCAN_INTERVAL)

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=scan_interval),
        )

    async def _async_update_data(self) -> dict:
        """Fetch stats from TaskPilot."""
        url = f"{self.api_url}/tasks/stats"
        headers = {"X-API-Key": self.api_key}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 401:
                        raise UpdateFailed("Invalid API key — check your TaskPilot settings")
                    if resp.status != 200:
                        raise UpdateFailed(f"TaskPilot API returned HTTP {resp.status}")
                    data = await resp.json()
                    _LOGGER.debug("TaskPilot stats: %s", data)
                    return data
        except aiohttp.ClientConnectorError as err:
            raise UpdateFailed(f"Cannot connect to TaskPilot at {self.api_url}: {err}") from err
        except aiohttp.ClientError as err:
            raise UpdateFailed(f"TaskPilot request failed: {err}") from err
