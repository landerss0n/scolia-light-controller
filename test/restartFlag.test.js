const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { markRestart, consumeRestartFlag } = require('../lib/restartFlag');

const flagPath = path.join(os.tmpdir(), 'scolia-test-restart-flag');

afterEach(() => {
  try { fs.unlinkSync(flagPath); } catch { /* redan borta */ }
});

describe('restartFlag', () => {
  it('markRestart skapar filen, consumeRestartFlag returnerar true och raderar den', () => {
    assert.equal(markRestart(flagPath), true);
    assert.equal(fs.existsSync(flagPath), true);
    assert.equal(consumeRestartFlag(flagPath), true);
    assert.equal(fs.existsSync(flagPath), false);
  });

  it('consumeRestartFlag returnerar false när markören inte finns', () => {
    assert.equal(consumeRestartFlag(flagPath), false);
  });

  it('consumeRestartFlag är engångs — andra anropet ger false', () => {
    markRestart(flagPath);
    assert.equal(consumeRestartFlag(flagPath), true);
    assert.equal(consumeRestartFlag(flagPath), false);
  });
});
