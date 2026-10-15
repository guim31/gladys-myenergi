// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface: feature names, option labels, connection status, errors, action
// messages. German says "du", Spanish "usted". Brands (myenergi, zappi, eddi,
// harvi, libbi) are never translated. test/i18n.test.js checks every table.
// The widget texts live in src/widgets.js.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './myenergi/client.js';

/** The text of a multi-language object in a language, English as fallback. */
export const pick = (text, language) =>
  typeof text === 'string' ? text : (text?.[language] ?? text?.en ?? '');

/** Apply a function to each language of a table: `{ en: fn('en'), ... }`. */
export const perLanguage = (fn) => ({ en: fn('en'), fr: fn('fr'), de: fn('de'), es: fn('es') });

// --- Feature names (fixed when the device is added) ---------------------------------

export const NAMES = {
  en: {
    grid_power: 'Grid power',
    solar_power: 'Solar power',
    voltage: 'Grid voltage',
    connector_status: 'Connector',
    charging_state: 'Charge',
    plugged: 'Car plugged in',
    mode: 'Charge mode',
    charge_power: 'Charge power',
    session_energy: 'Session energy',
    energy_today: 'Energy today',
    energy_total: 'Total energy',
    status: 'Status',
    heating: 'Heating',
    heating_power: 'Heating power',
    diverted_today: 'Diverted today',
    enabled: 'Surplus diversion',
    boost: 'Boost',
    boost_remaining: 'Boost time left',
    temp1: 'Probe 1 temperature',
    temp2: 'Probe 2 temperature',
    battery_level: 'Battery level',
    battery_charge: 'Charge power',
    battery_discharge: 'Discharge power',
  },
  fr: {
    grid_power: 'Puissance réseau',
    solar_power: 'Puissance solaire',
    voltage: 'Tension réseau',
    connector_status: 'Connecteur',
    charging_state: 'Charge',
    plugged: 'Voiture branchée',
    mode: 'Mode de charge',
    charge_power: 'Puissance de charge',
    session_energy: 'Énergie de la session',
    energy_today: "Énergie aujourd'hui",
    energy_total: 'Énergie totale',
    status: 'État',
    heating: 'Chauffe',
    heating_power: 'Puissance de chauffe',
    diverted_today: "Détourné aujourd'hui",
    enabled: 'Routage du surplus',
    boost: 'Boost',
    boost_remaining: 'Boost restant',
    temp1: 'Température sonde 1',
    temp2: 'Température sonde 2',
    battery_level: 'Niveau de batterie',
    battery_charge: 'Puissance de charge',
    battery_discharge: 'Puissance de décharge',
  },
  de: {
    grid_power: 'Netzleistung',
    solar_power: 'Solarleistung',
    voltage: 'Netzspannung',
    connector_status: 'Anschluss',
    charging_state: 'Ladevorgang',
    plugged: 'Auto angeschlossen',
    mode: 'Lademodus',
    charge_power: 'Ladeleistung',
    session_energy: 'Energie der Sitzung',
    energy_today: 'Energie heute',
    energy_total: 'Gesamtenergie',
    status: 'Status',
    heating: 'Heizvorgang',
    heating_power: 'Heizleistung',
    diverted_today: 'Heute umgeleitet',
    enabled: 'Überschussumleitung',
    boost: 'Boost',
    boost_remaining: 'Verbleibender Boost',
    temp1: 'Temperatur Fühler 1',
    temp2: 'Temperatur Fühler 2',
    battery_level: 'Batteriestand',
    battery_charge: 'Ladeleistung',
    battery_discharge: 'Entladeleistung',
  },
  es: {
    grid_power: 'Potencia de la red',
    solar_power: 'Potencia solar',
    voltage: 'Tensión de la red',
    connector_status: 'Conector',
    charging_state: 'Carga',
    plugged: 'Coche enchufado',
    mode: 'Modo de carga',
    charge_power: 'Potencia de carga',
    session_energy: 'Energía de la sesión',
    energy_today: 'Energía de hoy',
    energy_total: 'Energía total',
    status: 'Estado',
    heating: 'Calentando',
    heating_power: 'Potencia de calentamiento',
    diverted_today: 'Desviado hoy',
    enabled: 'Desvío del excedente',
    boost: 'Refuerzo',
    boost_remaining: 'Refuerzo restante',
    temp1: 'Temperatura sonda 1',
    temp2: 'Temperatura sonda 2',
    battery_level: 'Nivel de batería',
    battery_charge: 'Potencia de carga',
    battery_discharge: 'Potencia de descarga',
  },
};

