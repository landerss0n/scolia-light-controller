#!/usr/bin/env node

const { execSync } = require('child_process');
const WebSocket = require('ws');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { LightSharkController } = require('./lib/lightshark');
const { SoundController } = require('./lib/sound');
const { KnxController } = require('./lib/knx');
const { Logger } = require('./lib/logger');

// Döda gamla instanser som lyssnar på samma port
function killOldInstances(port) {
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (pids) {
      const pidList = pids.split('\n').filter(p => p && p !== String(process.pid));
      if (pidList.length > 0) {
        execSync(`kill ${pidList.join(' ')} 2>/dev/null`);
        console.log(`Dödade gamla instanser på port ${port}: PID ${pidList.join(', ')}`);
      }
    }
  } catch {
    // Inga gamla instanser
  }
}

// Ladda konfiguration
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// Initiera komponenter
const logger = new Logger(config.logging);
const lightshark = config.lightshark.enabled ? new LightSharkController(config.lightshark, logger) : null;
const sound = config.sound?.enabled ? new SoundController(config.sound, logger) : null;
const knxController = config.knx?.enabled ? new KnxController(config.knx, logger) : null;
let knxLightsOff = false; // Spårar om KNX-lampor är släckta (från miss)

let ws = null;
let reconnectTimeout = null;
let throwHistory = [];
let lastTriggeredExecutor = null; // Spara senaste executor för att kunna släcka vid takeout

// ═══════════════════════════════════════
// Spelstate
// ═══════════════════════════════════════
let gameState = {
  active: false,
  players: [],           // [{ name, score }]
  currentPlayer: 0,
  throwsInTurn: 0,
  turnStartScore: 0,
  turnThrows: [],        // kast i nuvarande tur
  turnAdvanced: false,   // true om turen redan bytts (3 kast eller bust)
  startScore: 501,
  doubleOut: false,
  winner: null,
};

// SSE-klienter för live-uppdateringar
let sseClients = [];

function broadcastGameState() {
  const data = JSON.stringify(getGameStateResponse());
  sseClients = sseClients.filter(res => {
    try {
      res.write(`data: ${data}\n\n`);
      return true;
    } catch {
      return false;
    }
  });
}

function getGameStateResponse() {
  return {
    active: gameState.active,
    players: gameState.players,
    currentPlayer: gameState.currentPlayer,
    throwsInTurn: gameState.throwsInTurn,
    turnThrows: gameState.turnThrows,
    startScore: gameState.startScore,
    doubleOut: gameState.doubleOut,
    winner: gameState.winner,
  };
}

