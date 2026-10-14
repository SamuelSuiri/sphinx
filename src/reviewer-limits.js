// Providers may request several independent reads in one response. Pi executes
// them sequentially; workspace byte limits, the archive cap, and deadlines still apply.
export const MAX_REVIEWER_TOOL_CALLS = 8;