// Name of a current clamp feature: "Clamp 2 (Grid)".
export const CLAMP_NAME = {
  en: (index, type) => `Clamp ${index} (${type})`,
  fr: (index, type) => `Pince ${index} (${type})`,
  de: (index, type) => `Zange ${index} (${type})`,
  es: (index, type) => `Pinza ${index} (${type})`,
};

// The clamp types of the myenergi app; an unknown type is shown as received.
export const CLAMP_TYPES = {
  en: {
    Grid: 'grid',
    Generation: 'solar',
    'AC Battery': 'AC battery',
    'Internal Load': 'internal load',
    Monitor: 'monitor',
    Storage: 'storage',
    DCPV: 'DC solar',
  },
  fr: {
    Grid: 'réseau',
    Generation: 'production',
    'AC Battery': 'batterie AC',
    'Internal Load': 'charge interne',
    Monitor: 'mesure',
    Storage: 'stockage',
    DCPV: 'solaire DC',
  },
  de: {
    Grid: 'Netz',
    Generation: 'Erzeugung',
    'AC Battery': 'AC-Batterie',
    'Internal Load': 'interne Last',
    Monitor: 'Messung',
    Storage: 'Speicher',
    DCPV: 'DC-Solar',
  },
  es: {
    Grid: 'red',
    Generation: 'generación',
    'AC Battery': 'batería CA',
    'Internal Load': 'carga interna',
    Monitor: 'medida',
    Storage: 'almacenamiento',
    DCPV: 'solar CC',
  },
};

export const clampName = (index, type, language) =>
  CLAMP_NAME[language](index, CLAMP_TYPES[language][type] ?? type);

// Default device names, when the app gave none.
export const DEVICE_NAMES = {
  en: { site: 'myenergi site' },
  fr: { site: 'Installation myenergi' },
  de: { site: 'myenergi-Anlage' },
  es: { site: 'Instalación myenergi' },
};

// --- Options of the selects (labels upserted at every publication) -----------------

export const ZAPPI_MODE_LABELS = {
  en: { fast: 'Fast', eco: 'Eco', eco_plus: 'Eco+', stop: 'Stop' },
  fr: { fast: 'Rapide', eco: 'Eco', eco_plus: 'Eco+', stop: 'Arrêt' },
  de: { fast: 'Schnell', eco: 'Eco', eco_plus: 'Eco+', stop: 'Stopp' },
  es: { fast: 'Rápido', eco: 'Eco', eco_plus: 'Eco+', stop: 'Parada' },
};

export const EDDI_STATUS_LABELS = {
  en: {
    paused: 'Waiting for surplus',
    diverting: 'Diverting',
    boosting: 'Boosting',
    hot: 'Max temperature reached',
    stopped: 'Stopped',
  },
  fr: {
    paused: 'En attente de surplus',
    diverting: 'Routage en cours',
    boosting: 'Boost en cours',
    hot: 'Température max atteinte',
    stopped: 'Arrêté',
  },
  de: {
    paused: 'Wartet auf Überschuss',
    diverting: 'Leitet um',
    boosting: 'Boost läuft',
    hot: 'Höchsttemperatur erreicht',
    stopped: 'Gestoppt',
  },
  es: {
    paused: 'Esperando excedente',
    diverting: 'Desviando',
    boosting: 'Refuerzo en curso',
    hot: 'Temperatura máxima alcanzada',
    stopped: 'Detenido',
  },
};

