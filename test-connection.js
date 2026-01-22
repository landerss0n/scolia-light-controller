#!/usr/bin/env node

const fs = require('fs');
const { LightSharkController } = require('./lib/lightshark');
const { Logger } = require('./lib/logger');

// Ladda konfiguration
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const logger = new Logger({ enabled: false, consoleOutput: true });

console.log(`
╔═══════════════════════════════════════════════╗
║   ANSLUTNINGSTEST - LightShark (OSC)          ║
╚═══════════════════════════════════════════════╝
`);

async function testLightShark() {
  if (!config.lightshark.enabled) {
    console.log('❌ LightShark är inaktiverad i config.json');
    console.log('   Sätt "enabled": true för att testa');
    return;
  }

  console.log(`Testar anslutning till LightShark via OSC...`);
  console.log(`IP: ${config.lightshark.ip}`);
  console.log(`OSC Port: ${config.lightshark.oscPort}\n`);

  const lightshark = new LightSharkController(config.lightshark, logger);
  const isConnected = await lightshark.testConnection();

  if (isConnected) {
    console.log('✅ OSC-meddelande skickat!\n');
    console.log('OBS: OSC är "fire-and-forget" - vi kan inte bekräfta att');
    console.log('LightShark tog emot meddelandet. Kontrollera att enheten är på.\n');

    console.log('Vill du testa att trigga en cuelist? (Testar cuelist 1)');
    console.log('Tryck Enter för att testa, eller Ctrl+C för att avsluta...\n');

    process.stdin.once('data', async () => {
      console.log('Triggar cuelist 1 via OSC...\n');
      const success = await lightshark.triggerCuelist(1);

      if (success) {
        console.log('✅ OSC-meddelande skickat till cuelist 1!');
        console.log('   Om ljuset inte ändrades, kontrollera:');
        console.log('   - Att cuelist 1 existerar i LightShark');
        console.log('   - Att LightShark inte är lockad');
        console.log('   - Att OSC är aktiverat (Settings → Network → OSC)\n');
      } else {
        console.log('⚠️  Kunde inte skicka OSC-meddelande');
        console.log('   Kontrollera nätverksanslutningen.\n');
      }

      lightshark.close();
      process.exit(0);
    });
  } else {
    console.log('❌ Kunde inte skicka OSC-meddelande!\n');
    console.log('Kontrollera följande:');
    console.log('1. Är LightShark påslagen?');
    console.log('2. Är IP-adressen rätt? (nuvarande: ' + config.lightshark.ip + ')');
    console.log('3. Är OSC-porten rätt? (nuvarande: ' + config.lightshark.oscPort + ', standard är 8000)');
    console.log('4. Är datorn och LightShark på samma nätverk?');
    console.log('5. Är OSC aktiverat i LightShark? (Settings → Network → OSC)');
    console.log('6. Testa pinga: ping ' + config.lightshark.ip + '\n');
    lightshark.close();
    process.exit(1);
  }
}

testLightShark();
