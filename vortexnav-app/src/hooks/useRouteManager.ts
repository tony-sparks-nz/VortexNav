/**
 * useRouteManager - Centralized route state management
 *
 * This hook provides a single source of truth for all route operations,
 * following the same pattern as useWaypointManager.
 *
 * Key features:
 * - Reducer-based state management for predictable state transitions
 * - Support for two route creation modes: waypoint selection and map drawing
 * - Tag management for route categorization
 * - Filtering and sorting for route library
 * - Statistics calculation for route planning
 */

import { useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import type {
  Route,
  RouteTag,
  RouteWithWaypoints,
  RouteStatistics,
  RouteEditState,
  RouteFormData,
  RouteCreationModeState,
  RouteFilterState,
  TempWaypoint,
} from '../types';
import { DEFAULT_ROUTE_FILTER, DEFAULT_ROUTE_COLOR } from '../types';
import {
  getRoutes,
  createRoute as createRouteApi,
  updateRoute as updateRouteApi,
  deleteRoute as deleteRouteApi,
  deleteRouteWithWaypoints as deleteRouteWithWaypointsApi,
  getRouteExclusiveWaypointCount,
  duplicateRoute as duplicateRouteApi,
  reverseRoute as reverseRouteApi,
  setActiveRoute as setActiveRouteApi,
  toggleRouteHidden as toggleRouteHiddenApi,
  getRouteTags,
  createRouteTag as createRouteTagApi,
  updateRouteTag as updateRouteTagApi,
  deleteRouteTag as deleteRouteTagApi,
  calculateRouteStatistics,
  createWaypoint,
  isTauri,
} from './useTauri';

// ============ State Interface ============

export interface RouteManagerState {
  routes: RouteWithWaypoints[];
  tags: RouteTag[];
  activeRouteId: number | null;
  selectedRouteId: number | null;
  editState: RouteEditState;
  creationMode: RouteCreationModeState;
  filter: RouteFilterState;
  isLoading: boolean;
  statistics: RouteStatistics | null;
}

// ============ Action Types ============

type RouteAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; payload: { routes: RouteWithWaypoints[]; tags: RouteTag[] } }
  | { type: 'LOAD_ERROR'; payload: string }
  | { type: 'START_CREATE' }
  | { type: 'START_CREATE_ON_MAP'; payload: string }
  | { type: 'ADD_CREATION_WAYPOINT'; payload: TempWaypoint }
  | { type: 'REMOVE_LAST_CREATION_WAYPOINT' }
  | { type: 'UPDATE_CREATION_NAME'; payload: string }
  | { type: 'CANCEL_CREATION_MODE' }
  | { type: 'START_EDIT'; payload: { routeId: number; route: RouteWithWaypoints } }
  | { type: 'UPDATE_FORM'; payload: Partial<RouteFormData> }
  | { type: 'UPDATE_SELECTED_WAYPOINTS'; payload: number[] }
  | { type: 'UPDATE_SELECTED_TAGS'; payload: number[] }
  | { type: 'MARK_DIRTY' }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS'; payload: RouteWithWaypoints[] }
  | { type: 'SAVE_ERROR'; payload: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'CLOSE_EDIT' }
  | { type: 'SET_ACTIVE'; payload: number | null }
  | { type: 'SET_SELECTED'; payload: number | null }
  | { type: 'DELETE_SUCCESS'; payload: { deletedId: number; routes: RouteWithWaypoints[] } }
  | { type: 'UPDATE_FILTER'; payload: Partial<RouteFilterState> }
  | { type: 'SET_STATISTICS'; payload: RouteStatistics | null }
  | { type: 'TAG_CREATED'; payload: RouteTag }
  | { type: 'TAG_UPDATED'; payload: RouteTag }
  | { type: 'TAG_DELETED'; payload: number }
  | { type: 'TOGGLE_HIDDEN'; payload: { routeId: number; hidden: boolean } };

// ============ Initial State ============

