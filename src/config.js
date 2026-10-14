import { homedir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, writeFile, rename, chmod, lstat } from 'node:fs/promises';

export const DEFAULT_CONFIG = {
  version: 1, enabled: true, provider: 'openrouter', model: 'openrouter/free',
  level: 'standard', mode: 'block', events: ['pre-push'],
  branches: ['main', 'master'], remotes: ['*'], exclude: [],
  maxContextBytes: 100000, timeoutSeconds: 180, receiptHours: 24,
  maxModelCalls: 10, maxOutputTokens: 4096, allowPaid: false,
  models: {
    small: { provider: 'openrouter', model: 'openrouter/free' },
    medium: { provider: 'openrouter', model: 'openrouter/free' },
    large: { provider: 'openrouter', model: 'openrouter/free' },
  },
  routing: {
    smallMaxLines: 80, smallMaxFiles: 3, largeMinLines: 400, largeMinFiles: 12,
    riskPatterns: ['auth', 'permission', 'migration', 'billing', 'payment', 'crypto', 'security', 'terraform'],
  },
};

export function getPaths(env = process.env) {
  const userHome = path.resolve(env.SPHINX_USER_HOME || homedir());
  const home = path.resolve(env.SPHINX_HOME || path.join(userHome, '.config', 'sphinx'));
  return {
    home, userHome, config: path.join(home, 'config.json'), sessions: path.join(home, 'sessions'),
    install: path.join(home, 'install.json'), credentials: path.join(home, 'credentials.json'),
    codexHome: path.resolve((!env.SPHINX_USER_HOME && env.CODEX_HOME) || path.join(userHome, '.codex')),
    claudeHome: path.resolve((!env.SPHINX_USER_HOME && env.CLAUDE_CONFIG_DIR) || path.join(userHome, '.claude')),
  };
}

export async function readJson(file, fallback) {
  let handle;
  try {
    handle=await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info=await handle.stat();
    if(!info.isFile() || info.size>4*1024*1024)throw new Error('not a regular JSON file or exceeds 4 MiB');
    const raw=await handle.readFile('utf8');
    try { return JSON.parse(raw); } catch { throw new Error('invalid JSON'); }
  }
  catch (e) {
    if (e.code === 'ENOENT' && arguments.length > 1) return fallback;
    throw new Error(`Cannot read ${file}: ${e.code || e.message}`);
  } finally { await handle?.close(); }
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(tmp, file);
  await chmod(file, 0o600);
}

export function validateConfig(config) {
  const fail = (message) => { throw new Error(`Invalid Sphinx configuration: ${message}`); };
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('expected an object');
  const allowed = new Set(Object.keys(DEFAULT_CONFIG));
  for (const key of Object.keys(config)) if (!allowed.has(key)) fail(`unknown setting ${key}`);
  if (config.version !== 1) fail('version must be 1');
  for (const key of ['enabled', 'allowPaid']) if (typeof config[key] !== 'boolean') fail(`${key} must be boolean`);
  for (const [key, values] of Object.entries({ provider: ['openrouter','codex','claude','auto'], level: ['relaxed','standard','thorough'], mode: ['block','advisory'] })) {
    if (!values.includes(config[key])) fail(`${key} must be ${values.join(', ')}`);
  }
  if (config.model !== null && (typeof config.model !== 'string' || !config.model.trim())) fail('model must be a nonempty string or null');
  for (const key of ['events','branches','remotes','exclude']) {
    if (!Array.isArray(config[key]) || config[key].some(x => typeof x !== 'string' || !x.length)) fail(`${key} must be an array of nonempty strings`);
  }
  if (config.events.some(x => !['pre-push','pre-commit'].includes(x))) fail('events must use pre-push or pre-commit');
  for (const [key, min, max] of [['maxContextBytes',1000,1000000],['timeoutSeconds',1,600],['receiptHours',1,720],['maxModelCalls',1,100],['maxOutputTokens',512,16384]]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) fail(`${key} must be an integer between ${min} and ${max}`);
  }
  if (!config.models || typeof config.models !== 'object') fail('models must define small, medium, and large routes');
  for (const tier of ['small','medium','large']) {
    const route = config.models[tier];
    if (!route || !['openrouter','codex','claude','auto'].includes(route.provider)) fail(`models.${tier}.provider is invalid`);
    if (route.model !== null && (typeof route.model !== 'string' || !route.model.trim())) fail(`models.${tier}.model must be a string or null`);
    if (Object.keys(route).some(k => !['provider','model'].includes(k))) fail(`unexpected field in models.${tier}`);
  }
  if (Object.keys(config.models).some(k => !['small','medium','large'].includes(k))) fail('unknown model tier');
  if (!config.routing || typeof config.routing !== 'object') fail('routing is required');
  for (const key of Object.keys(config.routing)) if (!Object.hasOwn(DEFAULT_CONFIG.routing,key)) fail(`unknown routing setting ${key}`);
  for (const k of ['smallMaxLines','smallMaxFiles','largeMinLines','largeMinFiles']) {
    if (!Number.isInteger(config.routing[k]) || config.routing[k] < 1) fail(`routing.${k} must be a positive integer`);
  }
  if (config.routing.largeMinLines <= config.routing.smallMaxLines || config.routing.largeMinFiles <= config.routing.smallMaxFiles) fail('large routing thresholds must exceed small thresholds');
  if (!Array.isArray(config.routing.riskPatterns) || config.routing.riskPatterns.some(s => typeof s !== 'string' || !s)) fail('routing.riskPatterns must be strings');
  return config;
}

