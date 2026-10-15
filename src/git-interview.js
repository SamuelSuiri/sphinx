import { setTimeout as delay } from 'node:timers/promises';
import { launchCheckpointTerminal, waitForCheckpointTerminal } from './terminal-launch.js';

/** Collect human input in a separate terminal while the original Git hook waits.
 * The caller owns queue cleanup and must validate the receipt before returning 0.
 */
export async function runGitCheckpointTerminal({ request, env = process.env, signal, launch = launchCheckpointTerminal, waitForResult = waitForCheckpointTerminal, timeoutMs = 25 * 60 * 1000, platform = process.platform } = {}) {
  const result = (status, reason) => ({ status, id: request?.id, ...(reason ? { reason } : {}) });
  if (signal?.aborted) return result('pending', 'cancelled');
  if (env.SPHINX_EVALUATOR === '1' || env.SSH_CONNECTION || env.SSH_TTY || (env.CI && env.CI !== 'false' && env.CI !== '0') || !['darwin', 'linux'].includes(platform) || (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY)) return result('unavailable', 'no-desktop');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return result('pending', 'timeout');
  const controller = new AbortController(), deadline = Date.now() + timeoutMs;
  let timer, stop, stopped;
  const interrupted = new Promise(resolve => {
    stop = reason => {
      if (stopped) return;
      stopped = reason; controller.abort(); resolve(result('pending', reason));
    };
  });
  const onAbort = () => stop('cancelled');
  signal?.addEventListener('abort', onAbort, { once: true });
  timer = setTimeout(() => stop('timeout'), timeoutMs);
  const operation = async () => {
    let started;
    try {
      // A concurrent Git invocation may own the short launch lock. Retrying a
      // busy lock reuses the existing window; it never starts another interview.
      do {
        controller.signal.throwIfAborted();
        started = await launch({ request, env, platform, signal: controller.signal });
        controller.signal.throwIfAborted();
        if (started?.status === 'busy') await delay(Math.min(50, Math.max(1, deadline - Date.now())), undefined, { signal: controller.signal });
      } while (started?.status === 'busy');
    } catch { return stopped ? result('pending', stopped) : result('unavailable', 'launch-failed'); }
    if (started?.status === 'passed') return result('passed');
    if (!['opened', 'already-open'].includes(started?.status)) return result(started?.status === 'suppressed' ? 'pending' : 'unavailable');
    try {
      controller.signal.throwIfAborted();
      const status = await waitForResult({ id: request.id, env, timeoutMs: Math.max(1, deadline - Date.now()), signal: controller.signal });
      controller.signal.throwIfAborted();
      return result(['passed', 'pending', 'unavailable', 'interrupted'].includes(status) ? status : 'interrupted');
    } catch { return stopped ? result('pending', stopped) : result('interrupted'); }
  };
  try { return await Promise.race([operation(), interrupted]); }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    // Stop any unfinished bookkeeping after timeout, without killing a terminal
    // or coding client. A human may still save progress in that window.
    controller.abort();
  }
}
