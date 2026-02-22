const fs = require('fs');
const path = require('path');

class Logger {
  constructor(config) {
    this.config = config || { enabled: true, consoleOutput: true };
    this.logFile = path.resolve(__dirname, '..', config.logFile || 'dart-events.log');
    this.maxFileSize = config.maxFileSize || 5 * 1024 * 1024; // 5 MB
    this.maxFiles = config.maxFiles || 3;
    this.stream = null;

    if (this.config.enabled && this.logFile) {
      this.rotateIfNeeded();
      this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
    }
  }

  rotateIfNeeded() {
    try {
      const stats = fs.statSync(this.logFile);
      if (stats.size < this.maxFileSize) return;
    } catch {
      return; // File doesn't exist yet
    }

    const ext = path.extname(this.logFile);
    const base = this.logFile.slice(0, -ext.length || undefined);

    // Radera äldsta, skifta övriga: .3 → delete, .2 → .3, .1 → .2
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const older = `${base}.${i + 1}${ext}`;
      const newer = `${base}.${i}${ext}`;
      try { fs.unlinkSync(older); } catch { /* file may not exist */ }
      try { fs.renameSync(newer, older); } catch { /* file may not exist */ }
    }

    try {
      fs.renameSync(this.logFile, `${base}.1${ext}`);
    } catch { /* file may not exist */ }
  }

  log(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.join(' ');

    if (this.config.consoleOutput) {
      const prefix = this.getPrefix(level);
      console.log(`${prefix} ${message}`);
    }

    if (this.stream) {
      this.stream.write(`[${timestamp}] [${level}] ${message}\n`);
    }
  }

  getPrefix(level) {
    const now = new Date();
    const time = now.toLocaleTimeString('sv-SE');

    switch (level) {
      case 'INFO':
        return `[${time}] ℹ️`;
      case 'SUCCESS':
        return `[${time}] ✓`;
      case 'WARN':
        return `[${time}] ⚠️`;
      case 'ERROR':
        return `[${time}] ❌`;
      case 'DEBUG':
        return `[${time}] 🔍`;
      default:
        return `[${time}]`;
    }
  }

  info(...args) {
    this.log('INFO', ...args);
  }

  success(...args) {
    this.log('SUCCESS', ...args);
  }

  warn(...args) {
    this.log('WARN', ...args);
  }

  error(...args) {
    this.log('ERROR', ...args);
  }

  debug(...args) {
    if (process.env.DEBUG) {
      this.log('DEBUG', ...args);
    }
  }

  close() {
    if (this.stream) {
      this.stream.destroy();
      this.stream = null;
    }
  }
}

module.exports = { Logger };
