const { Client, Message } = require('node-osc');

class LightSharkController {
  constructor(config, logger, notifier = null) {
    this.config = config;
    this.logger = logger;
    this.notifier = notifier;
    this.client = null;
    // Spårar OSC-fel i rad. OSC är UDP (fire-and-forget) så vi kan inte
    // bekräfta leverans, men socket-fel (t.ex. EHOSTUNREACH) går att fånga.
    // Eskalera efter några fel i rad så en offline LightShark faktiskt syns
    // istället för identiska radspam, och logga när den kommer tillbaka.
    this.consecutiveFailures = 0;
    this.failureAlertAfter = config.failureAlertAfter || 3;
  }

  _onSendError(message) {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures === this.failureAlertAfter) {
      this.logger.error(`⚠️  LightShark svarar inte — ${this.consecutiveFailures} OSC-kommandon i rad har misslyckats. Kontrollera ström/nätverk (${this.config.ip}:${this.config.oscPort})`);
    } else {
      this.logger.error(`LightShark fel: ${message}`);
    }
    // Dedup sker i notifiern, så vi kan kalla på varje fel vid/över tröskeln
    if (this.notifier && this.consecutiveFailures >= this.failureAlertAfter) {
      this.notifier.alert('lightshark-down', `LightShark svarar inte (${this.consecutiveFailures} OSC-fel i rad). Ljuset funkar inte.`);
    }
  }

  _onSendSuccess() {
    if (this.consecutiveFailures >= this.failureAlertAfter) {
      this.logger.success('✓ LightShark svarar igen');
      if (this.notifier) this.notifier.recover('lightshark-down', 'LightShark svarar igen');
    }
    this.consecutiveFailures = 0;
  }

  _getClient() {
    if (!this.client) {
      this.client = new Client(this.config.ip, this.config.oscPort);
    }
    return this.client;
  }

  _createMessage(address, floatValue = 0.0) {
    const msg = new Message(address);
    msg.append({ type: 'f', value: floatValue });
    return msg;
  }

  async testConnection() {
    try {
      const client = this._getClient();
      const msg = this._createMessage('/LS/Sync');

      return new Promise((resolve) => {
        client.send(msg, (err) => {
          if (err) {
            this.logger.error(`LightShark OSC-test misslyckades: ${err.message}`);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    } catch (err) {
      this.logger.error(`LightShark test misslyckades: ${err.message}`);
      return false;
    }
  }

  async triggerExecutor(page, column, row) {
    try {
      const client = this._getClient();
      const address = `/LS/Executor/${page}/${column}/${row}`;
      const msg = this._createMessage(address, 0.0);

      return new Promise((resolve) => {
        client.send(msg, (err) => {
          if (err) {
            this._onSendError(err.message);
            resolve(false);
          } else {
            this._onSendSuccess();
            this.logger.success(`✓ LightShark executor ${page}/${column}/${row} triggad`);
            resolve(true);
          }
        });
      });
    } catch (err) {
      this._onSendError(err.message);
      return false;
    }
  }

  close() {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}

module.exports = { LightSharkController };