export const LIBBI_STATUS_LABELS = {
  en: {
    off: 'Off',
    on: 'On',
    full: 'Battery full',
    idle: 'Idle',
    charging: 'Charging',
    discharging: 'Discharging',
    duration_charging: 'Timed charging',
    duration_drain: 'Timed discharge',
    stopped: 'Stopped',
    target_charge: 'Charging to target',
    boosting: 'Boosting',
    upgrading: 'Updating',
    fault: 'Fault',
  },
  fr: {
    off: 'Éteinte',
    on: 'Allumée',
    full: 'Batterie pleine',
    idle: 'En veille',
    charging: 'En charge',
    discharging: 'En décharge',
    duration_charging: 'Charge programmée',
    duration_drain: 'Décharge programmée',
    stopped: 'Arrêtée',
    target_charge: "Charge jusqu'à l'objectif",
    boosting: 'Boost en cours',
    upgrading: 'Mise à jour',
    fault: 'Défaut',
  },
  de: {
    off: 'Aus',
    on: 'An',
    full: 'Batterie voll',
    idle: 'Bereit',
    charging: 'Lädt',
    discharging: 'Entlädt',
    duration_charging: 'Zeitgesteuertes Laden',
    duration_drain: 'Zeitgesteuertes Entladen',
    stopped: 'Gestoppt',
    target_charge: 'Lädt bis zum Ziel',
    boosting: 'Boost läuft',
    upgrading: 'Aktualisierung',
    fault: 'Fehler',
  },
  es: {
    off: 'Apagada',
    on: 'Encendida',
    full: 'Batería llena',
    idle: 'En espera',
    charging: 'Cargando',
    discharging: 'Descargando',
    duration_charging: 'Carga programada',
    duration_drain: 'Descarga programada',
    stopped: 'Detenida',
    target_charge: 'Cargando hasta el objetivo',
    boosting: 'Refuerzo en curso',
    upgrading: 'Actualizando',
    fault: 'Fallo',
  },
};

// --- Connection status and errors ----------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  notConfigured: {
    en: 'Enter the serial number of your hub and your API key.',
    fr: 'Saisissez le numéro de série de votre hub et votre clé d’API.',
    de: 'Gib die Seriennummer deines Hubs und deinen API-Schlüssel ein.',
    es: 'Introduzca el número de serie de su hub y su clave de API.',
  },
  invalidSerial: {
    en: 'The serial number is digits only, as on the hub label.',
    fr: 'Le numéro de série ne contient que des chiffres, comme sur l’étiquette du hub.',
    de: 'Die Seriennummer besteht nur aus Ziffern, wie auf dem Etikett des Hubs.',
    es: 'El número de serie solo contiene cifras, como en la etiqueta del hub.',
  },
  noDevice: {
    en: 'Connected, but the account has no zappi, eddi, harvi or libbi.',
    fr: 'Connecté, mais le compte n’a ni zappi, ni eddi, ni harvi, ni libbi.',
    de: 'Verbunden, aber das Konto hat weder zappi, eddi, harvi noch libbi.',
    es: 'Conectado, pero la cuenta no tiene ningún zappi, eddi, harvi ni libbi.',
  },
};

