#!/usr/bin/env node

const crypto = require('crypto');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { LightSharkController } = require('./lib/lightshark');
const { SoundController } = require('./lib/sound');
const { KnxController } = require('./lib/knx');
const { PlaywrightController } = require('./lib/playwright');
const { Logger } = require('./lib/logger');
const { parseSector } = require('./lib/sector');
const { resolveThrowEffect, applyExecutor } = require('./lib/effects');
const { detectSpecialEvent } = require('./lib/specialEvents');
const { nextBackoffDelay } = require('./lib/backoff');
const { SlackNotifier } = require('./lib/notifier');
const { SlackCommandListener } = require('./lib/slackCommands');
const { markRestart, consumeRestartFlag } = require('./lib/restartFlag');

// Markörfil för Slack-begärd omstart — sätts innan exit, läses vid uppstart
// för att bekräfta "uppe igen" (utan att spamma vid pm2-/cron-/watchdog-omstart).
const RESTART_FLAG = path.join(__dirname, '.restart-flag');

// Ladda konfiguration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// Initiera komponenter
const logger = new Logger(config.logging);
// Notifier skapas alltid — disabled/utan webhook blir den en no-op, så alla
// anropsställen kan kalla alert/recover utan att kolla om den finns.
const notifier = new SlackNotifier(config.notifications || {}, logger);
// Slack-kommandolyssnare (Socket Mode). Just nu bara !restart → process.exit(0),
// pm2 startar om appen. Skapas alltid; disabled/utan appToken blir en no-op.
const slackCommands = new SlackCommandListener(
  config.notifications?.socketMode || {},
  logger,
  {
    reply: (msg) => notifier.send(msg),
    onRestart: () => {
      logger.warn('♻️  Omstart begärd via Slack — avslutar (pm2 startar om)');
      markRestart(RESTART_FLAG); // bekräftas vid nästa uppstart
      process.exit(0);
    },
  },
);
const lightshark = config.lightshark.enabled ? new LightSharkController(config.lightshark, logger, notifier) : null;
const sound = config.sound?.enabled ? new SoundController(config.sound, logger) : null;
const knxController = config.knx?.enabled ? new KnxController(config.knx, logger) : null;
const playwrightController = config.playwright?.enabled ? new PlaywrightController(config.playwright, logger, notifier) : null;
let knxLightsOff = false; // Spårar om KNX-lampor är släckta (från miss)

let ws = null;
let reconnectTimeout = null;
let reconnectAttempts = 0; // Räknare för exponentiell backoff vid reconnect
let throwHistory = [];
let lastTriggeredExecutor = null; // Spara senaste executor för att kunna släcka vid takeout
let lastSpecialExecutors = []; // Spårar 180-executors för att kunna toggla av vid takeout
let strobeTimer = null; // Timer för T20-strobe auto-off

// Random executor helper
function getRandomExecutor() {
  const randConfig = config.lightshark.randomExecutorMode;
  if (!randConfig) return null;

  const page = randConfig.page || 1;
  const col = Math.floor(Math.random() * (randConfig.columns.max - randConfig.columns.min + 1)) + randConfig.columns.min;
  const row = Math.floor(Math.random() * (randConfig.rows.max - randConfig.rows.min + 1)) + randConfig.rows.min;

  return { page, column: col, row };
}

// Banner
console.log(`
╔═══════════════════════════════════════════════╗
║   SCOLIA DART → LIGHT CONTROLLER v1.0        ║
║   Styr belysning baserat på dartkast          ║
╚═══════════════════════════════════════════════╝
`);

logger.info('Startar Scolia Light Controller...');

// Kontrollera konfiguration
if (config.scolia.simulationMode) {
  logger.warn('⚠️  SIMULATORLÄGE AKTIVT - Ansluter INTE till Scolia');
  logger.warn('⚠️  Kör "npm run simulate" för att testa ljuseffekter');
  logger.warn('⚠️  Sätt "simulationMode": false i config.json när ni har access token');
  console.log('');
}

