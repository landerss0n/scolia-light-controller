# Scolia Light Controller

Styr LightShark-belysning och ljudeffekter i realtid baserat på Scolia darttavla-events.

## Funktioner

- **Färgläge (Color Mode)** - LED-färger matchar darttavlans färger:
  - Dubbel/Trippel på röda segment (20,18,13,10,2,3,7,8,14,12) → LED Red
  - Dubbel/Trippel på gröna segment (1,4,6,15,17,19,16,11,9,5) → LED Green
  - Bullseye (50p) → Moln Ow Strobe
  - Bull (25p) → LED Green
  - Singel → Neutral (3k 100%)
  - Miss → Lampor släcks (via KNX och/eller LightShark)
- **KNX-integration** - Styr rumsbelysning via KNX IP-gateway:
  - Miss → Släcker all belysning (KNX + LightShark via extern länk)
  - Singel efter miss → Återställer belysning
  - Färg-kast efter miss → Triggar färg direkt (utan att vänta på KNX)
- **Ljudeffekter (Unreal Tournament-tema)** - Spelar ljud vid kast:
  - Segment-specifika ljud för T20 (Godlike), T19 (Dominating), T18 (Unstoppable), T17 (Rampage)
  - Generella ljud för dubblar (Double Kill), tripplar (Triple Kill)
  - Bullseye → Headshot, Bull 25 → Ultrakill, Miss → BInjur2
  - 180 → Monster Kill, Tre missar i rad → Lost Match
  - Takeout (pilar tas ut) → Draw
  - Volymstöd per ljud (macOS)
- **Playwright DOM-övervakning** - Övervakar Scolias webbapp för spelhändelser:
  - Bust-detection → Tjockis-ljud
  - Leg won / Set won → Vinst-ljud
  - Auto-login, cookie-hantering, fullscreen
  - Auto-klick på "Finish & View Stats", board selection
- **Auto-reset** - Lampor återgår till 3k 100% när pilar tas ut
- **Random Executor Mode** - Slumpmässig executor vid varje kast (för test)
- **180 Detection** - Special-effekt vid 180 poäng
- **Tre missar-detection** - Special-ljud vid 3 missar i rad

## Systemkrav

- Node.js v18+
- LightShark med OSC aktiverat
- Scolia darttavla med API-access
- Ljud: macOS (afplay, inbyggt), Linux (aplay/mpg123), Windows (PowerShell, inbyggt)
- KNX (valfritt): KNX IP-gateway på nätverket

## Installation

```bash
git clone <repo-url>
cd "Scolia API"
npm install
```

Dependencies:
- `ws` — WebSocket-klient för Scolia
- `node-osc` — OSC/UDP för LightShark
- `playwright` — Browser-automation för bust/win-detection
- `play-sound` — Ljuduppspelning (macOS/Linux)
- `knx` — KNX IP-gateway kommunikation

## Konfiguration

Kopiera `config.example.json` till `config.json` och fyll i:

```bash
cp config.example.json config.json
```

### Scolia-inställningar
```json
"scolia": {
  "serialNumber": "DITT-SERIENUMMER",
  "accessToken": "DIN-ACCESS-TOKEN",
  "simulationMode": false,
  "reconnectDelay": 5000
}
```

Sätt `simulationMode: true` för att köra utan Scolia-anslutning.

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
      "greenExecutor": { "page": 1, "column": 2, "row": 2 },
      "bullseyeExecutor": { "page": 1, "column": 6, "row": 6 }
    },
    "noScoreExecutor": { "page": 1, "column": 8, "row": 4 }
  }
}
```

### Playwright-inställningar
```json
"playwright": {
  "enabled": true,
  "url": "https://game.scoliadarts.com",
  "fullscreen": true,
  "pollIntervalMs": 200,
  "credentials": {
    "email": "din@email.com",
    "password": "ditt-lösenord"
  }
}
```

Playwright öppnar Scolias webbapp i Chromium och övervakar DOM för bust/leg-won/set-won. Cookies sparas automatiskt för att undvika inloggning vid omstart.

### Ljudeffekter
```json
"sound": {
  "enabled": true,
  "soundsDir": "./sounds",
  "sounds": {
    "miss": { "file": "BInjur2.wav" },
    "bullseye": { "file": "headshot.wav" },
    "bull25": { "file": "ultrakill.wav" },
    "double": { "file": "doublekill.wav" },
    "triple": { "file": "triplekill.wav" },
    "triple_20": { "file": "godlike.wav" },
    "single_1": { "file": "cd1.wav" },
    "180": { "file": "monsterkill.wav" },
    "three_misses": { "file": "lostmatch.wav" },
    "takeout": { "file": "draw.wav", "volume": 0.25 },
    "bust": { "file": "tjockis.wav", "volume": 2.0 },
    "leg_won": { "file": "set_won.wav" },
    "set_won": { "file": "monsterkill.wav" }
  }
}
```

Segment-specifika ljud (t.ex. `triple_20`) har prioritet. Om inget segment-specifikt ljud finns faller det tillbaka till det generella (`triple`). Varje ljud stödjer `volume` (0.0–2.0, default 1.0) och `enabled` (true/false). Lägg egna WAV-filer i `sounds/`-mappen.

### KNX-inställningar
```json
"knx": {
  "enabled": false,
  "gateway": "192.168.6.169",
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
| Moln Ow Strobe | 1 | 6 | 6 | Bullseye-effekt |
| Disco | 1 | 1 | 5 | Disco-effekt |
| LED Dim OFF | 1 | 8 | 4 | Släcker lampor |

## Filstruktur

```
Scolia API/
├── index.js              # Huvudapp — WebSocket, ljus, ljud, Playwright
├── simulator.js          # Testa ljuseffekter utan darttavla
├── test-connection.js    # Testa LightShark-anslutning
├── knx-monitor.js        # Verktyg: lyssna på KNX-buss för att hitta gruppadresser
├── plejd_control.py      # Plejd BLE-styrning (Python)
├── config.json           # Konfiguration (gitignored, se config.example.json)
├── lib/
│   ├── lightshark.js     # OSC-kommunikation med LightShark
│   ├── playwright.js     # Playwright DOM-övervakning (bust/win-detection)
│   ├── knx.js            # KNX IP-gateway kommunikation
│   ├── sound.js          # Ljuduppspelning (cross-platform, volymstöd)
│   └── logger.js         # Loggning
├── sounds/               # WAV-filer för ljudeffekter
└── CLAUDE.md             # Projektkontext för AI-assistans
```

## Protokoll

- **Scolia** → WebSocket (wss://game.scoliadarts.com)
- **LightShark** → OSC/UDP (port 8000)
- **KNX** → KNXnet/IP (port 3671)
- **Playwright** → Chromium (DOM-polling mot Scolias webbapp)

## Användning

### Live-läge
```bash
npm start
```
Ansluter till Scolia och triggar ljuseffekter vid varje kast. Om Playwright är aktiverat öppnas Scolias webbapp i Chromium för bust/win-detection.

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

### Playwright-problem
1. Kontrollera att `playwright` är installerat (`npx playwright install chromium`)
2. Verifiera credentials i `config.json` → `playwright.credentials`
3. Ta bort `scolia-cookies.json` för att tvinga ny inloggning
4. Kolla loggar — Playwright loggar alla state-ändringar
