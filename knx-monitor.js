#!/usr/bin/env node

const knx = require('knx');

console.log(`
╔═══════════════════════════════════════════════╗
║   KNX MONITOR - Lyssnar på gruppaddresser    ║
║   Tryck på strömbrytare i kontoret!          ║
║   Ctrl+C för att avsluta                     ║
╚═══════════════════════════════════════════════╝
`);

console.log('Ansluter till KNX gateway 192.168.6.169:3671...\n');

const connection = new knx.Connection({
  ipAddr: '192.168.6.169',
  ipPort: 3671,
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
