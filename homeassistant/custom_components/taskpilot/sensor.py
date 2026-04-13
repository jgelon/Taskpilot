"""TaskPilot sensors."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import DOMAIN, TaskPilotCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up TaskPilot sensors."""
    coordinator: TaskPilotCoordinator = hass.data[DOMAIN][entry.entry_id]
    name = entry.data.get("name", "TaskPilot")

    async_add_entities([
        TaskPilotSensor(
            coordinator,
            entry,
            key="open",
            name=f"{name} Open Tasks",
            icon="mdi:clipboard-list-outline",
            unit="tasks",
        ),
        TaskPilotSensor(
            coordinator,
            entry,
            key="overdue",
            name=f"{name} Overdue Tasks",
            icon="mdi:clipboard-alert-outline",
            unit="tasks",
        ),
    ])


class TaskPilotSensor(CoordinatorEntity, SensorEntity):
    """A TaskPilot count sensor."""

    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self,
        coordinator: TaskPilotCoordinator,
        entry: ConfigEntry,
        key: str,
        name: str,
        icon: str,
        unit: str,
    ) -> None:
        super().__init__(coordinator)
        self._key = key
        self._attr_name = name
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_icon = icon
        self._attr_native_unit_of_measurement = unit

    @property
    def native_value(self) -> int | None:
        """Return the sensor value."""
        if self.coordinator.data is None:
            return None
        return self.coordinator.data.get(self._key, 0)

    @property
    def extra_state_attributes(self) -> dict:
        """Extra attributes."""
        return {
            "api_url": self.coordinator.api_url,
            "last_updated": self.coordinator.last_update_success_time.isoformat()
            if self.coordinator.last_update_success_time
            else None,
        }
