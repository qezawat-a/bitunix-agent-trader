export function normalizeIntervalSeconds(value, fallback = 30) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createReportScheduler({store, sendReport, buildReport, log = console, sleepFn}) {
  let stopped = false;
  let running = false;
  let timer = null;
  let wake = null;
  let loopPromise = null;
  let runs = 0;
  let failures = 0;
  let lastRunAt = null;
  let lastSuccessAt = null;
  let lastError = null;

  const status = () => ({running, stopped, runs, failures, lastRunAt, lastSuccessAt, lastError});

  async function runOnce() {
    if (stopped || running || !store.get('reportOn', true)) return false;
    running = true;
    runs += 1;
    lastRunAt = new Date().toISOString();
    try {
      const report = await buildReport();
      const result = await sendReport(report);
      lastError = null;
      lastSuccessAt = new Date().toISOString();
      await store.push('report_sent', {result, at: lastSuccessAt});
      return true;
    } catch (error) {
      failures += 1;
      lastError = error?.stack || error?.message || String(error);
      log.error('[report] send failed', lastError);
      try { await store.push('report_failed', {error: lastError, at: new Date().toISOString()}); }
      catch (storeError) { log.error('[report] failed to persist error', storeError?.stack || storeError?.message || storeError); }
      return false;
    } finally {
      running = false;
    }
  }

  function wait(ms) {
    return new Promise(resolve => {
      wake = resolve;
      timer = setTimeout(() => { timer = null; wake = null; resolve(); }, ms);
    });
  }

  async function loop() {
    while (!stopped) {
      try {
        if (store.get('reportOn', true)) await runOnce();
      } catch (error) {
        lastError = error?.stack || error?.message || String(error);
        log.error('[report] scheduler iteration failed', lastError);
      }
      const intervalMs = normalizeIntervalSeconds(store.get('reportIntervalSec', 30)) * 1000;
      await waitWith(intervalMs);
    }
  }

  async function waitWith(ms) {
    if (sleepFn !== undefined) return sleepFn(ms);
    return wait(ms);
  }

  function start({immediate = false} = {}) {
    if (loopPromise) return loopPromise;
    stopped = false;
    loopPromise = (async () => {
      if (immediate) await runOnce();
      else await waitWith(normalizeIntervalSeconds(store.get('reportIntervalSec', 30)) * 1000);
      await loop();
    })().catch(error => {
      lastError = error?.stack || error?.message || String(error);
      log.error('[report] scheduler stopped unexpectedly', lastError);
      throw error;
    });
    return loopPromise;
  }

  async function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (wake) { const resolve = wake; wake = null; timer = null; resolve(); }
    if (loopPromise) {
      try { await loopPromise; } catch { /* already logged */ }
    }
  }

  return {start, stop, runOnce, status};
}
