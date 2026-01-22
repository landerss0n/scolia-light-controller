# Scolia Light Controller - Projektkontext

Detta dokument innehåller all kontext som behövs för att göra ändringar i projektet.

## Projektöversikt

**Syfte:** Styra LightShark-belysning baserat på dartkast från Scolia smart darttavla.

**Huvudflöde:**
1. Scolia darttavla detekterar kast via kamera
2. Scolia SBC skickar event till Scolia Cloud
3. Vår app (index.js) tar emot THROW_DETECTED via WebSocket
4. App triggar LightShark executor via OSC baserat på kasttyp
5. Vid TAKEOUT_FINISHED (pilar tas ut) → återställ till basbelysning

## Arkitektur

```
Scolia Darttavla → Scolia Cloud (WebSocket) → index.js → LightShark (OSC)
```

## Viktiga filer

### index.js (Huvudapp)
- WebSocket-anslutning till Scolia (`wss://game.scoliadarts.com/api/v1/social`)
- Hanterar events: `THROW_DETECTED`, `TAKEOUT_FINISHED`, `TAKEOUT_STARTED`
- Parsear sektor-strängar från Scolia (t.ex. "s14", "d20", "t19", "25", "50")
- Triggar LightShark executors baserat på `config.json`

### lib/lightshark.js
- OSC-kommunikation med LightShark
- `triggerExecutor(page, column, row)` - Triggar executor via OSC
- OSC-adress: `/LS/Executor/{page}/{column}/{row}` med värde 0.0 (toggle)
- Port: 8000 (UDP)

### lib/logger.js
- Loggning till konsol och fil
- Metoder: `info()`, `success()`, `warn()`, `error()`, `debug()`

### lib/mapper.js
- Mappningslogik för dart → ljuseffekt (används som fallback)
- Läser `mapping`-sektionen i config.json
- **OBS:** Används inte i nuvarande colorMode-läge

## Nuvarande ljuslogik (colorMode)

Finns i `index.js` → `handleThrowDetected()`:

```javascript
// Prioritetsordning:
1. Miss (points === 0) → noScoreExecutor (LED Dim OFF)
2. Bullseye 50p → bullseyeExecutor (Moln Ow Strobe)
3. Bull 25p → greenExecutor (LED Green)
4. Dubbel/Trippel på rött segment → redExecutor
5. Dubbel/Trippel på grönt segment → greenExecutor
6. Singel → Släck senaste färg (visa 3k 100% basbelysning)
```

### Darttavlans färgschema
- **Röda segment:** 20, 18, 13, 10, 2, 3, 7, 8, 14, 12
- **Gröna segment:** 1, 4, 6, 15, 17, 19, 16, 11, 9, 5
- **Bullseye (50p):** Röd
- **Bull (25p):** Grön

### Viktiga variabler
- `lastTriggeredExecutor` - Sparar senast triggade executor för att kunna släcka vid nästa kast/takeout
- `throwHistory[]` - Sparar de senaste 100 kasten (för 180-detection)

## LightShark Executor Grid (Page 1)

Baserat på användarens setup:

| Col | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 |
|-----|-------|-------|-------|-------|-------|-------|-------|
| 1 | 3k 100% | 3k Col 1 | 3k Col 2 | Colour | Disco | 3k 50% | - |
| 2 | LED Red | LED Green | LED Blue | LED Cyan | LED Mag | LED Lav Led | - |
| 3 | Led Red Amb | LED Amb Lav | LED Gul Mag | LED Blue Mag | LED Lav Mag | LED Mag Green | - |
| 4 | LED Red Chase | LED Green Chase | LED Blue Chase | LED Cyan Chase | LED Mag Chase | LED Lav Chase | - |
| 5 | LED Sound Red | LED Sound Green | LED Sound Blue | LED Sound Cyan | LED Sound Mag | LED Sound Multi Col | - |
| 6 | LED Ow Strobe | LED Rnd Strobe | LED Col Strobe | LED Col Rnd Strobe | Moln Col Chase | Moln Ow Strobe | - |
| 7 | LED Speed x2 | LED Speed x4 | LED Speed x6 | LED Speed STOP | - | - | - |
| 8 | LED Dim 75 | LED Dim 50 | LED Dim 25 | LED Dim OFF | - | - | - |

