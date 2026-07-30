import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../pokemon_helper.html', import.meta.url), 'utf8');

function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.notEqual(from, -1, `Missing start marker: ${start}`);
  assert.notEqual(to, -1, `Missing end marker: ${end}`);
  return html.slice(from, to);
}

const parsingSource = between(
  'const stopWords = new Set([',
  '//  CARD SEARCH'
);
const scoringSource = between(
  'function scoreCardMatch(',
  'function canvasFingerprint('
);
const priceSource = between(
  'function getPriceRange(',
  'function getPriceCategory('
);

const context = {
  knownPokemonNames: new Set([
    'charizard', 'pikachu', 'victini', 'mr-mime', 'professors-research'
  ])
};
vm.createContext(context);
vm.runInContext(
  `${parsingSource}\n${scoringSource}\n${priceSource}\n` +
  'globalThis.parseOCRText = parseOCRText;' +
  'globalThis.scoreCardMatch = scoreCardMatch;' +
  'globalThis.getPriceRange = getPriceRange;',
  context
);

test('HP, damage and years are not treated as collector numbers', () => {
  const parsed = context.parseOCRText(
    'BASIC Pikachu HP 60\nThunder Jolt 30\n©2023 Pokémon'
  );
  assert.deepEqual(Array.from(parsed.numberMatches), []);
});

test('a printed collector fraction is reliable evidence', () => {
  const parsed = context.parseOCRText(
    'STAGE 2 Charizard HP 120\nFire Spin 100\n4/102'
  );
  assert.equal(parsed.numberMatches[0].number, '4');
  assert.equal(parsed.numberMatches[0].total, '102');
  assert.equal(parsed.numberMatches[0].reliable, true);
  assert.ok(parsed.detectedPokemonNames.includes('charizard'));
});

test('known promo prefixes work without accepting arbitrary letter-number text', () => {
  const parsed = context.parseOCRText(
    'BASIC Pikachu V HP 190\nSWSH061\nBASIC 74'
  );
  assert.equal(parsed.numberMatches.length, 1);
  assert.equal(parsed.numberMatches[0].number, 'swsh061');
});

test('trainer names are extracted even though they are not Pokémon species', () => {
  const parsed = context.parseOCRText(
    "TRAINER\nProfessor's Research\nDiscard your hand and draw 7 cards\n178/198"
  );
  assert.ok(parsed.nameCandidates.includes('professors research'));
});

test('an exact number and set total outrank an unrelated same-number card', () => {
  const parsed = context.parseOCRText('Charizard\n4/102');
  const exact = context.scoreCardMatch({
    name: 'Charizard',
    number: '4',
    set: { name: 'Base', printedTotal: 102 }
  }, parsed, 'charizard 4/102');
  const unrelated = context.scoreCardMatch({
    name: 'Pikachu',
    number: '4',
    set: { name: 'Another Set', printedTotal: 165 }
  }, parsed, 'charizard 4/102');
  assert.ok(exact >= unrelated + 100);
});

test('the displayed price range always contains the saved average price', () => {
  const range = context.getPriceRange({
    cardmarket: {
      prices: {
        lowPrice: 7.5,
        trendPrice: 44.6,
        averageSellPrice: 57.5
      }
    }
  });
  assert.ok(range.low <= range.mid);
  assert.ok(range.mid <= range.high);
});
