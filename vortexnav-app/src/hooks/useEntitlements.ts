// ==============================================
// Entitlements Hook
// ==============================================
//
// React hook for checking and managing feature entitlements.
//

import { useState, useEffect, useCallback, useRef, createElement } from 'react';
import type { ComponentType, FC } from 'react';
import * as laClient from '../services/laClient';
import type { Entitlement, EntitlementCheck } from '../services/laClient';

// Common entitlement keys
export const EntitlementKeys = {
  PREMIUM_CHARTS: 'premium_charts',
  WEATHER_OVERLAY: 'weather_overlay',
  AIS_INTEGRATION: 'ais_integration',
  OFFLINE_PACKS: 'offline_packs',
  MAX_OFFLINE_REGIONS: 'max_offline_regions',
  MAX_ZOOM_LEVEL: 'max_zoom_level',
  ALLOWED_BASEMAPS: 'allowed_basemaps',
} as const;

export type EntitlementKey = typeof EntitlementKeys[keyof typeof EntitlementKeys];

export interface UseEntitlementsReturn {
  // All entitlements
  entitlements: Entitlement[];
  isLoading: boolean;
  error: string | null;

  // Check functions
  check: (key: string) => Promise<EntitlementCheck>;
  isAllowed: (key: string) => boolean;
  getValue: <T>(key: string) => T | null;

  // Refresh
  refresh: () => Promise<void>;
}

// Cache for entitlement checks
const entitlementCache = new Map<string, EntitlementCheck & { cachedAt: number }>();
const CACHE_TTL = 60000; // 1 minute

/**
 * Hook for checking and managing feature entitlements
 */
export function useEntitlements(): UseEntitlementsReturn {
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track allowed entitlements for quick lookup
  const allowedMap = useRef<Map<string, boolean>>(new Map());
  const valueMap = useRef<Map<string, unknown>>(new Map());

  /**
   * Load all entitlements
   */
  const loadEntitlements = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const list = await laClient.listEntitlements();
      setEntitlements(list);

      // Build allowed map
      allowedMap.current.clear();
      valueMap.current.clear();

      for (const ent of list) {
        allowedMap.current.set(ent.key, !laClient.isExpired(ent.expires_at));
        valueMap.current.set(ent.key, ent.value);
      }

      setIsLoading(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load entitlements';
      setError(msg);
      setIsLoading(false);
    }
  }, []);

  /**
   * Check a specific entitlement (with caching)
   */
  const check = useCallback(async (key: string): Promise<EntitlementCheck> => {
    // Check cache
    const cached = entitlementCache.get(key);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return cached;
    }

    try {
      const result = await laClient.checkEntitlement(key);

      // Cache result
      entitlementCache.set(key, {
        ...result,
        cachedAt: Date.now(),
      });

      // Update allowed map
      allowedMap.current.set(key, result.allowed);
      if (result.value !== undefined) {
        valueMap.current.set(key, result.value);
      }

      return result;
    } catch (err) {
      console.error(`Failed to check entitlement ${key}:`, err);
      return {
        allowed: false,
        reason: 'Failed to check entitlement',
      };
    }
  }, []);

  /**
   * Synchronously check if entitlement is allowed (from cache)
   */
  const isAllowed = useCallback((key: string): boolean => {
    return allowedMap.current.get(key) ?? false;
  }, []);

  /**
   * Get entitlement value
   */
  const getValue = useCallback(<T>(key: string): T | null => {
    return (valueMap.current.get(key) as T) ?? null;
  }, []);

  /**
   * Refresh entitlements
   */
  const refresh = useCallback(async () => {
    entitlementCache.clear();
    await loadEntitlements();
  }, [loadEntitlements]);

  // Load on mount
  useEffect(() => {
    loadEntitlements();
  }, [loadEntitlements]);

  return {
    entitlements,
    isLoading,
    error,
    check,
    isAllowed,
    getValue,
    refresh,
  };
}

/**
 * Higher-order component for entitlement-gated features
 */
export function withEntitlement<P extends object>(
  WrappedComponent: ComponentType<P>,
  requiredEntitlement: string,
  FallbackComponent?: ComponentType
): FC<P> {
  return function EntitlementGate(props: P) {
    const { isAllowed } = useEntitlements();

    if (!isAllowed(requiredEntitlement)) {
      if (FallbackComponent) {
        return createElement(FallbackComponent);
      }
      return null;
    }

    return createElement(WrappedComponent, props);
  };
}

export default useEntitlements;