function merged(base, overrides) {
  return { ...base, ...overrides, models: { ...base.models, ...overrides?.models }, routing: { ...base.routing, ...overrides?.routing } };
}

export const REPOSITORY_CONFIG_KEYS = Object.freeze(['version','enabled','level','mode','events','branches','remotes','exclude']);

export function validateRepositoryConfig(local, { env = process.env, source = '.sphinxconfig' } = {}) {
  if (!local || typeof local !== 'object' || Array.isArray(local)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(local))) {
    throw new Error(`Repository ${source} must be a JSON object.`);
  }
  for (const key of Object.keys(local)) {
    if (!REPOSITORY_CONFIG_KEYS.includes(key)) {
      throw new Error(`Repository ${source} cannot set ${key}; configure model routes and budgets in ${getPaths(env).config}.`);
    }
  }
  validateConfig({ ...structuredClone(DEFAULT_CONFIG), ...local });
  return local;
}

async function fileInfo(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** The canonical policy wins completely; shadowed legacy data is never read or merged. */
export async function repositoryConfigInfo(repoRoot) {
  const canonical = path.resolve(repoRoot, '.sphinxconfig');
  const legacy = path.resolve(repoRoot, '.sphinx.json');
  const [canonicalInfo, legacyInfo] = await Promise.all([fileInfo(canonical), fileInfo(legacy)]);
  const selected = canonicalInfo ? canonical : legacyInfo ? legacy : canonical;
  const info = canonicalInfo || legacyInfo;
  if (info && !info.isFile()) throw new Error(`Repository configuration must be a regular file, not a symlink or directory: ${selected}`);
  return {
    path: selected, exists: Boolean(info), legacy: !canonicalInfo && Boolean(legacyInfo),
    ...(canonicalInfo && legacyInfo ? { shadowed: legacy } : {}),
  };
}

export async function loadConfig(repoRoot, env = process.env) {
  const global = await readJson(getPaths(env).config, {});
  if (!global || typeof global !== 'object' || Array.isArray(global)) throw new Error('Global Sphinx configuration must be a JSON object.');
  for (const key of ['models','routing']) {
    if (Object.hasOwn(global,key) && (!global[key] || typeof global[key]!=='object' || Array.isArray(global[key]))) throw new Error(`Global ${key} must be a JSON object.`);
  }
  let config = merged(structuredClone(DEFAULT_CONFIG), global);
  // A legacy/single-provider configuration applies to all tiers unless routes are explicit.
  if ((Object.hasOwn(global,'provider') || Object.hasOwn(global,'model')) && !global.models) {
    config.models = Object.fromEntries(['small','medium','large'].map(t => [t,{provider:config.provider,model:config.model}]));
  }
  validateConfig(config);
  if (repoRoot) {
    const source = await repositoryConfigInfo(repoRoot);
    const local = source.exists ? await readJson(source.path) : {};
    validateRepositoryConfig(local, { env, source: path.basename(source.path) });
    config = merged(config, {...local,exclude:[...new Set([...config.exclude,...(local.exclude||[])])]});
  }
  return validateConfig(config);
}

export async function saveConfig(config, env = process.env) {
  validateConfig(config);
  await writeJson(getPaths(env).config, config);
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function policyHash(config) {
  return createHash('sha256').update(stableStringify(config)).digest('hex');
}

export async function saveOpenRouterKey(key, env = process.env) {
  if (typeof key !== 'string' || !key.trim() || /\s/.test(key.trim())) throw new Error('Enter a valid OpenRouter API key.');
  await writeJson(getPaths(env).credentials, { openrouter: key.trim() });
}
export async function openRouterKey(env = process.env) {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  try {
    const credentials = await readJson(getPaths(env).credentials, {});
    const key = credentials?.openrouter;
    if (key !== undefined && (typeof key !== 'string' || !key.trim() || /\s/.test(key))) throw new Error('Invalid key');
    return key || null;
  } catch { throw new Error('Could not read Sphinx credentials. Run sphinx auth to save your key again.'); }
}
