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
        launchArgs.push('--start-fullscreen');
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

      // Wait for SPA to render — either a login form or game content
      this.logger.debug('Playwright: Väntar på att SPA:n renderar...');
      await this.page.waitForSelector('#email, #password, [class*="dartboard"], [class*="scoreboard"]', { timeout: 15000 }).catch(() => {
        this.logger.debug('Playwright: Timeout vid väntan på SPA-rendering');
      });

      // Check if we need to log in
      const needsLogin = await this.page.evaluate(() => {
        return !!document.querySelector('#email');
      });

      if (needsLogin) {
        const { email, password } = this.config.credentials || {};

        if (email && password) {
          this.logger.info('Playwright: Loggar in automatiskt...');
          try {
            await this.autoLogin(email, password);
          } catch (err) {
            this.logger.warn(`Playwright: Auto-login misslyckades: ${err.message}`);
            this.logger.warn('Playwright: Logga in manuellt i browserfönstret');
            await this.waitForLogin();
          }
        } else {
          this.logger.warn('Playwright: Inloggning krävs — logga in manuellt i browserfönstret');
          await this.waitForLogin();
        }
      }

      // Save cookies after successful navigation
      await this.saveCookies();

      // Navigate to /game after login (login might redirect elsewhere)
      const currentPath = new URL(this.page.url()).pathname;
      if (!currentPath.startsWith('/game')) {
        this.logger.info('Playwright: Navigerar till /game...');
        await this.page.goto(`${url}/game`, { waitUntil: 'networkidle', timeout: 30000 });
      }

      // Dismiss cookie consent popup if present
      const cookieBtn = await this.page.$('.styles_acceptButton__S9Zs4');
      if (cookieBtn) {
        await cookieBtn.click();
        this.logger.info('Playwright: Cookie-popup godkänd');
      }

      // Enter fullscreen with F11
      if (this.config.fullscreen) {
        await this.page.keyboard.press('F11');
      }

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

  async autoLogin(email, password) {
    const emailInput = await this.page.$('#email');
    const passwordInput = await this.page.$('#password');

    if (!emailInput || !passwordInput) {
      throw new Error('Kunde inte hitta email/password-fält');
    }

    await emailInput.fill(email);
    await passwordInput.fill(password);

    // Click LOG IN button
    const submitBtn = await this.page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await passwordInput.press('Enter');
    }

    // Wait for login form to disappear
    await this.page.waitForFunction(() => {
      return !document.querySelector('#password');
    }, { timeout: 15000 });

    this.logger.success('Playwright: Inloggning lyckades!');
  }

  async waitForLogin() {
    // Wait for login form to disappear (max 5 minutes for manual login)
    await this.page.waitForFunction(() => {
      return !document.querySelector('#password');
    }, { timeout: 300000 });
    this.logger.success('Playwright: Inloggning lyckades!');
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

      // "Finish & View Stats" button
      const finishBtn = !!document.querySelector('.styles_sbuttonLabel__91BU3');

      // Post-game "Back To Setup" button — need to reload
      const backToSetup = !!document.querySelector('#post-game-statistics-header-back-btn');

      // Board selection — click "Digiwise HQ"
      const boardBtn = document.querySelector('.styles_boardName__lyTGy');
      const needsBoardSelect = boardBtn ? boardBtn.textContent.includes('Digiwise HQ') : false;

      return { bust, legWon, setWon, finishBtn, backToSetup, needsBoardSelect };
    });

    // Handle "Finish & View Stats" button — delay 30s so players can see stats
    if (state.finishBtn && !this.finishBtnTimer) {
      this.logger.info('Playwright: "Finish & View Stats" synlig — klickar om 30s');
      this.finishBtnTimer = setTimeout(async () => {
        try {
          const stillThere = await this.page.$('.styles_sbuttonLabel__91BU3');
          if (stillThere) {
            this.logger.info('Playwright: Klickar "Finish & View Stats"');
            await this.page.click('.styles_sbuttonLabel__91BU3');
          }
        } catch {}
        this.finishBtnTimer = null;
      }, 30000);
      return;
    }

    // Handle post-game screen — reload page
    if (state.backToSetup) {
      this.logger.info('Playwright: Post-game skärm — laddar om sidan');
      await this.page.reload({ waitUntil: 'networkidle', timeout: 30000 });
      return;
    }

    // Handle board selection — click Digiwise HQ
    if (state.needsBoardSelect) {
      this.logger.info('Playwright: Väljer tavla Digiwise HQ');
      await this.page.click('.styles_boardName__lyTGy');
      return;
    }

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