### Viktiga executors i nuvarande config
- **3k 100%** (1/1/1) - Basbelysning, alltid på
- **LED Red** (1/2/1) - Röd färg för röda segment
- **LED Green** (1/2/2) - Grön färg för gröna segment
- **Moln Ow Strobe** (1/6/6) - Bullseye 50p effekt
- **LED Dim OFF** (1/8/4) - Släcker lampor (miss)
- **LED Ow Rnd Strobe** (1/6/2) - 180-effekt (del 1)
- **LED Speed x4** (1/7/2) - 180-effekt (del 2)

## Scolia API Events

### THROW_DETECTED payload
```javascript
{
  sector: "s14" | "d20" | "t19" | "25" | "50" | "None",
  coordinates: [x, y],
  bounceout: boolean
}
```

### Sektor-format
- `s{num}` - Single (t.ex. "s14" = single 14)
- `d{num}` - Double (t.ex. "d20" = double 20)
- `t{num}` - Triple (t.ex. "t19" = triple 19)
- `Bull` - Bull (Scolia skickar samma för inner/outer!)
- `None` - Miss

**OBS:** Scolia skickar "Bull" för både 25p och 50p. Vi använder koordinater för att skilja:
- Distance ≤ 7 enheter från centrum → Inner bull (50p)
- Distance > 7 enheter → Outer bull (25p)

### parseSector() output
```javascript
{ points: number, multiplier: number, segment: number }
// Exempel: "d20" → { points: 40, multiplier: 2, segment: 20 }
```

## Config.json struktur (aktuell)

```javascript
{
  "scolia": {
    "serialNumber": "...",      // Scolia serienummer
    "accessToken": "...",       // API-nyckel
    "serverUrl": "wss://...",   // WebSocket URL
    "simulationMode": false,    // true = ingen Scolia-anslutning
    "reconnectDelay": 5000      // ms mellan återanslutningsförsök
  },
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
        "bullseyeExecutor": { "page": 1, "column": 6, "row": 6 },  // Moln Ow Strobe
        "redSegments": [20, 18, 13, 10, 2, 3, 7, 8, 14, 12],
        "greenSegments": [1, 4, 6, 15, 17, 19, 16, 11, 9, 5],
        "bull25": "green"
      },
      "noScoreExecutor": { "page": 1, "column": 8, "row": 4 }
    }
  },
  "special_events": {
    "180": {
      "enabled": true,
      "lightshark_executors": [  // Array - flera triggas samtidigt
        { "page": 1, "column": 6, "row": 2 },  // LED Ow Rnd Strobe
        { "page": 1, "column": 7, "row": 2 }   // LED Speed x4
      ]
    }
  },
  "mapping": { ... },           // Fallback om colorMode är av
  "logging": { ... }
}
```

## Vanliga ändringar

### Lägga till ny executor-effekt
1. Identifiera executor-koordinater (page/column/row) i LightShark
2. Lägg till i relevant sektion i `config.json`
3. Uppdatera logiken i `handleThrowDetected()` i `index.js`

### Ändra färgmappning
Redigera `colorMode` i `config.json`:
- `redSegments` / `greenSegments` - Vilka segment som är röda/gröna
- `redExecutor` / `greenExecutor` - Vilka executors som triggas

### Lägga till nytt event
1. Lägg till case i `handleScoliaMessage()` switch-sats
2. Skapa handler-funktion vid behov

## Viktigt att veta

1. **OSC är fire-and-forget** - Inget bekräftelsesvar från LightShark
2. **Bull skickas som "Bull"** - Scolia skiljer inte på inner/outer i sektorn, vi använder koordinater (dist ≤ 7 = 50p)
3. **3k 100% ska aldrig triggas manuellt** - Den är alltid på, andra executors skriver över
4. **Executors är toggle-baserade** - Trigga samma executor två gånger = av. Kod förhindrar dubbel-toggle via `lastTriggeredExecutor`

## Körning

```bash
# Produktion
npm start

# Test/Simulator
npm run simulate

# Bakgrundsprocess redan igång?
# Kolla: ps aux | grep node
# Döda: killall node
```

## Filer som rensats bort

- `test-disco-reset.js` - Testfil
- `test-random-executor.js` - Testfil
- `PROJEKTSTRUKTUR.md` - Utdaterad dokumentation
- `INSTALLATIONSGUIDE.md` - Utdaterad dokumentation
- `README_SV.md` - Utdaterad dokumentation