// One short explanation per error kind (src/myenergi/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.AUTH]: {
    en: 'Serial number or API key refused by myenergi.',
    fr: 'Numéro de série ou clé d’API refusés par myenergi.',
    de: 'Seriennummer oder API-Schlüssel von myenergi abgelehnt.',
    es: 'Número de serie o clave de API rechazados por myenergi.',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'The myenergi cloud does not answer.',
    fr: 'Le cloud myenergi ne répond pas.',
    de: 'Die myenergi-Cloud antwortet nicht.',
    es: 'La nube de myenergi no responde.',
  },
  [ERROR_KINDS.RATE]: {
    en: 'Too many requests: myenergi asks to slow down.',
    fr: 'Trop de requêtes : myenergi demande de ralentir.',
    de: 'Zu viele Anfragen: myenergi bittet um weniger Abfragen.',
    es: 'Demasiadas solicitudes: myenergi pide reducir el ritmo.',
  },
  [ERROR_KINDS.SERVER]: {
    en: 'The myenergi cloud answered with an error.',
    fr: 'Le cloud myenergi a répondu par une erreur.',
    de: 'Die myenergi-Cloud hat mit einem Fehler geantwortet.',
    es: 'La nube de myenergi ha respondido con un error.',
  },
  [ERROR_KINDS.ANSWER]: {
    en: 'Unexpected answer from the myenergi cloud.',
    fr: 'Réponse inattendue du cloud myenergi.',
    de: 'Unerwartete Antwort der myenergi-Cloud.',
    es: 'Respuesta inesperada de la nube de myenergi.',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'The device refused the command.',
    fr: 'L’appareil a refusé la commande.',
    de: 'Das Gerät hat den Befehl abgelehnt.',
    es: 'El aparato ha rechazado la orden.',
  },
};

/** The user-facing text of an error, any error. */
export const errorText = (err) =>
  ERROR_TEXT[err?.kind] ?? (err?.text && typeof err.text === 'object' ? err.text : null);

// --- Actions (scenes, widget, configuration screen) ------------------------------------------

