/**
 * Singleton accessor for the cross-tab PendingGrantCoordinator.
 *
 * The coordinator wraps a BroadcastChannel + localStorage + navigator.locks,
 * so it must be a singleton within a tab. This module provides a lazy-init
 * accessor that returns the same instance on every call.
 */

import { PendingGrantCoordinator } from "./pendingGrantCoordinator";

let instance: PendingGrantCoordinator | null = null;

/**
 * Returns the singleton PendingGrantCoordinator for this tab.
 * The instance is lazily created on first access and survives for the
 * lifetime of the page.
 */
export function getPendingGrantCoordinator(): PendingGrantCoordinator {
  if (!instance) {
    instance = new PendingGrantCoordinator();
  }
  return instance;
}

/**
 * Resets the singleton (for testing only).
 */
export function resetPendingGrantCoordinator(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
