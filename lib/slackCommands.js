const { SocketModeClient } = require('@slack/socket-mode');

// Ren matchning: är meddelandet exakt vårt kommando (trimmat, case-insensitive)?
// Triggar alltså inte av vanligt prat som innehåller ordet.
function matchesCommand(text, command) {
  if (typeof text !== 'string' || typeof command !== 'string') return false;
  return text.trim().toLowerCase() === command.trim().toLowerCase();
}

// Tar emot kommandon från Slack via Socket Mode (utgående WebSocket — funkar
// bakom NAT/Tailscale utan publik endpoint). Just nu bara `!restart`, med
// debounce mot upprepade omstarter. Svar skickas via den befintliga webhooken
// (handlers.reply), så ingen bot-token för API-anrop behövs.
class SlackCommandListener {
  constructor(config = {}, logger = console, handlers = {}) {
    this.enabled = !!(config.enabled && config.appToken);
    this.appToken = config.appToken;
    this.command = config.command || '!restart';
    this.debounceMs = config.debounceMs || 30000;
    this.logger = logger;
    this.onRestart = handlers.onRestart || (() => {});
    this.reply = handlers.reply || (() => {});
    this.now = handlers.now || (() => Date.now()); // injicerbar klocka för test
    this.lastRestartAt = -Infinity; // så första kommandot alltid släpps igenom
    this.client = null;
  }

  // Matchar + inte debounced? Muterar lastRestartAt vid accept.
  shouldHandleRestart(text) {
    if (!matchesCommand(text, this.command)) return false;
    const now = this.now();
    if (now - this.lastRestartAt < this.debounceMs) {
      this.logger.info?.(`SlackCommandListener: '${this.command}' ignorerat (debounce)`);
      return false;
    }
    this.lastRestartAt = now;
    return true;
  }

  // Ignorera bottens egna/system-meddelanden (ingen loop), kör annars kommandot.
  // Kvittera först (best-effort, max 1.5s så svaret hinner skickas innan exit),
  // kör sedan onRestart (som typiskt avslutar processen → pm2 startar om).
  async _handleMessage(event) {
    if (!event || event.bot_id || event.subtype) return;
    if (!this.shouldHandleRestart(event.text || '')) return;
    this.logger.warn?.(`SlackCommandListener: '${this.command}' mottaget — startar om`);
    try {
      await Promise.race([
        Promise.resolve(this.reply('♻️ Startar om (begärt via Slack)…')),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch { /* låt aldrig kvittensen hindra omstart */ }
    try {
      await this.onRestart();
    } catch (err) {
      this.logger.error?.(`SlackCommandListener: onRestart fel: ${err.message}`);
    }
  }

  async start() {
    if (!this.enabled) {
      this.logger.info?.('SlackCommandListener: avstängd (ingen appToken / enabled=false)');
      return;
    }
    try {
      this.client = new SocketModeClient({ appToken: this.appToken });
      this.client.on('message', async ({ event, ack }) => {
        try { await ack(); } catch { /* måste acka inom 3s; ignorera ack-fel */ }
        await this._handleMessage(event);
      });
      this.client.on('connected', () => this.logger.success?.('SlackCommandListener: ansluten (Socket Mode)'));
      this.client.on('disconnected', () => this.logger.warn?.('SlackCommandListener: frånkopplad (återansluter automatiskt)'));
      await this.client.start();
    } catch (err) {
      this.logger.error?.(`SlackCommandListener: kunde inte starta Socket Mode: ${err.message}`);
    }
  }

  async stop() {
    if (this.client) {
      try { await this.client.disconnect(); } catch { /* noop */ }
      this.client = null;
    }
  }
}

module.exports = { SlackCommandListener, matchesCommand };
