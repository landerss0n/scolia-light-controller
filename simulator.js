#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { LightSharkController } = require('./lib/lightshark');
const { SoundController } = require('./lib/sound');
const { Logger } = require('./lib/logger');
const { resolveThrowEffect, applyExecutor } = require('./lib/effects');

// Ladda konfiguration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// Initiera komponenter
const logger = new Logger({ enabled: false, consoleOutput: true });
const lightshark = config.lightshark.enabled ? new LightSharkController(config.lightshark, logger) : null;
const sound = config.sound?.enabled ? new SoundController(config.sound, logger) : null;

let lastTriggeredExecutor = null;

// Random executor helper
function getRandomExecutor() {
  const randConfig = config.lightshark.randomExecutorMode;
  if (!randConfig) return { page: 1, column: 1, row: 1 };

  const page = randConfig.page || 1;
  const col = Math.floor(Math.random() * (randConfig.columns.max - randConfig.columns.min + 1)) + randConfig.columns.min;
  const row = Math.floor(Math.random() * (randConfig.rows.max - randConfig.rows.min + 1)) + randConfig.rows.min;

  return { page, column: col, row };
}

console.log(`
╔═══════════════════════════════════════════════╗
║     SCOLIA DART SIMULATOR v1.0                ║
║     Testa ljuseffekter utan darttavla         ║
╚═══════════════════════════════════════════════╝
`);

// Fördefinierade kast att simulera
const simulatedThrows = [
  { name: 'Bull\'s Eye (50p)', points: 50, multiplier: 2, segment: 25, color: '🟡' },
  { name: 'Bull (25p)', points: 25, multiplier: 1, segment: 25, color: '🟢' },
  { name: 'Triple 20', points: 60, multiplier: 3, segment: 20, color: '🔴' },
  { name: 'Triple 19', points: 57, multiplier: 3, segment: 19, color: '🟢' },
  { name: 'Triple 18', points: 54, multiplier: 3, segment: 18, color: '🔴' },
  { name: 'Double 20', points: 40, multiplier: 2, segment: 20, color: '🔴' },
  { name: 'Double 16', points: 32, multiplier: 2, segment: 16, color: '🟢' },
  { name: 'Single 20', points: 20, multiplier: 1, segment: 20, color: '⚪' },
  { name: 'Single 5', points: 5, multiplier: 1, segment: 5, color: '⚪' },
  { name: 'Miss (0p)', points: 0, multiplier: 0, segment: 0, color: '❌' },
];

async function testConnections() {
  console.log('Testar anslutningar...\n');

  if (lightshark) {
    const lsOk = await lightshark.testConnection();
    if (lsOk) {
      console.log('✓ LightShark: Ansluten');
    } else {
      console.log('✗ LightShark: Kan inte ansluta - kontrollera IP/port i config.json');
    }
  } else {
    console.log('○ LightShark: Inaktiverad');
  }

  console.log('');
}

function showMenu() {
  console.log('═══════════════════════════════════════════════');
  console.log('Välj kast att simulera:\n');

  simulatedThrows.forEach((throwData, index) => {
    console.log(`  ${index + 1}. ${throwData.color} ${throwData.name.padEnd(20)} (${throwData.points}p)`);
  });

  console.log(`\n  ${simulatedThrows.length + 1}. 🎯 Simulera 180 (3x T20)`);
  console.log(`  ${simulatedThrows.length + 2}. 🎲 Random Executor Test (10 kast)`);
  console.log(`  0. ❌ Avsluta\n`);
  console.log('═══════════════════════════════════════════════');
}

