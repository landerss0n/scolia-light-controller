# Scolia Light Controller - Projektkontext

Detta dokument innehåller all kontext som behövs för att göra ändringar i projektet.

## Projektöversikt

**Syfte:** Styra LightShark-belysning och ljudeffekter baserat på dartkast från Scolia smart darttavla.

**Huvudflöde:**
1. Scolia darttavla detekterar kast via kamera
2. Scolia SBC skickar event till Scolia Cloud
3. Vår app (index.js) tar emot THROW_DETECTED via WebSocket
4. App triggar LightShark executor via OSC baserat på kasttyp
5. Vid TAKEOUT_FINISHED (pilar tas ut) → återställ till basbelysning
6. Playwright öppnar Scolia webbapp och övervakar DOM för bust/leg-won/set-won

## Arkitektur

```
Scolia Darttavla → Scolia Cloud (WebSocket) → index.js → LightShark (OSC)
                                                       → KNX (KNXnet/IP)
                                                       → Ljud (afplay / PowerShell)

Scolia Webbapp ← Playwright (DOM-polling) → index.js → Ljud (bust/leg-won/set-won)

KNX IP-gateway ──extern länk──→ LightShark (KNX allOff/allOn påverkar LightShark)
```

## Viktiga filer

### index.js (Huvudapp)
- WebSocket-anslutning till Scolia (`wss://game.scoliadarts.com/api/v1/social`)
- Hanterar events: `THROW_DETECTED`, `TAKEOUT_FINISHED`, `TAKEOUT_STARTED`
- Parsear sektor-strängar från Scolia (t.ex. "s14", "d20", "t19", "25", "50")
- Triggar LightShark executors baserat på `config.json`
- Spelar ljud vid kast, special events och takeout
- Startar Playwright för bust/win-detection via Scolia webbapp

### lib/playwright.js
- Öppnar Scolia webbapp i Chromium via Playwright
- Auto-login med sparade cookies eller credentials
- DOM-polling (200ms intervall) för att detektera:
  - **Bust** — element med `statusInfoBusted` + `isBusted` i class
  - **Leg won** — `winnerTile` med text "Won the Leg"
  - **Set won** — `winnerTile` med text "Won the Set"
- Emittar events: `bust`, `leg-won`, `set-won`
- Hanterar automatiskt: cookie-popup, "Finish & View Stats" (30s delay), post-game reload, board selection
- Fullscreen via CDP (`Browser.setWindowBounds`)
- Ljudblockering via Web Audio API hook (`addInitScript`):
  - **Permanent blockering:** specifika offsets i Scolias audio sprite (bust=580.8s)
  - **Temporär mute:** `window.__scoliaMuted` flagga blockerar ALLT Scolia-ljud medan våra egna ljud spelas
- `muteAudio()` / `unmuteAudio()` — sätter `__scoliaMuted` via `page.evaluate()`, anropas av SoundController
- Auto-restart vid browser-krasch

### lib/lightshark.js
- OSC-kommunikation med LightShark
- `triggerExecutor(page, column, row)` - Triggar executor via OSC
- OSC-adress: `/LS/Executor/{page}/{column}/{row}` med värde 0.0 (toggle)
- Port: 8000 (UDP)

### lib/logger.js
- Loggning till konsol och fil
- Metoder: `info()`, `success()`, `warn()`, `error()`, `debug()`

### lib/sound.js
- Ljuduppspelning via `afplay` (macOS med volymstöd), `play-sound` (Linux) och PowerShell (Windows)
- `playSound(eventName)` - Spelar ljud fire-and-forget, mutar Scolia-ljud i browsern under uppspelning
- `playSoundWithFallback(specific, fallback)` - Försöker segment-specifikt ljud först (t.ex. `triple_20`), faller tillbaka till generellt (t.ex. `triple`)
- `setMuteCallbacks(onMute, onUnmute)` - Kopplas till PlaywrightController.muteAudio/unmuteAudio i index.js
- Stöd per ljud: `volume` (0.0–2.0, default 1.0), `enabled` (true/false)
- Kräver WAV-filer i `sounds/`-mappen
- **Browser-mute under uppspelning:** Mutar allt Scolia-ljud medan vårt ljud spelas. Unmute sker via:
  - **Windows:** Timer baserad på WAV-filens duration (läser header: byteRate + dataSize, +300ms buffer)
  - **macOS:** `afplay` process exit
  - **Linux:** `play-sound` callback

### lib/knx.js
- KNX IP-gateway kommunikation via `knx` npm-paket
- `connect()` - Anslut till KNX gateway
- `write(groupAddress, value, dpt)` - Skriv till gruppadress
- `triggerAction(actionName)` - Kör namngiven action från config (t.ex. 'allOff', 'allOn')
- `disconnect()` - Koppla ner