if (!config.lightshark.enabled) {
  logger.error('❌ LightShark är inte aktiverat i config.json!');
  process.exit(1);
}

// Testa anslutningar
async function testConnections() {
  logger.info('Testar anslutningar...');

  if (lightshark) {
    const lsOk = await lightshark.testConnection();
    if (lsOk) {
      logger.success('✓ LightShark anslutning OK');
    } else {
      logger.error('✗ LightShark anslutning misslyckades - kontrollera IP och port i config.json');
    }
  }

  if (knxController) {
    await knxController.connect();
  }

  console.log('');
}

// Anslut till Scolia WebSocket
function connectToScolia() {
  if (config.scolia.simulationMode) {
    logger.info('Simulatorläge - hoppar över Scolia-anslutning');
    return;
  }

  const { serialNumber, accessToken, serverUrl } = config.scolia;

  if (!accessToken || accessToken === 'LÄGG_IN_NÄR_NI_KÖPT_TOKEN') {
    logger.error('❌ Ingen access token konfigurerad!');
    logger.error('   Uppdatera "accessToken" i config.json eller aktivera simulationMode');
    return;
  }

  const wsUrl = `${serverUrl}?serialNumber=${serialNumber}&accessToken=${accessToken}`;

  logger.info(`Ansluter till Scolia SBC: ${serialNumber}...`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    logger.success('✓ Ansluten till Scolia!');
    logger.info('Väntar på dart-events...');
    console.log('');
    reconnectAttempts = 0; // Lyckad anslutning — nollställ backoff
    notifier.recover('scolia-down', 'Scolia-anslutningen är återställd');
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleScoliaMessage(message);
    } catch (err) {
      logger.error('Fel vid hantering av meddelande:', err.message);
    }
  });

  ws.on('error', (err) => {
    logger.error('WebSocket fel:', err.message);
  });

  ws.on('close', () => {
    logger.warn('Anslutning till Scolia stängd');

    // Nollställ state så gammal data inte påverkar nästa session
    throwHistory = [];
    lastTriggeredExecutor = null;
    lastSpecialExecutors = [];
    knxLightsOff = false;
    if (strobeTimer) { clearTimeout(strobeTimer); strobeTimer = null; }

    // Återanslut med exponentiell backoff så ett permanent fel inte hamrar
    // var 5:e sekund i all evighet. Backoff nollställs vid lyckad anslutning.
    if (!reconnectTimeout) {
      reconnectAttempts += 1;
      const delay = nextBackoffDelay(reconnectAttempts, {
        baseMs: config.scolia.reconnectDelay,
        maxMs: config.scolia.reconnectMaxDelay || 60000,
        jitterMs: 2000,
      });
      const secs = (delay / 1000).toFixed(1);
      // Eskalera till error-nivå när problemet ser ut att vara ihållande
      const escalateAfter = config.scolia.reconnectAlertAfter || 5;
      if (reconnectAttempts >= escalateAfter) {
        logger.error(`⚠️  Scolia-anslutningen är nere — försök #${reconnectAttempts} misslyckades. Kontrollera nätverk/token. Nytt försök om ${secs}s`);
        notifier.alert('scolia-down', `Scolia-anslutningen är nere (försök #${reconnectAttempts} misslyckades). Inga dartkast detekteras.`);
      } else {
        logger.warn(`Återansluter om ${secs}s (försök #${reconnectAttempts})`);
      }
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        logger.info('Försöker återansluta...');
        connectToScolia();
      }, delay);
    }
  });
}

