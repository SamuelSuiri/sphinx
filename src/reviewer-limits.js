// Providers may request several independent reads in one response. Pi executes
// them sequentially; workspace byte limits, the archive cap, and deadlines still apply.
export const MAX_REVIEWER_TOOL_CALLS = 8;

// Planning targets include investigation, Pi compaction, and final synthesis.
// A null configured limit does not turn a planning target into a hard cap.
export function reviewerTurnLimit(tier, configuredLimit = 8) {
  const target = configuredLimit ?? 8;
  return Math.min(target, tier === 'small' ? 3 : tier === 'medium' ? 5 : target);
}
