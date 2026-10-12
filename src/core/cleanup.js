export const SKIP_REASONS = {
  active: 'Active tab',
  discarded: 'Already unloaded',
  protected: 'Protected',
  pinned: 'Pinned',
  audible: 'Playing audio',
  excluded: 'Excluded by Chrome or the site',
  recent: 'Recently used',
  loading: 'Still loading',
};

/**
 * Decides whether a tab may be discarded. Returns null when eligible, otherwise
 * a key of SKIP_REASONS. The active tab is never eligible.
 */
export function cleanupSkipReason(tab, { inactiveMinutes, excludePinned = true, excludeAudible = true, now = Date.now(), isProtected = () => false }) {
  if (tab.active) return 'active';
  if (tab.discarded) return 'discarded';
  if (isProtected(tab)) return 'protected';
  if (excludePinned && tab.pinned) return 'pinned';
  if (excludeAudible && tab.audible) return 'audible';
  if (tab.autoDiscardable === false) return 'excluded';
  if (tab.status === 'loading') return 'loading';
  if (inactiveMinutes > 0) {
    // lastAccessed is missing on Chrome < 121; treat unknown as recent to stay safe.
    if (!tab.lastAccessed || now - tab.lastAccessed < inactiveMinutes * 60_000) return 'recent';
  }
  return null;
}