// Hantera Scolia-meddelanden
function handleScoliaMessage(message) {
  logger.debug('Scolia message:', message.type);

  switch (message.type) {
    case 'HELLO_CLIENT':
      logger.success('Scolia hälsade välkommen!');
      // Hämta initial status
      sendScoliaMessage('GET_SBC_STATUS', {});
      break;

    case 'SBC_STATUS':
    case 'SBC_STATUS_CHANGED':
      logger.info(`SBC Status: ${JSON.stringify(message.payload)}`);
      break;

    case 'THROW_DETECTED':
      handleThrowDetected(message.payload);
      break;

    case 'TAKEOUT_STARTED':
      logger.info('🎯 Pilar tas ut från tavlan...');
      break;

    case 'TAKEOUT_FINISHED':
      logger.info('✓ Pilar uttagna, redo för nästa kast');
      // Nollställ kasthistorik (ny spelares tur)
      throwHistory = [];
      // Spela takeout-ljud
      if (sound) {
        sound.playSound('takeout');
      }
      // Tänd KNX-lampor om de var släckta (miss)
      if (knxController && knxLightsOff) {
        knxController.triggerAction('allOn');
        knxLightsOff = false;
      }
      // Stäng av ev. pågående strobe
      if (strobeTimer && lightshark) {
        clearTimeout(strobeTimer);
        strobeTimer = null;
        const strobe = config.lightshark.throwEffect?.colorMode?.triple20Strobe;
        if (strobe) {
          lightshark.triggerExecutor(strobe.executor.page, strobe.executor.column, strobe.executor.row);
          logger.info('⚡ T20 Strobe Fast: OFF (takeout)');
        }
      }
      // Släck special-executors (180-effekt etc.)
      if (lightshark && lastSpecialExecutors.length > 0) {
        lastSpecialExecutors.forEach(exec => {
          logger.info(`↩️  Släcker special-executor: Page ${exec.page}, Col ${exec.column}, Row ${exec.row}`);
          lightshark.triggerExecutor(exec.page, exec.column, exec.row);
        });
        lastSpecialExecutors = [];
      }
      // Släck senaste executor (färg eller off) så 3k 100% syns igen
      if (lightshark && lastTriggeredExecutor) {
        logger.info(`↩️  Släcker executor: Page ${lastTriggeredExecutor.page}, Col ${lastTriggeredExecutor.column}, Row ${lastTriggeredExecutor.row}`);
        // Trigga samma executor igen för att toggla av den
        lightshark.triggerExecutor(lastTriggeredExecutor.page, lastTriggeredExecutor.column, lastTriggeredExecutor.row);
        lastTriggeredExecutor = null;
      }
      break;

    case 'ACKNOWLEDGED':
      logger.debug('Kommando bekräftat av SBC');
      break;

    case 'REFUSED':
      logger.warn('Kommando nekades av SBC:', message.payload);
      break;

    default:
      logger.info('Okänt meddelande:', message.type, JSON.stringify(message.payload || {}));
  }
}

