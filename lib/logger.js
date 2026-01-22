const fs = require('fs');
const path = require('path');

class Logger {
  constructor(config) {
    this.config = config || { enabled: true, consoleOutput: true };
    this.logFile = config.logFile || 'dart-events.log';
  }

  log(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.join(' ');

    // Console output
    if (this.config.consoleOutput) {
      const prefix = this.getPrefix(level);
      console.log(`${prefix} ${message}`);
    }

    // File output
    if (this.config.enabled && this.logFile) {
      const logLine = `[${timestamp}] [${level}] ${message}\n`;
      fs.appendFileSync(this.logFile, logLine);
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
    // Endast i debug-läge
    if (process.env.DEBUG) {
      this.log('DEBUG', ...args);
    }
  }
}

module.exports = { Logger };