// ═══════════════════════════════════════
// Express REST API
// ═══════════════════════════════════════
function startApiServer() {
  if (!config.game?.enabled) return;

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Hämta spelstate
  app.get('/api/game', (req, res) => {
    res.json(getGameStateResponse());
  });

  // SSE endpoint för live-uppdateringar
  app.get('/api/game/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(getGameStateResponse())}\n\n`);
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
  });

  // Starta nytt spel
  app.post('/api/game/start', (req, res) => {
    const { startScore = 501, players = ['Spelare 1'], doubleOut = false } = req.body;

    if (!Array.isArray(players) || players.length < 1 || players.length > 4) {
      return res.status(400).json({ error: 'Ange 1-4 spelare' });
    }

    gameState = {
      active: true,
      players: players.map(name => ({ name, score: startScore })),
      currentPlayer: 0,
      throwsInTurn: 0,
      turnStartScore: startScore,
      turnThrows: [],
      turnAdvanced: false,
      startScore,
      doubleOut,
      winner: null,
    };

    // Nollställ throw-historik för nytt spel
    throwHistory = [];

    logger.info(`🎮 Nytt spel startat! ${startScore} | ${players.length} spelare | Double out: ${doubleOut}`);
    broadcastGameState();
    res.json(getGameStateResponse());
  });

  // Nollställ spel
  app.post('/api/game/reset', (req, res) => {
    gameState = {
      active: false,
      players: [],
      currentPlayer: 0,
      throwsInTurn: 0,
      turnStartScore: 0,
      turnThrows: [],
      turnAdvanced: false,
      startScore: 501,
      doubleOut: false,
      winner: null,
    };
    throwHistory = [];
    logger.info('🔄 Spel nollställt');
    broadcastGameState();
    res.json({ ok: true });
  });

  // Nästa spelare manuellt (t.ex. om Scolia inte detekterar takeout)
  app.post('/api/game/next-player', (req, res) => {
    if (!gameState.active) {
      return res.status(400).json({ error: 'Inget spel pågår' });
    }
    advanceTurn();
    broadcastGameState();
    res.json(getGameStateResponse());
  });

  // Ångra senaste kast
  app.post('/api/game/undo', (req, res) => {
    if (!gameState.active) {
      return res.status(400).json({ error: 'Inget spel pågår' });
    }
    if (gameState.turnThrows.length === 0) {
      return res.status(400).json({ error: 'Inga kast att ångra' });
    }

    const lastThrow = gameState.turnThrows.pop();
    gameState.players[gameState.currentPlayer].score += lastThrow.points;
    gameState.throwsInTurn--;
    if (throwHistory.length > 0) throwHistory.pop();

    logger.info(`↩️ Ångrade kast: ${lastThrow.points}p`);
    broadcastGameState();
    res.json(getGameStateResponse());
  });

  // Simulera kast manuellt
  app.post('/api/game/throw', (req, res) => {
    const { sector, coordinates, bounceout } = req.body;
    if (!sector) {
      return res.status(400).json({ error: 'Ange sector (t.ex. "s20", "d16", "t19", "Bull", "None")' });
    }
    handleThrowDetected({ sector, coordinates: coordinates || [0, 0], bounceout: bounceout || false });
    res.json(getGameStateResponse());
  });

  // Kasthistorik
  app.get('/api/game/history', (req, res) => {
    res.json(throwHistory.slice(-50));
  });

  const port = config.game.apiPort || 3000;
  killOldInstances(port);
  app.listen(port, '0.0.0.0', () => {
    logger.success(`✓ REST API lyssnar på port ${port}`);
  });
}

// ═══════════════════════════════════════
// Spellogik
// ═══════════════════════════════════════
function handleGameThrow(points, multiplier, segment) {
  if (!gameState.active || gameState.winner) return { bust: false, win: false };

  // Nytt kast = turen har inte bytts ännu
  gameState.turnAdvanced = false;

  const player = gameState.players[gameState.currentPlayer];
  const newScore = player.score - points;

  // Bust-kontroll
  if (newScore < 0) {
    // Bust: under 0
    logger.warn(`💥 BUST! ${player.name} hade ${player.score}, kastade ${points} → under 0`);
    revertTurn();
    return { bust: true, win: false };
  }

  if (newScore === 1 && gameState.doubleOut) {
    // Bust: kan inte checka ut med 1 kvar vid double out
    logger.warn(`💥 BUST! ${player.name} hade ${player.score}, kastade ${points} → 1 kvar (double out)`);
    revertTurn();
    return { bust: true, win: false };
  }

  if (newScore === 0 && gameState.doubleOut && multiplier !== 2) {
    // Bust: måste checka ut med dubbel
    logger.warn(`💥 BUST! ${player.name} nådde 0 men inte med dubbel (double out)`);
    revertTurn();
    return { bust: true, win: false };
  }

  // Giltigt kast - dra av poäng
  player.score = newScore;
  gameState.throwsInTurn++;
  gameState.turnThrows.push({ points, multiplier, segment });

  // Vinst?
  if (newScore === 0) {
    gameState.winner = gameState.currentPlayer;
    logger.success(`🏆 ${player.name} VINNER! Checked out!`);
    return { bust: false, win: true };
  }

  // Auto-avancera efter 3 kast
  if (gameState.throwsInTurn >= 3) {
    advanceTurn();
  }

  return { bust: false, win: false };
}

function revertTurn() {
  // Återställ alla kast i denna tur
  const player = gameState.players[gameState.currentPlayer];
  player.score = gameState.turnStartScore;
  gameState.turnThrows = [];
  gameState.throwsInTurn = 0;
  // Avancera till nästa spelare
  advanceTurn();
}

