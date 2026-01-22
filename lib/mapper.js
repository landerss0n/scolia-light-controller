/**
 * DartEventMapper - Fallback-mappning för dart → ljuseffekt
 *
 * OBS: Används endast som fallback om colorMode är inaktiverat.
 * Huvudlogiken finns i index.js handleThrowDetected()
 */

class DartEventMapper {
  constructor(mapping, specialEvents, logger) {
    this.mapping = mapping || {};
    this.specialEvents = specialEvents || {};
    this.logger = logger;
  }

  mapThrowToEffect(points, multiplier, segment) {
    // Bull's eye
    if (points === 50 && this.mapping.bullseye) {
      return this.createEffect(this.mapping.bullseye);
    }

    // Miss
    if (points === 0 && this.mapping.miss) {
      return this.createEffect(this.mapping.miss);
    }

    // Ingen matchning
    return null;
  }

  createEffect(config) {
    if (!config) return null;
    return {
      description: config.description || 'Okänd effekt',
      lightshark_executor: config.lightshark_executor,
      lightshark_cuelist: config.lightshark_cuelist
    };
  }
}

module.exports = { DartEventMapper };
