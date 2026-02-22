// Bestäm vilken executor som ska triggas baserat på kast-data och config.
// Returnerar { executor, effectName, isSingle } eller null om inget ska hända.
function resolveThrowEffect(points, multiplier, segment, effectConfig) {
  // Miss
  if (points === 0) {
    if (effectConfig.noScoreExecutor) {
      return { executor: effectConfig.noScoreExecutor, effectName: '❌ NOSCORE! Släcker lampor' };
    }
    return null;
  }

  // Färgläge
  if (effectConfig.colorMode?.enabled) {
    const cm = effectConfig.colorMode;

    if (points === 50) {
      return { executor: cm.bullseyeExecutor || cm.redExecutor, effectName: '🎯 BULLSEYE 50! Moln Ow Strobe' };
    }

    if (points === 25 && segment === 25) {
      const isGreen = cm.bull25 === 'green';
      return {
        executor: isGreen ? cm.greenExecutor : cm.redExecutor,
        effectName: `🎯 BULL 25! LED ${isGreen ? 'Green' : 'Red'}`,
      };
    }

    if ((multiplier === 2 || multiplier === 3) && cm.redSegments.includes(segment)) {
      const typeStr = multiplier === 3 ? 'TRIPPEL' : 'DUBBEL';
      return { executor: cm.redExecutor, effectName: `🔴 ${typeStr} ${segment} - LED Red` };
    }

    if ((multiplier === 2 || multiplier === 3) && cm.greenSegments.includes(segment)) {
      const typeStr = multiplier === 3 ? 'TRIPPEL' : 'DUBBEL';
      return { executor: cm.greenExecutor, effectName: `🟢 ${typeStr} ${segment} - LED Green` };
    }

    // Singel — ingen executor, men anroparen behöver veta att senaste ska släckas
    if (multiplier === 1) {
      return { executor: null, effectName: `⚪ SINGEL ${segment}`, isSingle: true };
    }

    // Fallback (borde inte hända, men säkert)
    if (effectConfig.resetExecutor) {
      return { executor: effectConfig.resetExecutor, effectName: '💡 3k 100% (fallback)' };
    }
    return null;
  }

  // Ingen colorMode — disco fallback
  if (effectConfig.executor) {
    return { executor: effectConfig.executor, effectName: '💡 Triggar Disco' };
  }

  return null;
}

// Trigga executor på LightShark med toggle-logik (undvik dubbel-toggle).
// Returnerar nya lastTriggeredExecutor-värdet.
function applyExecutor(lightshark, executor, lastTriggered, log) {
  if (!executor || !lightshark) return lastTriggered;

  const sameAsLast = lastTriggered &&
    lastTriggered.page === executor.page &&
    lastTriggered.column === executor.column &&
    lastTriggered.row === executor.row;

  if (sameAsLast) return lastTriggered;

  // Släck tidigare executor först
  if (lastTriggered) {
    lightshark.triggerExecutor(lastTriggered.page, lastTriggered.column, lastTriggered.row);
  }

  log(`Page ${executor.page}, Col ${executor.column}, Row ${executor.row}`);
  lightshark.triggerExecutor(executor.page, executor.column, executor.row);
  return executor;
}

module.exports = { resolveThrowEffect, applyExecutor };
