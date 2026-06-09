const fs = require('fs');

// Liten markörfil som överlever process.exit: skrivs precis innan en
// Slack-begärd omstart, läses + raderas vid uppstart för att kunna bekräfta
// "uppe igen". Så vi slipper passera state genom processdöden. Best-effort —
// ett I/O-fel får aldrig hindra omstarten eller uppstarten.
function markRestart(flagPath) {
  try {
    fs.writeFileSync(flagPath, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

// Returnerar true om markören fanns (och raderar den så det blir engångs).
function consumeRestartFlag(flagPath) {
  try {
    if (!fs.existsSync(flagPath)) return false;
    fs.unlinkSync(flagPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = { markRestart, consumeRestartFlag };
