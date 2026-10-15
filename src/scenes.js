// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`). The keys are permanent once
// published. Each handler receives the resolved fields (scene variables
// substituted, defaults applied, validated by the core); throwing fails that
// action only, with the message in the configured language.
//
// The scene trigger (`charge_completed`) is fired by src/hub.js.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  zappi_set_mode: async (hub, { fields }) => {
    await hub.setZappiMode(fields.device, fields.mode);
  },
  zappi_boost: async (hub, { fields }) => {
    await hub.startZappiBoost(fields.device, fields.energy_kwh, fields.ready_by);
  },
  zappi_stop_boost: async (hub, { fields }) => {
    await hub.stopZappiBoost(fields.device);
  },
  eddi_boost: async (hub, { fields }) => {
    await hub.startEddiBoost(fields.device, fields.heater, fields.minutes);
  },
  eddi_stop_boost: async (hub, { fields }) => {
    await hub.stopEddiBoost(fields.device);
  },
};
