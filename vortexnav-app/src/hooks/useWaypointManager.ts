/**
 * useWaypointManager - Centralized waypoint state management
 *
 * This hook provides a single source of truth for all waypoint operations,
 * solving issues with distributed state and stale closures.
 *
 * Key features:
 * - Reducer-based state management for predictable state transitions
 * - Proper async sequencing (all async ops awaited before state changes)
 * - Position-only updates for safe drag operations
 * - Form state as source of truth during editing
 */

import { useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import type {
  WaypointFormData,
  WaypointEditState,
  WaypointDraggingState,
} from '../types';
import {
  getWaypoints,
  createWaypoint,
  updateWaypoint,
  updateWaypointPosition,
  deleteWaypoint as deleteWaypointApi,
  toggleWaypointHidden as toggleWaypointHiddenApi,
  isTauri,
  type Waypoint,
} from './useTauri';

// Re-export Waypoint type for consumers
export type { Waypoint };

// Define WaypointManagerState locally to avoid circular import
export interface WaypointManagerState {
  waypoints: Waypoint[];
  activeWaypointId: number | null;
  selectedWaypointId: number | null;
  editState: WaypointEditState;
  dragging: WaypointDraggingState | null;
  isLoading: boolean;
  showAllLabels: boolean; // Global toggle for waypoint labels on map
  showAllMarkers: boolean; // Global toggle for waypoint markers on map
}

// ============ Action Types ============

type WaypointAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; payload: Waypoint[] }
  | { type: 'LOAD_ERROR'; payload: string }
  | { type: 'START_CREATE'; payload?: { lat: number; lon: number } }
  | { type: 'START_EDIT'; payload: { waypointId: number; waypoint: Waypoint } }
  | { type: 'UPDATE_FORM'; payload: Partial<WaypointFormData> }
  | { type: 'MARK_DIRTY' }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS'; payload: Waypoint[] }
  | { type: 'SAVE_ERROR'; payload: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'CLOSE_EDIT' }
  | { type: 'DRAG_START'; payload: WaypointDraggingState }
  | { type: 'DRAG_MOVE'; payload: { lat: number; lon: number } }
  | { type: 'DRAG_END' }
  | { type: 'DRAG_END_DURING_EDIT'; payload: { lat: number; lon: number } }
  | { type: 'SET_ACTIVE'; payload: number | null }
  | { type: 'SET_SELECTED'; payload: number | null }
  | { type: 'DELETE_SUCCESS'; payload: { deletedId: number; waypoints: Waypoint[] } }
  | { type: 'TOGGLE_ALL_LABELS' }
  | { type: 'TOGGLE_ALL_MARKERS' }
  | { type: 'TOGGLE_HIDDEN_SUCCESS'; payload: Waypoint[] };

// ============ Initial State ============

const initialEditState: WaypointEditState = {
  status: 'idle',
  waypointId: null,
  formData: null,
  isDirty: false,
  error: null,
};

const initialState: WaypointManagerState = {
  waypoints: [],
  activeWaypointId: null,
  selectedWaypointId: null,
  editState: initialEditState,
  dragging: null,
  isLoading: false,
  showAllLabels: true, // Labels visible by default
  showAllMarkers: true, // Markers visible by default
};

// ============ Helper Functions ============

function waypointToFormData(waypoint: Waypoint): WaypointFormData {
  return {
    name: waypoint.name,
    lat: waypoint.lat.toFixed(6),
    lon: waypoint.lon.toFixed(6),
    description: waypoint.description || '',
    symbol: waypoint.symbol || 'default',
    showLabel: waypoint.show_label,
  };
}

function createEmptyFormData(lat?: number, lon?: number): WaypointFormData {
  return {
    name: '',
    lat: lat !== undefined ? lat.toFixed(6) : '',
    lon: lon !== undefined ? lon.toFixed(6) : '',
    description: '',
    symbol: 'default',
    showLabel: true, // New waypoints have labels visible by default
  };
}

// ============ Reducer ============

