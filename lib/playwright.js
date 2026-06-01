const { chromium } = require('playwright');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

// Race a promise against a timeout so a hung page.evaluate() can't freeze the
// poll loop (otherwise the watchdog would never fire). Swallows a late rejection
// from the original promise if the timeout wins, to avoid unhandled rejections.
function raceTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class PlaywrightController extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.pollTimeout = null;
    this.running = false;

    // Watchdog — detect silent page-level death (browser stays alive, monitoring dies)
    this.lastHealthyAt = 0;
    this.pollErrorLogged = false;

    // Edge detection state — track counts to detect new events
    this.lastState = {
      bustCount: 0,
      legWon: false,
      setWon: false,
    };
  }

  async launch() {
    try {
      const launchArgs = [
        '--start-maximized',
        '--disable-features=Translate,TranslateUI',
        '--lang=en',
      ];

      this.browser = await chromium.launch({
        headless: false,
        args: launchArgs,
      });

      this.context = await this.browser.newContext({ viewport: null, locale: 'en-US' });

      // Load saved cookies if available
      const cookieFile = this.config.cookieFile || path.join(__dirname, '..', 'scolia-cookies.json');
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

      // Block Scolia sounds via Web Audio API hook:
      // 1. Always block specific offsets (bust = 580.8s)
      // 2. Block ALL sounds when __scoliaMuted is true (while our sounds play)
      const browserVolume = this.config.volume !== undefined ? this.config.volume : 1.0;
      await this.page.addInitScript((volume) => {
        const blockedOffsets = [580.8];
        const offsetTolerance = 1.0;

        // Master volume: override AudioContext.destination to route through a GainNode
        if (volume < 1.0) {
          const destDescriptor = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination');
          Object.defineProperty(BaseAudioContext.prototype, 'destination', {
            get: function () {
              if (!this.__masterGain) {
                this.__masterGain = this.createGain();
                this.__masterGain.gain.value = volume;
                this.__masterGain.connect(destDescriptor.get.call(this));
              }
              return this.__masterGain;
            },
          });
        }

        // Block specific sounds from Scolia's audio sprite (e.g. bust at 580.8s)
        const origStart = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (...args) {
          const offset = args[1];
          if (offset !== undefined && blockedOffsets.some(bo => Math.abs(offset - bo) < offsetTolerance)) {
            return;
          }
          return origStart.apply(this, args);
        };
      }, browserVolume);

      const url = this.config.url || 'https://game.scoliadarts.com';
      this.logger.info(`Playwright: Navigerar till ${url}/game`);
      await this.page.goto(`${url}/game`, { waitUntil: 'domcontentloaded', timeout: 30000 });

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
        await this.page.goto(`${url}/game`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      // Dismiss cookie consent popup if present
      try {
        const cookieBtn = await this.page.$('.styles_acceptButton__S9Zs4');
        if (cookieBtn) {
          await cookieBtn.click({ timeout: 3000 });
          this.logger.info('Playwright: Cookie-popup godkänd');
        }
      } catch {
        this.logger.debug('Playwright: Cookie-popup hittades men kunde inte klickas');
      }

      // Enter fullscreen via CDP
      if (this.config.fullscreen) {
        try {
          const cdp = await this.page.context().newCDPSession(this.page);
          const { windowId } = await cdp.send('Browser.getWindowForTarget');
          await cdp.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'fullscreen' },
          });
          this.logger.info('Playwright: Fullscreen via CDP');
        } catch (err) {
          this.logger.warn(`Playwright: Kunde inte sätta fullscreen via CDP: ${err.message}`);
        }
      }

      this.logger.success('Playwright: Browser startad och redo');

      // Listen for browser disconnect (crash)
      this.browser.once('disconnected', () => {
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
      const cookieFile = this.config.cookieFile || path.join(__dirname, '..', 'scolia-cookies.json');
      const cookies = await this.context.cookies();
      fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
      this.logger.debug('Playwright: Cookies sparade');
    } catch (err) {
      this.logger.warn(`Playwright: Kunde inte spara cookies: ${err.message}`);
    }
  }

  startMonitoring() {
    if (this.pollTimeout) return;

    this.running = true;
    const intervalMs = this.config.pollIntervalMs || 200;
    // Auto-heal if DOM-monitoring stays broken this long. The browser never
    // crashes (so 'disconnected' never fires), but the page can silently die
    // after a post-game reload — this catches that and restarts automatically.
    const healTimeoutMs = this.config.healTimeoutMs || 15000;
    this.lastHealthyAt = Date.now();
    this.pollErrorLogged = false;

    this.logger.info(`Playwright: Startar DOM-övervakning (${intervalMs}ms intervall)`);

    const poll = async () => {
      if (!this.running) return;
      try {
        await raceTimeout(this.pollDOM(), 5000, 'pollDOM');
        this.lastHealthyAt = Date.now();
        if (this.pollErrorLogged) {
          this.logger.success('Playwright: DOM-övervakning återhämtad');
          this.pollErrorLogged = false;
        }
      } catch (err) {
        const downMs = Date.now() - this.lastHealthyAt;
        // Surface persistent failures (transient ones during navigation stay quiet)
        if (!this.pollErrorLogged && downMs > 3000) {
          let url = 'okänd';
          try { url = this.page ? this.page.url() : 'ingen sida'; } catch {}
          this.logger.warn(`Playwright: DOM-poll misslyckas (url=${url}): ${err.message}`);
          this.pollErrorLogged = true;
        } else {
          this.logger.debug(`Playwright: Poll-fel: ${err.message}`);
        }
        // Watchdog: page alive but monitoring dead too long → self-heal
        if (downMs > healTimeoutMs && this.running) {
          this.logger.error(`Playwright: DOM-övervakning död i ${Math.round(downMs / 1000)}s — startar om browser automatiskt`);
          this.stopMonitoring();
          setTimeout(() => this.restart(), 1000);
          return;
        }
      }
      if (this.running) {
        this.pollTimeout = setTimeout(poll, intervalMs);
      }
    };

    this.pollTimeout = setTimeout(poll, intervalMs);
  }

  stopMonitoring() {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.postGameReloadTimer) {
      clearTimeout(this.postGameReloadTimer);
      this.postGameReloadTimer = null;
    }
  }

  schedulePostGameReload() {
    if (this.postGameReloadTimer) return;
    this.logger.info('Playwright: Schemalägger reload om 25s för att återuppliva realtime i nytt game');
    this.postGameReloadTimer = setTimeout(async () => {
      this.postGameReloadTimer = null;
      try {
        this.logger.info('Playwright: Laddar om sidan (post-game reload)');
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (err) {
        this.logger.warn(`Playwright: Post-game reload fel: ${err.message}`);
      }
    }, 25000);
  }

  async pollDOM() {
    if (!this.page) return;

    const state = await this.page.evaluate(() => {
      // Bust: count elements with "statusInfoBusted" and "isBusted" in class
      const bustCount = document.querySelectorAll('[class*="statusInfoBusted"][class*="isBusted"]').length;

      // Winner tile: element with "winnerTile" in class
      const winnerTiles = document.querySelectorAll('[class*="winnerTile"]');
      let legWon = false;
      let setWon = false;

      winnerTiles.forEach(el => {
        const text = el.innerText || '';
        if (text.includes('Won the Leg')) legWon = true;
        if (text.includes('Won the Set')) setWon = true;
      });

      // Post-game "Back To Setup" button — need to reload (safety net, Scolia auto-advances normalt)
      const backToSetup = !!document.querySelector('#post-game-statistics-header-back-btn');

      // Board selection — click "Digiwise HQ"
      const boardBtn = document.querySelector('.styles_boardName__lyTGy');
      const needsBoardSelect = boardBtn ? boardBtn.textContent.includes('Digiwise HQ') : false;

      return { bustCount, legWon, setWon, backToSetup, needsBoardSelect };
    });

    // Handle post-game screen — reload page (safety net)
    if (state.backToSetup) {
      this.logger.info('Playwright: Post-game skärm — laddar om sidan');
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      return;
    }

    // Handle board selection — click Digiwise HQ
    if (state.needsBoardSelect) {
      this.logger.info('Playwright: Väljer tavla Digiwise HQ');
      await this.page.click('.styles_boardName__lyTGy');
      return;
    }

    // Edge detection — emit when count increases (handles consecutive busts from different players)
    if (state.bustCount > this.lastState.bustCount) {
      this.logger.info(`Playwright: BUST detekterat! (${this.lastState.bustCount} → ${state.bustCount})`);
      this.emit('bust');
    }

    if (state.legWon && !this.lastState.legWon) {
      this.logger.info('Playwright: LEG WON detekterat!');
      this.emit('leg-won');
      this.schedulePostGameReload();
    }

    if (state.setWon && !this.lastState.setWon) {
      this.logger.info('Playwright: SET WON detekterat!');
      this.emit('set-won');
      this.schedulePostGameReload();
    }

    this.lastState = state;
  }

  async restart() {
    this.logger.info('Playwright: Startar om...');
    await this.close();

    // Reset edge detection state
    this.lastState = { bustCount: 0, legWon: false, setWon: false };

    const ok = await this.launch();
    if (ok) {
      this.startMonitoring();
    } else {
      this.logger.error('Playwright: Kunde inte starta om — försöker igen om 10s');
      setTimeout(async () => {
        try {
          await this.restart();
        } catch (err) {
          this.logger.error(`Playwright: Restart misslyckades: ${err.message}`);
        }
      }, 10000);
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
