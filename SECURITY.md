# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the serial number of the myenergi hub and its API key, stored
  in the Gladys configuration of the integration (the key as a `secret`
  field). The key is only used for HTTP digest authentication: it never
  travels in clear and is never written to the logs, at any level.
- **Network**: outgoing HTTPS only, to `director.myenergi.net` and to the
  server of the account it names (`*.myenergi.net`); a server outside that
  domain is refused, so the credentials never reach another host. Nothing
  listens on the network.
- **`/data`**: `myenergi-state.json`, the energy ledger of the zappi and eddi
  (day, base and index in kWh, by device serial). No secret is written there.
- **Commands**: charge mode and boosts of the zappi, surplus diversion and
  boosts of the eddi. Unlocking the zappi is not implemented, on purpose.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the myenergi cloud and devices the integration talks to.
