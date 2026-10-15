// -----------------------------------------------------------------------------
// The dashboard widget (manifest `widgets`): solar, grid, zappi and eddi at a
// glance, with the boost buttons. Built from the last reading of the hub (no
// request to the cloud), pre-localized in the language of the dashboard.
//
// Budget of the core: 8 components at most. Here: 4 tiles, 1 status list and
// up to 3 buttons. The tiles follow the live states when the device is added
// to Gladys (device_feature), else they show the last reading.
//
// The boost buttons open a form (Gladys >= 5.2.0, #3168): the energy of the
// zappi boost, the duration of the eddi boost. The labels of a form are
// multi-language objects (the core refuses a plain string there).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { SITE, deviceIds, parseExternalId } from './devices.js';
import { BOOST_LIMITS, WIDGET_KEY } from './hub.js';
import { CHARGING_STATE, KINDS, eddiView, zappiView } from './myenergi/model.js';
import {
  ACTION_TEXT,
  EDDI_STATUS_LABELS,
  ERROR_TEXT,
  UserError,
  ZAPPI_MODE_LABELS,
  pick,
} from './texts.js';

// Action keys of the buttons: one per button, the core drops a duplicate.
export const WIDGET_ACTIONS = Object.freeze({
  ZAPPI_BOOST: 'zappi_boost',
  EDDI_BOOST: 'eddi_boost',
  STOP_BOOST: 'stop_boost',
});

export const TEXT = {
  solar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  grid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  session: { en: 'Session', fr: 'Session', de: 'Sitzung', es: 'Sesión' },
  divertedToday: {
    en: 'Diverted today',
    fr: "Détourné aujourd'hui",
    de: 'Heute umgeleitet',
    es: 'Desviado hoy',
  },
  zappiBoost: { en: 'Boost the car', fr: 'Boost voiture', de: 'Auto-Boost', es: 'Refuerzo coche' },
  eddiBoost: {
    en: 'Boost hot water',
    fr: 'Boost eau chaude',
    de: 'Warmwasser-Boost',
    es: 'Refuerzo agua caliente',
  },
  stopBoost: {
    en: 'Stop the boost',
    fr: 'Arrêter le boost',
    de: 'Boost stoppen',
    es: 'Detener refuerzo',
  },
  energyField: {
    en: 'Energy to add (kWh)',
    fr: 'Énergie à ajouter (kWh)',
    de: 'Zu ladende Energie (kWh)',
    es: 'Energía a añadir (kWh)',
  },
  readyByField: {
    en: 'Ready by (HH:MM, optional)',
    fr: 'Prête pour (HH:MM, facultatif)',
    de: 'Fertig um (HH:MM, optional)',
    es: 'Lista a las (HH:MM, opcional)',
  },
  minutesField: {
    en: 'Duration (minutes)',
    fr: 'Durée (minutes)',
    de: 'Dauer (Minuten)',
    es: 'Duración (minutos)',
  },
  heaterField: { en: 'Heater', fr: 'Résistance', de: 'Heizstab', es: 'Resistencia' },
  heater1: { en: 'Heater 1', fr: 'Résistance 1', de: 'Heizstab 1', es: 'Resistencia 1' },
  heater2: { en: 'Heater 2', fr: 'Résistance 2', de: 'Heizstab 2', es: 'Resistencia 2' },
  boost: { en: 'Boost', fr: 'Boost', de: 'Boost', es: 'Refuerzo' },
  charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  connected: {
    en: 'Car plugged in',
    fr: 'Voiture branchée',
    de: 'Auto angeschlossen',
    es: 'Coche enchufado',
  },
  waitingCar: {
    en: 'Waiting for the car',
    fr: 'En attente de la voiture',
    de: 'Wartet auf das Auto',
    es: 'Esperando al coche',
  },
  waitingSurplus: {
    en: 'Waiting for surplus',
    fr: 'En attente de surplus',
    de: 'Wartet auf Überschuss',
    es: 'Esperando excedente',
  },
  complete: {
    en: 'Charge complete',
    fr: 'Charge terminée',
    de: 'Ladung beendet',
    es: 'Carga terminada',
  },
  unplugged: { en: 'No car', fr: 'Pas de voiture', de: 'Kein Auto', es: 'Sin coche' },
  fault: { en: 'Fault', fr: 'Défaut', de: 'Fehler', es: 'Fallo' },
  notConfigured: {
    en: 'Enter the serial number of your hub and your API key in the configuration of the integration.',
    fr: "Saisissez le numéro de série de votre hub et votre clé d'API dans la configuration de l'intégration.",
    de: 'Gib die Seriennummer deines Hubs und deinen API-Schlüssel in der Konfiguration der Integration ein.',
    es: 'Introduzca el número de serie de su hub y su clave de API en la configuración de la integración.',
  },
  reading: {
    en: 'Reading the myenergi account…',
    fr: 'Lecture du compte myenergi…',
    de: 'Das myenergi-Konto wird gelesen…',
    es: 'Leyendo la cuenta de myenergi…',
  },
  stale: {
    en: 'Last reading shown: myenergi does not answer.',
    fr: 'Dernière lecture affichée : myenergi ne répond pas.',
    de: 'Letzte Messung angezeigt: myenergi antwortet nicht.',
    es: 'Se muestra la última lectura: myenergi no responde.',
  },
  oldCore: {
    en: 'Update Gladys to 5.2.0 or later to use this button.',
    fr: 'Mettez Gladys à jour (5.2.0 ou plus) pour utiliser ce bouton.',
    de: 'Aktualisiere Gladys auf 5.2.0 oder neuer, um diese Schaltfläche zu nutzen.',
    es: 'Actualice Gladys a la 5.2.0 o posterior para usar este botón.',
  },
};

