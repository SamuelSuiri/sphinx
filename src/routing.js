export const QUESTION_LIMITS = Object.freeze({
  relaxed: Object.freeze({ small: 1, medium: 2, large: 2 }),
  standard: Object.freeze({ small: 1, medium: 2, large: 3 }),
  thorough: Object.freeze({ small: 1, medium: 3, large: 5 }),
});

export function questionLimit(level, tier = 'large') {
  const limit = QUESTION_LIMITS[level]?.[tier];
  if (!Number.isInteger(limit)) throw new Error('Assessment needs a valid depth and change tier.');
  return limit;
}

export function selectRoute(snapshot, config) {
  const stats = snapshot.stats || {};
  const lines = (stats.additions || 0) + (stats.deletions || 0);
  const files = stats.files ?? snapshot.files.length;
  const r = config.routing;
  const sensitive = snapshot.files.filter(file => r.riskPatterns.some(term => file.toLowerCase().includes(term.toLowerCase())));
  let tier, reason;
  if (sensitive.length) { tier = 'large'; reason = `Consequential paths: ${sensitive.join(', ')}`; }
  else if (lines >= r.largeMinLines || files >= r.largeMinFiles) { tier = 'large'; reason = `${lines} changed lines across ${files} files`; }
  else if (lines <= r.smallMaxLines && files <= r.smallMaxFiles) { tier = 'small'; reason = `${lines} changed lines across ${files} files`; }
  else { tier = 'medium'; reason = `${lines} changed lines across ${files} files`; }
  const route = config.models[tier];
  return { tier, reason, ...route, lines, files };
}

export function evaluatorConfig(config, route) {
  return { ...config, provider: route.provider, model: route.model, changeTier: route.tier, effort: route.tier === 'large' ? 'medium' : 'low' };
}

export function parseRoute(value) {
  const separator = value.indexOf(':');
  const provider = separator < 0 ? value : value.slice(0,separator);
  const model = separator < 0 ? null : value.slice(separator + 1);
  if (!['openrouter','codex','claude','auto'].includes(provider) || model === '') throw new Error('Use provider:model, for example openrouter:openrouter/free or claude:sonnet.');
  return { provider, model };
}