## Nuvarande ljuslogik (colorMode)

Finns i `index.js` → `handleThrowDetected()`:

```javascript
// Prioritetsordning:
1. Miss (points === 0) → noScoreExecutor (LightShark) + KNX allOff (om KNX aktivt)
2. Bullseye 50p → bullseyeExecutor (Moln Ow Strobe) + Strobe overlay 3s
3. Bull 25p → greenExecutor (LED Green)
4. Trippel 20 → redExecutor + Strobe overlay 3s
5. Dubbel/Trippel på rött segment → redExecutor
6. Dubbel/Trippel på grönt segment → greenExecutor
7. Singel → Släck senaste färg + KNX allOn om lampor var släckta
```

### Strobe overlay (T20 + Bullseye 50p)
Vid Triple 20 och Bullseye 50p triggas en extra strobe-effekt (LED Strobe Fast, 1/5/3) ovanpå den vanliga färgen. Stroben körs i 3 sekunder och togglas sedan av automatiskt — färgen (röd/bullseye) lyser kvar.

- Config: `colorMode.triple20Strobe` med `executor` och `durationMs`
- State: `strobeTimer` — global timer som rensas vid takeout, reconnect och SIGINT
- Om ny strobe triggas medan en pågår → föregående rensas först (toggle av + clearTimeout)

### KNX-interaktion med LightShark
KNX har en extern fysisk länk till LightShark. Detta innebär:
- **KNX allOff** → Släcker ALL belysning (inkl. LightShark via extern länk)
- **KNX allOn** → Återställer basbelysning (3k 100% på LightShark)
- **Färg-kast efter miss** → Triggar LightShark-färg direkt UTAN KNX allOn (färg-executors funkar oberoende av 3k 100%)
- **Singel efter miss** → KNX allOn (återställer 3k 100%)
- **Timing viktigt:** KNX allOn skickas bara vid singlar/icke-färg-kast för att undvika att 3k 100% skriver över färgen

### Darttavlans färgschema
- **Röda segment:** 20, 18, 13, 10, 2, 3, 7, 8, 14, 12
- **Gröna segment:** 1, 4, 6, 15, 17, 19, 16, 11, 9, 5
- **Bullseye (50p):** Röd
- **Bull (25p):** Grön

### Viktiga variabler
- `lastTriggeredExecutor` - Sparar senast triggade executor för att kunna släcka vid nästa kast/takeout
- `lastSpecialExecutors[]` - Sparar 180-executors för att kunna toggla av vid takeout
- `knxLightsOff` - Boolean som spårar om KNX har släckt lamporna (true efter miss)
- `strobeTimer` - Timer för T20/Bullseye strobe auto-off (rensas vid takeout/reconnect/SIGINT)
- `throwHistory[]` - Sparar kasthistorik för special events. Nollställs vid takeout (ny spelares tur) och WebSocket-reconnect. Sentinels på kastobjekt förhindrar dubbletter: `_180played`, `_120played`, `_123played`, `_threeOnesPlayed`, `threeMissPlayed`, `_threeSixesPlayed`, `_007played`, `_420played`, `_1337played`, `_tripleSevenPlayed`, `_69played`, `_112played`, `_911played`, `_67played`, `_1904played`, `_1888played`, `_99played`, `_21played`, `_23played`, `_404played`
- Alla state-variabler nollställs vid WebSocket-reconnect (`ws.on('close')`)

## LightShark Executor Grid (Page 1)

Baserat på användarens setup:

| Col | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 |
|-----|-------|-------|-------|-------|-------|-------|
| 1 | 3k 100% | 3k Col | Color 1 | Colour 2 | Colour 3 | Neon Fire |
| 2 | LED Red | LED Green | LED Blue | LED Cyan | LED Mag | LED Lav |
| 3 | Led Pink Amb | LED Amb Lav | LED Mag Yell | LED Blue Mag | LED Lav Red | LED Mag Green |
| 4 | - | - | - | - | - | - |
| 5 | Strobe OFF | LED Strobe Slow | LED Strobe Fast | - | - | - |

