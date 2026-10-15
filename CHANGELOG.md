# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- myenergi devices in Gladys, through the myenergi cloud (hub serial number and
  API key): an installation device (grid power, solar power, grid voltage),
  the zappi, eddi, harvi and libbi of the account.
- zappi: connector, charge state, car plugged in, charge mode (Fast, Eco, Eco+,
  Stop) as a command, charge power, energy of the session and of the day, a
  total energy index for the Gladys energy tracking, clamp powers.
- eddi: status, heating, heating power, energy diverted today, total energy
  index, surplus diversion on/off, boost in progress and time left, tank probe
  temperatures, clamp powers.
- harvi: clamp powers. libbi: battery level, charge and discharge power,
  status, clamp powers.
- Dashboard widget "myenergi": solar, grid, zappi and eddi, with the Boost the
  car, Boost hot water and Stop the boost buttons (Gladys 5.2.0 or later).
- Scene trigger "zappi charge completed", with the energy of the session.
- Scene actions: set the zappi charge mode, boost the zappi (now or ready by a
  time), stop the zappi boost, boost the eddi, stop the eddi boost.
- "Test the connection" button, connection status and cloud badge per device.
- Every text in English, French, German and Spanish, with the user guide in
  the four languages.

[Unreleased]: https://github.com/guim31/gladys-myenergi/commits/main