function waypointReducer(
  state: WaypointManagerState,
  action: WaypointAction
): WaypointManagerState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, isLoading: true };

    case 'LOAD_SUCCESS':
      return {
        ...state,
        waypoints: action.payload,
        isLoading: false,
      };

    case 'LOAD_ERROR':
      console.error('Failed to load waypoints:', action.payload);
      return { ...state, isLoading: false };

    case 'START_CREATE':
      return {
        ...state,
        editState: {
          status: 'creating',
          waypointId: null,
          formData: createEmptyFormData(action.payload?.lat, action.payload?.lon),
          isDirty: false,
          error: null,
        },
      };

    case 'START_EDIT':
      return {
        ...state,
        selectedWaypointId: action.payload.waypointId,
        editState: {
          status: 'editing',
          waypointId: action.payload.waypointId,
          formData: waypointToFormData(action.payload.waypoint),
          isDirty: false,
          error: null,
        },
      };

    case 'UPDATE_FORM':
      if (!state.editState.formData) return state;
      return {
        ...state,
        editState: {
          ...state.editState,
          formData: { ...state.editState.formData, ...action.payload },
          isDirty: true,
        },
      };

    case 'MARK_DIRTY':
      return {
        ...state,
        editState: { ...state.editState, isDirty: true },
      };

    case 'SAVE_START':
      return {
        ...state,
        editState: { ...state.editState, status: 'saving', error: null },
      };

    case 'SAVE_SUCCESS':
      // After save, keep editing mode open but mark as clean
      // User must explicitly close the panel
      return {
        ...state,
        waypoints: action.payload,
        editState: {
          ...state.editState,
          status: state.editState.status === 'creating' ? 'idle' : 'editing',
          isDirty: false,
          error: null,
          // If creating, clear the form; if editing, keep waypointId
          waypointId: state.editState.status === 'creating' ? null : state.editState.waypointId,
          formData: state.editState.status === 'creating' ? null : state.editState.formData,
        },
      };

    case 'SAVE_ERROR':
      return {
        ...state,
        editState: {
          ...state.editState,
          status: state.editState.waypointId ? 'editing' : 'creating',
          error: action.payload,
        },
      };

    case 'CANCEL_EDIT':
    case 'CLOSE_EDIT':
      return {
        ...state,
        editState: initialEditState,
      };

    case 'DRAG_START':
      return {
        ...state,
        dragging: action.payload,
      };

    case 'DRAG_MOVE':
      if (!state.dragging) return state;
      return {
        ...state,
        dragging: { ...state.dragging, ...action.payload },
      };

    case 'DRAG_END':
      return {
        ...state,
        dragging: null,
      };

    case 'DRAG_END_DURING_EDIT':
      // When dragging during edit, update the form's lat/lon but don't save to DB
      if (!state.editState.formData) return { ...state, dragging: null };
      return {
        ...state,
        dragging: null,
        editState: {
          ...state.editState,
          formData: {
            ...state.editState.formData,
            lat: action.payload.lat.toFixed(6),
            lon: action.payload.lon.toFixed(6),
          },
          isDirty: true,
        },
      };

    case 'SET_ACTIVE':
      return {
        ...state,
        activeWaypointId: action.payload,
      };

    case 'SET_SELECTED':
      return {
        ...state,
        selectedWaypointId: action.payload,
      };

    case 'DELETE_SUCCESS':
      return {
        ...state,
        waypoints: action.payload.waypoints,
        selectedWaypointId:
          state.selectedWaypointId === action.payload.deletedId
            ? null
            : state.selectedWaypointId,
        activeWaypointId:
          state.activeWaypointId === action.payload.deletedId
            ? null
            : state.activeWaypointId,
      };

    case 'TOGGLE_ALL_LABELS':
      return {
        ...state,
        showAllLabels: !state.showAllLabels,
      };

    case 'TOGGLE_ALL_MARKERS':
      return {
        ...state,
        showAllMarkers: !state.showAllMarkers,
      };

    case 'TOGGLE_HIDDEN_SUCCESS':
      return {
        ...state,
        waypoints: action.payload,
      };

    default:
      return state;
  }
}

// ============ Hook ============

