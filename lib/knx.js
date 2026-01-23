const knx = require('knx');

class KnxController {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.connection = null;
    this.connected = false;
  }

  connect() {
    return new Promise((resolve) => {
      this.connection = new knx.Connection({
        ipAddr: this.config.gateway,
        ipPort: this.config.port || 3671,
        handlers: {
          connected: () => {
            this.connected = true;
            this.logger.success('✓ KNX anslutning OK');
            resolve(true);
          },
          error: (status) => {
            this.logger.error(`KNX anslutning misslyckades: ${status}`);
            this.connected = false;
            resolve(false);
          }
        }
      });
    });
  }

  write(groupAddress, value, dpt = 'DPT5.010') {
    if (!this.connected || !this.connection) {
      this.logger.warn('KNX: Inte ansluten, kan inte skriva');
      return;
    }

    try {
      const dp = new knx.Datapoint({ga: groupAddress, dpt: dpt}, this.connection);
      dp.write(value);
      this.logger.debug(`KNX: Skrev ${value} till ${groupAddress}`);
    } catch (err) {
      this.logger.error(`KNX fel vid skrivning till ${groupAddress}: ${err.message}`);
    }
  }

  triggerAction(actionName) {
    const action = this.config.actions?.[actionName];
    if (!action) {
      this.logger.debug(`KNX: Ingen action konfigurerad för: ${actionName}`);
      return;
    }

    const commands = Array.isArray(action) ? action : [action];
    commands.forEach(cmd => {
      this.write(cmd.ga, cmd.value, cmd.dpt || 'DPT5.010');
    });

    this.logger.info(`KNX: ${actionName} → ${commands.length} kommando(n)`);
  }

  disconnect() {
    if (this.connection) {
      this.connection.Disconnect();
      this.connected = false;
    }
  }
}

module.exports = { KnxController };