function advanceTurn() {
  gameState.turnAdvanced = true;
  if (gameState.players.length <= 1) {
    gameState.throwsInTurn = 0;
    gameState.turnThrows = [];
    gameState.turnStartScore = gameState.players[0]?.score || 0;
    return;
  }
  gameState.currentPlayer = (gameState.currentPlayer + 1) % gameState.players.length;
  gameState.throwsInTurn = 0;
  gameState.turnThrows = [];
  gameState.turnStartScore = gameState.players[gameState.currentPlayer].score;
  logger.info(`👉 Tur: ${gameState.players[gameState.currentPlayer].name}`);
}

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
      logger.error('Fel vid parsning av meddelande:', err.message);
    }
  });

  ws.on('error', (err) => {
    logger.error('WebSocket fel:', err.message);
  });

  ws.on('close', () => {
    logger.warn('Anslutning till Scolia stängd');

    // Återanslut efter delay
    if (!reconnectTimeout) {
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        logger.info('Försöker återansluta...');
        connectToScolia();
      }, config.scolia.reconnectDelay);
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
      // Släck senaste executor (färg eller off) så 3k 100% syns igen
      if (lightshark && lastTriggeredExecutor) {
        logger.info(`↩️  Släcker executor: Page ${lastTriggeredExecutor.page}, Col ${lastTriggeredExecutor.column}, Row ${lastTriggeredExecutor.row}`);
        // Trigga samma executor igen för att toggla av den
        lightshark.triggerExecutor(lastTriggeredExecutor.page, lastTriggeredExecutor.column, lastTriggeredExecutor.row);
        lastTriggeredExecutor = null;
      }
      // Byt spelare vid takeout — men bara om turen inte redan bytts
      // (efter 3 kast eller bust har advanceTurn() redan körts)
      if (gameState.active && !gameState.winner && !gameState.turnAdvanced) {
        advanceTurn();
        broadcastGameState();
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

// Parsa sektor-sträng från Scolia (t.ex. "s14", "d20", "t19", "bull")
function parseSector(sector) {
  if (!sector) return { points: 0, multiplier: 0, segment: 0 };

  const s = sector.toLowerCase();

  // Bull (inner/outer bestäms av Scolia via multiplier i payload)
  if (s === 'bull' || s === '25' || s === '50') {
    return { points: 25, multiplier: 1, segment: 25 };
  }

  // Miss
  if (s === 'none' || s === 'miss' || s === '0') {
    return { points: 0, multiplier: 0, segment: 0 };
  }

  // Single (s), Double (d), Triple (t) - t.ex. "s20", "d16", "t19"
  const match = s.match(/^([sdt])(\d+)$/);
  if (match) {
    const type = match[1];
    const seg = parseInt(match[2]);
    const mult = type === 't' ? 3 : type === 'd' ? 2 : 1;
    return { points: seg * mult, multiplier: mult, segment: seg };
  }

  return { points: 0, multiplier: 0, segment: 0 };
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

  // ═══ Spellogik (bust-detection) ═══
  let bustOccurred = false;
  let winOccurred = false;

  if (gameState.active && !gameState.winner) {
    const result = handleGameThrow(points, multiplier, segment);
    bustOccurred = result.bust;
    winOccurred = result.win;
    broadcastGameState();
  }

  // Kolla om throwEffect mode är aktivt (trigga effekt + reset efter delay)
  if (config.lightshark.throwEffect?.enabled) {
    const effect = config.lightshark.throwEffect;
    let execToTrigger = null;
    let effectName = '';

    // Noscore (miss) - Släcker via LightShark noScoreExecutor
    if (points === 0) {
      execToTrigger = effect.noScoreExecutor;
      effectName = '❌ NOSCORE! Släcker lampor';
    }
    // Färgläge baserat på darttavlans färger (endast dubbel/trippel)
    else if (effect.colorMode?.enabled) {
      const cm = effect.colorMode;

      // Bullseye 50 (inner bull) - Moln Ow Strobe
      if (points === 50) {
        execToTrigger = cm.bullseyeExecutor || cm.redExecutor;
        effectName = `🎯 BULLSEYE 50! Moln Ow Strobe`;
      }
      // Bull 25 (outer bull) - grön
      else if (points === 25 && segment === 25) {
        execToTrigger = cm.bull25 === 'green' ? cm.greenExecutor : cm.redExecutor;
        effectName = `🎯 BULL 25! LED ${cm.bull25 === 'green' ? 'Green' : 'Red'}`;
      }
      // Dubbel eller Trippel på rött segment
      else if ((multiplier === 2 || multiplier === 3) && cm.redSegments.includes(segment)) {
        execToTrigger = cm.redExecutor;
        const typeStr = multiplier === 3 ? 'TRIPPEL' : 'DUBBEL';
        effectName = `🔴 ${typeStr} ${segment} - LED Red`;
      }
      // Dubbel eller Trippel på grönt segment
      else if ((multiplier === 2 || multiplier === 3) && cm.greenSegments.includes(segment)) {
        execToTrigger = cm.greenExecutor;
        const typeStr = multiplier === 3 ? 'TRIPPEL' : 'DUBBEL';
        effectName = `🟢 ${typeStr} ${segment} - LED Green`;
      }
      // Singel - släck senaste färgen så 3k 100% syns
      else if (multiplier === 1) {
        if (lastTriggeredExecutor) {
          logger.info(`⚪ SINGEL ${segment} - Släcker senaste färg`);
          lightshark.triggerExecutor(lastTriggeredExecutor.page, lastTriggeredExecutor.column, lastTriggeredExecutor.row);
          lastTriggeredExecutor = null;
        } else {
          logger.info(`⚪ SINGEL ${segment} - (3k 100% redan på)`);
        }
        execToTrigger = null;
      }
      // Fallback
      else {
        execToTrigger = effect.resetExecutor;
        effectName = '💡 3k 100% (fallback)';
      }
    }
    // Fallback till Disco
    else {
      execToTrigger = effect.executor;
      effectName = '💡 Triggar Disco';
    }

    if (execToTrigger && lightshark) {
      // Kolla om samma executor redan är aktiv - skippa då för att undvika toggle
      const sameAsLast = lastTriggeredExecutor &&
        lastTriggeredExecutor.page === execToTrigger.page &&
        lastTriggeredExecutor.column === execToTrigger.column &&
        lastTriggeredExecutor.row === execToTrigger.row;

      if (sameAsLast) {
        logger.info(`${effectName} (redan aktiv, skippar)`);
      } else {
        // Släck tidigare executor först om det finns en
        if (lastTriggeredExecutor) {
          lightshark.triggerExecutor(lastTriggeredExecutor.page, lastTriggeredExecutor.column, lastTriggeredExecutor.row);
        }
        logger.info(`${effectName}: Page ${execToTrigger.page}, Col ${execToTrigger.column}, Row ${execToTrigger.row}`);
        lightshark.triggerExecutor(execToTrigger.page, execToTrigger.column, execToTrigger.row);
        lastTriggeredExecutor = execToTrigger;
      }
    }

    // KNX: återställ lampor vid singel/icke-färg-kast efter miss (färger funkar utan allOn)
    if (knxController && knxLightsOff && points > 0 && !execToTrigger) {
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
  if (sound) {
    if (bustOccurred) {
      sound.playSound('bust');
    } else if (winOccurred) {
      sound.playSound('win');
    } else if (!specialPlayed) {
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
  }

  console.log('');
}

// Kolla special events - returnerar true om special-ljud spelades
function checkSpecialEvents() {
  // Kolla för 180 (3 senaste kasten = 180p totalt)
  if (config.special_events['180'].enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    const totalPoints = lastThree.reduce((sum, t) => sum + t.points, 0);

    if (totalPoints === 180) {
      logger.success('🔥🔥🔥 180!!! 🔥🔥🔥');

      if (sound) {
        sound.playSound('180');
      }

      // Stöd för flera executors
      const executors = config.special_events['180'].lightshark_executors ||
                       [config.special_events['180'].lightshark_executor];

      if (lightshark && executors) {
        executors.forEach(exec => {
          if (exec) {
            logger.info(`🎆 180 effekt: Page ${exec.page}, Col ${exec.column}, Row ${exec.row}`);
            lightshark.triggerExecutor(exec.page, exec.column, exec.row);
          }
        });
      }

      return true;
    }
  }

  // Kolla för 3 missar i rad
  if (throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (lastThree.every(t => t.points === 0)) {
      logger.warn('💀 Tre missar i rad!');
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
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('');
  logger.info('Stänger av...');

  if (ws) ws.close();
  if (knxController) knxController.disconnect();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);

  process.exit(0);
});

// Starta applikationen
(async () => {
  await testConnections();

  // Starta REST API
  startApiServer();

  if (!config.scolia.simulationMode) {
    connectToScolia();
  } else {
    logger.info('Redo! Kör "npm run simulate" för att testa ljuseffekter');
  }
})();
