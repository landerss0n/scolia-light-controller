const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSoundFile } = require('../lib/sound');

describe('resolveSoundFile', () => {
  describe('enstaka fil', () => {
    it('returnerar file + volume', () => {
      assert.deepStrictEqual(
        resolveSoundFile({ file: 'a.wav', volume: 2.0 }),
        { file: 'a.wav', volume: 2.0 },
      );
    });

    it('volume undefined bevaras (default sätts av anroparen)', () => {
      assert.deepStrictEqual(resolveSoundFile({ file: 'a.wav' }), { file: 'a.wav', volume: undefined });
    });
  });

  describe('flera filer (random)', () => {
    const cfg = { files: ['a.wav', 'b.wav', 'c.wav'], volume: 1.5 };

    it('väljer första vid rand≈0', () => {
      assert.equal(resolveSoundFile(cfg, () => 0).file, 'a.wav');
    });

    it('väljer mitten vid rand≈0.5', () => {
      assert.equal(resolveSoundFile(cfg, () => 0.5).file, 'b.wav');
    });

    it('väljer sista vid rand≈0.99', () => {
      assert.equal(resolveSoundFile(cfg, () => 0.99).file, 'c.wav');
    });

    it('sträng-entry ärver event-volym', () => {
      assert.deepStrictEqual(resolveSoundFile(cfg, () => 0), { file: 'a.wav', volume: 1.5 });
    });

    it('objekt-entry kan åsidosätta volym', () => {
      const c = { files: [{ file: 'loud.wav', volume: 0.5 }], volume: 2.0 };
      assert.deepStrictEqual(resolveSoundFile(c, () => 0), { file: 'loud.wav', volume: 0.5 });
    });

    it('objekt-entry utan volym ärver event-volym', () => {
      const c = { files: [{ file: 'x.wav' }], volume: 2.0 };
      assert.deepStrictEqual(resolveSoundFile(c, () => 0), { file: 'x.wav', volume: 2.0 });
    });
  });

  describe('edge cases', () => {
    it('null config → null', () => {
      assert.equal(resolveSoundFile(null), null);
    });

    it('tomt files-array faller tillbaka (inget file) → null', () => {
      assert.equal(resolveSoundFile({ files: [] }), null);
    });

    it('varken file eller files → null', () => {
      assert.equal(resolveSoundFile({ volume: 1.0 }), null);
    });

    it('files prioriteras över file', () => {
      assert.equal(resolveSoundFile({ file: 'old.wav', files: ['new.wav'] }, () => 0).file, 'new.wav');
    });
  });
});
