// ==============================================
// Licensing Agent Hook
// ==============================================
//
// React hook for managing connection to the Licensing Agent
// and device registration status.
//

import { useState, useEffect, useCallback, useRef } from 'react';
import * as laClient from '../services/laClient';
import type { DeviceStatus, PackInfo, PackCatalogRegion, Entitlement } from '../services/laClient';

export interface LaConnectionState {
  isConnected: boolean;
  isRegistered: boolean;
  deviceStatus: DeviceStatus | null;
  entitlements: Entitlement[];
  error: string | null;
  isLoading: boolean;
}

export interface UseLicensingAgentReturn extends LaConnectionState {
  // Actions
  checkConnection: () => Promise<boolean>;
  register: (code: string) => Promise<boolean>;
  sync: () => Promise<void>;

  // Entitlement operations
  refreshEntitlements: () => Promise<void>;
  checkEntitlement: (key: string) => Promise<boolean>;

  // Pack operations
  packs: PackInfo[];
  catalog: PackCatalogRegion[];
  refreshPacks: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  requestPack: (regionSlug: string, zoomLevels?: number[]) => Promise<string | null>;
  deletePack: (packId: string) => Promise<boolean>;
}

/**
 * Hook for managing Licensing Agent connection and device registration
 */
export function useLicensingAgent(): UseLicensingAgentReturn {
  const [state, setState] = useState<LaConnectionState>({
    isConnected: false,
    isRegistered: false,
    deviceStatus: null,
    entitlements: [],
    error: null,
    isLoading: true,
  });

  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [catalog, setCatalog] = useState<PackCatalogRegion[]>([]);

  // Polling interval ref
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Check connection to LA
   */
  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const connected = await laClient.checkConnection();

      if (connected) {
        // Get device status
        const status = await laClient.getDeviceStatus();
        setState(prev => ({
          ...prev,
          isConnected: true,
          isRegistered: status.registered,
          deviceStatus: status,
          error: null,
          isLoading: false,
        }));
        return true;
      } else {
        setState(prev => ({
          ...prev,
          isConnected: false,
          isRegistered: false,
          deviceStatus: null,
          error: 'Unable to connect to Licensing Agent',
          isLoading: false,
        }));
        return false;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Connection failed';
      setState(prev => ({
        ...prev,
        isConnected: false,
        isRegistered: false,
        deviceStatus: null,
        error: errorMsg,
        isLoading: false,
      }));
      return false;
    }
  }, []);

  /**
   * Register device with code
   */
  const register = useCallback(async (code: string): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await laClient.registerDevice(code);

      if (result.success) {
        // Refresh status
        const status = await laClient.getDeviceStatus();
        setState(prev => ({
          ...prev,
          isRegistered: true,
          deviceStatus: status,
          isLoading: false,
        }));
        return true;
      } else {
        setState(prev => ({
          ...prev,
          error: 'Registration failed',
          isLoading: false,
        }));
        return false;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Registration failed';
      setState(prev => ({
        ...prev,
        error: errorMsg,
        isLoading: false,
      }));
      return false;
    }
  }, []);

  /**
   * Force sync with Horizon
   */
  const sync = useCallback(async (): Promise<void> => {
    try {
      await laClient.sync();
      // Refresh status, entitlements, and packs after sync
      await checkConnection();
      await refreshEntitlements();
      await refreshPacks();
    } catch (err) {
      console.error('Sync failed:', err);
    }
  }, [checkConnection]);

  /**
   * Refresh entitlements from LA
   */
  const refreshEntitlements = useCallback(async (): Promise<void> => {
    try {
      const entitlementList = await laClient.listEntitlements();
      setState(prev => ({ ...prev, entitlements: entitlementList }));
    } catch (err) {
      console.error('Failed to refresh entitlements:', err);
    }
  }, []);

  /**
   * Check a specific entitlement
   */
  const checkEntitlement = useCallback(async (key: string): Promise<boolean> => {
    try {
      const result = await laClient.checkEntitlement(key);
      return result.allowed;
    } catch (err) {
      console.error(`Failed to check entitlement ${key}:`, err);
      return false;
    }
  }, []);

  /**
   * Refresh pack list
   */
  const refreshPacks = useCallback(async (): Promise<void> => {
    try {
      const packList = await laClient.listPacks();
      setPacks(packList);
    } catch (err) {
      console.error('Failed to refresh packs:', err);
    }
  }, []);

  /**
   * Refresh pack catalog
   */
  const refreshCatalog = useCallback(async (): Promise<void> => {
    try {
      const catalogList = await laClient.getPackCatalog();
      setCatalog(catalogList);
    } catch (err) {
      console.error('Failed to refresh catalog:', err);
    }
  }, []);

  /**
   * Request pack download
   */
  const requestPack = useCallback(async (
    regionSlug: string,
    zoomLevels?: number[]
  ): Promise<string | null> => {
    try {
      const result = await laClient.requestPack(regionSlug, zoomLevels);
      // Refresh packs to show the new pending pack
      await refreshPacks();
      return result.pack_id;
    } catch (err) {
      console.error('Failed to request pack:', err);
      return null;
    }
  }, [refreshPacks]);

  /**
   * Delete a pack
   */
  const deletePack = useCallback(async (packId: string): Promise<boolean> => {
    try {
      const success = await laClient.deletePack(packId);
      if (success) {
        await refreshPacks();
      }
      return success;
    } catch (err) {
      console.error('Failed to delete pack:', err);
      return false;
    }
  }, [refreshPacks]);

  // Initial connection check
  useEffect(() => {
    checkConnection();

    // Poll for connection status every 30 seconds
    pollIntervalRef.current = setInterval(() => {
      checkConnection();
    }, 30000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [checkConnection]);

  // Load entitlements, packs and catalog when registered
  useEffect(() => {
    if (state.isRegistered) {
      refreshEntitlements();
      refreshPacks();
      refreshCatalog();
    }
  }, [state.isRegistered, refreshEntitlements, refreshPacks, refreshCatalog]);

  return {
    ...state,
    checkConnection,
    register,
    sync,
    refreshEntitlements,
    checkEntitlement,
    packs,
    catalog,
    refreshPacks,
    refreshCatalog,
    requestPack,
    deletePack,
  };
}

export default useLicensingAgent;