### Viktiga executors i nuvarande config
- **3k 100%** (1/1/1) - Basbelysning, alltid på
- **LED Red** (1/2/1) - Röd färg för röda segment
- **LED Green** (1/2/2) - Grön färg för gröna segment
- **Moln Ow Strobe** (1/6/6) - Bullseye 50p effekt
- **LED Strobe Fast** (1/5/3) - Strobe overlay för T20 och Bullseye (3s timed)
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
        "bullseyeExecutor": { "page": 1, "column": 6, "row": 6 },
        "redSegments": [20, 18, 13, 10, 2, 3, 7, 8, 14, 12],
        "greenSegments": [1, 4, 6, 15, 17, 19, 16, 11, 9, 5],
        "bull25": "green",
        "triple20Strobe": {
          "executor": { "page": 1, "column": 5, "row": 3 },
          "durationMs": 3000
        }
      },
      "noScoreExecutor": { "page": 1, "column": 8, "row": 4 }
    }
  },
  "special_events": {
    "180": {
      "enabled": true,
      "lightshark_executors": [
        { "page": 1, "column": 6, "row": 2 },
        { "page": 1, "column": 7, "row": 2 }
      ]
    },
    "120": { "enabled": true },
    "one_two_three": { "enabled": true },
    "three_ones": { "enabled": true },
    "three_sixes": { "enabled": true },
    "double_oh_seven": { "enabled": true },
    "four_twenty": { "enabled": true },
    "thirteen_thirty_seven": { "enabled": true },
    "triple_seven": { "enabled": true },
    "sixty_nine": { "enabled": true },
    "one_one_two": { "enabled": true },
    "nine_one_one": { "enabled": true },
    "six_seven": { "enabled": true },
    "nineteen_oh_four": { "enabled": true },
    "eighteen_eighty_eight": { "enabled": true },
    "ninety_nine": { "enabled": true },
    "twenty_one": { "enabled": true },
    "twenty_three": { "enabled": true },
    "four_oh_four": { "enabled": true }
  },
  "playwright": {
    "enabled": true,
    "url": "https://game.scoliadarts.com",
    "fullscreen": true,
    "pollIntervalMs": 200,
    "cookieFile": "./scolia-cookies.json",
    "credentials": {
      "email": "...",
      "password": "..."
    }
  },
  "sound": {
    "enabled": true,
    "soundsDir": "./sounds",
    "sounds": {
      "miss": { "file": "miss.wav" },
      "bullseye": { "file": "headshot.wav" },
      "bull25": { "file": "ultrakill.wav" },
      "double": { "file": "doublekill.wav" },
      "triple": { "file": "triplekill.wav" },
      "triple_20": { "file": "godlike.wav" },
      "triple_19": { "file": "dominating.wav" },
      "triple_18": { "file": "unstoppable.wav" },
      "triple_17": { "file": "rampage.wav" },
      "single_1": { "file": "cd1.wav" },
      "180": { "file": "monsterkill.wav" },
      "120": { "file": "120.wav" },
      "one_two_three": { "file": "one_two_three.wav" },
      "three_ones": { "file": "three_ones.wav" },
      "three_misses": { "file": "lostmatch.wav" },
      "takeout": { "file": "draw.wav", "volume": 0.25 },
      "bust": { "file": "tjockis.wav", "volume": 2.0 },
      "leg_won": { "file": "holy-shit.wav" },
      "set_won": { "file": "set_won.wav" },
      "one_one_two": { "file": "one_one_two.wav" },
      "nine_one_one": { "file": "nine_one_one.wav" },
      "six_seven": { "file": "six_seven.wav" },
      "nineteen_oh_four": { "file": "nineteen_oh_four.wav" },
      "eighteen_eighty_eight": { "file": "eighteen_eighty_eight.wav" },
      "ninety_nine": { "file": "ninety_nine.wav" },
      "twenty_one": { "file": "twenty_one.wav" },
      "twenty_three": { "file": "twenty_three.wav" },
      "four_oh_four": { "file": "four_oh_four.wav" }
    }
  },
  "knx": {
    "enabled": false,
    "gateway": "192.168.6.169",
    "port": 3671,
    "actions": {
      "allOff": [{ "ga": "0/0/1", "value": 5 }],
      "allOn": [{ "ga": "0/0/1", "value": 0 }]
    }
  },
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

### Lägga till nytt ljud
1. Lägg WAV-fil i `sounds/`
2. Lägg till mappning i `config.json` → `sound.sounds`
3. Segment-specifika: namnge `{type}_{segment}` (t.ex. `double_20`)
4. Trigga via `sound.playSound('eventName')` eller `sound.playSoundWithFallback('specific', 'fallback')`

### Lägga till nytt event
1. Lägg till case i `handleScoliaMessage()` switch-sats
2. Skapa handler-funktion vid behov

## Ljudlogik

### Kast-ljud (via WebSocket THROW_DETECTED)
Triggas parallellt med ljuseffekter (fire-and-forget) i `handleThrowDetected()`:

