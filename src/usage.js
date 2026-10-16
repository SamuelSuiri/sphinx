/** A null limit means explicitly uncapped usage, not zero available requests. */
export const modelUsageText = ({ calls, limit }) => limit === null
  ? `${calls} model calls · no limit`
  : `${calls}/${limit} model calls`;

export const modelLimitText = limit => limit === null ? 'no limit' : `${limit} model calls per assessment`;
