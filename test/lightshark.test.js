const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { LightSharkController } = require('../lib/lightshark');

function makeLogger() {
  const calls = { error: [], success: [], warn: [], info: [] };
  return {
    calls,
    error: (m) => calls.error.push(m),
    success: (m) => calls.success.push(m),
    warn: (m) => calls.warn.push(m),
    info: (m) => calls.info.push(m),
  };
}

describe('LightSharkController OSC-feleskalering', () => {
  const config = { ip: '1.2.3.4', oscPort: 8000, failureAlertAfter: 3 };

  it('loggar vanligt fel under tröskeln', () => {
    const logger = makeLogger();
    const ls = new LightSharkController(config, logger);
    ls._onSendError('EHOSTUNREACH');
    ls._onSendError('EHOSTUNREACH');
    assert.equal(ls.consecutiveFailures, 2);
    assert.equal(logger.calls.error.length, 2);
    assert.ok(logger.calls.error.every(m => !m.includes('svarar inte')));
  });

  it('eskalerar exakt vid tröskeln', () => {
    const logger = makeLogger();
    const ls = new LightSharkController(config, logger);
    ls._onSendError('e');
    ls._onSendError('e');
    ls._onSendError('e');
    assert.equal(ls.consecutiveFailures, 3);
    assert.ok(logger.calls.error.some(m => m.includes('svarar inte')));
  });

  it('loggar recovery och nollställer efter att ha varit nere', () => {
    const logger = makeLogger();
    const ls = new LightSharkController(config, logger);
    ls._onSendError('e');
    ls._onSendError('e');
    ls._onSendError('e');
    ls._onSendSuccess();
    assert.equal(ls.consecutiveFailures, 0);
    assert.ok(logger.calls.success.some(m => m.includes('svarar igen')));
  });

  it('loggar ingen recovery om den aldrig eskalerade', () => {
    const logger = makeLogger();
    const ls = new LightSharkController(config, logger);
    ls._onSendError('e');
    ls._onSendSuccess();
    assert.equal(ls.consecutiveFailures, 0);
    assert.equal(logger.calls.success.length, 0);
  });

  it('larmar notifiern vid tröskeln och recoverar vid återkomst', () => {
    const logger = makeLogger();
    const notifierCalls = { alert: [], recover: [] };
    const notifier = {
      alert: (k) => notifierCalls.alert.push(k),
      recover: (k) => notifierCalls.recover.push(k),
    };
    const ls = new LightSharkController(config, logger, notifier);
    ls._onSendError('e');
    ls._onSendError('e');
    assert.equal(notifierCalls.alert.length, 0, 'inget larm under tröskeln');
    ls._onSendError('e');
    assert.deepEqual(notifierCalls.alert, ['lightshark-down']);
    ls._onSendSuccess();
    assert.deepEqual(notifierCalls.recover, ['lightshark-down']);
  });
});