// Hantera dart-kast
function handleThrowDetected(payload) {
  const { sector, coordinates, bounceout } = payload;
  let { points, multiplier, segment } = parseSector(sector);

  // Scolia skickar "Bull" för både inner/outer - använd koordinater för att skilja
  // Inner bull (50p) har radie ~7 enheter från centrum
  if (segment === 25 && points === 25 && coordinates) {
    const dist = Math.sqrt(coordinates[0] ** 2 + coordinates[1] ** 2);
    if (dist <= 7) {
      points = 50;
      multiplier = 2;
    }
  }

  // Bounceout = pilen fastnade inte, räknas som miss
  if (bounceout) {
    points = 0;
    multiplier = 0;
    segment = 0;
  }

  logger.info('');
  logger.info('🎯 ═══════════════════════════════════════');
  logger.info(`   KAST DETEKTERAT!`);
  logger.info(`   Sektor: ${sector} | Segment: ${segment} | ${multiplier}x`);
  logger.info(`   Poäng: ${points}${bounceout ? ' (BOUNCEOUT - räknas som miss)' : ''}`);
  logger.info(`   Position: (${coordinates?.[0] || 0}, ${coordinates?.[1] || 0})`);
  logger.info('═══════════════════════════════════════');

  // Lägg till i historik
  throwHistory.push({ segment, multiplier, points, timestamp: Date.now() });
  if (throwHistory.length > 100) throwHistory.shift();

  // Kolla om throwEffect mode är aktivt (trigga effekt + reset efter delay)
  if (config.lightshark.throwEffect?.enabled) {
    const effect = config.lightshark.throwEffect;
    const result = resolveThrowEffect(points, multiplier, segment, effect);

    if (result) {
      if (result.isSingle) {
        // Singel — släck senaste färg så 3k 100% syns
        if (lastTriggeredExecutor) {
          logger.info(`${result.effectName} - Släcker senaste färg`);
          lightshark.triggerExecutor(lastTriggeredExecutor.page, lastTriggeredExecutor.column, lastTriggeredExecutor.row);
          lastTriggeredExecutor = null;
        } else {
          logger.info(`${result.effectName} - (3k 100% redan på)`);
        }
      } else if (result.executor) {
        const prev = lastTriggeredExecutor;
        lastTriggeredExecutor = applyExecutor(lightshark, result.executor, lastTriggeredExecutor,
          (msg) => logger.info(`${result.effectName}: ${msg}`));
        if (prev === lastTriggeredExecutor) {
          logger.info(`${result.effectName} (redan aktiv, skippar)`);
        }
      } else {
        logger.info(result.effectName);
      }
    }

    // Strobe overlay: T20 och Bullseye 50p — strobe i 3s ovanpå färg
    const isT20 = multiplier === 3 && segment === 20;
    const isBullseye = points === 50;
    if (lightshark && (isT20 || isBullseye) && effect.colorMode?.triple20Strobe) {
      const strobe = effect.colorMode.triple20Strobe;
      const label = isBullseye ? 'Bullseye' : 'T20';
      // Rensa ev. pågående strobe-timer
      if (strobeTimer) {
        clearTimeout(strobeTimer);
        lightshark.triggerExecutor(strobe.executor.page, strobe.executor.column, strobe.executor.row);
      }
      logger.info(`⚡ ${label} Strobe Fast: ON (${strobe.durationMs / 1000}s)`);
      lightshark.triggerExecutor(strobe.executor.page, strobe.executor.column, strobe.executor.row);
      strobeTimer = setTimeout(() => {
        logger.info(`⚡ ${label} Strobe Fast: OFF`);
        lightshark.triggerExecutor(strobe.executor.page, strobe.executor.column, strobe.executor.row);
        strobeTimer = null;
      }, strobe.durationMs);
    }

    // KNX: återställ lampor vid singel/icke-färg-kast efter miss (färger funkar utan allOn)
    if (knxController && knxLightsOff && points > 0 && (!result || !result.executor)) {
      knxController.triggerAction('allOn');
      knxLightsOff = false;
    }
  } else if (config.lightshark.randomExecutorMode?.enabled) {
    // Random executor mode (för test)
    const randExec = getRandomExecutor();
    logger.info(`🎲 RANDOM MODE: Triggar executor Page ${randExec.page}, Col ${randExec.column}, Row ${randExec.row}`);
    if (lightshark) {
      lightshark.triggerExecutor(randExec.page, randExec.column, randExec.row);
    }
  }

  // KNX: släck alla vid miss
  if (knxController && points === 0) {
    knxController.triggerAction('allOff');
    knxLightsOff = true;
    lastTriggeredExecutor = null;
  }

  // Kolla special events (180, finish, etc) — returnerar true om special-ljud spelades
  const specialPlayed = checkSpecialEvents();

  // Trigga ljud (fire-and-forget, parallellt med ljus)
  // Bust/win-ljud hanteras av Playwright via DOM-övervakning
  if (sound && !specialPlayed) {
    if (points === 0) {
      sound.playSound('miss');
    } else if (points === 50) {
      sound.playSound('bullseye');
    } else if (points === 25 && segment === 25) {
      sound.playSound('bull25');
    } else if (multiplier === 3) {
      sound.playSoundWithFallback(`triple_${segment}`, 'triple');
    } else if (multiplier === 2) {
      sound.playSoundWithFallback(`double_${segment}`, 'double');
    } else if (multiplier === 1 && points === 1) {
      sound.playSound('single_1');
    }
  }

  console.log('');
}

