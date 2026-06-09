// Beräknar fördröjning (ms) inför nästa återförsök med exponentiell backoff och
// ett tak, plus valfri jitter. Ren funktion — `rand` injiceras för testbarhet.
// Används av WebSocket-reconnect (index.js) och Playwright-restart (playwright.js)
// så att upprepade fel inte hamrar var X:e sekund i all evighet.
//
//   attempt    – 1 för första återförsöket, 2 för andra, ...
//   opts.baseMs  – fördröjning vid attempt 1 (default 1000)
//   opts.maxMs   – tak (default 60000)
//   opts.factor  – multiplikator per försök (default 2)
//   opts.jitterMs – max slumpmässigt tillägg ovanpå fördröjningen (default 0)
function nextBackoffDelay(attempt, opts = {}, rand = Math.random) {
  const { baseMs = 1000, maxMs = 60000, factor = 2, jitterMs = 0 } = opts;
  const n = Math.max(1, attempt);
  const exp = baseMs * Math.pow(factor, n - 1);
  const capped = Math.min(exp, maxMs);
  const jitter = jitterMs > 0 ? Math.floor(rand() * jitterMs) : 0;
  return capped + jitter;
}

module.exports = { nextBackoffDelay };
