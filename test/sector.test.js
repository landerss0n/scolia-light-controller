const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSector } = require('../lib/sector');

describe('parseSector', () => {
  describe('singles', () => {
    it('parses s20', () => {
      assert.deepStrictEqual(parseSector('s20'), { points: 20, multiplier: 1, segment: 20 });
    });

    it('parses s1', () => {
      assert.deepStrictEqual(parseSector('s1'), { points: 1, multiplier: 1, segment: 1 });
    });

    it('parses s14 (case insensitive)', () => {
      assert.deepStrictEqual(parseSector('S14'), { points: 14, multiplier: 1, segment: 14 });
    });
  });

  describe('doubles', () => {
    it('parses d20', () => {
      assert.deepStrictEqual(parseSector('d20'), { points: 40, multiplier: 2, segment: 20 });
    });

    it('parses d16', () => {
      assert.deepStrictEqual(parseSector('d16'), { points: 32, multiplier: 2, segment: 16 });
    });

    it('parses D3 (case insensitive)', () => {
      assert.deepStrictEqual(parseSector('D3'), { points: 6, multiplier: 2, segment: 3 });
    });
  });

  describe('triples', () => {
    it('parses t20', () => {
      assert.deepStrictEqual(parseSector('t20'), { points: 60, multiplier: 3, segment: 20 });
    });

    it('parses t19', () => {
      assert.deepStrictEqual(parseSector('t19'), { points: 57, multiplier: 3, segment: 19 });
    });

    it('parses T1 (case insensitive)', () => {
      assert.deepStrictEqual(parseSector('T1'), { points: 3, multiplier: 3, segment: 1 });
    });
  });

  describe('bull', () => {
    it('parses "Bull" as 25p (outer bull default)', () => {
      assert.deepStrictEqual(parseSector('Bull'), { points: 25, multiplier: 1, segment: 25 });
    });

    it('parses "bull" lowercase', () => {
      assert.deepStrictEqual(parseSector('bull'), { points: 25, multiplier: 1, segment: 25 });
    });

    it('parses "25"', () => {
      assert.deepStrictEqual(parseSector('25'), { points: 25, multiplier: 1, segment: 25 });
    });

    it('parses "50"', () => {
      assert.deepStrictEqual(parseSector('50'), { points: 25, multiplier: 1, segment: 25 });
    });
  });

  describe('miss', () => {
    it('parses "None"', () => {
      assert.deepStrictEqual(parseSector('None'), { points: 0, multiplier: 0, segment: 0 });
    });

    it('parses "miss"', () => {
      assert.deepStrictEqual(parseSector('miss'), { points: 0, multiplier: 0, segment: 0 });
    });

    it('parses "0"', () => {
      assert.deepStrictEqual(parseSector('0'), { points: 0, multiplier: 0, segment: 0 });
    });
  });

  describe('edge cases', () => {
    it('returns zero for null', () => {
      assert.deepStrictEqual(parseSector(null), { points: 0, multiplier: 0, segment: 0 });
    });

    it('returns zero for undefined', () => {
      assert.deepStrictEqual(parseSector(undefined), { points: 0, multiplier: 0, segment: 0 });
    });

    it('returns zero for empty string', () => {
      assert.deepStrictEqual(parseSector(''), { points: 0, multiplier: 0, segment: 0 });
    });

    it('returns zero for unrecognized input', () => {
      assert.deepStrictEqual(parseSector('xyz'), { points: 0, multiplier: 0, segment: 0 });
    });

    it('returns zero for partial match like "s"', () => {
      assert.deepStrictEqual(parseSector('s'), { points: 0, multiplier: 0, segment: 0 });
    });
  });
});
