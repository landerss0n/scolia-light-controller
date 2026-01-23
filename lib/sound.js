const path = require('path');
const { exec } = require('child_process');

class SoundController {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.soundsDir = path.resolve(config.soundsDir || './sounds');

    // play-sound fungerar på macOS (afplay) och Linux (aplay/mpg123)
    // Windows hanteras separat via PowerShell
    if (process.platform !== 'win32') {
      this.player = require('play-sound')();
    }
  }

  playSound(eventName) {
    if (!this.config.enabled) return;

    const soundConfig = this.config.sounds?.[eventName];
    if (!soundConfig || !soundConfig.file) {
      this.logger.debug(`Inget ljud konfigurerat för: ${eventName}`);
      return;
    }

    const filePath = path.join(this.soundsDir, soundConfig.file);

    if (process.platform === 'win32') {
      // Windows: använd PowerShell med SoundPlayer (stödjer WAV nativt)
      const escaped = filePath.replace(/'/g, "''");
      exec(`powershell -c "(New-Object Media.SoundPlayer '${escaped}').PlaySync()"`, (err) => {
        if (err) {
          this.logger.warn(`Kunde inte spela ljud "${eventName}" (${soundConfig.file}): ${err.message}`);
        }
      });
    } else {
      // macOS/Linux: play-sound (afplay, aplay, mpg123, etc.)
      this.player.play(filePath, (err) => {
        if (err) {
          this.logger.warn(`Kunde inte spela ljud "${eventName}" (${soundConfig.file}): ${err.message}`);
        }
      });
    }

    this.logger.debug(`Spelar ljud: ${eventName} (${soundConfig.file})`);
  }
}

module.exports = { SoundController };
