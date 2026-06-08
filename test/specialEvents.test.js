const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detectSpecialEvent } = require('../lib/specialEvents');

// Config med alla events aktiverade
function fullConfig() {
  const names = [
    '180', '120', 'one_two_three', 'three_two_one', 'three_ones', 'one_one_two', 'nine_one_one',
    'twenty_one', 'three_hundred', 'four_oh_four', 'twenty_three', 'ninety_nine',
    'eighteen_eighty_eight', 'nineteen_oh_four', 'six_seven', 'three_sixes',
    'three_twenties', 'sixty_nine', 'triple_seven', 'thirteen_thirty_seven', 'four_twenty',
    'double_oh_seven', 'last_chance', 'low_score',
    'fifty_one', 'five_hundred', 'two_oh_one', 'nineteen_ninety_eight',
    'nineteen_ninety_four', 'ten_five_six', 'thirty_three', 'fifteen', 'triple_one',
  ];
  const special_events = {};
  for (const n of names) special_events[n] = { enabled: true };
  special_events['180'].lightshark_executors = [
    { page: 1, column: 6, row: 2 },
    { page: 1, column: 7, row: 2 },
  ];
  return { special_events };
}

// Kast-helper: segment + multiplier → { segment, multiplier, points }
function thr(segment, multiplier) {
  return { segment, multiplier, points: segment * multiplier };
}
const miss = () => ({ segment: 0, multiplier: 0, points: 0 });

