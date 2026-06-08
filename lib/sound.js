const path = require('path');
const { execFile, spawn } = require('child_process');

// Välj vilken fil (och volym) som ska spelas för ett sound-config.
// Stödjer både enstaka fil (`file`) och flera filer (`files`) där en väljs
// slumpmässigt — t.ex. för att variera bust-ljudet. Varje entry i `files`
// kan vara en sträng ("namn.wav") eller ett objekt ({ file, volume }) där
// volym åsidosätter event-volymen. `rand` injiceras för testbarhet.
// Returnerar { file, volume } eller null om inget är konfigurerat.
function resolveSoundFile(soundConfig, rand = Math.random) {
  if (!soundConfig) return null;

  if (Array.isArray(soundConfig.files) && soundConfig.files.length > 0) {
    const idx = Math.floor(rand() * soundConfig.files.length);
    const entry = soundConfig.files[idx];
    if (typeof entry === 'string') {
      return { file: entry, volume: soundConfig.volume };
    }
    if (entry && entry.file) {
      return { file: entry.file, volume: entry.volume !== undefined ? entry.volume : soundConfig.volume };
    }
    return null;
  }

  if (soundConfig.file) {
    return { file: soundConfig.file, volume: soundConfig.volume };
  }

  return null;
}

class SoundController {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.soundsDir = path.resolve(__dirname, '..', config.soundsDir || './sounds');
    this.psProcess = null;
    this.closing = false;

    if (process.platform === 'win32') {
      this.spawnPowerShell();
    } else if (process.platform !== 'darwin') {
      // Linux: play-sound (aplay, mpg123, etc.)
      this.player = require('play-sound')();
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
    if (!soundConfig || soundConfig.enabled === false) {
      this.logger.debug(`Inget ljud konfigurerat för: ${eventName}`);
      return;
    }

    const picked = resolveSoundFile(soundConfig);
    if (!picked) {
      this.logger.debug(`Inget ljud konfigurerat för: ${eventName}`);
      return;
    }

    const filePath = path.resolve(this.soundsDir, picked.file);

    // Förhindra path traversal
    if (!filePath.startsWith(this.soundsDir)) {
      this.logger.warn(`Ogiltig ljudsökväg: ${picked.file}`);
      return;
    }

    const volume = picked.volume !== undefined ? picked.volume : 1.0;

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
            this.logger.warn(`Kunde inte spela ljud "${eventName}" (${picked.file}): ${err.message}`);
          }
        });
        this.logger.debug(`Spelar ljud: ${eventName} (${picked.file})`);
        return;
      }
    } else if (process.platform === 'darwin') {
      // macOS: afplay med volym — kill föregående för att undvika process-ackumulering
      if (this.activeProcess) {
        this.activeProcess.kill();
        this.activeProcess = null;
      }
      const proc = spawn('afplay', ['-v', String(volume), filePath]);
      this.activeProcess = proc;
      proc.on('error', (err) => {
        this.logger.warn(`Kunde inte spela ljud "${eventName}" (${picked.file}): ${err.message}`);
      });
      proc.on('exit', () => {
        if (this.activeProcess === proc) {
          this.activeProcess = null;
        }
      });
    } else {
      // Linux: play-sound (aplay, mpg123, etc.)
      this.player.play(filePath, (err) => {
        if (err) {
          this.logger.warn(`Kunde inte spela ljud "${eventName}" (${picked.file}): ${err.message}`);
        }
        });
    }

    this.logger.debug(`Spelar ljud: ${eventName} (${picked.file})`);
  }

  playSoundWithFallback(specificEvent, fallbackEvent) {
    // Försök segment-specifikt ljud först, annars generellt
    const specificConfig = this.config.sounds?.[specificEvent];
    if (resolveSoundFile(specificConfig)) {
      this.playSound(specificEvent);
    } else {
      this.playSound(fallbackEvent);
    }
  }

  close() {
    this.closing = true;
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

module.exports = { SoundController, resolveSoundFile };
