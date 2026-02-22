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

module.exports = { parseSector };