describe('detectSpecialEvent', () => {
  describe('inget event', () => {
    it('returnerar null för tom historik', () => {
      assert.equal(detectSpecialEvent([], fullConfig()), null);
    });

    it('returnerar null för ett vanligt kast', () => {
      assert.equal(detectSpecialEvent([thr(20, 1)], fullConfig()), null);
    });

    it('returnerar null för tre vanliga kast utan match', () => {
      const h = [thr(20, 1), thr(19, 1), thr(18, 1)]; // 57p, inget event
      assert.equal(detectSpecialEvent(h, fullConfig()), null);
    });
  });

  describe('180', () => {
    it('triggar på tre T20', () => {
      const h = [thr(20, 3), thr(20, 3), thr(20, 3)];
      const r = detectSpecialEvent(h, fullConfig());
      assert.equal(r.sound, '180');
      assert.equal(r.log.level, 'success');
      assert.deepStrictEqual(r.executors, [
        { page: 1, column: 6, row: 2 },
        { page: 1, column: 7, row: 2 },
      ]);
    });

    it('triggar inte två gånger för samma kast (sentinel)', () => {
      // Isolera 180: stäng av övriga events så att inget annat fångar de tre T20
      // vid det andra anropet (annars matchar t.ex. 120 de två sista).
      const cfg = { special_events: { '180': { enabled: true } } };
      const h = [thr(20, 3), thr(20, 3), thr(20, 3)];
      assert.equal(detectSpecialEvent(h, cfg).sound, '180');
      assert.equal(detectSpecialEvent(h, cfg), null);
    });

    it('har prioritet över 120 (kollas först)', () => {
      const h = [thr(20, 3), thr(20, 3), thr(20, 3)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, '180');
    });

    it('triggar inte när disabled', () => {
      const cfg = fullConfig();
      cfg.special_events['180'].enabled = false;
      cfg.special_events['120'].enabled = false; // annars fångar 120 de två sista T20
      const h = [thr(20, 3), thr(20, 3), thr(20, 3)];
      assert.equal(detectSpecialEvent(h, cfg), null);
    });

    it('faller tillbaka till singular lightshark_executor', () => {
      const cfg = fullConfig();
      delete cfg.special_events['180'].lightshark_executors;
      cfg.special_events['180'].lightshark_executor = { page: 1, column: 5, row: 5 };
      const h = [thr(20, 3), thr(20, 3), thr(20, 3)];
      assert.deepStrictEqual(detectSpecialEvent(h, cfg).executors, [{ page: 1, column: 5, row: 5 }]);
    });
  });

  describe('120 (2x T20)', () => {
    it('triggar på två T20 i rad', () => {
      const h = [thr(20, 3), thr(20, 3)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, '120');
    });
  });

  describe('sekvens-events', () => {
    it('1-2-3', () => {
      const h = [thr(1, 1), thr(2, 1), thr(3, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'one_two_three');
    });

    it('3-2-1 (s3 s2 s1) → three_two_one', () => {
      const h = [thr(3, 1), thr(2, 1), thr(1, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'three_two_one');
    });

    it('three_ones (s1 s1 s1)', () => {
      const h = [thr(1, 1), thr(1, 1), thr(1, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'three_ones');
    });

    it('911 (s9 s1 s1)', () => {
      const h = [thr(9, 1), thr(1, 1), thr(1, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'nine_one_one');
    });

    it('1888 (s18 s8 s8)', () => {
      const h = [thr(18, 1), thr(8, 1), thr(8, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'eighteen_eighty_eight');
    });

    it('1904 (s19 miss s4)', () => {
      const h = [thr(19, 1), miss(), thr(4, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'nineteen_oh_four');
    });

    it('404 (s4 miss s4)', () => {
      const h = [thr(4, 1), miss(), thr(4, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'four_oh_four');
    });

    it('1337 (13p 3p 7p)', () => {
      const h = [thr(13, 1), thr(3, 1), thr(7, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'thirteen_thirty_seven');
    });

    it('007 (miss miss s7)', () => {
      const h = [miss(), miss(), thr(7, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'double_oh_seven');
    });

    it('666 (tre 6-poängskast)', () => {
      const h = [thr(6, 1), thr(6, 1), thr(6, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'three_sixes');
    });

    it('7-7-7 (tre singel 7)', () => {
      const h = [thr(7, 1), thr(7, 1), thr(7, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'triple_seven');
    });

    it('three_twenties (tre singel 20)', () => {
      const h = [thr(20, 1), thr(20, 1), thr(20, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'three_twenties');
    });

    it('three_twenties triggar INTE på tre T20 (måste vara singlar)', () => {
      const h = [thr(20, 3), thr(20, 3), thr(20, 3)];
      assert.notEqual(detectSpecialEvent(h, fullConfig())?.sound, 'three_twenties');
    });
  });

  describe('två-kast-events', () => {
    it('69 (6p följt av 9p)', () => {
      const h = [thr(6, 1), thr(9, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'sixty_nine');
    });

    it('420 (4p följt av 20p)', () => {
      const h = [thr(4, 1), thr(20, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'four_twenty');
    });

    it('67 (s6 följt av s7)', () => {
      const h = [thr(6, 1), thr(7, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'six_seven');
    });

    it('99 (2x singel 9)', () => {
      const h = [thr(9, 1), thr(9, 1)];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'ninety_nine');
    });
  });

  describe('miss-events', () => {
    it('tre missar i rad → three_misses (warn)', () => {
      const h = [miss(), miss(), miss()];
      const r = detectSpecialEvent(h, fullConfig());
      assert.equal(r.sound, 'three_misses');
      assert.equal(r.log.level, 'warn');
    });

    it('three_misses triggar inte igen på fjärde missen (sentinel)', () => {
      // Stäng av low_score, annars fångar den fjärde missen (totalsumma 0 < 10).
      const cfg = fullConfig();
      cfg.special_events.low_score.enabled = false;
      const h = [miss(), miss(), miss()];
      assert.equal(detectSpecialEvent(h, cfg).sound, 'three_misses');
      h.push(miss()); // fjärde miss
      assert.equal(detectSpecialEvent(h, cfg), null);
    });

    it('last_chance: två missar (exakt 2 kast i historiken)', () => {
      const h = [miss(), miss()];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'last_chance');
    });
  });

  describe('nya nummer-events', () => {
    it('51 (s5 s1)', () => {
      assert.equal(detectSpecialEvent([thr(5, 1), thr(1, 1)], fullConfig()).sound, 'fifty_one');
    });

    it('15 (s1 s5)', () => {
      assert.equal(detectSpecialEvent([thr(1, 1), thr(5, 1)], fullConfig()).sound, 'fifteen');
    });

    it('33 via sekvens (s3 s3)', () => {
      assert.equal(detectSpecialEvent([thr(3, 1), thr(3, 1)], fullConfig()).sound, 'thirty_three');
    });

    it('33 via total 33p (t11 + miss + ... summa 33)', () => {
      // t11=33 ensamt räcker inte (1 kast). Bygg 33 på tre kast utan s3-sekvens.
      const h = [thr(20, 1), thr(10, 1), thr(3, 1)]; // 20+10+3 = 33
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'thirty_three');
    });

    it('500 (s5 miss miss) vinner över low_score', () => {
      const h = [thr(5, 1), miss(), miss()];
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'five_hundred');
    });

    it('201 (s20 miss s1) vinner över total-21', () => {
      const h = [thr(20, 1), miss(), thr(1, 1)]; // summa 21
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'two_oh_one');
    });

    it('1998 (s19 s9 s8)', () => {
      assert.equal(detectSpecialEvent([thr(19, 1), thr(9, 1), thr(8, 1)], fullConfig()).sound, 'nineteen_ninety_eight');
    });

    it('1994 (s19 s9 s4)', () => {
      assert.equal(detectSpecialEvent([thr(19, 1), thr(9, 1), thr(4, 1)], fullConfig()).sound, 'nineteen_ninety_four');
    });

    it('105.6 (s10 s5 s6) vinner över total-21', () => {
      const h = [thr(10, 1), thr(5, 1), thr(6, 1)]; // summa 21
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'ten_five_six');
    });

    it('triple_one (t1)', () => {
      assert.equal(detectSpecialEvent([thr(1, 3)], fullConfig()).sound, 'triple_one');
    });

    it('triple_one triggar inte på singel 1', () => {
      assert.notEqual(detectSpecialEvent([thr(1, 1)], fullConfig())?.sound, 'triple_one');
    });
  });

  describe('total-score events (lägre prioritet)', () => {
    it('total 123 utan 1-2-3-sekvens', () => {
      const cfg = fullConfig();
      cfg.special_events['120'].enabled = false; // annars fångar 120 de två T20
      const h = [thr(20, 3), thr(20, 3), thr(3, 1)]; // 60+60+3 = 123
      const r = detectSpecialEvent(h, cfg);
      assert.equal(r.sound, 'one_two_three');
    });

    it('low_score: under 10p på tre kast', () => {
      const h = [thr(2, 1), thr(2, 1), thr(2, 1)]; // 6p totalt
      assert.equal(detectSpecialEvent(h, fullConfig()).sound, 'low_score');
    });
  });

  describe('mutation', () => {
    it('muterar inte historik när inget event matchar', () => {
      const h = [thr(20, 1), thr(19, 1), thr(18, 1)];
      const snapshot = JSON.parse(JSON.stringify(h));
      detectSpecialEvent(h, fullConfig());
      assert.deepStrictEqual(h, snapshot);
    });
  });
});
