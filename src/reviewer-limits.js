// Providers may request several independent reads in one response. Pi executes
// them sequentially; workspace byte limits, the archive cap, and deadlines still apply.
export const MAX_REVIEWER_TOOL_CALLS = 8;

// These ceilings include investigation, Pi compaction, and final synthesis.
// The shared assessment budget still reserves separate calls for human grading.
export function reviewerTurnLimit(tier, configuredLimit = 8) {
  return Math.min(configuredLimit, tier === 'small' ? 3 : tier === 'medium' ? 5 : configuredLimit);
}
