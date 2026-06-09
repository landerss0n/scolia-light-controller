const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { nextBackoffDelay } = require('../lib/backoff');

describe('nextBackoffDelay', () => {
  const opts = { baseMs: 1000, maxMs: 30000, factor: 2 };

  it('returnerar baseMs för första försöket', () => {
    assert.equal(nextBackoffDelay(1, opts), 1000);
  });

  it('växer exponentiellt per försök', () => {
    assert.equal(nextBackoffDelay(2, opts), 2000);
    assert.equal(nextBackoffDelay(3, opts), 4000);
    assert.equal(nextBackoffDelay(4, opts), 8000);
  });

  it('kapas vid maxMs', () => {
    assert.equal(nextBackoffDelay(10, opts), 30000);
    assert.equal(nextBackoffDelay(100, opts), 30000);
  });

  it('behandlar attempt <= 0 som första försöket', () => {
    assert.equal(nextBackoffDelay(0, opts), 1000);
    assert.equal(nextBackoffDelay(-5, opts), 1000);
  });

  it('lägger till jitter via injicerad rand', () => {
    // rand=0.5, jitterMs=2000 → +1000
    assert.equal(nextBackoffDelay(1, { ...opts, jitterMs: 2000 }, () => 0.5), 2000);
    // rand=0 → ingen jitter
    assert.equal(nextBackoffDelay(1, { ...opts, jitterMs: 2000 }, () => 0), 1000);
  });

  it('använder default factor 2 och rimliga defaults', () => {
    assert.equal(nextBackoffDelay(1, { baseMs: 500, maxMs: 10000 }), 500);
    assert.equal(nextBackoffDelay(2, { baseMs: 500, maxMs: 10000 }), 1000);
  });
});