function simulateThrow(throwData) {
  const { points, multiplier, segment, name } = throwData;

  console.log('\n🎯 ═══════════════════════════════════════');
  console.log(`   SIMULERAT KAST: ${name}`);
  console.log(`   Sektor: ${segment} | Multiplikator: ${multiplier}x`);
  console.log(`   Poäng: ${points}`);
  console.log('═══════════════════════════════════════\n');

  // ColorMode ljuslogik (delad med index.js via lib/effects.js)
  if (config.lightshark.throwEffect?.enabled && lightshark) {
    const effect = config.lightshark.throwEffect;
    const result = resolveThrowEffect(points, multiplier, segment, effect);

    if (result) {
      if (result.isSingle) {
        if (lastTriggeredExecutor) {
          console.log(`${result.effectName} - Släcker senaste färg`);
          lightshark.triggerExecutor(lastTriggeredExecutor.page, lastTriggeredExecutor.column, lastTriggeredExecutor.row);
          lastTriggeredExecutor = null;
        } else {
          console.log(`${result.effectName} - (3k 100% redan på)`);
        }
      } else if (result.executor) {
        const prev = lastTriggeredExecutor;
        lastTriggeredExecutor = applyExecutor(lightshark, result.executor, lastTriggeredExecutor,
          (msg) => console.log(`💡 ${result.effectName}: ${msg}`));
        if (prev === lastTriggeredExecutor) {
          console.log(`${result.effectName} (redan aktiv, skippar)`);
        }
      }
    }
  }

  // Trigga ljud
  if (sound) {
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
    }
  }

  console.log('');
}

function simulate180() {
  console.log('\n🔥🔥🔥 SIMULERAR 180! 🔥🔥🔥\n');

  // Simulera 3x Triple 20
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      const t20 = simulatedThrows.find(t => t.name === 'Triple 20');
      simulateThrow(t20);

      if (i === 2) {
        // Trigga special 180-effekt
        setTimeout(() => {
          console.log('🎆 SPECIAL EFFEKT: 180! 🎆\n');
          if (sound) sound.playSound('180');
          if (lightshark && config.special_events?.['180']?.enabled) {
            const executors = config.special_events['180'].lightshark_executors ||
                             [config.special_events['180'].lightshark_executor];
            executors.forEach(exec => {
              if (exec) lightshark.triggerExecutor(exec.page, exec.column, exec.row);
            });
          }
        }, 500);
      }
    }, i * 1000);
  }
}

function simulateRandomExecutorTest() {
  console.log('\n🎲 ═══════════════════════════════════════');
  console.log('   RANDOM EXECUTOR TEST - 10 kast');
  console.log('═══════════════════════════════════════\n');

  const randConfig = config.lightshark.randomExecutorMode;
  if (!randConfig) {
    console.log('Random executor mode är inte konfigurerat i config.json');
    return;
  }

  console.log(`   Page: ${randConfig.page}`);
  console.log(`   Kolumner: ${randConfig.columns.min}-${randConfig.columns.max}`);
  console.log(`   Rader: ${randConfig.rows.min}-${randConfig.rows.max}\n`);

  for (let i = 0; i < 10; i++) {
    setTimeout(() => {
      const randExec = getRandomExecutor();
      console.log(`   Kast ${i + 1}/10: Executor Page ${randExec.page}, Col ${randExec.column}, Row ${randExec.row}`);

      if (lightshark) {
        lightshark.triggerExecutor(randExec.page, randExec.column, randExec.row);
      }

      if (i === 9) {
        console.log('\n   Random Executor Test klart!\n');
      }
    }, i * 1500);
  }
}

async function main() {
  await testConnections();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = () => {
    showMenu();

    rl.question('Välj (0-' + (simulatedThrows.length + 2) + '): ', (answer) => {
      const choice = parseInt(answer);

      if (choice === 0) {
        console.log('\nAvslutar simulator. Hejdå! 👋\n');
        rl.close();
        return;
      }

      if (choice >= 1 && choice <= simulatedThrows.length) {
        simulateThrow(simulatedThrows[choice - 1]);
        setTimeout(askQuestion, 1000);
      } else if (choice === simulatedThrows.length + 1) {
        simulate180();
        setTimeout(askQuestion, 4000);
      } else if (choice === simulatedThrows.length + 2) {
        simulateRandomExecutorTest();
        setTimeout(askQuestion, 16000);
      } else {
        console.log('Ogiltigt val, försök igen.\n');
        askQuestion();
      }
    });
  };

  askQuestion();
}

main();
