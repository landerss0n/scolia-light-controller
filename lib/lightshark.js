const { Client, Message } = require('node-osc');

class LightSharkController {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.client = null;
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
            this.logger.error(`LightShark fel: ${err.message}`);
            resolve(false);
          } else {
            this.logger.success(`✓ LightShark executor ${page}/${column}/${row} triggad`);
            resolve(true);
          }
        });
      });
    } catch (err) {
      this.logger.error(`LightShark fel: ${err.message}`);
      return false;
    }
  }

  async triggerCuelist(executor) {
    // Stöd för både gammalt format (nummer) och nytt format (objekt med page/column/row)
    if (typeof executor === 'object' && executor.page !== undefined) {
      return this.triggerExecutor(executor.page, executor.column, executor.row);
    }

    // Fallback: om det är ett nummer, använd som executor-index (för bakåtkompatibilitet)
    this.logger.warn(`Cuelist-nummer ${executor} stöds inte längre, använd executor-objekt`);
    return false;
  }

  async releaseCuelist(cuelistNumber) {
    // OSC har ingen release-funktion, detta är en no-op
    this.logger.debug(`Release är ej tillgängligt via OSC (cuelist ${cuelistNumber})`);
  }

  async setIntensity(playbackId, intensity) {
    try {
      const client = this._getClient();
      // Konvertera 0-100% till 0-255
      const level = Math.round((intensity / 100) * 255);
      const address = `/LS/Level/PB/${playbackId}`;

      return new Promise((resolve) => {
        client.send(address, level, (err) => {
          if (err) {
            this.logger.error(`Kunde inte sätta intensitet: ${err.message}`);
            resolve(false);
          } else {
            this.logger.debug(`Intensitet för playback ${playbackId} satt till ${intensity}%`);
            resolve(true);
          }
        });
      });
    } catch (err) {
      this.logger.error(`Kunde inte sätta intensitet: ${err.message}`);
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
