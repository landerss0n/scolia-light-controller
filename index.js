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

// Ladda konfiguration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// Initiera komponenter
const logger = new Logger(config.logging);
const lightshark = config.lightshark.enabled ? new LightSharkController(config.lightshark, logger) : null;
const sound = config.sound?.enabled ? new SoundController(config.sound, logger) : null;
const knxController = config.knx?.enabled ? new KnxController(config.knx, logger) : null;
const playwrightController = config.playwright?.enabled ? new PlaywrightController(config.playwright, logger) : null;
let knxLightsOff = false; // Spårar om KNX-lampor är släckta (från miss)

let ws = null;
let reconnectTimeout = null;
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

    // Återanslut efter delay
    if (!reconnectTimeout) {
      const jitter = Math.floor(Math.random() * 2000);
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        logger.info('Försöker återansluta...');
        connectToScolia();
      }, config.scolia.reconnectDelay + jitter);
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
  // Kolla för 180 (3 senaste kasten = 180p totalt)
  if (config.special_events?.['180']?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    const totalPoints = lastThree.reduce((sum, t) => sum + t.points, 0);

    if (totalPoints === 180 && !lastThree.some(t => t._180played)) {
      lastThree.forEach(t => { t._180played = true; });
      logger.success('🔥🔥🔥 180!!! 🔥🔥🔥');

      if (sound) {
        sound.playSound('180');
      }

      // Stöd för flera executors
      const executors = config.special_events['180'].lightshark_executors ||
                       [config.special_events['180'].lightshark_executor];

      if (lightshark && executors) {
        lastSpecialExecutors = [];
        executors.forEach(exec => {
          if (exec) {
            logger.info(`🎆 180 effekt: Page ${exec.page}, Col ${exec.column}, Row ${exec.row}`);
            lightshark.triggerExecutor(exec.page, exec.column, exec.row);
            lastSpecialExecutors.push(exec);
          }
        });
      }

      return true;
    }
  }

  // Kolla för 2x triple 20 i rad (120p)
  if (config.special_events?.['120']?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo.every(t => t.segment === 20 && t.multiplier === 3) &&
      !lastTwo.some(t => t._120played)
    ) {
      lastTwo.forEach(t => { t._120played = true; });
      logger.success('🔥🔥 120! Dubbla T20! 🔥🔥');
      if (sound) {
        sound.playSound('120');
      }
      return true;
    }
  }

  // Kolla för singel 1 → 2 → 3 i följd
  if (config.special_events?.one_two_three?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 1 && lastThree[0].multiplier === 1 &&
      lastThree[1].segment === 2 && lastThree[1].multiplier === 1 &&
      lastThree[2].segment === 3 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._123played)
    ) {
      lastThree.forEach(t => { t._123played = true; });
      logger.success('🍹 1-2-3! Fanta & Rosé! 🍹');
      if (sound) {
        sound.playSound('one_two_three');
      }
      return true;
    }
  }

  // Kolla för 3x singel 1 i rad
  if (config.special_events?.three_ones?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree.every(t => t.segment === 1 && t.multiplier === 1) &&
      !lastThree.some(t => t._threeOnesPlayed)
    ) {
      lastThree.forEach(t => { t._threeOnesPlayed = true; });
      logger.success('🎺 Tre ettor i rad! Wah wah waaaah 🎺');
      if (sound) {
        sound.playSound('three_ones');
      }
      return true;
    }
  }

  // Kolla för 3 missar i rad (sätt sentinel så det inte triggas igen på miss #4, #5 etc.)
  if (throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (lastThree.every(t => t.points === 0 && !t.threeMissPlayed)) {
      logger.warn('💀 Tre missar i rad!');
      lastThree.forEach(t => { t.threeMissPlayed = true; });
      if (sound) {
        sound.playSound('three_misses');
      }
      return true;
    }
  }

  return false;
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

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('');
  logger.info('Stänger av...');

  if (ws) ws.close();
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
