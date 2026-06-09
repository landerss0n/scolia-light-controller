// Skickar driftlarm till Slack via en incoming webhook. Incident-baserad dedup
// är inbyggd: alert(key, ...) skickar bara om incidenten inte redan är aktiv,
// och recover(key, ...) skickar "tillbaka online" bara om den var aktiv. Så
// anropsställena kan kalla alert/recover fritt utan att hålla reda på spam.
//
// `fetch` injiceras för testbarhet (Node 18+/24 har global fetch i prod).
// Allt är fire-and-forget med try/catch — ett Slack-fel får aldrig krascha
// appen eller blockera ljus/ljud.
class SlackNotifier {
  constructor(config = {}, logger = console, fetchFn = globalThis.fetch) {
    this.enabled = !!(config.enabled && config.slackWebhookUrl);
    this.webhookUrl = config.slackWebhookUrl;
    this.label = config.label || 'Scolia';
    this.logger = logger;
    this.fetchFn = fetchFn;
    this.timeoutMs = config.timeoutMs || 5000;
    this.activeIncidents = new Set();
  }

  // Markerar incidenten aktiv direkt (inte efter lyckad sändning) så upprepade
  // anrop under samma incident inte spammar — även om just denna sändning failar.
  async alert(key, message) {
    if (this.activeIncidents.has(key)) return false;
    this.activeIncidents.add(key);
    return this._send(`🔴 *${this.label}*: ${message}`);
  }

  async recover(key, message) {
    if (!this.activeIncidents.has(key)) return false;
    this.activeIncidents.delete(key);
    return this._send(`✅ *${this.label}*: ${message}`);
  }

  async _send(text) {
    if (!this.enabled) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (res && res.ok === false) {
        this.logger.warn?.(`Notifier: Slack svarade ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn?.(`Notifier: kunde inte skicka Slack-larm: ${err.message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { SlackNotifier };
