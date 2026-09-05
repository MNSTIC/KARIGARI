/**
 * How often the live admin consoles refetch.
 *
 * One constant rather than a literal per console: the facilitator queue, the
 * cluster view and the tickets board all sit on the same screen behind tabs, so
 * three different intervals would mean three different ideas of how stale
 * "Live" is allowed to be.
 */
export const ADMIN_POLL_MS = 15000;