const kwh = (value) => `${Math.round(value * 10) / 10} kWh`;

/** The device a setting names, else the first one of its kind. */
function chosen(gladys, devices, kind, setting) {
  const parsed = setting ? parseExternalId(gladys, setting) : null;
  if (parsed?.kind === kind) {
    const device = devices.find((d) => d.kind === kind && d.serial === parsed.serial);
    if (device) {
      return device;
    }
  }
  return devices.find((d) => d.kind === kind) ?? null;
}

function zappiLabel(view, language) {
  if (view.connector === 4) {
    return pick(TEXT.fault, language);
  }
  if (view.boosting && view.charging === CHARGING_STATE.CHARGING) {
    return pick(TEXT.boost, language);
  }
  switch (view.charging) {
    case CHARGING_STATE.CHARGING:
      return pick(TEXT.charging, language);
    case CHARGING_STATE.EV_CONNECTED:
      return pick(TEXT.connected, language);
    case CHARGING_STATE.PAUSED_BY_VEHICLE:
      return pick(TEXT.waitingCar, language);
    case CHARGING_STATE.PAUSED_BY_CHARGER:
      return view.mode === 'stop'
        ? ZAPPI_MODE_LABELS[language].stop
        : pick(TEXT.waitingSurplus, language);
    default:
      return view.plugged === 1 ? pick(TEXT.complete, language) : pick(TEXT.unplugged, language);
  }
}

/** A value tile: live when the device is in Gladys, the last reading otherwise. */
function tile({ created, ids, key, label, value, unit, icon }) {
  if (created.has(ids.device)) {
    return { type: 'value', label, icon, device_feature: ids.feature(key) };
  }
  return value === null || value === undefined ? null : { type: 'value', label, icon, value, unit };
}

/**
 * @param {object} gladys
 * @param {object} view hub.view()
 * @param {{ settings?: object, language?: string }} request
 */
