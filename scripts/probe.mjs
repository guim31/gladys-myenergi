#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real myenergi cloud, read only, from a machine with network
// access (the development sessions have none):
//
//   node scripts/probe.mjs
//       Runs the real client with an invented account (serial 99999990,
//       a made-up key) until the cloud refuses it, and prints what each step
//       answered: the status codes, the digest challenge (scheme, realm,
//       qop, algorithm — never the nonce), whether the director named a
//       server, and the error kind the integration shows the user.
//
//   MYENERGI_SERIAL=... MYENERGI_API_KEY=... node scripts/probe.mjs
//       With a real account: also reads the status (no command is ever sent)
//       and prints the kinds of devices and the field names found, the
//       hourly history of one zappi or eddi, and what the integration would
//       publish. No serial number, key, name or address is printed.
// -----------------------------------------------------------------------------

import { DIRECTOR_HOST, MyenergiClient, fetchRequest } from '../src/myenergi/client.js';
import { parseChallenge } from '../src/myenergi/digest.js';
import { KINDS, PREFIXES, parseHistory, parseStatus, siteView } from '../src/myenergi/model.js';
import { dayKey, hoursIn, startOfDay } from '../src/clock.js';

const serial = process.env.MYENERGI_SERIAL || '99999990';
const apiKey = process.env.MYENERGI_API_KEY || 'probe-invented-key-0000';
const real = Boolean(process.env.MYENERGI_SERIAL && process.env.MYENERGI_API_KEY);

const line = (label, value) => console.log(`${label.padEnd(28)} ${value}`);

/** A transport that records what came back, without the secrets. */
const exchanges = [];
const request = async (url, options) => {
  const { host, pathname } = new URL(url);
  // Paths carry device serials: keep the command name only.
  const path = pathname.replace(/[ZEHL]?\d{4,}.*$/, '…');
  try {
    const response = await fetchRequest(url, options);
    const challenge = parseChallenge(
      Object.entries(response.headers).find(([k]) => k.toLowerCase() === 'www-authenticate')?.[1],
    );
    const asn = Object.entries(response.headers).find(
      ([k]) => k.toLowerCase() === 'x_myenergi-asn',
    );
    exchanges.push({
      host,
      path,
      sentAuthorization: Boolean(options.headers?.Authorization),
      status: response.status,
      challenge: challenge
        ? `Digest realm="${challenge.realm}" qop=${challenge.qop ?? '-'} algorithm=${challenge.algorithm ?? 'MD5'} opaque=${challenge.opaque !== undefined}`
        : '-',
      asn: asn ? asn[1] : '-',
      contentType: response.headers['content-type'] ?? '-',
      bodyLength: response.body.length,
    });
    return response;
  } catch (err) {
    exchanges.push({ host, path, error: `${err.name}: ${err.cause?.code ?? err.message}` });
    throw err;
  }
};

console.log(`myenergi probe — ${real ? 'real account (read only)' : 'invented account'}`);
console.log(`director: https://${DIRECTOR_HOST}`);
const client = new MyenergiClient({ serial, apiKey, request });

let status = null;
try {
  status = await client.getStatus();
  line('status read', 'yes');
} catch (err) {
  line('status read', `no — error kind "${err.kind}" (${err.message})`);
}

console.log('\nexchanges:');
for (const exchange of exchanges) {
  console.log(JSON.stringify(exchange));
}

if (status && real) {
  const { devices, firmware } = parseStatus(status);
  console.log('\naccount:');
  line('hub firmware', firmware ?? '-');
  line('devices', devices.map((d) => d.kind).join(', ') || 'none');
  for (const kind of Object.values(KINDS)) {
    const first = devices.find((d) => d.kind === kind);
    if (first) {
      line(`${kind} fields`, Object.keys(first.raw).sort().join(' '));
      line(
        `${kind} pst/sta/zmo/div`,
        [first.raw.pst, first.raw.sta, first.raw.zmo, first.raw.div].join(' / '),
      );
    }
  }
  line('site view', JSON.stringify(siteView(devices)));
  const target = devices.find((d) => d.kind === KINDS.ZAPPI || d.kind === KINDS.EDDI);
  if (target) {
    const day = dayKey(Date.now());
    const answer = await client.getHourlyHistory(
      PREFIXES[target.kind],
      target.serial,
      new Date(startOfDay(day)),
      hoursIn(day),
    );
    const rows = answer[`U${target.serial}`] ?? [];
    const keys = new Set(rows.flatMap((row) => Object.keys(row)));
    line(`${target.kind} history rows`, rows.length);
    line(`${target.kind} history keys`, [...keys].sort().join(' '));
    line(`${target.kind} energy today`, JSON.stringify(parseHistory(answer, target.serial)));
  }
  try {
    const names = await client.getNames();
    line('names answer', `${Object.keys(names).length} group(s)`);
  } catch (err) {
    line('names answer', `error kind "${err.kind}"`);
  }
}
