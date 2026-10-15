// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names and option labels, and the four documentation
// files, with the same sections. German says "du", never the polite "Sie".
// (From guim31/gladys-wled and guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import {
  ACTION_TEXT,
  CLAMP_TYPES,
  CONNECTION_TEXT,
  DEVICE_NAMES,
  EDDI_STATUS_LABELS,
  ERROR_TEXT,
  INIT_FAILED,
  LIBBI_STATUS_LABELS,
  NAMES,
  REPORT_TEXT,
  ZAPPI_MODE_LABELS,
  clampName,
} from '../src/texts.js';
import { EDDI_STATUSES, LIBBI_STATUSES, ZAPPI_MODES } from '../src/myenergi/model.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  sectionDescription: 1000,
  message: 200,
  short: 24,
  featureName: 40,
  option: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key, parent) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key, parent));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : key === 'description' && parent?.type === 'section'
              ? MAX.sectionDescription
              : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child, value);
    }
  };
  walk(root, 'manifest', null, null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  for (const table of [NAMES, CLAMP_TYPES, DEVICE_NAMES, ZAPPI_MODE_LABELS, REPORT_TEXT]) {
    assert.deepEqual(Object.keys(table), LANGS);
  }
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 55, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the catalog name is the brand, the description holds 10 characters at least', () => {
  assert.equal(typeof manifest.name, 'string');
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

/** Render a message (a function in the tables) with sample arguments. */
const render = (value) =>
  typeof value === 'function' ? value('Garage zappi', 'Eco+', '07:30') : value;

test('every message table of the code has the four languages', () => {
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...Object.entries(CONNECTION_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECTION_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(ERROR_TEXT).flatMap(([key, value]) =>
      problems(value, `ERROR_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(ACTION_TEXT).flatMap(([key, value]) =>
      problems(
        Object.fromEntries(Object.entries(value).map(([lang, text]) => [lang, render(text)])),
        `ACTION_TEXT.${key}`,
        MAX.message,
      ),
    ),
  ];
  assert.deepEqual(found, []);
});

test('the widget texts have the four languages, the button labels fit', () => {
  const long = new Set(['notConfigured', 'reading', 'stale', 'oldCore', 'readyByField']);
  const buttons = new Set(['zappiBoost', 'eddiBoost', 'stopBoost']);
  const found = Object.entries(TEXT).flatMap(([key, value]) =>
    problems(value, `TEXT.${key}`, long.has(key) ? MAX.message : buttons.has(key) ? 24 : 40),
  );
  assert.deepEqual(found, []);
});

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, keys = Object.keys(table.en)) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(keys))) {
      found.push(`${name}.${lang} does not have the expected keys`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the feature names, option labels and clamp types exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  assert.deepEqual(tableProblems(DEVICE_NAMES, 'DEVICE_NAMES', MAX.featureName), []);
  assert.deepEqual(
    tableProblems(ZAPPI_MODE_LABELS, 'ZAPPI_MODE_LABELS', MAX.option, Object.keys(ZAPPI_MODES)),
    [],
  );
  assert.deepEqual(
    tableProblems(EDDI_STATUS_LABELS, 'EDDI_STATUS_LABELS', MAX.option, EDDI_STATUSES),
    [],
  );
  assert.deepEqual(
    tableProblems(LIBBI_STATUS_LABELS, 'LIBBI_STATUS_LABELS', MAX.option, LIBBI_STATUSES),
    [],
  );
  assert.deepEqual(tableProblems(CLAMP_TYPES, 'CLAMP_TYPES', MAX.option), []);
  for (const lang of LANGS) {
    for (const type of Object.keys(CLAMP_TYPES.en)) {
      const name = clampName(6, type, lang);
      assert.ok(name.length <= MAX.featureName, `${lang}: ${name}`);
    }
  }
  assert.equal(clampName(2, 'Grid', 'fr'), 'Pince 2 (réseau)');
  assert.equal(clampName(3, 'Solar Thermal', 'de'), 'Zange 3 (Solar Thermal)');
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of [
    'Wählen Sie',
    'Ihr Gerät',
    'Ihre IP',
    'mit Ihrem',
    'Ihren',
    'Ihrer',
    'Ihres',
  ]) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  // Words that only contain the letters stay allowed.
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[1].fields[2].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[1].fields[2].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 10);
});

test('a missing section is caught', () => {
  const shorter = docs.fr.replace(/\n## [^\n]+\n/, '\n');
  assert.notDeepEqual(headings(shorter), headings(docs.en));
});

test('the documentation names every trigger, action, widget button and feature', () => {
  for (const lang of LANGS) {
    const doc = docs[lang];
    for (const item of [
      ...manifest.scene_triggers,
      ...manifest.scene_actions,
      ...manifest.actions,
    ]) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: "${item.label[lang]}"`);
    }
    for (const key of ['zappiBoost', 'eddiBoost', 'stopBoost']) {
      assert.ok(doc.includes(TEXT[key][lang]), `docs/${lang}.md: "${TEXT[key][lang]}"`);
    }
    for (const name of new Set(Object.values(NAMES[lang]))) {
      assert.ok(doc.includes(name), `docs/${lang}.md: feature "${name}"`);
    }
  }
});

test('the German documentation says "du"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
});

test('the documentation says it was developed without the hardware', () => {
  assert.match(docs.en, /Developed without the hardware: feedback welcome/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /github\.com\/guim31\/gladys-myenergi\/issues/);
    assert.match(docs[lang], /myenergi/);
  }
});