const initialEditState: RouteEditState = {
  status: 'idle',
  routeId: null,
  formData: null,
  selectedWaypointIds: [],
  selectedTagIds: [],
  isDirty: false,
  error: null,
};

const initialCreationMode: RouteCreationModeState = {
  active: false,
  routeName: '',
  tempWaypoints: [],
};

const initialState: RouteManagerState = {
  routes: [],
  tags: [],
  activeRouteId: null,
  selectedRouteId: null,
  editState: initialEditState,
  creationMode: initialCreationMode,
  filter: DEFAULT_ROUTE_FILTER,
  isLoading: false,
  statistics: null,
};

// ============ Helper Functions ============

function routeToFormData(route: Route): RouteFormData {
  return {
    name: route.name,
    description: route.description || '',
    color: route.color || DEFAULT_ROUTE_COLOR,
    estimated_speed_kn: route.estimated_speed_kn.toFixed(1),
  };
}

function createEmptyFormData(): RouteFormData {
  return {
    name: '',
    description: '',
    color: DEFAULT_ROUTE_COLOR,
    estimated_speed_kn: '5.0',
  };
}

// ============ Reducer ============

function routeReducer(
  state: RouteManagerState,
  action: RouteAction
): RouteManagerState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, isLoading: true };

    case 'LOAD_SUCCESS':
      // Find active route
      const activeRoute = action.payload.routes.find(r => r.route.is_active);
      return {
        ...state,
        routes: action.payload.routes,
        tags: action.payload.tags,
        activeRouteId: activeRoute?.route.id ?? null,
        isLoading: false,
      };

    case 'LOAD_ERROR':
      console.error('Failed to load routes:', action.payload);
      return { ...state, isLoading: false };

    case 'START_CREATE':
      return {
        ...state,
        editState: {
          status: 'creating',
          routeId: null,
          formData: createEmptyFormData(),
          selectedWaypointIds: [],
          selectedTagIds: [],
          isDirty: false,
          error: null,
        },
      };

    case 'START_CREATE_ON_MAP':
      return {
        ...state,
        creationMode: {
          active: true,
          routeName: action.payload,
          tempWaypoints: [],
        },
      };

    case 'ADD_CREATION_WAYPOINT':
      return {
        ...state,
        creationMode: {
          ...state.creationMode,
          tempWaypoints: [...state.creationMode.tempWaypoints, action.payload],
        },
      };

    case 'REMOVE_LAST_CREATION_WAYPOINT':
      return {
        ...state,
        creationMode: {
          ...state.creationMode,
          tempWaypoints: state.creationMode.tempWaypoints.slice(0, -1),
        },
      };

    case 'UPDATE_CREATION_NAME':
      return {
        ...state,
        creationMode: {
          ...state.creationMode,
          routeName: action.payload,
        },
      };

    case 'CANCEL_CREATION_MODE':
      return {
        ...state,
        creationMode: initialCreationMode,
      };

    case 'START_EDIT':
      return {
        ...state,
        selectedRouteId: action.payload.routeId,
        editState: {
          status: 'editing',
          routeId: action.payload.routeId,
          formData: routeToFormData(action.payload.route.route),
          selectedWaypointIds: action.payload.route.waypoints.map(w => w.id!),
          selectedTagIds: action.payload.route.tags.map(t => t.id!),
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

    case 'UPDATE_SELECTED_WAYPOINTS':
      return {
        ...state,
        editState: {
          ...state.editState,
          selectedWaypointIds: action.payload,
          isDirty: true,
        },
      };

    case 'UPDATE_SELECTED_TAGS':
      return {
        ...state,
        editState: {
          ...state.editState,
          selectedTagIds: action.payload,
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
      return {
        ...state,
        routes: action.payload,
        editState: initialEditState,
        creationMode: initialCreationMode,
      };

    case 'SAVE_ERROR':
      return {
        ...state,
        editState: {
          ...state.editState,
          status: state.editState.routeId ? 'editing' : 'creating',
          error: action.payload,
        },
      };

    case 'CANCEL_EDIT':
    case 'CLOSE_EDIT':
      return {
        ...state,
        editState: initialEditState,
      };

    case 'SET_ACTIVE': {
      // Update active status in routes list
      const updatedRoutes = state.routes.map(r => ({
        ...r,
        route: {
          ...r.route,
          is_active: r.route.id === action.payload,
        },
      }));
      return {
        ...state,
        routes: updatedRoutes,
        activeRouteId: action.payload,
      };
    }

    case 'SET_SELECTED':
      return {
        ...state,
        selectedRouteId: action.payload,
      };

    case 'DELETE_SUCCESS':
      return {
        ...state,
        routes: action.payload.routes,
        selectedRouteId:
          state.selectedRouteId === action.payload.deletedId
            ? null
            : state.selectedRouteId,
        activeRouteId:
          state.activeRouteId === action.payload.deletedId
            ? null
            : state.activeRouteId,
      };

    case 'UPDATE_FILTER':
      return {
        ...state,
        filter: { ...state.filter, ...action.payload },
      };

    case 'SET_STATISTICS':
      return {
        ...state,
        statistics: action.payload,
      };

    case 'TAG_CREATED':
      return {
        ...state,
        tags: [...state.tags, action.payload],
      };

    case 'TAG_UPDATED':
      return {
        ...state,
        tags: state.tags.map(t =>
          t.id === action.payload.id ? action.payload : t
        ),
      };

    case 'TAG_DELETED':
      return {
        ...state,
        tags: state.tags.filter(t => t.id !== action.payload),
      };

    case 'TOGGLE_HIDDEN':
      return {
        ...state,
        routes: state.routes.map(r =>
          r.route.id === action.payload.routeId
            ? { ...r, route: { ...r.route, hidden: action.payload.hidden } }
            : r
        ),
      };

    default:
      return state;
  }
}

// ============ Hook ============

export function useRouteManager() {
  const [state, dispatch] = useReducer(routeReducer, initialState);

  // Keep refs for access in event handlers without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  // Temp waypoint counter for unique IDs
  const tempWaypointCounter = useRef(0);

  // ============ Memoized Selectors ============

  const selectedRoute = useMemo(
    () => state.routes.find((r) => r.route.id === state.selectedRouteId) || null,
    [state.routes, state.selectedRouteId]
  );

  const activeRoute = useMemo(
    () => state.routes.find((r) => r.route.id === state.activeRouteId) || null,
    [state.routes, state.activeRouteId]
  );

  const editingRoute = useMemo(
    () =>
      state.editState.routeId
        ? state.routes.find((r) => r.route.id === state.editState.routeId) || null
        : null,
    [state.routes, state.editState.routeId]
  );

  const isEditing = state.editState.status === 'editing' || state.editState.status === 'creating';
  const isSaving = state.editState.status === 'saving';
  const isCreatingOnMap = state.creationMode.active;

  // Filtered and sorted routes
  const filteredRoutes = useMemo(() => {
    let result = [...state.routes];

    // Filter by search query
    if (state.filter.searchQuery) {
      const query = state.filter.searchQuery.toLowerCase();
      result = result.filter(
        r =>
          r.route.name.toLowerCase().includes(query) ||
          r.route.description?.toLowerCase().includes(query)
      );
    }

    // Filter by tags
    if (state.filter.selectedTagIds.length > 0) {
      result = result.filter(r =>
        state.filter.selectedTagIds.some(tagId =>
          r.tags.some(t => t.id === tagId)
        )
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (state.filter.sortBy) {
        case 'name':
          comparison = a.route.name.localeCompare(b.route.name);
          break;
        case 'date':
          comparison = (a.route.updated_at || a.route.created_at || '').localeCompare(
            b.route.updated_at || b.route.created_at || ''
          );
          break;
        case 'distance':
          comparison = (a.route.total_distance_nm || 0) - (b.route.total_distance_nm || 0);
          break;
        case 'waypoints':
          comparison = a.waypoints.length - b.waypoints.length;
          break;
      }
      return state.filter.sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [state.routes, state.filter]);

  // ============ Actions ============

  const loadRoutes = useCallback(async () => {
    if (!isTauri()) return;

    dispatch({ type: 'LOAD_START' });
    try {
      const [routes, tags] = await Promise.all([
        getRoutes(),
        getRouteTags(),
      ]);
      dispatch({ type: 'LOAD_SUCCESS', payload: { routes, tags } });
    } catch (error) {
      dispatch({ type: 'LOAD_ERROR', payload: String(error) });
    }
  }, []);

  const startCreate = useCallback(() => {
    dispatch({ type: 'START_CREATE' });
  }, []);

  const startCreateOnMap = useCallback((name: string) => {
    tempWaypointCounter.current = 0;
    dispatch({ type: 'START_CREATE_ON_MAP', payload: name });
  }, []);

  const addCreationWaypoint = useCallback((lat: number, lon: number) => {
    const counter = ++tempWaypointCounter.current;
    const routeName = stateRef.current.creationMode.routeName || 'Route';
    const tempWaypoint: TempWaypoint = {
      id: `temp-${counter}`,
      name: `${routeName} - WP${counter}`,
      lat,
      lon,
    };
    dispatch({ type: 'ADD_CREATION_WAYPOINT', payload: tempWaypoint });
  }, []);

  const removeLastCreationWaypoint = useCallback(() => {
    dispatch({ type: 'REMOVE_LAST_CREATION_WAYPOINT' });
  }, []);

  const updateCreationName = useCallback((name: string) => {
    dispatch({ type: 'UPDATE_CREATION_NAME', payload: name });
  }, []);

  const cancelCreationMode = useCallback(() => {
    dispatch({ type: 'CANCEL_CREATION_MODE' });
  }, []);

  const finishCreationMode = useCallback(async () => {
    if (!isTauri()) return;

    const currentState = stateRef.current;
    const { creationMode } = currentState;

    if (creationMode.tempWaypoints.length < 2) {
      console.warn('Route must have at least 2 waypoints');
      return;
    }

    dispatch({ type: 'SAVE_START' });

    try {
      // First, create all the temporary waypoints as real waypoints
      const waypointIds: number[] = [];
      for (const tempWp of creationMode.tempWaypoints) {
        const id = await createWaypoint({
          name: tempWp.name,
          lat: tempWp.lat,
          lon: tempWp.lon,
          description: null,
          symbol: 'route-point',
          show_label: true,
          hidden: false,
        });
        waypointIds.push(id);
      }

      // Calculate statistics for distance
      const stats = await calculateRouteStatistics(waypointIds, 5.0);

      // Create the route
      await createRouteApi(
        {
          name: creationMode.routeName || 'New Route',
          description: null,
          color: DEFAULT_ROUTE_COLOR,
          is_active: false,
          hidden: false,
          total_distance_nm: stats.total_distance_nm,
          estimated_speed_kn: 5.0,
        },
        waypointIds,
        []
      );

      // Reload routes
      const freshRoutes = await getRoutes();
      dispatch({ type: 'SAVE_SUCCESS', payload: freshRoutes });
    } catch (error) {
      dispatch({ type: 'SAVE_ERROR', payload: String(error) });
    }
  }, []);

  const startEdit = useCallback(
    (routeId: number) => {
      const route = stateRef.current.routes.find((r) => r.route.id === routeId);
      if (route) {
        dispatch({ type: 'START_EDIT', payload: { routeId, route } });
      }
    },
    []
  );

  const updateForm = useCallback((updates: Partial<RouteFormData>) => {
    dispatch({ type: 'UPDATE_FORM', payload: updates });
  }, []);

  const updateSelectedWaypoints = useCallback((waypointIds: number[]) => {
    dispatch({ type: 'UPDATE_SELECTED_WAYPOINTS', payload: waypointIds });
  }, []);

  const updateSelectedTags = useCallback((tagIds: number[]) => {
    dispatch({ type: 'UPDATE_SELECTED_TAGS', payload: tagIds });
  }, []);

  const saveRoute = useCallback(async () => {
    const currentState = stateRef.current;
    const { editState } = currentState;

    if (!editState.formData || !isTauri()) return;

    const speedKn = parseFloat(editState.formData.estimated_speed_kn);

    if (!editState.formData.name.trim()) {
      dispatch({ type: 'SAVE_ERROR', payload: 'Route name is required' });
      return;
    }

    if (editState.selectedWaypointIds.length < 2) {
      dispatch({ type: 'SAVE_ERROR', payload: 'Route must have at least 2 waypoints' });
      return;
    }

    dispatch({ type: 'SAVE_START' });

    try {
      // Calculate statistics
      const stats = await calculateRouteStatistics(editState.selectedWaypointIds, speedKn);

      if (editState.status === 'creating' || editState.routeId === null) {
        // Create new route
        await createRouteApi(
          {
            name: editState.formData.name.trim(),
            description: editState.formData.description.trim() || null,
            color: editState.formData.color,
            is_active: false,
            hidden: false,
            total_distance_nm: stats.total_distance_nm,
            estimated_speed_kn: speedKn,
          },
          editState.selectedWaypointIds,
          editState.selectedTagIds
        );
      } else {
        // Update existing route
        const original = currentState.routes.find((r) => r.route.id === editState.routeId);
        if (!original) {
          dispatch({ type: 'SAVE_ERROR', payload: 'Route not found' });
          return;
        }

        await updateRouteApi(
          {
            id: original.route.id,
            name: editState.formData.name.trim(),
            description: editState.formData.description.trim() || null,
            color: editState.formData.color,
            is_active: original.route.is_active,
            hidden: original.route.hidden,
            total_distance_nm: stats.total_distance_nm,
            estimated_speed_kn: speedKn,
            created_at: original.route.created_at,
            updated_at: null, // Will be set by backend
          },
          editState.selectedWaypointIds,
          editState.selectedTagIds
        );
      }

      // Reload routes
      const freshRoutes = await getRoutes();
      dispatch({ type: 'SAVE_SUCCESS', payload: freshRoutes });
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

  const deleteRoute = useCallback(async (routeId: number, deleteWaypoints: boolean = false) => {
    if (!isTauri()) return;

    try {
      if (deleteWaypoints) {
        await deleteRouteWithWaypointsApi(routeId, true);
      } else {
        await deleteRouteApi(routeId);
      }
      const freshRoutes = await getRoutes();
      dispatch({ type: 'DELETE_SUCCESS', payload: { deletedId: routeId, routes: freshRoutes } });
    } catch (error) {
      console.error('Failed to delete route:', error);
    }
  }, []);

  const getExclusiveWaypointCount = useCallback(async (routeId: number): Promise<number> => {
    if (!isTauri()) return 0;

    try {
      return await getRouteExclusiveWaypointCount(routeId);
    } catch (error) {
      console.error('Failed to get exclusive waypoint count:', error);
      return 0;
    }
  }, []);

  const duplicateRoute = useCallback(async (routeId: number, newName: string) => {
    if (!isTauri()) return;

    try {
      await duplicateRouteApi(routeId, newName);
      const freshRoutes = await getRoutes();
      dispatch({ type: 'SAVE_SUCCESS', payload: freshRoutes });
    } catch (error) {
      console.error('Failed to duplicate route:', error);
    }
  }, []);

  const reverseRoute = useCallback(async (routeId: number) => {
    if (!isTauri()) return;

    try {
      await reverseRouteApi(routeId);
      const freshRoutes = await getRoutes();
      dispatch({ type: 'SAVE_SUCCESS', payload: freshRoutes });
    } catch (error) {
      console.error('Failed to reverse route:', error);
    }
  }, []);

  const setActiveRoute = useCallback(async (routeId: number | null) => {
    if (!isTauri()) return;

    try {
      await setActiveRouteApi(routeId);
      dispatch({ type: 'SET_ACTIVE', payload: routeId });
    } catch (error) {
      console.error('Failed to set active route:', error);
    }
  }, []);

  const toggleActiveRoute = useCallback(async (routeId: number) => {
    const currentActive = stateRef.current.activeRouteId;
    await setActiveRoute(currentActive === routeId ? null : routeId);
  }, [setActiveRoute]);

  const toggleRouteHidden = useCallback(async (routeId: number, hidden: boolean) => {
    if (!isTauri()) return;

    try {
      await toggleRouteHiddenApi(routeId, hidden);
      dispatch({ type: 'TOGGLE_HIDDEN', payload: { routeId, hidden } });
    } catch (error) {
      console.error('Failed to toggle route hidden state:', error);
    }
  }, []);

  const setSelectedRoute = useCallback((routeId: number | null) => {
    dispatch({ type: 'SET_SELECTED', payload: routeId });
  }, []);

  const updateFilter = useCallback((filter: Partial<RouteFilterState>) => {
    dispatch({ type: 'UPDATE_FILTER', payload: filter });
  }, []);

  const loadStatistics = useCallback(async (waypointIds: number[], speedKn: number) => {
    if (!isTauri() || waypointIds.length < 2) {
      dispatch({ type: 'SET_STATISTICS', payload: null });
      return;
    }

    try {
      const stats = await calculateRouteStatistics(waypointIds, speedKn);
      dispatch({ type: 'SET_STATISTICS', payload: stats });
    } catch (error) {
      console.error('Failed to calculate statistics:', error);
      dispatch({ type: 'SET_STATISTICS', payload: null });
    }
  }, []);

  // ============ Tag Actions ============

  const createTag = useCallback(async (name: string, color: string | null) => {
    if (!isTauri()) return;

    try {
      const id = await createRouteTagApi({ name, color });
      const tag: RouteTag = { id, name, color, created_at: new Date().toISOString() };
      dispatch({ type: 'TAG_CREATED', payload: tag });
      return id;
    } catch (error) {
      console.error('Failed to create tag:', error);
    }
  }, []);

  const updateTag = useCallback(async (tag: RouteTag) => {
    if (!isTauri() || !tag.id) return;

    try {
      await updateRouteTagApi(tag);
      dispatch({ type: 'TAG_UPDATED', payload: tag });
    } catch (error) {
      console.error('Failed to update tag:', error);
    }
  }, []);

  const deleteTag = useCallback(async (tagId: number) => {
    if (!isTauri()) return;

    try {
      await deleteRouteTagApi(tagId);
      dispatch({ type: 'TAG_DELETED', payload: tagId });
    } catch (error) {
      console.error('Failed to delete tag:', error);
    }
  }, []);

  // ============ Load routes on mount ============

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  return {
    // State
    state,
    stateRef,

    // Derived state
    selectedRoute,
    activeRoute,
    editingRoute,
    filteredRoutes,
    isEditing,
    isSaving,
    isCreatingOnMap,

    // Actions
    loadRoutes,
    startCreate,
    startCreateOnMap,
    addCreationWaypoint,
    removeLastCreationWaypoint,
    updateCreationName,
    cancelCreationMode,
    finishCreationMode,
    startEdit,
    updateForm,
    updateSelectedWaypoints,
    updateSelectedTags,
    saveRoute,
    cancelEdit,
    closeEdit,
    deleteRoute,
    getExclusiveWaypointCount,
    duplicateRoute,
    reverseRoute,
    setActiveRoute,
    toggleActiveRoute,
    toggleRouteHidden,
    setSelectedRoute,
    updateFilter,
    loadStatistics,

    // Tag actions
    createTag,
    updateTag,
    deleteTag,

    // Raw dispatch for advanced use
    dispatch,
  };
}

// Export types for consumers
export type { RouteAction };
