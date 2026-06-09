const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SlackNotifier } = require('../lib/notifier');

function makeFetch(impl) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (impl) return impl(url, opts);
    return { ok: true, status: 200 };
  };
  fn.calls = calls;
  return fn;
}

const quietLogger = { warn: () => {}, info: () => {}, error: () => {} };
const baseConfig = { enabled: true, slackWebhookUrl: 'http://hook.test', label: 'Test' };

describe('SlackNotifier', () => {
  it('skickar ett larm och dedupar upprepade larm med samma key', async () => {
    const fetchFn = makeFetch();
    const n = new SlackNotifier(baseConfig, quietLogger, fetchFn);

    await n.alert('scolia-down', 'Scolia nere');
    await n.alert('scolia-down', 'Scolia nere igen');

    assert.equal(fetchFn.calls.length, 1, 'andra larmet ska inte skickas');
  });

  it('recover skickar och rensar incidenten så nästa larm går igenom igen', async () => {
    const fetchFn = makeFetch();
    const n = new SlackNotifier(baseConfig, quietLogger, fetchFn);

    await n.alert('scolia-down', 'nere');
    await n.recover('scolia-down', 'online igen');
    await n.alert('scolia-down', 'nere igen');

    assert.equal(fetchFn.calls.length, 3);
  });

  it('recover utan aktiv incident är tyst', async () => {
    const fetchFn = makeFetch();
    const n = new SlackNotifier(baseConfig, quietLogger, fetchFn);

    await n.recover('aldrig-aktiv', 'ok');

    assert.equal(fetchFn.calls.length, 0);
  });

  it('skickar inget när disabled', async () => {
    const fetchFn = makeFetch();
    const n = new SlackNotifier({ ...baseConfig, enabled: false }, quietLogger, fetchFn);

    await n.alert('x', 'fel');
    await n.recover('x', 'ok');

    assert.equal(fetchFn.calls.length, 0);
  });

  it('skickar inget när webhook-URL saknas', async () => {
    const fetchFn = makeFetch();
    const n = new SlackNotifier({ enabled: true, label: 'Test' }, quietLogger, fetchFn);

    await n.alert('x', 'fel');

    assert.equal(fetchFn.calls.length, 0);
  });

  it('inkluderar label i meddelandet', async () => {
    const fetchFn = makeFetch();
    const n = new SlackNotifier(baseConfig, quietLogger, fetchFn);

    await n.alert('x', 'något hände');

    assert.ok(fetchFn.calls[0].body.text.includes('Test'));
    assert.ok(fetchFn.calls[0].body.text.includes('något hände'));
  });

  it('kastar inte om transporten failar', async () => {
    const fetchFn = makeFetch(() => { throw new Error('network down'); });
    const n = new SlackNotifier(baseConfig, quietLogger, fetchFn);

    const result = await n.alert('x', 'fel');
    assert.equal(result, false);
  });
});
