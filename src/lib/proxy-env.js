const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeProxyConfig, buildProxyUrl } = require("./proxy-settings");

function hasProxyEnv(env = process.env) {
  return Boolean(
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    env.ALL_PROXY ||
    env.all_proxy,
  );
}

function parseMacProxyOutput(output) {
  const values = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  if (values.HTTPSEnable !== "1" || !values.HTTPSProxy || !values.HTTPSPort) return null;
  return `http://${values.HTTPSProxy}:${values.HTTPSPort}`;
}

function defaultConfigPath() {
  return path.join(os.homedir(), ".tokentracker", "tracker", "config.json");
}

function readPersistedProxyConfig({ configPath } = {}) {
  const file = configPath || defaultConfigPath();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed.proxy : undefined;
  } catch {
    return undefined;
  }
}

function resolveSystemProxyEnv({
  env = process.env,
  platform = process.platform,
  commandRunner = cp.spawnSync,
  proxyConfig,
} = {}) {
  const normalized = normalizeProxyConfig(proxyConfig);
  // Manual mode is applied only via applyUndiciProxyIfNeeded's ProxyAgent.
  // Injecting HTTPS_PROXY here would relaunch serve and leak the URL into
  // process.env, so a later switch back to system still picks the old proxy.
  if (normalized.mode === "off" || normalized.mode === "manual") return null;

  const out = {};
  if (hasProxyEnv(env)) {
    out.NODE_USE_ENV_PROXY = env.NODE_USE_ENV_PROXY || "1";
    return out;
  }

  if (platform !== "darwin") return null;
  const result = commandRunner("scutil", ["--proxy"], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (result?.error || result?.status !== 0) return null;
  const proxyUrl = parseMacProxyOutput(result.stdout);
  if (!proxyUrl) return null;

  return {
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
  };
}

function shouldRelaunchForProxy(argv, env = process.env) {
  if (env.TOKENTRACKER_PROXY_ENV_APPLIED === "1") return false;
  const command = Array.isArray(argv) ? argv[0] : null;
  return !command || command === "serve";
}

function relaunchWithProxyEnvIfNeeded({
  argv,
  originalArgv,
  env = process.env,
  platform = process.platform,
  commandRunner = cp.spawnSync,
  nodePath = process.execPath,
  proxyConfig,
} = {}) {
  if (!shouldRelaunchForProxy(argv, env)) return null;
  const proxyEnv = resolveSystemProxyEnv({ env, platform, commandRunner, proxyConfig });
  if (!proxyEnv || proxyEnv.NODE_USE_ENV_PROXY === env.NODE_USE_ENV_PROXY) return null;

  const childEnv = {
    ...env,
    ...proxyEnv,
    TOKENTRACKER_PROXY_ENV_APPLIED: "1",
  };
  return commandRunner(nodePath, originalArgv, {
    stdio: "inherit",
    env: childEnv,
  });
}

function pickProxyUrl(env = process.env) {
  return (
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    env.ALL_PROXY ||
    env.all_proxy ||
    null
  );
}

// Dispatchers created by this module. setGlobalDispatcher only swaps the
// global symbol and does not recycle the previous agent, so we keep our own
// handle and close() it after a successful replacement.
let ownedDispatcher = null;
let lastManualApplyError = null;

function getLastProxyApplyError() {
  return lastManualApplyError;
}

function resetProxyApplyStateForTests() {
  ownedDispatcher = null;
  lastManualApplyError = null;
}

function closeDispatcherQuietly(dispatcher) {
  if (!dispatcher || typeof dispatcher.close !== "function") return;
  Promise.resolve()
    .then(() => dispatcher.close())
    .catch(() => {});
}

function warnManualApplyFailure(message, warn) {
  const text = `[proxy] Failed to apply manual proxy; outbound traffic is blocked: ${message}`;
  if (typeof warn === "function") {
    warn(text);
    return;
  }
  console.error(text);
}

const FAIL_CLOSED_MESSAGE = "manual proxy is not applied; outbound traffic is blocked";

function createFailClosedDispatcher(reason) {
  const message = reason ? `${FAIL_CLOSED_MESSAGE}: ${reason}` : FAIL_CLOSED_MESSAGE;
  const error = () => Object.assign(new Error(message), { code: "PROXY_FAIL_CLOSED" });
  try {
    // eslint-disable-next-line global-require
    const undici = require("undici");
    if (typeof undici.Agent === "function") {
      return new undici.Agent({
        connect(_options, callback) {
          if (typeof callback === "function") callback(error(), null);
        },
      });
    }
  } catch (_e) {
    /* fall through to a minimal dispatcher */
  }
  return {
    dispatch(_options, handler) {
      if (handler && typeof handler.onError === "function") {
        queueMicrotask(() => handler.onError(error()));
      }
      return true;
    },
    close() {
      return Promise.resolve();
    },
    destroy() {
      return Promise.resolve();
    },
  };
}

function installFailClosedDispatcher(parts, reason) {
  if (!parts || typeof parts.setter !== "function") return false;
  const next = createFailClosedDispatcher(reason);
  try {
    swapOwnedDispatcher(parts.setter, next);
    return true;
  } catch (_e) {
    closeDispatcherQuietly(next);
    return false;
  }
}

function createProxyDispatcher(proxyUrl, { ProxyAgent } = {}) {
  if (!proxyUrl) return null;
  if (typeof ProxyAgent !== "function") return null;
  return new ProxyAgent(proxyUrl);
}

function loadUndiciParts({ setGlobalDispatcher, ProxyAgent, Agent } = {}) {
  let setter = setGlobalDispatcher;
  let Proxy = ProxyAgent;
  let Direct = Agent;
  if (!setter || !Proxy || !Direct) {
    try {
      // eslint-disable-next-line global-require
      const undici = require("undici");
      setter = setter || undici.setGlobalDispatcher;
      Proxy = Proxy || undici.ProxyAgent;
      Direct = Direct || undici.Agent;
    } catch (_e) {
      return { setter: null, ProxyAgent: null, Agent: null };
    }
  }
  return { setter, ProxyAgent: Proxy, Agent: Direct };
}

/**
 * Display-only resolution of the currently effective proxy source.
 * Includes macOS scutil so the settings UI can label "system".
 */
function resolveEffectiveProxySource({
  env = process.env,
  proxyConfig,
  platform = process.platform,
  commandRunner = cp.spawnSync,
} = {}) {
  const config = normalizeProxyConfig(proxyConfig);
  if (config.mode === "off") {
    return { source: "none", proxyUrl: null, config };
  }
  if (config.mode === "manual") {
    const proxyUrl = buildProxyUrl(config);
    return { source: proxyUrl ? "manual" : "none", proxyUrl, config };
  }
  const envUrl = pickProxyUrl(env);
  if (envUrl) return { source: "env", proxyUrl: envUrl, config };
  if (platform === "darwin") {
    const result = commandRunner("scutil", ["--proxy"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (!result?.error && result?.status === 0) {
      const proxyUrl = parseMacProxyOutput(result.stdout);
      if (proxyUrl) return { source: "system", proxyUrl, config };
    }
  }
  return { source: "none", proxyUrl: null, config };
}

const PROXY_TEST_TIMEOUT_MS = 5000;

async function runProxyConnectivityTest({
  proxyUrl,
  targetUrl,
  timeoutMs = PROXY_TEST_TIMEOUT_MS,
  fetchImpl,
  ProxyAgent,
  Agent,
  setGlobalDispatcher,
} = {}) {
  const started = Date.now();
  const latency = () => Date.now() - started;
  if (!proxyUrl) return { ok: false, error: "no proxy url", latencyMs: latency() };
  if (!targetUrl) return { ok: false, error: "no test target", latencyMs: latency() };

  let dispatcher = null;
  try {
    const parts = loadUndiciParts({ ProxyAgent, Agent, setGlobalDispatcher });
    dispatcher = createProxyDispatcher(proxyUrl, parts);
    if (!dispatcher) {
      return { ok: false, error: "unsupported proxy protocol", latencyMs: latency() };
    }
    const doFetch = fetchImpl || fetch;
    const res = await doFetch(targetUrl, {
      method: "GET",
      dispatcher,
      signal: AbortSignal.timeout(Math.min(timeoutMs, PROXY_TEST_TIMEOUT_MS)),
    });
    return { ok: true, status: res.status, latencyMs: latency() };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), latencyMs: latency() };
  } finally {
    closeDispatcherQuietly(dispatcher);
  }
}

// Node's built-in NODE_USE_ENV_PROXY support only landed in v22.21 / v24.5.
// For older runtimes (including the v22.14 we historically embedded in the
// macOS app, and the v22.16 a community user hit on Discussion #68) the env
// var is silently ignored and fetch() bypasses the proxy. Setting an undici
// ProxyAgent dispatcher at startup gives us proxy support on every Node ≥ 18
// regardless of the env-proxy flag.
function swapOwnedDispatcher(setter, next) {
  setter(next);
  const previous = ownedDispatcher;
  ownedDispatcher = next;
  closeDispatcherQuietly(previous);
}

function installDirectAgent(parts) {
  if (typeof parts.Agent !== "function" || typeof parts.setter !== "function") return false;
  let next;
  try {
    next = new parts.Agent();
  } catch (_e) {
    return false;
  }
  try {
    swapOwnedDispatcher(parts.setter, next);
  } catch (_e) {
    closeDispatcherQuietly(next);
    return false;
  }
  return true;
}

function failManual(message, warn, parts) {
  lastManualApplyError = message;
  installFailClosedDispatcher(parts, message);
  warnManualApplyFailure(message, warn);
  return { ok: false, error: message };
}

function applyUndiciProxyIfNeeded({
  env = process.env,
  setGlobalDispatcher,
  ProxyAgent,
  Agent,
  proxyConfig,
  warn,
} = {}) {
  const normalized = normalizeProxyConfig(proxyConfig);
  const manual = normalized.mode === "manual";
  const parts = loadUndiciParts({ setGlobalDispatcher, ProxyAgent, Agent });

  if (normalized.mode === "off") {
    if (typeof parts.setter !== "function") return null;
    installDirectAgent(parts);
    lastManualApplyError = null;
    return null;
  }

  const proxyUrl = manual ? buildProxyUrl(normalized) : pickProxyUrl(env);
  if (!proxyUrl) {
    if (ownedDispatcher) installDirectAgent(parts);
    lastManualApplyError = null;
    return null;
  }

  if (typeof parts.setter !== "function") {
    return manual ? failManual("undici dispatcher is unavailable", warn, parts) : null;
  }

  let dispatcher;
  try {
    dispatcher = createProxyDispatcher(proxyUrl, parts);
  } catch (error) {
    const message = error?.message || String(error);
    return manual ? failManual(message, warn, parts) : null;
  }
  if (!dispatcher) {
    return manual ? failManual("failed to construct proxy dispatcher", warn, parts) : null;
  }

  try {
    swapOwnedDispatcher(parts.setter, dispatcher);
  } catch (error) {
    closeDispatcherQuietly(dispatcher);
    const message = error?.message || String(error);
    return manual ? failManual(message, warn, parts) : null;
  }

  lastManualApplyError = null;
  return { ok: true, proxyUrl };
}

module.exports = {
  hasProxyEnv,
  parseMacProxyOutput,
  pickProxyUrl,
  resolveSystemProxyEnv,
  relaunchWithProxyEnvIfNeeded,
  applyUndiciProxyIfNeeded,
  createProxyDispatcher,
  readPersistedProxyConfig,
  resolveEffectiveProxySource,
  runProxyConnectivityTest,
  getLastProxyApplyError,
  resetProxyApplyStateForTests,
};
