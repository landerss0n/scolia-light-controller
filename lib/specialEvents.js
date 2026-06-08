// Ren beslutslogik för special events (180, 69, 1337, etc).
//
// detectSpecialEvent() tittar på de senaste kasten i throwHistory och avgör
// om ett special event ska triggas. Den är fri från sidoeffekter (ingen
// loggning, inget ljud, ingen LightShark) — anroparen utför effekterna.
//
// VIKTIGT: funktionen muterar throwHistory-objekten genom att sätta
// sentinel-flaggor (t.ex. `_180played`). Det är avsiktligt och är samma
// dedup-mekanism som tidigare fanns inline i index.js: den förhindrar att
// samma event triggas flera gånger för samma kast.
//
// Returnerar antingen null (inget event) eller:
//   { sound, log: { level, message }, executors? }
//     sound      — namnet på ljudet som ska spelas (eller null)
//     log.level  — 'success' | 'warn'
//     log.message— sträng som ska loggas
//     executors  — (endast 180) lista av LightShark-executors att trigga
function detectSpecialEvent(throwHistory, config) {
  const se = config.special_events || {};

  // 180 (3 senaste kasten = 180p totalt)
  if (se['180']?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    const totalPoints = lastThree.reduce((sum, t) => sum + t.points, 0);

    if (totalPoints === 180 && !lastThree.some(t => t._180played)) {
      lastThree.forEach(t => { t._180played = true; });
      const executors = (se['180'].lightshark_executors ||
                         [se['180'].lightshark_executor]).filter(Boolean);
      return {
        sound: '180',
        log: { level: 'success', message: '🔥🔥🔥 180!!! 🔥🔥🔥' },
        executors,
      };
    }
  }

  // 2x triple 20 i rad (120p)
  if (se['120']?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo.every(t => t.segment === 20 && t.multiplier === 3) &&
      !lastTwo.some(t => t._120played)
    ) {
      lastTwo.forEach(t => { t._120played = true; });
      return { sound: '120', log: { level: 'success', message: '🔥🔥 120! Dubbla T20! 🔥🔥' } };
    }
  }

  // Singel 1 → 2 → 3 i följd
  if (se.one_two_three?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 1 && lastThree[0].multiplier === 1 &&
      lastThree[1].segment === 2 && lastThree[1].multiplier === 1 &&
      lastThree[2].segment === 3 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._123played)
    ) {
      lastThree.forEach(t => { t._123played = true; });
      return { sound: 'one_two_three', log: { level: 'success', message: '🍹 1-2-3! Fanta & Rosé! 🍹' } };
    }
  }

  // Trippel 1 (enkelkast — "Oh baby a triple!")
  if (se.triple_one?.enabled && throwHistory.length >= 1) {
    const last = throwHistory[throwHistory.length - 1];
    if (last.segment === 1 && last.multiplier === 3 && !last._tripleOnePlayed) {
      last._tripleOnePlayed = true;
      return { sound: 'triple_one', log: { level: 'success', message: '🎯 Trippel 1! Oh baby a triple! 🎯' } };
    }
  }

  // Singel 3 → 2 → 1 i följd (nedräkning: 3-2-1 liftoff!)
  if (se.three_two_one?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 3 && lastThree[0].multiplier === 1 &&
      lastThree[1].segment === 2 && lastThree[1].multiplier === 1 &&
      lastThree[2].segment === 1 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._321played)
    ) {
      lastThree.forEach(t => { t._321played = true; });
      return { sound: 'three_two_one', log: { level: 'success', message: '🚀 3-2-1 liftoff! 🚀' } };
    }
  }

  // 3x singel 1 i rad
  if (se.three_ones?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree.every(t => t.segment === 1 && t.multiplier === 1) &&
      !lastThree.some(t => t._threeOnesPlayed)
    ) {
      lastThree.forEach(t => { t._threeOnesPlayed = true; });
      return { sound: 'three_ones', log: { level: 'success', message: '🎺 Tre ettor i rad! Wah wah waaaah 🎺' } };
    }
  }

  // Singel 1, singel 1, singel 2 i följd (112)
  if (se.one_one_two?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 1 && lastThree[0].multiplier === 1 &&
      lastThree[1].segment === 1 && lastThree[1].multiplier === 1 &&
      lastThree[2].segment === 2 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._112played)
    ) {
      lastThree.forEach(t => { t._112played = true; });
      return { sound: 'one_one_two', log: { level: 'success', message: '🎵 1-1-2! 🎵' } };
    }
  }

  // Singel 9, singel 1, singel 1 i följd (911)
  if (se.nine_one_one?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 9 && lastThree[0].multiplier === 1 &&
      lastThree[1].segment === 1 && lastThree[1].multiplier === 1 &&
      lastThree[2].segment === 1 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._911played)
    ) {
      lastThree.forEach(t => { t._911played = true; });
      return { sound: 'nine_one_one', log: { level: 'success', message: '🚨 911! 🚨' } };
    }
  }

  // Singel 2 följt av singel 1 (21)
  if (se.twenty_one?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo[0].segment === 2 && lastTwo[0].multiplier === 1 &&
      lastTwo[1].segment === 1 && lastTwo[1].multiplier === 1 &&
      !lastTwo.some(t => t._21played)
    ) {
      lastTwo.forEach(t => { t._21played = true; });
      return { sound: 'twenty_one', log: { level: 'success', message: '🃏 21! 🃏' } };
    }
  }

  // Singel 5 följt av singel 1 (51 — Tony Rickardsson)
  if (se.fifty_one?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo[0].segment === 5 && lastTwo[0].multiplier === 1 &&
      lastTwo[1].segment === 1 && lastTwo[1].multiplier === 1 &&
      !lastTwo.some(t => t._51played)
    ) {
      lastTwo.forEach(t => { t._51played = true; });
      return { sound: 'fifty_one', log: { level: 'success', message: '🏁 51! Tony Rickardsson! 🏁' } };
    }
  }

  // Singel 1 följt av singel 5 (15)
  if (se.fifteen?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo[0].segment === 1 && lastTwo[0].multiplier === 1 &&
      lastTwo[1].segment === 5 && lastTwo[1].multiplier === 1 &&
      !lastTwo.some(t => t._15played)
    ) {
      lastTwo.forEach(t => { t._15played = true; });
      return { sound: 'fifteen', log: { level: 'success', message: '👑 15! 👑' } };
    }
  }

  // 2x singel 3 i rad (33)
  if (se.thirty_three?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo.every(t => t.segment === 3 && t.multiplier === 1) &&
      !lastTwo.some(t => t._33played)
    ) {
      lastTwo.forEach(t => { t._33played = true; });
      return { sound: 'thirty_three', log: { level: 'success', message: '🎤 33! Hur gammal är du då?! 🎤' } };
    }
  }

  // Singel 3, miss, miss i följd (300)
  if (se.three_hundred?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 3 && lastThree[0].multiplier === 1 &&
      lastThree[1].points === 0 &&
      lastThree[2].points === 0 &&
      !lastThree.some(t => t._300played)
    ) {
      lastThree.forEach(t => { t._300played = true; });
      return { sound: 'three_hundred', log: { level: 'success', message: '⚔️ 300! THIS IS SPARTA! ⚔️' } };
    }
  }

  // Singel 4, miss, singel 4 i följd (404)
  if (se.four_oh_four?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 4 && lastThree[0].multiplier === 1 &&
      lastThree[1].points === 0 &&
      lastThree[2].segment === 4 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._404played)
    ) {
      lastThree.forEach(t => { t._404played = true; });
      return { sound: 'four_oh_four', log: { level: 'success', message: '🔍 404! Not Found! 🔍' } };
    }
  }

  // Singel 2 följt av singel 3 (23)
  if (se.twenty_three?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo[0].segment === 2 && lastTwo[0].multiplier === 1 &&
      lastTwo[1].segment === 3 && lastTwo[1].multiplier === 1 &&
      !lastTwo.some(t => t._23played)
    ) {
      lastTwo.forEach(t => { t._23played = true; });
      return { sound: 'twenty_three', log: { level: 'success', message: '🎵 23! 🎵' } };
    }
  }

  // 2x singel 9 i rad (99)
  if (se.ninety_nine?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo.every(t => t.segment === 9 && t.multiplier === 1) &&
      !lastTwo.some(t => t._99played)
    ) {
      lastTwo.forEach(t => { t._99played = true; });
      return { sound: 'ninety_nine', log: { level: 'success', message: '🎵 99! 🎵' } };
    }
  }

  // Singel 18, singel 8, singel 8 i följd (1888)
  if (se.eighteen_eighty_eight?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 18 && lastThree[0].multiplier === 1 &&
      lastThree[1].segment === 8 && lastThree[1].multiplier === 1 &&
      lastThree[2].segment === 8 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._1888played)
    ) {
      lastThree.forEach(t => { t._1888played = true; });
      return { sound: 'eighteen_eighty_eight', log: { level: 'success', message: '⚫🟡 1888! ⚫🟡' } };
    }
  }

  // Singel 19, miss, singel 4 i följd (1904)
  if (se.nineteen_oh_four?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 19 && lastThree[0].multiplier === 1 &&
      lastThree[1].points === 0 &&
      lastThree[2].segment === 4 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._1904played)
    ) {
      lastThree.forEach(t => { t._1904played = true; });
      return { sound: 'nineteen_oh_four', log: { level: 'success', message: '⚽ 1904! 🟡🔵' } };
    }
  }

  // Singel 5, miss, miss i följd (500 — 500 Miles)
  if (se.five_hundred?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 5 && lastThree[0].multiplier === 1 &&
      lastThree[1].points === 0 &&
      lastThree[2].points === 0 &&
      !lastThree.some(t => t._500played)
    ) {
      lastThree.forEach(t => { t._500played = true; });
      return { sound: 'five_hundred', log: { level: 'success', message: '🚶 500! And I would walk 500 miles! 🚶' } };
    }
  }

  // Singel 20, miss, singel 1 i följd (201 / 2001)
  if (se.two_oh_one?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 20 && lastThree[0].multiplier === 1 &&
      lastThree[1].points === 0 &&
      lastThree[2].segment === 1 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._201played)
    ) {
      lastThree.forEach(t => { t._201played = true; });
      return { sound: 'two_oh_one', log: { level: 'success', message: '🎤 2001! Still D.R.E.! 🎤' } };
    }
  }

  // Singel 19, singel 9, singel 8 i följd (1998)
  if (se.nineteen_ninety_eight?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 19 && lastThree[0].multiplier === 1 &&
      lastThree[1].segment === 9 && lastThree[1].multiplier === 1 &&
      lastThree[2].segment === 8 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._1998played)
    ) {
      lastThree.forEach(t => { t._1998played = true; });
      return { sound: 'nineteen_ninety_eight', log: { level: 'success', message: '🎵 1998! 🎵' } };
    }
  }

  // Singel 19, singel 9, singel 4 i följd (1994 — guld i USA)
  if (se.nineteen_ninety_four?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 19 && lastThree[0].multiplier === 1 &&
      lastThree[1].segment === 9 && lastThree[1].multiplier === 1 &&
      lastThree[2].segment === 4 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._1994played)
    ) {
      lastThree.forEach(t => { t._1994played = true; });
      return { sound: 'nineteen_ninety_four', log: { level: 'success', message: '🥇 1994! När vi gräver guld i USA! 🥇' } };
    }
  }

  // Singel 10, singel 5, singel 6 i följd (105.6 — Nilecity)
  if (se.ten_five_six?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].segment === 10 && lastThree[0].multiplier === 1 &&
      lastThree[1].segment === 5 && lastThree[1].multiplier === 1 &&
      lastThree[2].segment === 6 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._1056played)
    ) {
      lastThree.forEach(t => { t._1056played = true; });
      return { sound: 'ten_five_six', log: { level: 'success', message: '📻 105.6! Nilecity! 📻' } };
    }
  }

  // Singel 6 följt av singel 7 (67)
  if (se.six_seven?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo[0].segment === 6 && lastTwo[0].multiplier === 1 &&
      lastTwo[1].segment === 7 && lastTwo[1].multiplier === 1 &&
      !lastTwo.some(t => t._67played)
    ) {
      lastTwo.forEach(t => { t._67played = true; });
      return { sound: 'six_seven', log: { level: 'success', message: '🎵 6-7! 🎵' } };
    }
  }

  // 3x 6 poäng i rad (666)
  if (se.three_sixes?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree.every(t => t.points === 6) &&
      !lastThree.some(t => t._threeSixesPlayed)
    ) {
      lastThree.forEach(t => { t._threeSixesPlayed = true; });
      return { sound: 'three_sixes', log: { level: 'success', message: '😈 Tre sexor i rad! Number of the beast! 😈' } };
    }
  }

  // 3x singel 20 i rad (60p men allt singlar — "riktigt bra" ironiskt)
  if (se.three_twenties?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree.every(t => t.segment === 20 && t.multiplier === 1) &&
      !lastThree.some(t => t._threeTwentiesPlayed)
    ) {
      lastThree.forEach(t => { t._threeTwentiesPlayed = true; });
      return { sound: 'three_twenties', log: { level: 'success', message: '🙄 Tre singel 20 i rad! Riktigt bra! 🙄' } };
    }
  }

  // 69 (6 poäng följt av 9 poäng)
  if (se.sixty_nine?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo[0].points === 6 &&
      lastTwo[1].points === 9 &&
      !lastTwo.some(t => t._69played)
    ) {
      lastTwo.forEach(t => { t._69played = true; });
      return { sound: 'sixty_nine', log: { level: 'success', message: '😏 69! Nice! 😏' } };
    }
  }

  // 7-7-7 (tre kast på segment 7)
  if (se.triple_seven?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree.every(t => t.segment === 7 && t.multiplier === 1) &&
      !lastThree.some(t => t._tripleSevenPlayed)
    ) {
      lastThree.forEach(t => { t._tripleSevenPlayed = true; });
      return { sound: 'triple_seven', log: { level: 'success', message: '🎰 7-7-7! JACKPOT! 🎰' } };
    }
  }

  // 1337 (13 poäng, 3 poäng, 7 poäng)
  if (se.thirteen_thirty_seven?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].points === 13 &&
      lastThree[1].points === 3 &&
      lastThree[2].points === 7 &&
      !lastThree.some(t => t._1337played)
    ) {
      lastThree.forEach(t => { t._1337played = true; });
      return { sound: 'thirteen_thirty_seven', log: { level: 'success', message: '💻 1337! H4X0R! 💻' } };
    }
  }

  // 420 (4 poäng följt av 20 poäng)
  if (se.four_twenty?.enabled && throwHistory.length >= 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo[0].points === 4 &&
      lastTwo[1].points === 20 &&
      !lastTwo.some(t => t._420played)
    ) {
      lastTwo.forEach(t => { t._420played = true; });
      return { sound: 'four_twenty', log: { level: 'success', message: '🌿 420! 🌿' } };
    }
  }

  // 007 (miss, miss, 7)
  if (se.double_oh_seven?.enabled && throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (
      lastThree[0].points === 0 &&
      lastThree[1].points === 0 &&
      lastThree[2].segment === 7 && lastThree[2].multiplier === 1 &&
      !lastThree.some(t => t._007played)
    ) {
      lastThree.forEach(t => { t._007played = true; });
      return { sound: 'double_oh_seven', log: { level: 'success', message: '🔫 007! Miss, miss, seven! 🔫' } };
    }
  }

  // 2 missar i rad (sista chansen!) - endast på pil 1 och 2 efter takeout
  if (se.last_chance?.enabled && throwHistory.length === 2) {
    const lastTwo = throwHistory.slice(-2);
    if (
      lastTwo.every(t => t.points === 0) &&
      !lastTwo.some(t => t._lastChancePlayed)
    ) {
      lastTwo.forEach(t => { t._lastChancePlayed = true; });
      return { sound: 'last_chance', log: { level: 'success', message: '⚠️ Två missar i rad! Sista chansen! ⚠️' } };
    }
  }

  // 3 missar i rad (sätt sentinel så det inte triggas igen på miss #4, #5 etc.)
  if (throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    if (lastThree.every(t => t.points === 0 && !t.threeMissPlayed)) {
      lastThree.forEach(t => { t.threeMissPlayed = true; });
      return { sound: 'three_misses', log: { level: 'warn', message: '💀 Tre missar i rad!' } };
    }
  }

  // Total-score check: efter 3 kast, kolla om totalsumman matchar ett event.
  // Lägre prioritet än alla sekvens-events ovan.
  if (throwHistory.length >= 3) {
    const lastThree = throwHistory.slice(-3);
    const totalPoints = lastThree.reduce((sum, t) => sum + t.points, 0);

    const totalScoreEvents = {
      21:  { config: 'twenty_one',     sound: 'twenty_one',    emoji: '🃏', label: '21' },
      23:  { config: 'twenty_three',   sound: 'twenty_three',  emoji: '🎵', label: '23' },
      33:  { config: 'thirty_three',   sound: 'thirty_three',  emoji: '🎤', label: '33' },
      67:  { config: 'six_seven',      sound: 'six_seven',     emoji: '🎵', label: '67' },
      69:  { config: 'sixty_nine',     sound: 'sixty_nine',    emoji: '😏', label: '69' },
      99:  { config: 'ninety_nine',    sound: 'ninety_nine',   emoji: '🎵', label: '99' },
      111: { config: 'three_ones',     sound: 'three_ones',    emoji: '🎺', label: '111' },
      112: { config: 'one_one_two',    sound: 'one_one_two',   emoji: '🎵', label: '112' },
      123: { config: 'one_two_three',  sound: 'one_two_three', emoji: '🍹', label: '123' },
    };

    const event = totalScoreEvents[totalPoints];
    if (event && se[event.config]?.enabled && !lastThree.some(t => t[`_total${totalPoints}played`])) {
      lastThree.forEach(t => { t[`_total${totalPoints}played`] = true; });
      return {
        sound: event.sound,
        log: {
          level: 'success',
          message: `${event.emoji} Total ${event.label}! (${lastThree.map(t => t.points).join(' + ')} = ${totalPoints}) ${event.emoji}`,
        },
      };
    }

    // Low score: under 10 poäng på 3 kast
    if (se.low_score?.enabled && totalPoints < 10 && !lastThree.some(t => t._lowScorePlayed)) {
      lastThree.forEach(t => { t._lowScorePlayed = true; });
      return {
        sound: 'low_score',
        log: { level: 'warn', message: `😬 Låg poäng! (${lastThree.map(t => t.points).join(' + ')} = ${totalPoints})` },
      };
    }
  }

  return null;
}

module.exports = { detectSpecialEvent };
