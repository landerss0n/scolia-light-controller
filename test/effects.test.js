const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveThrowEffect, applyExecutor } = require('../lib/effects');

// Bas-config för colorMode-tester
function colorConfig(overrides = {}) {
  return {
    noScoreExecutor: { page: 1, column: 8, row: 4 },
    colorMode: {
      enabled: true,
      redExecutor: { page: 1, column: 2, row: 1 },
      greenExecutor: { page: 1, column: 2, row: 2 },
      bullseyeExecutor: { page: 1, column: 6, row: 6 },
      redSegments: [20, 18, 13, 10, 2, 3, 7, 8, 14, 12],
      greenSegments: [1, 4, 6, 15, 17, 19, 16, 11, 9, 5],
      bull25: 'green',
      ...overrides,
    },
  };
}

describe('resolveThrowEffect', () => {
  describe('miss', () => {
    it('returns noScoreExecutor on miss', () => {
      const r = resolveThrowEffect(0, 0, 0, colorConfig());
      assert.deepStrictEqual(r.executor, { page: 1, column: 8, row: 4 });
    });

    it('returns null on miss when no noScoreExecutor configured', () => {
      const r = resolveThrowEffect(0, 0, 0, { colorMode: { enabled: true } });
      assert.equal(r, null);
    });
  });

  describe('bullseye / bull', () => {
    it('returns bullseyeExecutor for 50p', () => {
      const r = resolveThrowEffect(50, 2, 25, colorConfig());
      assert.deepStrictEqual(r.executor, { page: 1, column: 6, row: 6 });
    });

    it('falls back to redExecutor for 50p when no bullseyeExecutor', () => {
      const cfg = colorConfig();
      delete cfg.colorMode.bullseyeExecutor;
      const r = resolveThrowEffect(50, 2, 25, cfg);
      assert.deepStrictEqual(r.executor, { page: 1, column: 2, row: 1 });
    });

    it('returns greenExecutor for bull 25 when bull25=green', () => {
      const r = resolveThrowEffect(25, 1, 25, colorConfig({ bull25: 'green' }));
      assert.deepStrictEqual(r.executor, { page: 1, column: 2, row: 2 });
    });

    it('returns redExecutor for bull 25 when bull25=red', () => {
      const r = resolveThrowEffect(25, 1, 25, colorConfig({ bull25: 'red' }));
      assert.deepStrictEqual(r.executor, { page: 1, column: 2, row: 1 });
    });
  });

  describe('color segments', () => {
    it('triple on red segment → redExecutor', () => {
      const r = resolveThrowEffect(60, 3, 20, colorConfig());
      assert.deepStrictEqual(r.executor, { page: 1, column: 2, row: 1 });
    });

    it('double on red segment → redExecutor', () => {
      const r = resolveThrowEffect(40, 2, 20, colorConfig());
      assert.deepStrictEqual(r.executor, { page: 1, column: 2, row: 1 });
    });

    it('triple on green segment → greenExecutor', () => {
      const r = resolveThrowEffect(57, 3, 19, colorConfig());
      assert.deepStrictEqual(r.executor, { page: 1, column: 2, row: 2 });
    });

    it('double on green segment → greenExecutor', () => {
      const r = resolveThrowEffect(12, 2, 6, colorConfig());
      assert.deepStrictEqual(r.executor, { page: 1, column: 2, row: 2 });
    });
  });

  describe('singles', () => {
    it('single returns isSingle with null executor', () => {
      const r = resolveThrowEffect(20, 1, 20, colorConfig());
      assert.equal(r.executor, null);
      assert.equal(r.isSingle, true);
    });
  });

  describe('disco fallback (colorMode disabled)', () => {
    it('returns configured executor when colorMode off', () => {
      const r = resolveThrowEffect(60, 3, 20, { executor: { page: 1, column: 1, row: 1 } });
      assert.deepStrictEqual(r.executor, { page: 1, column: 1, row: 1 });
    });

    it('returns null when colorMode off and no executor', () => {
      assert.equal(resolveThrowEffect(60, 3, 20, {}), null);
    });
  });
});

describe('applyExecutor', () => {
  // Mock-lightshark som loggar alla triggerExecutor-anrop
  function mockLightshark() {
    const calls = [];
    return {
      calls,
      triggerExecutor(page, column, row) { calls.push({ page, column, row }); },
    };
  }
  const noop = () => {};

  it('triggers the executor when nothing was active before', () => {
    const ls = mockLightshark();
    const exec = { page: 1, column: 2, row: 1 };
    const last = applyExecutor(ls, exec, null, noop);
    assert.deepStrictEqual(ls.calls, [exec]);
    assert.deepStrictEqual(last, exec);
  });

  it('skips when the same executor is already active', () => {
    const ls = mockLightshark();
    const exec = { page: 1, column: 2, row: 1 };
    const last = applyExecutor(ls, exec, { ...exec }, noop);
    assert.deepStrictEqual(ls.calls, []);
    assert.deepStrictEqual(last, { ...exec });
  });

  it('turns off the previous executor then turns on the new one', () => {
    const ls = mockLightshark();
    const prev = { page: 1, column: 2, row: 1 };
    const next = { page: 1, column: 2, row: 2 };
    const last = applyExecutor(ls, next, prev, noop);
    assert.deepStrictEqual(ls.calls, [prev, next]);
    assert.deepStrictEqual(last, next);
  });

  it('does nothing when executor is null', () => {
    const ls = mockLightshark();
    const prev = { page: 1, column: 2, row: 1 };
    const last = applyExecutor(ls, null, prev, noop);
    assert.deepStrictEqual(ls.calls, []);
    assert.deepStrictEqual(last, prev);
  });

  it('does nothing when lightshark is null', () => {
    const prev = { page: 1, column: 2, row: 1 };
    const last = applyExecutor(null, { page: 1, column: 3, row: 3 }, prev, noop);
    assert.deepStrictEqual(last, prev);
  });
});
