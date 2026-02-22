#!/usr/bin/env node

const knx = require('knx');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const gateway = config.knx?.gateway;
const port = config.knx?.port || 3671;

if (!gateway) {
  console.error('Ingen KNX-gateway konfigurerad i config.json');
  process.exit(1);
}

console.log(`
╔═══════════════════════════════════════════════╗
║   KNX MONITOR - Lyssnar på gruppaddresser    ║
║   Tryck på strömbrytare i kontoret!          ║
║   Ctrl+C för att avsluta                     ║
╚═══════════════════════════════════════════════╝
`);

console.log(`Ansluter till KNX gateway ${gateway}:${port}...\n`);

const connection = new knx.Connection({
  ipAddr: gateway,
  ipPort: port,
  handlers: {
    connected: () => {
      console.log('✓ Ansluten till KNX! Tryck på lampknappar nu...\n');
      console.log('%-20s %-15s %-15s %s', 'TID', 'FRÅN', 'GRUPPADRESS', 'VÄRDE');
      console.log('─'.repeat(70));
    },
    error: (connstatus) => {
      console.error('✗ KNX-anslutning misslyckades:', connstatus);
    }
  }
});

connection.on('GroupValue_Write', (src, dest, value) => {
  const time = new Date().toLocaleTimeString('sv-SE');
  const val = Buffer.isBuffer(value) ? [...value].map(b => b.toString(16).padStart(2, '0')).join(' ') : value;
  console.log('%-20s %-15s %-15s %s', time, src, dest, val);
});

connection.on('GroupValue_Response', (src, dest, value) => {
  const time = new Date().toLocaleTimeString('sv-SE');
  const val = Buffer.isBuffer(value) ? [...value].map(b => b.toString(16).padStart(2, '0')).join(' ') : value;
  console.log('%-20s %-15s %-15s %s (response)', time, src, dest, val);
});
