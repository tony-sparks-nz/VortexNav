// ==============================================
// Licensing Agent Hook
// ==============================================
//
// React hook for managing connection to the Licensing Agent
// and device registration status.
//

import { useState, useEffect, useCallback, useRef } from 'react';
import * as laClient from '../services/laClient';
import type {
  DeviceStatus,
  PackInfo,
  PackCatalogRegion,
  Entitlement,
  CustomPackBounds,
  CustomPackResult,
  TileEstimateResult,
  DownloadProgressResult,
  PauseResumeResult,
  CancelResult,
} from '../services/laClient';

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

  // Custom pack (download area) operations
  requestCustomPack: (
    bounds: CustomPackBounds,
    zoomLevels: number[],
    basemapId: string,
    name: string
  ) => Promise<CustomPackResult | null>;
  estimatePackTiles: (
    bounds: CustomPackBounds,
    zoomLevels: number[]
  ) => Promise<TileEstimateResult | null>;
  getDownloadProgress: (packId: string) => Promise<DownloadProgressResult | null>;

  // Download control
  pauseDownload: (packId: string) => Promise<boolean>;
  resumeDownload: (packId: string) => Promise<boolean>;
  cancelDownload: (packId: string) => Promise<boolean>;
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
      console.log('[useLicensingAgent] Received entitlements:', JSON.stringify(entitlementList, null, 2));
      // Log specific max_zoom_level entitlement for debugging
      const maxZoomEnt = entitlementList.find(e => e.key === 'max_zoom_level');
      console.log('[useLicensingAgent] max_zoom_level entitlement:', maxZoomEnt);
      if (maxZoomEnt) {
        console.log('[useLicensingAgent] max_zoom_level value type:', typeof maxZoomEnt.value, 'value:', maxZoomEnt.value);
      }
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

  /**
   * Request a custom pack download for a user-defined area
   */
  const requestCustomPack = useCallback(async (
    bounds: CustomPackBounds,
    zoomLevels: number[],
    basemapId: string,
    name: string
  ): Promise<CustomPackResult | null> => {
    console.log('[useLicensingAgent] requestCustomPack called:', { bounds, zoomLevels, basemapId, name });
    console.log('[useLicensingAgent] Connection state:', { isConnected: state.isConnected, isRegistered: state.isRegistered });

    try {
      const result = await laClient.requestCustomPack(bounds, zoomLevels, basemapId, name);
      console.log('[useLicensingAgent] requestCustomPack result:', result);
      // Refresh packs to show the new pending pack
      await refreshPacks();
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[useLicensingAgent] requestCustomPack FAILED:', errorMsg, err);
      // Re-throw so caller can handle the specific error
      throw new Error(`Custom pack request failed: ${errorMsg}`);
    }
  }, [refreshPacks, state.isConnected, state.isRegistered]);

  /**
   * Estimate tile count and size for a custom area
   */
  const estimatePackTiles = useCallback(async (
    bounds: CustomPackBounds,
    zoomLevels: number[]
  ): Promise<TileEstimateResult | null> => {
    try {
      return await laClient.estimatePackTiles(bounds, zoomLevels);
    } catch (err) {
      console.error('Failed to estimate pack tiles:', err);
      return null;
    }
  }, []);

  /**
   * Get download progress for a pack
   */
  const getDownloadProgress = useCallback(async (
    packId: string
  ): Promise<DownloadProgressResult | null> => {
    try {
      return await laClient.getDownloadProgress(packId);
    } catch (err) {
      console.error('Failed to get download progress:', err);
      return null;
    }
  }, []);

  /**
   * Pause a download
   */
  const pauseDownload = useCallback(async (packId: string): Promise<boolean> => {
    try {
      const result = await laClient.pauseDownload(packId);
      return result.paused ?? false;
    } catch (err) {
      console.error('Failed to pause download:', err);
      return false;
    }
  }, []);

  /**
   * Resume a paused download
   */
  const resumeDownload = useCallback(async (packId: string): Promise<boolean> => {
    try {
      const result = await laClient.resumeDownload(packId);
      return result.resumed ?? false;
    } catch (err) {
      console.error('Failed to resume download:', err);
      return false;
    }
  }, []);

  /**
   * Cancel a download
   */
  const cancelDownload = useCallback(async (packId: string): Promise<boolean> => {
    try {
      const result = await laClient.cancelDownload(packId);
      if (result.cancelled) {
        // Refresh packs list after cancellation
        refreshPacks();
      }
      return result.cancelled ?? false;
    } catch (err) {
      console.error('Failed to cancel download:', err);
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
    requestCustomPack,
    estimatePackTiles,
    getDownloadProgress,
    pauseDownload,
    resumeDownload,
    cancelDownload,
  };
}

export default useLicensingAgent;
