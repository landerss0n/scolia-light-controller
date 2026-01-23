# Scolia Light Controller

Styr LightShark-belysning i realtid baserat på Scolia darttavla-events via OSC.

## Funktioner

- **Färgläge (Color Mode)** - LED-färger matchar darttavlans färger:
  - Dubbel/Trippel på röda segment (20,18,13,10,2,3,7,8,14,12) → LED Red
  - Dubbel/Trippel på gröna segment (1,4,6,15,17,19,16,11,9,5) → LED Green
  - Bullseye (50p) → Moln Ow Strobe
  - Bull (25p) → LED Green
  - Singel → Neutral (3k 100%)
  - Miss → Lampor släcks (via KNX eller LightShark)
- **KNX-integration** - Styr rumsbelysning via KNX IP-gateway:
  - Miss → Släcker all belysning (KNX + LightShark via extern länk)
  - Singel efter miss → Återställer belysning
  - Färg-kast efter miss → Triggar färg direkt (utan att vänta på KNX)
- **Ljudeffekter (Unreal Tournament-tema)** - Spelar ljud vid kast:
  - Segment-specifika ljud för T20 (Godlike), T19 (Dominating), T18 (Unstoppable), T17 (Rampage)
  - Generella ljud för dubblar (Double Kill), tripplar (Triple Kill)
  - Bullseye → Headshot, Bull 25 → Ultrakill, Miss → Failed
  - 180 → Monster Kill
- **Auto-reset** - Lampor återgår till 3k 100% när pilar tas ut
- **Random Executor Mode** - Slumpmässig executor vid varje kast (för test)
- **180 Detection** - Special-effekt vid 180 poäng

## Snabbstart

```bash
# Installera dependencies
npm install

# Starta live-läge (kräver Scolia access token)
npm start

# Testa utan darttavla
npm run simulate

# Testa LightShark-anslutning
npm test
```

## Konfiguration

Redigera `config.json`:

### Scolia-inställningar
```json
"scolia": {
  "serialNumber": "DITT-SERIENUMMER",
  "accessToken": "DIN-ACCESS-TOKEN",
  "simulationMode": false
}
```

### LightShark-inställningar
```json
"lightshark": {
  "enabled": true,
  "ip": "192.168.6.242",
  "oscPort": 8000,
  "throwEffect": {
    "enabled": true,
    "colorMode": {
      "enabled": true,
      "redExecutor": { "page": 1, "column": 2, "row": 1 },
      "greenExecutor": { "page": 1, "column": 2, "row": 2 }
    },
    "noScoreExecutor": { "page": 1, "column": 8, "row": 4 }
  }
}
```

### Ljudeffekter
```json
"sound": {
  "enabled": true,
  "soundsDir": "./sounds",
  "sounds": {
    "miss": { "file": "failed.wav" },
    "bullseye": { "file": "headshot.wav" },
    "triple_20": { "file": "godlike.wav" },
    "triple": { "file": "triplekill.wav" },
    "180": { "file": "monsterkill.wav" }
  }
}
```

Segment-specifika ljud (t.ex. `triple_20`) har prioritet. Om inget segment-specifikt ljud finns faller det tillbaka till det generella (`triple`). Lägg egna WAV-filer i `sounds/`-mappen.

### KNX-inställningar
```json
"knx": {
  "enabled": true,
  "gateway": "192.168.1.50",
  "port": 3671,
  "actions": {
    "allOff": [{ "ga": "0/0/1", "value": 5 }],
    "allOn": [{ "ga": "0/0/1", "value": 0 }]
  }
}
```
KNX styr rumsbelysning vid miss/scoring. Kräver KNX IP-gateway. Gruppadresser och värden konfigureras under `actions`.

### Executor-koordinater

Executors adresseras med `page`, `column`, `row` som motsvarar LightShark-griddet:

| Executor | Page | Column | Row | Beskrivning |
|----------|------|--------|-----|-------------|
| 3k 100% | 1 | 1 | 1 | Bas-belysning (alltid på) |
| LED Red | 1 | 2 | 1 | Röd färg |
| LED Green | 1 | 2 | 2 | Grön färg |
| Disco | 1 | 1 | 5 | Disco-effekt |
| LED Dim OFF | 1 | 8 | 4 | Släcker lampor |

## Filstruktur

```
Scolia API/
├── index.js              # Huvudapp - WebSocket till Scolia, OSC till LightShark
├── simulator.js          # Testa ljuseffekter utan darttavla
├── test-connection.js    # Testa LightShark-anslutning
├── knx-monitor.js        # Verktyg: lyssna på KNX-buss för att hitta gruppadresser
├── config.json           # Konfiguration
├── lib/
│   ├── lightshark.js     # OSC-kommunikation med LightShark
│   ├── knx.js            # KNX IP-gateway kommunikation
│   ├── sound.js          # Ljuduppspelning (cross-platform)
│   └── logger.js         # Loggning
├── sounds/               # WAV-filer för ljudeffekter
└── CLAUDE.md             # Projektkontext för AI-assistans
```

## Protokoll

- **Scolia** → WebSocket (wss://game.scoliadarts.com)
- **LightShark** → OSC/UDP (port 8000)
- **KNX** → KNXnet/IP (port 3671)

## Användning

### Live-läge
```bash
npm start
```
Ansluter till Scolia och triggar ljuseffekter vid varje kast.

### Simulator
```bash
npm run simulate
```
Meny för att simulera kast och testa ljuseffekter.

### Anslutningstest
```bash
npm test
```
Testar att LightShark är nåbar via OSC.

## Felsökning

### LightShark svarar inte
1. Kontrollera IP-adress i `config.json`
2. Verifiera att OSC är aktiverat i LightShark (Settings → Network → OSC)
3. Kör `npm test` för att testa anslutningen

### Scolia-anslutning misslyckas
1. Kontrollera `serialNumber` och `accessToken` i `config.json`
2. Verifiera att darttavlan är online
3. Kontrollera internetanslutning

### Lampor tänds inte
1. Verifiera executor-koordinater (page/column/row)
2. Kontrollera att executorn finns och är aktiv i LightShark
3. Testa med simulatorn först

## Systemkrav

- Node.js v18+
- LightShark med OSC aktiverat
- Scolia darttavla med API-access
- Ljud: macOS (afplay, inbyggt), Linux (aplay/mpg123), Windows (PowerShell, inbyggt)
- KNX (valfritt): KNX IP-gateway på nätverket