export function useWaypointManager() {
  const [state, dispatch] = useReducer(waypointReducer, initialState);

  // Keep refs for access in event handlers without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  // ============ Memoized Selectors ============

  const selectedWaypoint = useMemo(
    () => state.waypoints.find((w) => w.id === state.selectedWaypointId) || null,
    [state.waypoints, state.selectedWaypointId]
  );

  const activeWaypoint = useMemo(
    () => state.waypoints.find((w) => w.id === state.activeWaypointId) || null,
    [state.waypoints, state.activeWaypointId]
  );

  const editingWaypoint = useMemo(
    () =>
      state.editState.waypointId
        ? state.waypoints.find((w) => w.id === state.editState.waypointId) || null
        : null,
    [state.waypoints, state.editState.waypointId]
  );

  const isEditing = state.editState.status === 'editing' || state.editState.status === 'creating';
  const isSaving = state.editState.status === 'saving';

  // ============ Actions ============

  const loadWaypoints = useCallback(async () => {
    if (!isTauri()) return;

    dispatch({ type: 'LOAD_START' });
    try {
      const waypoints = await getWaypoints();
      dispatch({ type: 'LOAD_SUCCESS', payload: waypoints });
    } catch (error) {
      dispatch({ type: 'LOAD_ERROR', payload: String(error) });
    }
  }, []);

  const startCreate = useCallback((position?: { lat: number; lon: number }) => {
    dispatch({ type: 'START_CREATE', payload: position });
  }, []);

  const startEdit = useCallback(
    (waypointId: number) => {
      const waypoint = stateRef.current.waypoints.find((w) => w.id === waypointId);
      if (waypoint) {
        dispatch({ type: 'START_EDIT', payload: { waypointId, waypoint } });
      }
    },
    []
  );

  const updateForm = useCallback((updates: Partial<WaypointFormData>) => {
    dispatch({ type: 'UPDATE_FORM', payload: updates });
  }, []);

  const saveWaypoint = useCallback(async () => {
    const currentState = stateRef.current;
    const { editState } = currentState;

    if (!editState.formData || !isTauri()) return;

    const lat = parseFloat(editState.formData.lat);
    const lon = parseFloat(editState.formData.lon);

    if (!editState.formData.name.trim() || isNaN(lat) || isNaN(lon)) {
      dispatch({ type: 'SAVE_ERROR', payload: 'Invalid form data' });
      return;
    }

    dispatch({ type: 'SAVE_START' });

    try {
      if (editState.status === 'creating' || editState.waypointId === null) {
        // Create new waypoint
        await createWaypoint({
          name: editState.formData.name.trim(),
          lat,
          lon,
          description: editState.formData.description.trim() || null,
          symbol: editState.formData.symbol,
          show_label: editState.formData.showLabel,
          hidden: false, // New waypoints are visible by default
        });
      } else {
        // Update existing waypoint
        const original = currentState.waypoints.find((w) => w.id === editState.waypointId);
        if (!original) {
          dispatch({ type: 'SAVE_ERROR', payload: 'Waypoint not found' });
          return;
        }

        await updateWaypoint({
          id: original.id,
          name: editState.formData.name.trim(),
          lat,
          lon,
          description: editState.formData.description.trim() || null,
          symbol: editState.formData.symbol,
          show_label: editState.formData.showLabel,
          hidden: original.hidden, // Preserve hidden state when editing
          created_at: original.created_at,
        });
      }

      // CRITICAL: Await loadWaypoints before dispatching success
      // This ensures waypointsRef in MapView has fresh data
      const freshWaypoints = await getWaypoints();
      dispatch({ type: 'SAVE_SUCCESS', payload: freshWaypoints });
    } catch (error) {
      dispatch({ type: 'SAVE_ERROR', payload: String(error) });
    }
  }, []);

  const cancelEdit = useCallback(() => {
    dispatch({ type: 'CANCEL_EDIT' });
  }, []);

  const closeEdit = useCallback(() => {
    dispatch({ type: 'CLOSE_EDIT' });
  }, []);

  const deleteWaypoint = useCallback(async (waypointId: number) => {
    if (!isTauri()) return;

    try {
      await deleteWaypointApi(waypointId);
      const freshWaypoints = await getWaypoints();
      dispatch({ type: 'DELETE_SUCCESS', payload: { deletedId: waypointId, waypoints: freshWaypoints } });
    } catch (error) {
      console.error('Failed to delete waypoint:', error);
    }
  }, []);

  const setActiveWaypoint = useCallback((waypointId: number | null) => {
    dispatch({ type: 'SET_ACTIVE', payload: waypointId });
  }, []);

  const setSelectedWaypoint = useCallback((waypointId: number | null) => {
    dispatch({ type: 'SET_SELECTED', payload: waypointId });
  }, []);

  const toggleActiveWaypoint = useCallback((waypointId: number) => {
    const currentActive = stateRef.current.activeWaypointId;
    dispatch({ type: 'SET_ACTIVE', payload: currentActive === waypointId ? null : waypointId });
  }, []);

  const toggleAllLabels = useCallback(() => {
    dispatch({ type: 'TOGGLE_ALL_LABELS' });
  }, []);

  const toggleAllMarkers = useCallback(() => {
    dispatch({ type: 'TOGGLE_ALL_MARKERS' });
  }, []);

  const toggleWaypointHidden = useCallback(async (waypointId: number) => {
    if (!isTauri()) return;

    const waypoint = stateRef.current.waypoints.find((w) => w.id === waypointId);
    if (!waypoint) return;

    try {
      await toggleWaypointHiddenApi(waypointId, !waypoint.hidden);
      const freshWaypoints = await getWaypoints();
      dispatch({ type: 'TOGGLE_HIDDEN_SUCCESS', payload: freshWaypoints });
    } catch (error) {
      console.error('Failed to toggle waypoint hidden state:', error);
    }
  }, []);

  // ============ Drag Handlers ============

  const startDrag = useCallback((waypointId: number, lat: number, lon: number) => {
    dispatch({ type: 'DRAG_START', payload: { id: waypointId, lat, lon } });
  }, []);

  const moveDrag = useCallback((lat: number, lon: number) => {
    dispatch({ type: 'DRAG_MOVE', payload: { lat, lon } });
  }, []);

  /**
   * Handle drag end - this is the key function that prevents data loss.
   *
   * If editing the waypoint being dragged:
   *   - Update form's lat/lon only (via DRAG_END_DURING_EDIT)
   *   - Do NOT save to DB (form's Save button will do that with correct data)
   *
   * If NOT editing:
   *   - Use position-only API to update DB safely
   */
  const endDrag = useCallback(async (waypointId: number, lat: number, lon: number) => {
    const currentState = stateRef.current;
    const isBeingEdited =
      currentState.editState.waypointId === waypointId &&
      (currentState.editState.status === 'editing' || currentState.editState.status === 'saving');

    if (isBeingEdited) {
      // During edit: only update form, don't save to DB
      console.log('[WaypointManager] Drag end during edit - updating form only');
      dispatch({ type: 'DRAG_END_DURING_EDIT', payload: { lat, lon } });
    } else {
      // Not editing: use position-only API for safe DB update
      console.log('[WaypointManager] Drag end - saving position to DB');
      dispatch({ type: 'DRAG_END' });

      if (isTauri()) {
        try {
          await updateWaypointPosition(waypointId, lat, lon);
          // Refresh waypoints to ensure UI is in sync
          const freshWaypoints = await getWaypoints();
          dispatch({ type: 'LOAD_SUCCESS', payload: freshWaypoints });
        } catch (error) {
          console.error('Failed to update waypoint position:', error);
        }
      }
    }
  }, []);

  // ============ Preview for Real-Time Map Marker Updates ============

  const editingPreview = useMemo(() => {
    if (!state.editState.waypointId || !state.editState.formData) {
      return null;
    }
    return {
      id: state.editState.waypointId,
      name: state.editState.formData.name,
      symbol: state.editState.formData.symbol,
      description: state.editState.formData.description,
    };
  }, [state.editState.waypointId, state.editState.formData]);

  // ============ Load waypoints on mount ============

  useEffect(() => {
    loadWaypoints();
  }, [loadWaypoints]);

  return {
    // State
    state,
    stateRef, // For use in event handlers to avoid stale closures

    // Derived state
    selectedWaypoint,
    activeWaypoint,
    editingWaypoint,
    editingPreview,
    isEditing,
    isSaving,

    // Actions
    loadWaypoints,
    startCreate,
    startEdit,
    updateForm,
    saveWaypoint,
    cancelEdit,
    closeEdit,
    deleteWaypoint,
    setActiveWaypoint,
    setSelectedWaypoint,
    toggleActiveWaypoint,
    toggleAllLabels,
    toggleAllMarkers,
    toggleWaypointHidden,

    // Drag actions
    startDrag,
    moveDrag,
    endDrag,

    // Raw dispatch for advanced use
    dispatch,
  };
}

// Export types for consumers
export type { WaypointAction };