export function buildContent(gladys, view, { settings = {}, language = 'en' } = {}) {
  const lang = ['en', 'fr', 'de', 'es'].includes(language) ? language : 'en';
  if (!view.configured) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', text: pick(TEXT.notConfigured, lang) }],
    };
  }
  const { snapshot } = view;
  if (!snapshot) {
    const text = view.error ? pick(ERROR_TEXT[view.error.kind], lang) : pick(TEXT.reading, lang);
    return { ttl_seconds: 60, components: [{ type: 'text', text }] };
  }
  const zappi = chosen(gladys, snapshot.devices, KINDS.ZAPPI, settings.zappi);
  const eddi = chosen(gladys, snapshot.devices, KINDS.EDDI, settings.eddi);
  const site = deviceIds(gladys, SITE, view.hubSerial);
  const components = [];
  const items = [];
  const buttons = [];

  components.push(
    tile({
      created: view.created,
      ids: site,
      key: 'solar_power',
      label: pick(TEXT.solar, lang),
      value: snapshot.site.solarW,
      unit: 'W',
      icon: 'sun',
    }),
    tile({
      created: view.created,
      ids: site,
      key: 'grid_power',
      label: pick(TEXT.grid, lang),
      value: snapshot.site.gridW,
      unit: 'W',
      icon: 'zap',
    }),
  );

  if (zappi) {
    const ids = deviceIds(gladys, zappi.kind, zappi.serial);
    const z = zappiView(zappi.raw);
    const name = view.name(zappi.kind, zappi.serial).slice(0, 24);
    components.push(
      tile({
        created: view.created,
        ids,
        key: 'charge_power',
        label: name,
        value: z.chargePowerKw,
        unit: 'kW',
        icon: 'battery-charging',
      }),
    );
    const mode = z.mode ? ZAPPI_MODE_LABELS[lang][z.mode] : null;
    items.push({
      label: name,
      value: [zappiLabel(z, lang), mode].filter(Boolean).join(' · ').slice(0, 40),
      icon: 'battery-charging',
      color:
        z.connector === 4
          ? WIDGET_COLORS.DANGER
          : z.boosting
            ? WIDGET_COLORS.WARNING
            : z.charging === CHARGING_STATE.CHARGING
              ? WIDGET_COLORS.SUCCESS
              : WIDGET_COLORS.NEUTRAL,
    });
    if (z.sessionKwh !== null) {
      items.push({ label: pick(TEXT.session, lang), value: kwh(z.sessionKwh), icon: 'activity' });
    }
    if (z.mode === 'eco' || z.mode === 'eco_plus') {
      const last = Number(zappi.raw.tbk);
      buttons.push({
        type: 'button',
        label: pick(TEXT.zappiBoost, lang),
        icon: 'zap',
        style: 'secondary',
        action: {
          key: WIDGET_ACTIONS.ZAPPI_BOOST,
          params: { device: ids.device },
          fields: [
            {
              key: 'energy_kwh',
              type: 'number',
              required: true,
              min: BOOST_LIMITS.kwhMin,
              max: BOOST_LIMITS.kwhMax,
              // The last boost the zappi remembers pre-fills the form.
              default:
                Number.isInteger(last) && last >= BOOST_LIMITS.kwhMin && last <= BOOST_LIMITS.kwhMax
                  ? last
                  : 10,
              label: TEXT.energyField,
            },
            {
              key: 'ready_by',
              type: 'string',
              required: false,
              label: TEXT.readyByField,
            },
          ],
        },
      });
    }
  }

  if (eddi) {
    const ids = deviceIds(gladys, eddi.kind, eddi.serial);
    const e = eddiView(eddi.raw);
    const name = view.name(eddi.kind, eddi.serial).slice(0, 24);
    components.push(
      tile({
        created: view.created,
        ids,
        key: 'heating_power',
        label: name,
        value: e.powerW,
        unit: 'W',
        icon: 'droplet',
      }),
    );
    const status = e.status ? EDDI_STATUS_LABELS[lang][e.status] : null;
    if (status) {
      items.push({
        label: name,
        value: (e.boosting && e.boostMinutes ? `${status} · ${e.boostMinutes} min` : status).slice(
          0,
          40,
        ),
        icon: 'droplet',
        color: e.boosting
          ? WIDGET_COLORS.WARNING
          : e.heating
            ? WIDGET_COLORS.SUCCESS
            : WIDGET_COLORS.NEUTRAL,
      });
    }
    const energy = view.energy.get(`${eddi.kind}:${eddi.serial}`);
    if (energy) {
      items.push({
        label: pick(TEXT.divertedToday, lang),
        value: kwh(energy.today.diverted),
        icon: 'sun',
      });
    }
    if (e.status !== 'stopped') {
      buttons.push({
        type: 'button',
        label: pick(TEXT.eddiBoost, lang),
        icon: 'droplet',
        style: 'secondary',
        action: {
          key: WIDGET_ACTIONS.EDDI_BOOST,
          params: { device: ids.device },
          fields: [
            {
              key: 'minutes',
              type: 'number',
              required: true,
              min: BOOST_LIMITS.minutesMin,
              max: BOOST_LIMITS.minutesMax,
              default: 30,
              label: TEXT.minutesField,
            },
            {
              key: 'heater',
              type: 'select',
              required: true,
              default: '1',
              label: TEXT.heaterField,
              options: [
                { value: '1', label: TEXT.heater1 },
                { value: '2', label: TEXT.heater2 },
              ],
            },
          ],
        },
      });
    }
  }

  const boosting = snapshot.devices.some(
    ({ kind, raw }) =>
      (kind === KINDS.ZAPPI && zappiView(raw).boosting) ||
      (kind === KINDS.EDDI && eddiView(raw).boosting === 1),
  );
  if (boosting) {
    buttons.push({
      type: 'button',
      label: pick(TEXT.stopBoost, lang),
      icon: 'x-circle',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.STOP_BOOST, confirm: true },
    });
  }

  const content = components.filter(Boolean);
  if (items.length) {
    content.push({ type: 'status', items: items.slice(0, 10) });
  }
  if (view.error) {
    // The last reading stays on screen, said to be old; no command would get through.
    content.unshift({ type: 'text', variant: 'caption', text: pick(TEXT.stale, lang) });
  } else {
    content.push(...buttons);
  }
  return { ttl_seconds: 60, components: content.slice(0, 8) };
}

/** A widget button: refused when the form values did not come (older core). */
async function action(hub, { actionKey, params = {}, values }) {
  const language = hub.config?.language;
  if (actionKey === WIDGET_ACTIONS.STOP_BOOST) {
    return hub.stopAllBoosts();
  }
  if (!values) {
    throw new UserError(TEXT.oldCore, language);
  }
  if (actionKey === WIDGET_ACTIONS.ZAPPI_BOOST) {
    return hub.startZappiBoost(params.device, values.energy_kwh, values.ready_by);
  }
  if (actionKey === WIDGET_ACTIONS.EDDI_BOOST) {
    return hub.startEddiBoost(params.device, values.heater, values.minutes);
  }
  throw new UserError(ACTION_TEXT.unknownDevice, language);
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => buildContent(hub.gladys, hub.view(), request),
    action,
  },
};