```javascript
// Special events har högst prio (checkSpecialEvents()):
1. 180 → ljuseffekt only (3 senaste kast = 180p totalt, eget ljud disabled)
2. 120 → '120' (2x triple 20 i rad)
3. 1-2-3 → 'one_two_three' (singel 1 → 2 → 3 i följd)
4. 3x singel 1 → 'three_ones' (sad trombone)
5. 69 → 'sixty_nine' (6p följt av 9p)
6. 7-7-7 → 'triple_seven' (3x singel 7 i rad)
7. 1337 → 'thirteen_thirty_seven' (13p, 3p, 7p i följd)
8. 420 → 'four_twenty' (4p följt av 20p)
9. 007 → 'double_oh_seven' (miss, miss, singel 7)
10. 666 → 'three_sixes' (3x 6p i rad)
11. 404 → 'four_oh_four' (singel 4, miss, singel 4)
12. 1904 → 'nineteen_oh_four' (singel 19, miss, singel 4)
13. 1888 → 'eighteen_eighty_eight' (singel 18, singel 8, singel 8)
14. 112 → 'one_one_two' (singel 1, singel 1, singel 2)
15. 911 → 'nine_one_one' (singel 9, singel 1, singel 1)
16. 21 → 'twenty_one' (singel 2, singel 1)
17. 23 → 'twenty_three' (singel 2, singel 3)
18. 67 → 'six_seven' (singel 6, singel 7)
19. 99 → 'ninety_nine' (2x singel 9 i rad)
20. Tre missar i rad → 'lostmatch'
// Om inget special event spelades:
3. Miss → 'miss' (miss.wav)
4. Bullseye 50p → 'bullseye' (headshot.wav)
5. Bull 25p → 'bull25' (ultrakill.wav)
6. Trippel → 'triple_{segment}' med fallback till 'triple'
7. Dubbel → 'double_{segment}' med fallback till 'double'
8. Singel 1 → 'single_1' (cd1.wav)
```

Segment-specifika ljud har prioritet via `playSoundWithFallback()`:
- T20 → godlike, T19 → dominating, T18 → unstoppable, T17 → rampage, T7 → triple_7 (jackpot)
- Övriga tripplar → triplekill (generellt)

### Spel-ljud (via Playwright DOM-polling)
- Bust → 'bust' (tjockis.wav, volume 2.0)
- Leg won → 'leg_won' (set_won.wav)
- Set won → 'set_won' (monsterkill.wav)

### Takeout-ljud (via WebSocket TAKEOUT_FINISHED)
- Takeout → 'takeout' (draw.wav, volume 0.25)

## Viktigt att veta

1. **OSC är fire-and-forget** - Inget bekräftelsesvar från LightShark
2. **Ljud är fire-and-forget** - Varje play() spawnar ny process, blockerar inte
3. **Bull skickas som "Bull"** - Scolia skiljer inte på inner/outer i sektorn, vi använder koordinater (dist ≤ 7 = 50p)
4. **3k 100% ska aldrig triggas manuellt** - Den är alltid på, andra executors skriver över
5. **Executors är toggle-baserade** - Trigga samma executor två gånger = av. Kod förhindrar dubbel-toggle via `lastTriggeredExecutor`
6. **Cross-platform ljud** - macOS: afplay, Linux: aplay/mpg123, Windows: PowerShell SoundPlayer
7. **KNX extern länk till LightShark** - KNX allOff/allOn påverkar LightShark. Färg-executors triggas direkt utan KNX allOn för att undvika att 3k 100% skriver över färgen
8. **KNX allOn bara vid singlar** - Vid färg-kast (dubbel/trippel) efter miss skickas INTE KNX allOn — färg-executors funkar oberoende
9. **Playwright bust-detection via DOM** - Räknar `statusInfoBusted`-element, detekterar ökning (hanterar konsekutiva busts)
10. **Scolia Social API skickar inte matchstart/matchslut** - Bust/win detekteras via Playwright DOM-polling istället

## Körning

```bash
# Starta (ljus + ljud + Playwright)
npm start

# Test/Simulator
npm run simulate
```

## Filer som rensats bort

- `test-disco-reset.js` - Testfil
- `test-random-executor.js` - Testfil
- `PROJEKTSTRUKTUR.md` - Utdaterad dokumentation
- `INSTALLATIONSGUIDE.md` - Utdaterad dokumentation
- `README_SV.md` - Utdaterad dokumentation
- `webapp/` - Next.js webapp (ersatt av Playwright DOM-polling mot Scolias webbapp)
- REST API (Express) - Borttaget, poängspårning sköts nu av Scolia + Playwright
- `gameState` / `handleGameThrow()` / `advanceTurn()` / `revertTurn()` - Intern spellogik borttagen
