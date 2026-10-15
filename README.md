# myenergi for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows and drives the [myenergi](https://myenergi.com) devices — the
**zappi** car charger, the **eddi** hot water diverter, the **harvi**
wireless clamp sensor and the **libbi** battery — through the myenergi cloud,
the API of the myenergi app.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against the answers of the myenergi cloud published in the
> tests of [pymyenergi](https://github.com/CJNE/pymyenergi), not against real
> devices nor a real account. Please report what works and what does not in
> the [issues](https://github.com/guim31/gladys-myenergi/issues).

## Features

- **An installation device**: grid power (import +, export −), solar power
  and grid voltage, computed like the myenergi app (the clamps typed _Grid_ and
  _Generation_ of every device).
- **zappi**: connector and charge state (car plugged in, charging, waiting for
  surplus, complete…), **charge mode** (Fast, Eco, Eco+, Stop — a command),
  charge power, energy of the session, energy of the day, and a **total
  energy** index that feeds the Gladys energy tracking (consumption per half
  hour and its cost), plus the power of each assigned clamp.
- **eddi**: status, heating, heating power, solar energy diverted today, total
  energy index, **surplus diversion** on/off (a command), boost in progress
  and time left, tank probe temperatures when connected, clamps.
- **harvi**: the power of each assigned clamp.
- **libbi**: battery level, charge and discharge power, status, clamps.
- **Dashboard widget** "myenergi": solar, grid, zappi and eddi tiles, their
  states, and the **Boost the car** (energy, optional ready-by time), **Boost
  hot water** (duration, heater) and **Stop the boost** buttons.
- **Scene trigger** _zappi charge completed_, with the energy of the session.
- **Scene actions**: set the zappi charge mode, boost the zappi (now or ready
  by a time), stop the zappi boost, boost the eddi for a duration, stop the
  eddi boost.
- A **Test the connection** button, a connection status that says what is
  wrong, and a cloud / unreachable badge per device.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.2.0** or later (the widget buttons open a form).
- A myenergi hub (or a zappi / eddi acting as hub) online, its **serial
  number** and an **API key** generated in the
  [myenergi account](https://myaccount.myenergi.com) (Products).

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-myenergi`
   (or install **myenergi** from the catalog once it is listed).
2. In **Configuration**, enter the hub serial number and the API key, save,
   then click **Test the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Authentication**: HTTP digest, the user name being the hub serial number
  and the password the API key (never sent in clear, never logged).
  `https://director.myenergi.net/cgi-jstatus-E` answers with the
  `x_myenergi-asn` header naming the server of the account
  (`s18.myenergi.net`…); every request then goes there, and a later answer
  naming another server is followed. A server outside `*.myenergi.net` is
  refused: the credentials never go elsewhere.
- **Reading**: one `GET /cgi-jstatus-*` reads every device, at the refresh
  interval (1 to 10 minutes, 1 by default). The names given in the app come
  from `/cgi-get-app-key-` (every 6 hours). The hourly history
  (`/cgi-jdayhour-<Z|E><serial>-<UTC date and hour of the local midnight>-<hours>`)
  gives the energy of the day; it is read every 10 minutes for each zappi and
  eddi added to Gladys.
- **Total energy**: the cloud has no lifetime counter. `src/energy.js` adds the
  complete days to a base (reading again the day that just ended, and the days
  missed during a stop, up to 31), plus the energy of today; the index never
  goes down. The ledger is `/data/myenergi-state.json`.
- **Refresh**: the devices are published with `should_poll` and a 1-minute
  `poll_frequency`, but Gladys 5.2 does not reliably poll external devices
  (GladysAssistant/Gladys#3198): the container reads the cloud on its own
  timer, and the core's `onPoll` is a fallback that only reads when the timer
  has not. Only the changed values are sent, plus every value again every 6
  hours; all of them when a device is added or Gladys reconnects.
- **Commands** are GET requests too: `/cgi-zappi-mode-Z<serial>-<mode>-0-0-0000`,
  `-0-10-<kWh>-0000` (boost), `-0-11-<kWh>-<HHMM>` (smart boost),
  `-0-2-0-0000` (stop boost), `/cgi-eddi-mode-E<serial>-<0|1>`,
  `/cgi-eddi-boost-E<serial>-10-<heater>-<minutes>` and `-1-<heater>-0`. The
  device is read again 5 seconds after a command.
- **Not exposed, on purpose**: unlocking the zappi (`cgi-jlock`), and any
  heating switch — the eddi boost always has a duration.

## Checked, and what was not

- Checked here: 110+ tests against the SDK's fake Gladys and an in-memory
  myenergi cloud (real digest authentication, the status fixtures of
  pymyenergi, anonymized), the Gladys conformity rules
  (`test/gladys-rules.test.js`), the widget against the SDK validator, the
  store validator.
- Not checked: a real account and real devices (the development session has
  no network access to myenergi). `scripts/probe.mjs` runs the real client
  against the cloud, read only, without printing anything sensitive:
  `node scripts/probe.mjs` with an invented account (expected: refused,
  "auth"), or with `MYENERGI_SERIAL` and `MYENERGI_API_KEY` for a real one.
- Interpreted, to confirm on a device: the zappi charge power (`div`), the
  sign of the libbi power, the eddi remaining boost time (`rbt`, seconds), the
  zappi statuses while waiting for surplus, and the status answered by the
  commands (`0` = accepted).

## Limitations

- Cloud only, at the pace of the myenergi app (one minute at most).
- Not supported: device priorities, minimum green level, zappi phase setting,
  libbi modes and charge target (they need the myenergi app account through
  AWS Cognito, not the API key).
- The total energy starts from the day the device is added; Gladys prices it
  at the contract tariff, solar share included.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

Versions and releases belong to the Release workflow (Actions → Release),
run by the maintainer. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [pymyenergi](https://github.com/CJNE/pymyenergi) by Johan Isacsson and
  contributors (MIT): the description of the myenergi API (paths, fields,
  states, commands) and the fixtures of `test/fixtures/myenergi/`.
- [ha-myenergi](https://github.com/CJNE/ha-myenergi) by cjne and contributors
  (MIT), the Home Assistant integration: the choice of sensors and services,
  the API key procedure.
- The architecture and the tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled),
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by myenergi Ltd.
"myenergi", "zappi", "eddi", "harvi" and "libbi" are trademarks of myenergi
Ltd.

## License

Apache-2.0
