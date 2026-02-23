const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

class SoundController {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.soundsDir = path.resolve(__dirname, '..', config.soundsDir || './sounds');
    this.psProcess = null;
    this.closing = false;
    this._onMute = null;
    this._onUnmute = null;
    this._unmuteTimer = null;

    if (process.platform === 'win32') {
      this.spawnPowerShell();
    } else if (process.platform !== 'darwin') {
      // Linux: play-sound (aplay, mpg123, etc.)
      this.player = require('play-sound')();
    }
  }

  setMuteCallbacks(onMute, onUnmute) {
    this._onMute = onMute;
    this._onUnmute = onUnmute;
  }

  _mute() {
    if (this._onMute) Promise.resolve(this._onMute()).catch(() => {});
  }

  _unmute() {
    if (this._onUnmute) Promise.resolve(this._onUnmute()).catch(() => {});
  }

  _cancelUnmuteTimer() {
    if (this._unmuteTimer) {
      clearTimeout(this._unmuteTimer);
      this._unmuteTimer = null;
    }
  }

  _scheduleUnmute(filePath) {
    this._cancelUnmuteTimer();
    const durationMs = this._getWavDurationMs(filePath);
    this._unmuteTimer = setTimeout(() => {
      this._unmuteTimer = null;
      this._unmute();
    }, durationMs);
  }

  _getWavDurationMs(filePath) {
    try {
      const fd = fs.openSync(filePath, 'r');
      const header = Buffer.alloc(44);
      fs.readSync(fd, header, 0, 44, 0);
      fs.closeSync(fd);
      const byteRate = header.readUInt32LE(28);
      const dataSize = header.readUInt32LE(40);
      if (byteRate <= 0) return 5000;
      return Math.ceil((dataSize / byteRate) * 1000) + 300; // +300ms buffer
    } catch {
      return 5000; // Fallback 5s
    }
  }

  spawnPowerShell() {
    // Förspawnad PowerShell-process som lyssnar på stdin.
    // Varje rad = filsökväg att spela. Play() är non-blocking (bakgrundstråd).
    // Eliminerar ~300-800ms startup-overhead per ljud.
    const script = [
      '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
      'while ($true) {',
      '  $line = [Console]::ReadLine()',
      '  if ($line -eq $null) { break }',
      '  try {',
      '    (New-Object System.Media.SoundPlayer $line).Play()',
      '  } catch {',
      '    [Console]::Error.WriteLine($_.Exception.Message)',
      '  }',
      '}',
    ].join('\n');

    this.psProcess = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-Command', script
    ], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    });

    this.psProcess.stderr.on('data', (data) => {
      this.logger.warn(`PowerShell ljud-fel: ${data.toString().trim()}`);
    });

    this.psProcess.on('exit', (code) => {
      this.psProcess = null;
      if (this.closing) return;
      this.logger.warn(`PowerShell ljud-process avslutades (kod ${code}), startar om...`);
      setTimeout(() => this.spawnPowerShell(), 100);
    });

    this.logger.debug('PowerShell ljud-process startad');
  }

  playSound(eventName) {
    if (!this.config.enabled) return;

    const soundConfig = this.config.sounds?.[eventName];
    if (!soundConfig || !soundConfig.file || soundConfig.enabled === false) {
      this.logger.debug(`Inget ljud konfigurerat för: ${eventName}`);
      return;
    }

    const filePath = path.resolve(this.soundsDir, soundConfig.file);

    // Förhindra path traversal
    if (!filePath.startsWith(this.soundsDir)) {
      this.logger.warn(`Ogiltig ljudsökväg: ${soundConfig.file}`);
      return;
    }

    const volume = soundConfig.volume !== undefined ? soundConfig.volume : 1.0;

    // Mute browser audio while our sound plays
    this._mute();
    this._cancelUnmuteTimer();

    if (process.platform === 'win32') {
      // Skicka filsökväg till förspawnad PowerShell-process
      if (this.psProcess && this.psProcess.stdin.writable) {
        this.psProcess.stdin.write(filePath + '\n');
      } else {
        // Fallback om PowerShell-processen inte är redo
        execFile('powershell', [
          '-NoProfile', '-NonInteractive', '-Command',
          '(New-Object Media.SoundPlayer $args[0]).PlaySync()',
          filePath
        ], { windowsHide: true }, (err) => {
          if (err) {
            this.logger.warn(`Kunde inte spela ljud "${eventName}" (${soundConfig.file}): ${err.message}`);
          }
          this._unmute();
        });
        this.logger.debug(`Spelar ljud: ${eventName} (${soundConfig.file})`);
        return; // Fallback hanterar unmute via callback
      }
      // Huvudväg: unmute efter WAV-filens duration
      this._scheduleUnmute(filePath);
    } else if (process.platform === 'darwin') {
      // macOS: afplay med volym — kill föregående för att undvika process-ackumulering
      if (this.activeProcess) {
        this.activeProcess.kill();
        this.activeProcess = null;
      }
      const proc = spawn('afplay', ['-v', String(volume), filePath]);
      this.activeProcess = proc;
      proc.on('error', (err) => {
        this.logger.warn(`Kunde inte spela ljud "${eventName}" (${soundConfig.file}): ${err.message}`);
      });
      proc.on('exit', () => {
        if (this.activeProcess === proc) {
          this.activeProcess = null;
          this._unmute();
        }
      });
    } else {
      // Linux: play-sound (aplay, mpg123, etc.)
      this.player.play(filePath, (err) => {
        if (err) {
          this.logger.warn(`Kunde inte spela ljud "${eventName}" (${soundConfig.file}): ${err.message}`);
        }
        this._unmute();
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

  close() {
    this.closing = true;
    this._cancelUnmuteTimer();
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
    if (this.psProcess) {
      this.psProcess.stdin.end();
      this.psProcess.kill();
      this.psProcess = null;
    }
  }
}

module.exports = { SoundController };
