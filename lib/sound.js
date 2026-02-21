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
    if (!soundConfig || !soundConfig.file || soundConfig.enabled === false) {
      this.logger.debug(`Inget ljud konfigurerat för: ${eventName}`);
      return;
    }

    const filePath = path.join(this.soundsDir, soundConfig.file);

    // Volym: 0.0–1.0, default 1.0
    const volume = soundConfig.volume !== undefined ? soundConfig.volume : 1.0;

    if (process.platform === 'win32') {
      // Windows: använd PowerShell med SoundPlayer (stödjer WAV nativt, ingen volymsupport)
      const escaped = filePath.replace(/'/g, "''");
      exec(`powershell -c "(New-Object Media.SoundPlayer '${escaped}').PlaySync()"`, { windowsHide: true }, (err) => {
        if (err) {
          this.logger.warn(`Kunde inte spela ljud "${eventName}" (${soundConfig.file}): ${err.message}`);
        }
      });
    } else if (process.platform === 'darwin') {
      // macOS: afplay med volym (0.0–1.0 mappas till afplays 0–256 skala)
      const afplayVol = Math.round(volume * 256);
      exec(`afplay -v ${afplayVol / 256} "${filePath}"`, (err) => {
        if (err) {
          this.logger.warn(`Kunde inte spela ljud "${eventName}" (${soundConfig.file}): ${err.message}`);
        }
      });
    } else {
      // Linux: play-sound (aplay, mpg123, etc. — ingen volymsupport)
      this.player.play(filePath, (err) => {
        if (err) {
          this.logger.warn(`Kunde inte spela ljud "${eventName}" (${soundConfig.file}): ${err.message}`);
        }
      });
    }

    this.logger.debug(`Spelar ljud: ${eventName} (${soundConfig.file})`);
  }

  playSoundWithFallback(specificEvent, fallbackEvent) {
    // Försök segment-specifikt ljud först, annars generellt
    const specificConfig = this.config.sounds?.[specificEvent];
    if (specificConfig && specificConfig.file) {
      this.playSound(specificEvent);
    } else {
      this.playSound(fallbackEvent);
    }
  }
}

module.exports = { SoundController };
