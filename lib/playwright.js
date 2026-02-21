const { chromium } = require('playwright');
const { EventEmitter } = require('events');
const fs = require('fs');

class PlaywrightController extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.pollInterval = null;
    this.running = false;

    // Edge detection state — emit only on false→true transitions
    this.lastState = {
      bust: false,
      legWon: false,
      setWon: false,
    };
  }

  async launch() {
    try {
      const launchArgs = ['--start-maximized'];
      if (this.config.fullscreen) {
        launchArgs.push('--kiosk');
      }

      this.browser = await chromium.launch({
        headless: false,
        args: launchArgs,
      });

      this.context = await this.browser.newContext({ viewport: null });

      // Load saved cookies if available
      const cookieFile = this.config.cookieFile || './scolia-cookies.json';
      if (fs.existsSync(cookieFile)) {
        try {
          const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
          await this.context.addCookies(cookies);
          this.logger.info('Playwright: Laddade sparade cookies');
        } catch (err) {
          this.logger.warn(`Playwright: Kunde inte ladda cookies: ${err.message}`);
        }
      }

      this.page = await this.context.newPage();

      const url = this.config.url || 'https://game.scoliadarts.com';
      this.logger.info(`Playwright: Navigerar till ${url}/game`);
      await this.page.goto(`${url}/game`, { waitUntil: 'networkidle', timeout: 30000 });

      // Check if we need to log in
      const currentUrl = this.page.url();
      if (currentUrl.includes('login') || currentUrl.includes('auth')) {
        this.logger.warn('Playwright: Inloggning krävs — logga in manuellt i browserfönstret');
        // Wait for navigation away from login page (max 5 minutes)
        await this.page.waitForURL('**/game**', { timeout: 300000 });
        this.logger.success('Playwright: Inloggning lyckades!');
      }

      // Save cookies after successful navigation
      await this.saveCookies();

      this.logger.success('Playwright: Browser startad och redo');

      // Listen for browser disconnect (crash)
      this.browser.on('disconnected', () => {
        if (this.running) {
          this.logger.error('Playwright: Browser kraschade — försöker starta om...');
          this.stopMonitoring();
          setTimeout(() => this.restart(), 3000);
        }
      });

      return true;
    } catch (err) {
      this.logger.error(`Playwright: Kunde inte starta browser: ${err.message}`);
      return false;
    }
  }

  async saveCookies() {
    try {
      const cookieFile = this.config.cookieFile || './scolia-cookies.json';
      const cookies = await this.context.cookies();
      fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
      this.logger.debug('Playwright: Cookies sparade');
    } catch (err) {
      this.logger.warn(`Playwright: Kunde inte spara cookies: ${err.message}`);
    }
  }

  startMonitoring() {
    if (this.pollInterval) return;

    this.running = true;
    const intervalMs = this.config.pollIntervalMs || 200;

    this.logger.info(`Playwright: Startar DOM-övervakning (${intervalMs}ms intervall)`);

    this.pollInterval = setInterval(async () => {
      try {
        await this.pollDOM();
      } catch (err) {
        // Page might have been closed or navigated away
        this.logger.debug(`Playwright: Poll-fel: ${err.message}`);
      }
    }, intervalMs);
  }

  stopMonitoring() {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async pollDOM() {
    if (!this.page) return;

    const state = await this.page.evaluate(() => {
      // Bust: element with "statusInfoBusted" and "isBusted" in class
      const bustEl = document.querySelector('[class*="statusInfoBusted"][class*="isBusted"]');
      const bust = !!bustEl;

      // Winner tile: element with "winnerTile" in class
      const winnerTiles = document.querySelectorAll('[class*="winnerTile"]');
      let legWon = false;
      let setWon = false;

      winnerTiles.forEach(el => {
        const text = el.innerText || '';
        if (text.includes('Won the Leg')) legWon = true;
        if (text.includes('Won the Set')) setWon = true;
      });

      return { bust, legWon, setWon };
    });

    // Edge detection — only emit on false→true transitions
    if (state.bust && !this.lastState.bust) {
      this.logger.info('Playwright: BUST detekterat!');
      this.emit('bust');
    }

    if (state.legWon && !this.lastState.legWon) {
      this.logger.info('Playwright: LEG WON detekterat!');
      this.emit('leg-won');
    }

    if (state.setWon && !this.lastState.setWon) {
      this.logger.info('Playwright: SET WON detekterat!');
      this.emit('set-won');
    }

    this.lastState = state;
  }

  async restart() {
    this.logger.info('Playwright: Startar om...');
    await this.close();

    // Reset edge detection state
    this.lastState = { bust: false, legWon: false, setWon: false };

    const ok = await this.launch();
    if (ok) {
      this.startMonitoring();
    } else {
      this.logger.error('Playwright: Kunde inte starta om — försöker igen om 10s');
      setTimeout(() => this.restart(), 10000);
    }
  }

  async close() {
    this.stopMonitoring();
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch {
      // Browser might already be closed
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}

module.exports = { PlaywrightController };
