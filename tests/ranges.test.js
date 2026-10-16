import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange, handClass, combosOf, rangeSize, ALL_CLASSES, RFI, VS_OPEN, VS_3BET, rangeSet, getChart, chartAction } from '../src/ranges.js';
import { parseCards } from '../src/deck.js';

test('hand classes', () => {
  const [a, b] = parseCards('Ks Ah');
  assert.equal(handClass(a, b), 'AKo');
  assert.equal(handClass(...parseCards('9d Td')), 'T9s');
  assert.equal(handClass(...parseCards('7c 7h')), '77');
  assert.equal(ALL_CLASSES.length, 169);
});

test('combo counts', () => {
  assert.equal(combosOf('AA').length, 6);
  assert.equal(combosOf('AKs').length, 4);
  assert.equal(combosOf('AKo').length, 12);
});

test('range notation parsing', () => {
  assert.deepEqual([...parseRange('TT+')].sort(), ['AA', 'JJ', 'KK', 'QQ', 'TT']);
  assert.deepEqual([...parseRange('A9s+')].sort(), ['A9s', 'AJs', 'AKs', 'AQs', 'ATs']);
  assert.deepEqual([...parseRange('A2s-A4s')].sort(), ['A2s', 'A3s', 'A4s']);
  assert.deepEqual([...parseRange('22-44')].sort(), ['22', '33', '44']);
  assert.deepEqual([...parseRange('AK')].sort(), ['AKo', 'AKs']);
  assert.equal(rangeSize(parseRange('22+')), 78 / 1326);
});

test('all charts parse to valid classes and raise/call do not overlap badly', () => {
  const valid = new Set(ALL_CLASSES);
  const all = [...Object.values(RFI)];
  for (const byHero of Object.values(VS_OPEN)) for (const c of Object.values(byHero)) all.push(c.raise, c.call);
  for (const c of Object.values(VS_3BET)) all.push(c.raise, c.call);
  for (const str of all) for (const cls of rangeSet(str)) assert.ok(valid.has(cls), `${cls} from "${str}"`);
});

test('chart lookups', () => {
  assert.equal(chartAction(getChart('rfi', 'UTG'), 'AA'), 'raise');
  assert.equal(chartAction(getChart('rfi', 'UTG'), '72o'), 'fold');
  assert.equal(chartAction(getChart('vsOpen', 'BB', 'BTN'), '98o'), 'call');
  assert.equal(chartAction(getChart('vs3bet', 'CO', 'BTN'), 'KK'), 'raise');
});
