const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SlackCommandListener, matchesCommand } = require('../lib/slackCommands');

describe('matchesCommand', () => {
  it('matchar exakt kommando', () => {
    assert.equal(matchesCommand('!restart', '!restart'), true);
  });

  it('är okänslig för whitespace och versaler', () => {
    assert.equal(matchesCommand('  !restart  ', '!restart'), true);
    assert.equal(matchesCommand('!RESTART', '!restart'), true);
  });

  it('matchar inte text runt kommandot', () => {
    assert.equal(matchesCommand('vi borde !restart sen', '!restart'), false);
    assert.equal(matchesCommand('!restart nu', '!restart'), false);
    assert.equal(matchesCommand('restart', '!restart'), false);
  });

  it('hanterar tomt/ogiltigt', () => {
    assert.equal(matchesCommand('', '!restart'), false);
    assert.equal(matchesCommand(null, '!restart'), false);
    assert.equal(matchesCommand(undefined, '!restart'), false);
  });
});

describe('SlackCommandListener.shouldHandleRestart', () => {
  function makeListener(now) {
    return new SlackCommandListener(
      { command: '!restart', debounceMs: 30000 },
      { info: () => {}, warn: () => {}, success: () => {} },
      { now },
    );
  }

  it('accepterar första matchande kommandot', () => {
    const l = makeListener(() => 1000);
    assert.equal(l.shouldHandleRestart('!restart'), true);
  });

  it('avvisar icke-matchande text', () => {
    const l = makeListener(() => 1000);
    assert.equal(l.shouldHandleRestart('hej'), false);
  });

  it('debouncar upprepade kommandon inom fönstret', () => {
    let t = 1000;
    const l = makeListener(() => t);
    assert.equal(l.shouldHandleRestart('!restart'), true);
    t = 5000; // 4s senare
    assert.equal(l.shouldHandleRestart('!restart'), false);
  });

  it('släpper igenom efter att debounce-fönstret passerat', () => {
    let t = 1000;
    const l = makeListener(() => t);
    assert.equal(l.shouldHandleRestart('!restart'), true);
    t = 1000 + 30001; // strax efter fönstret
    assert.equal(l.shouldHandleRestart('!restart'), true);
  });
});