export const ACTION_TEXT = {
  notConfigured: CONNECTION_TEXT.notConfigured,
  notZappi: {
    en: 'Choose a zappi.',
    fr: 'Choisissez une zappi.',
    de: 'Wähle eine zappi.',
    es: 'Elija un zappi.',
  },
  notEddi: {
    en: 'Choose an eddi.',
    fr: 'Choisissez un eddi.',
    de: 'Wähle einen eddi.',
    es: 'Elija un eddi.',
  },
  unknownDevice: {
    en: 'This device is not in the myenergi account.',
    fr: 'Cet appareil n’est pas dans le compte myenergi.',
    de: 'Dieses Gerät ist nicht im myenergi-Konto.',
    es: 'Este aparato no está en la cuenta de myenergi.',
  },
  badMode: {
    en: 'Unknown charge mode: fast, eco, eco_plus or stop.',
    fr: 'Mode de charge inconnu : fast, eco, eco_plus ou stop.',
    de: 'Unbekannter Lademodus: fast, eco, eco_plus oder stop.',
    es: 'Modo de carga desconocido: fast, eco, eco_plus o stop.',
  },
  badEnergy: {
    en: 'Boost energy: a whole number of kWh from 1 to 99.',
    fr: 'Énergie du boost : un nombre entier de kWh de 1 à 99.',
    de: 'Boost-Energie: eine ganze Zahl von 1 bis 99 kWh.',
    es: 'Energía del refuerzo: un número entero de kWh de 1 a 99.',
  },
  badTime: {
    en: 'Ready-by time: HH:MM, e.g. 07:30.',
    fr: 'Heure de fin : HH:MM, ex. 07:30.',
    de: 'Fertig um: HH:MM, z. B. 07:30.',
    es: 'Hora de fin: HH:MM, p. ej. 07:30.',
  },
  badMinutes: {
    en: 'Boost duration: a whole number of minutes from 1 to 240.',
    fr: 'Durée du boost : un nombre entier de minutes de 1 à 240.',
    de: 'Boost-Dauer: eine ganze Zahl von 1 bis 240 Minuten.',
    es: 'Duración del refuerzo: un número entero de minutos de 1 a 240.',
  },
  badHeater: {
    en: 'Heater: 1 or 2.',
    fr: 'Résistance : 1 ou 2.',
    de: 'Heizstab: 1 oder 2.',
    es: 'Resistencia: 1 o 2.',
  },
  boostNeedsEco: {
    en: 'A zappi boost works in Eco or Eco+ mode only.',
    fr: 'Le boost de la zappi ne fonctionne qu’en mode Eco ou Eco+.',
    de: 'Der Boost der zappi funktioniert nur im Modus Eco oder Eco+.',
    es: 'El refuerzo del zappi solo funciona en modo Eco o Eco+.',
  },
  noZappi: {
    en: 'No zappi in the myenergi account.',
    fr: 'Aucune zappi dans le compte myenergi.',
    de: 'Keine zappi im myenergi-Konto.',
    es: 'Ningún zappi en la cuenta de myenergi.',
  },
  noEddi: {
    en: 'No eddi in the myenergi account.',
    fr: 'Aucun eddi dans le compte myenergi.',
    de: 'Kein eddi im myenergi-Konto.',
    es: 'Ningún eddi en la cuenta de myenergi.',
  },
  modeSet: {
    en: (name, mode) => `${name}: ${mode} mode.`,
    fr: (name, mode) => `${name} : mode ${mode}.`,
    de: (name, mode) => `${name}: Modus ${mode}.`,
    es: (name, mode) => `${name}: modo ${mode}.`,
  },
  zappiBoost: {
    en: (name, kwh) => `${name}: boost of ${kwh} kWh started.`,
    fr: (name, kwh) => `${name} : boost de ${kwh} kWh lancé.`,
    de: (name, kwh) => `${name}: Boost von ${kwh} kWh gestartet.`,
    es: (name, kwh) => `${name}: refuerzo de ${kwh} kWh iniciado.`,
  },
  zappiSmartBoost: {
    en: (name, kwh, time) => `${name}: ${kwh} kWh ready by ${time}.`,
    fr: (name, kwh, time) => `${name} : ${kwh} kWh prêts pour ${time}.`,
    de: (name, kwh, time) => `${name}: ${kwh} kWh bis ${time} Uhr.`,
    es: (name, kwh, time) => `${name}: ${kwh} kWh listos a las ${time}.`,
  },
  eddiBoost: {
    en: (name, minutes) => `${name}: boost for ${minutes} min started.`,
    fr: (name, minutes) => `${name} : boost de ${minutes} min lancé.`,
    de: (name, minutes) => `${name}: Boost für ${minutes} Min. gestartet.`,
    es: (name, minutes) => `${name}: refuerzo de ${minutes} min iniciado.`,
  },
  boostStopped: {
    en: (names) => `Boost stopped: ${names}.`,
    fr: (names) => `Boost arrêté : ${names}.`,
    de: (names) => `Boost gestoppt: ${names}.`,
    es: (names) => `Refuerzo detenido: ${names}.`,
  },
  eddiEnabled: {
    en: (name, on) => `${name}: surplus diversion ${on ? 'on' : 'stopped'}.`,
    fr: (name, on) => `${name} : routage du surplus ${on ? 'activé' : 'arrêté'}.`,
    de: (name, on) => `${name}: Überschussumleitung ${on ? 'an' : 'gestoppt'}.`,
    es: (name, on) => `${name}: desvío del excedente ${on ? 'activado' : 'detenido'}.`,
  },
};

/** An error whose message is a sentence for the user, in the configured language. */
export class UserError extends Error {
  constructor(text, language) {
    super(pick(text, language));
    this.text = text;
  }
}

// --- "Test the connection" (configuration screen) ---------------------------------------------

export const REPORT_TEXT = {
  en: {
    ok: (count, list) => `Connected to myenergi: ${count} device(s), ${list}.`,
    server: (host) => `Server of the account: ${host}.`,
  },
  fr: {
    ok: (count, list) => `Connecté à myenergi : ${count} appareil(s), ${list}.`,
    server: (host) => `Serveur du compte : ${host}.`,
  },
  de: {
    ok: (count, list) => `Mit myenergi verbunden: ${count} Gerät(e), ${list}.`,
    server: (host) => `Server des Kontos: ${host}.`,
  },
  es: {
    ok: (count, list) => `Conectado a myenergi: ${count} aparato(s), ${list}.`,
    server: (host) => `Servidor de la cuenta: ${host}.`,
  },
};