// Kolla special events - returnerar true om special-ljud spelades
function checkSpecialEvents() {
  const result = detectSpecialEvent(throwHistory, config);
  if (!result) return false;

  if (result.log) {
    logger[result.log.level](result.log.message);
  }

  if (result.sound && sound) {
    sound.playSound(result.sound);
  }

  // 180 triggar dessutom LightShark-executors
  if (result.executors && lightshark) {
    lastSpecialExecutors = [];
    result.executors.forEach(exec => {
      logger.info(`🎆 180 effekt: Page ${exec.page}, Col ${exec.column}, Row ${exec.row}`);
      lightshark.triggerExecutor(exec.page, exec.column, exec.row);
      lastSpecialExecutors.push(exec);
    });
  }

  return true;
}

// Skicka meddelande till Scolia
function sendScoliaMessage(type, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.error('Kan inte skicka meddelande - inte ansluten till Scolia');
    return;
  }

  const message = {
    type,
    id: generateUUID(),
    payload
  };

  ws.send(JSON.stringify(message));
  logger.debug('Skickade till Scolia:', type);
}

// Generera UUID v4
function generateUUID() {
  return crypto.randomUUID();
}

// Fånga okontrollerade async-fel
process.on('unhandledRejection', (err) => {
  logger.error('Ohanterat async-fel:', err?.message || err);
});

// Ohanterat fel → appen kraschar. Best-effort: försök skicka Slack-larm (max
// ~1.5s) innan vi avslutar, så pm2 kan starta om medan vi ändå får veta.
process.on('uncaughtException', async (err) => {
  logger.error('💥 Ohanterat fel — appen kraschar:', err?.stack || err?.message || err);
  try {
    await Promise.race([
      notifier.alert('app-crash', `Appen kraschade: ${err?.message || err}`),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch { /* aldrig låta larmet hindra exit */ }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('');
  logger.info('Stänger av...');

  if (ws) ws.close();
  if (slackCommands) await slackCommands.stop();
  if (sound) sound.close();
  if (knxController) knxController.disconnect();
  if (playwrightController) await playwrightController.close();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (strobeTimer) clearTimeout(strobeTimer);
  logger.close();

  process.exit(0);
});

// Starta applikationen
(async () => {
  await testConnections();

  // Starta Slack-kommandolyssnare (no-op om disabled)
  await slackCommands.start();

  // Bekräfta i Slack om denna uppstart var en begärd !restart
  if (consumeRestartFlag(RESTART_FLAG)) {
    notifier.send('✅ Uppe igen efter omstart');
  }

  // Starta Playwright DOM-övervakning
  if (playwrightController) {
    const ok = await playwrightController.launch();
    if (ok) {
      playwrightController.startMonitoring();

      playwrightController.on('bust', () => {
        logger.info('Playwright → BUST');
        if (sound) sound.playSound('bust');
      });

      playwrightController.on('leg-won', () => {
        logger.info('Playwright → LEG WON');
        if (sound) sound.playSound('leg_won');
      });

      playwrightController.on('set-won', () => {
        logger.info('Playwright → SET WON');
        if (sound) sound.playSound('set_won');
      });

      logger.success('✓ Playwright DOM-övervakning aktiv');
    } else {
      logger.error('✗ Playwright kunde inte startas');
    }
  }

  if (!config.scolia.simulationMode) {
    connectToScolia();
  } else {
    logger.info('Redo! Kör "npm run simulate" för att testa ljuseffekter');
  }
})();
