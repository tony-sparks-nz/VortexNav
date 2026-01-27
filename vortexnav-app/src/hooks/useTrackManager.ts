/**
 * useTrackManager - Centralized track recording and management
 *
 * This hook provides a single source of truth for all track operations,
 * following the same pattern as useRouteManager.
 *
 * Key features:
 * - Reducer-based state management for predictable state transitions
 * - Track recording with interval-based position logging
 * - Track CRUD operations
 * - Filtering and sorting for track list
 * - GPX export support
 */

import { useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import type {
  Track,
  TrackWithPoints,
  TrackEditState,
  TrackFormData,
  TrackFilterState,
  RecordingState,
} from '../types';
import { DEFAULT_TRACK_FILTER, DEFAULT_TRACK_COLOR } from '../types';
import {
  getTracks,
  getTracksWithPoints,
  startTrackRecording as startTrackRecordingApi,
  stopTrackRecording as stopTrackRecordingApi,
  getRecordingTrack,
  addTrackPoint as addTrackPointApi,
  updateTrack as updateTrackApi,
  toggleTrackHidden as toggleTrackHiddenApi,
  deleteTrack as deleteTrackApi,
  isTauri,
} from './useTauri';

// ============ State Interface ============

export interface TrackManagerState {
  tracks: Track[];
  tracksWithPoints: TrackWithPoints[];
  selectedTrackId: number | null;
  editState: TrackEditState;
  recording: RecordingState;
  filter: TrackFilterState;
  isLoading: boolean;
}

// ============ Action Types ============

type TrackAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; payload: { tracks: Track[]; tracksWithPoints: TrackWithPoints[] } }
  | { type: 'LOAD_ERROR'; payload: string }
  | { type: 'START_RECORDING'; payload: { trackId: number; startedAt: string } }
  | { type: 'STOP_RECORDING'; payload: Track }
  | { type: 'UPDATE_RECORDING_STATS'; payload: { pointCount: number; distance: number } }
  | { type: 'START_EDIT'; payload: { trackId: number; track: Track } }
  | { type: 'UPDATE_FORM'; payload: Partial<TrackFormData> }
  | { type: 'MARK_DIRTY' }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS'; payload: Track[] }
  | { type: 'SAVE_ERROR'; payload: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'SET_SELECTED'; payload: number | null }
  | { type: 'DELETE_SUCCESS'; payload: { deletedId: number; tracks: Track[] } }
  | { type: 'UPDATE_FILTER'; payload: Partial<TrackFilterState> }
  | { type: 'TOGGLE_HIDDEN'; payload: { trackId: number; hidden: boolean } }
  | { type: 'ADD_POINT_TO_LIVE_TRACK'; payload: { lat: number; lon: number } };

// ============ Initial State ============

const initialEditState: TrackEditState = {
  status: 'idle',
  trackId: null,
  formData: null,
  isDirty: false,
  error: null,
};

const initialRecordingState: RecordingState = {
  isRecording: false,
  trackId: null,
  pointCount: 0,
  distance: 0,
  startedAt: null,
};

const initialState: TrackManagerState = {
  tracks: [],
  tracksWithPoints: [],
  selectedTrackId: null,
  editState: initialEditState,
  recording: initialRecordingState,
  filter: DEFAULT_TRACK_FILTER,
  isLoading: false,
};

// ============ Helper Functions ============

function trackToFormData(track: Track): TrackFormData {
  return {
    name: track.name,
    description: track.description || '',
    color: track.color || DEFAULT_TRACK_COLOR,
  };
}

// ============ Reducer ============

function trackReducer(
  state: TrackManagerState,
  action: TrackAction
): TrackManagerState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, isLoading: true };

    case 'LOAD_SUCCESS':
      // Check if there's a recording track
      const recordingTrack = action.payload.tracks.find(t => t.is_recording);
      return {
        ...state,
        tracks: action.payload.tracks,
        tracksWithPoints: action.payload.tracksWithPoints,
        isLoading: false,
        recording: recordingTrack
          ? {
              isRecording: true,
              trackId: recordingTrack.id,
              pointCount: recordingTrack.point_count,
              distance: recordingTrack.total_distance_nm || 0,
              startedAt: recordingTrack.started_at,
            }
          : initialRecordingState,
      };

    case 'LOAD_ERROR':
      console.error('Failed to load tracks:', action.payload);
      return { ...state, isLoading: false };

    case 'START_RECORDING':
      return {
        ...state,
        recording: {
          isRecording: true,
          trackId: action.payload.trackId,
          pointCount: 0,
          distance: 0,
          startedAt: action.payload.startedAt,
        },
      };

    case 'STOP_RECORDING':
      // Update the track in the list
      const updatedTracks = state.tracks.map(t =>
        t.id === action.payload.id ? action.payload : t
      );
      return {
        ...state,
        tracks: updatedTracks,
        recording: initialRecordingState,
      };

    case 'UPDATE_RECORDING_STATS':
      return {
        ...state,
        recording: {
          ...state.recording,
          pointCount: action.payload.pointCount,
          distance: action.payload.distance,
        },
      };

    case 'START_EDIT': {
      return {
        ...state,
        selectedTrackId: action.payload.trackId,
        editState: {
          status: 'editing',
          trackId: action.payload.trackId,
          formData: trackToFormData(action.payload.track),
          isDirty: false,
          error: null,
        },
      };
    }

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
      return {
        ...state,
        tracks: action.payload,
        editState: initialEditState,
      };

    case 'SAVE_ERROR':
      return {
        ...state,
        editState: {
          ...state.editState,
          status: 'editing',
          error: action.payload,
        },
      };

    case 'CANCEL_EDIT':
      return {
        ...state,
        editState: initialEditState,
      };

    case 'SET_SELECTED':
      return {
        ...state,
        selectedTrackId: action.payload,
      };

    case 'DELETE_SUCCESS':
      return {
        ...state,
        tracks: action.payload.tracks,
        tracksWithPoints: state.tracksWithPoints.filter(t => t.track.id !== action.payload.deletedId),
        selectedTrackId:
          state.selectedTrackId === action.payload.deletedId
            ? null
            : state.selectedTrackId,
      };

    case 'UPDATE_FILTER':
      return {
        ...state,
        filter: { ...state.filter, ...action.payload },
      };

    case 'TOGGLE_HIDDEN':
      return {
        ...state,
        tracks: state.tracks.map(t =>
          t.id === action.payload.trackId
            ? { ...t, hidden: action.payload.hidden }
            : t
        ),
      };

    case 'ADD_POINT_TO_LIVE_TRACK':
      // Add point to the live track in tracksWithPoints (for map rendering)
      if (!state.recording.trackId) return state;
      return {
        ...state,
        tracksWithPoints: state.tracksWithPoints.map(twp => {
          if (twp.track.id === state.recording.trackId) {
            return {
              ...twp,
              points: [
                ...twp.points,
                {
                  id: null,
                  track_id: state.recording.trackId!,
                  lat: action.payload.lat,
                  lon: action.payload.lon,
                  timestamp: new Date().toISOString(),
                  sequence: twp.points.length,
                  heading: null,
                  cog: null,
                  sog: null,
                },
              ],
            };
          }
          return twp;
        }),
      };

    default:
      return state;
  }
}

// ============ Hook ============

export function useTrackManager() {
  const [state, dispatch] = useReducer(trackReducer, initialState);

  // Keep refs for access in event handlers without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  // ============ Memoized Selectors ============

  const selectedTrack = useMemo(
    () => state.tracks.find((t) => t.id === state.selectedTrackId) || null,
    [state.tracks, state.selectedTrackId]
  );

  const selectedTrackWithPoints = useMemo(
    () => state.tracksWithPoints.find((t) => t.track.id === state.selectedTrackId) || null,
    [state.tracksWithPoints, state.selectedTrackId]
  );

  const recordingTrack = useMemo(
    () => state.recording.trackId
      ? state.tracks.find((t) => t.id === state.recording.trackId) || null
      : null,
    [state.tracks, state.recording.trackId]
  );

  const isEditing = state.editState.status === 'editing';
  const isSaving = state.editState.status === 'saving';
  const isRecording = state.recording.isRecording;

  // Filtered and sorted tracks
  const filteredTracks = useMemo(() => {
    let result = [...state.tracks];

    // Filter by search query
    if (state.filter.searchQuery) {
      const query = state.filter.searchQuery.toLowerCase();
      result = result.filter(
        t =>
          t.name.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (state.filter.sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'date':
          comparison = (a.created_at || '').localeCompare(b.created_at || '');
          break;
        case 'distance':
          comparison = (a.total_distance_nm || 0) - (b.total_distance_nm || 0);
          break;
        case 'points':
          comparison = a.point_count - b.point_count;
          break;
      }
      return state.filter.sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [state.tracks, state.filter]);

  // Visible tracks with points (for map rendering) - non-hidden tracks only
  const visibleTracksWithPoints = useMemo(
    () => state.tracksWithPoints.filter(t => !t.track.hidden),
    [state.tracksWithPoints]
  );

  // ============ Actions ============

  const loadTracks = useCallback(async () => {
    if (!isTauri()) return;

    dispatch({ type: 'LOAD_START' });
    try {
      const [tracks, tracksWithPoints] = await Promise.all([
        getTracks(),
        getTracksWithPoints(),
      ]);
      dispatch({ type: 'LOAD_SUCCESS', payload: { tracks, tracksWithPoints } });
    } catch (error) {
      dispatch({ type: 'LOAD_ERROR', payload: String(error) });
    }
  }, []);

  const startRecording = useCallback(async (name?: string) => {
    if (!isTauri()) return;

    const trackName = name || `Track ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;

    try {
      const trackId = await startTrackRecordingApi(trackName);
      const startedAt = new Date().toISOString();
      dispatch({ type: 'START_RECORDING', payload: { trackId, startedAt } });

      // Reload tracks to get the new track in the list
      const [tracks, tracksWithPoints] = await Promise.all([
        getTracks(),
        getTracksWithPoints(),
      ]);
      dispatch({ type: 'LOAD_SUCCESS', payload: { tracks, tracksWithPoints } });
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!isTauri()) return;

    try {
      const track = await stopTrackRecordingApi();
      if (track) {
        dispatch({ type: 'STOP_RECORDING', payload: track });
        // Reload tracks to get updated data
        const [tracks, tracksWithPoints] = await Promise.all([
          getTracks(),
          getTracksWithPoints(),
        ]);
        dispatch({ type: 'LOAD_SUCCESS', payload: { tracks, tracksWithPoints } });
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
    }
  }, []);

  const addTrackPoint = useCallback(async (
    lat: number,
    lon: number,
    heading?: number | null,
    cog?: number | null,
    sog?: number | null
  ) => {
    if (!isTauri() || !stateRef.current.recording.isRecording) return;

    try {
      await addTrackPointApi(lat, lon, heading, cog, sog);

      // Update local state for immediate feedback
      dispatch({ type: 'ADD_POINT_TO_LIVE_TRACK', payload: { lat, lon } });

      // Refresh recording track stats
      const track = await getRecordingTrack();
      if (track) {
        dispatch({
          type: 'UPDATE_RECORDING_STATS',
          payload: {
            pointCount: track.point_count,
            distance: track.total_distance_nm || 0,
          },
        });
      }
    } catch (error) {
      console.error('Failed to add track point:', error);
    }
  }, []);

  const startEdit = useCallback((trackId: number) => {
    const track = stateRef.current.tracks.find((t) => t.id === trackId);
    if (track) {
      dispatch({ type: 'START_EDIT', payload: { trackId, track } });
    }
  }, []);

  const updateForm = useCallback((updates: Partial<TrackFormData>) => {
    dispatch({ type: 'UPDATE_FORM', payload: updates });
  }, []);

  const saveTrack = useCallback(async () => {
    const currentState = stateRef.current;
    const { editState } = currentState;

    if (!editState.formData || !isTauri() || !editState.trackId) return;

    if (!editState.formData.name.trim()) {
      dispatch({ type: 'SAVE_ERROR', payload: 'Track name is required' });
      return;
    }

    dispatch({ type: 'SAVE_START' });

    try {
      const original = currentState.tracks.find((t) => t.id === editState.trackId);
      if (!original) {
        dispatch({ type: 'SAVE_ERROR', payload: 'Track not found' });
        return;
      }

      await updateTrackApi({
        ...original,
        name: editState.formData.name.trim(),
        description: editState.formData.description.trim() || null,
        color: editState.formData.color,
      });

      // Reload tracks
      const freshTracks = await getTracks();
      dispatch({ type: 'SAVE_SUCCESS', payload: freshTracks });
    } catch (error) {
      dispatch({ type: 'SAVE_ERROR', payload: String(error) });
    }
  }, []);

  const cancelEdit = useCallback(() => {
    dispatch({ type: 'CANCEL_EDIT' });
  }, []);

  const deleteTrack = useCallback(async (trackId: number) => {
    if (!isTauri()) return;

    try {
      await deleteTrackApi(trackId);
      const freshTracks = await getTracks();
      dispatch({ type: 'DELETE_SUCCESS', payload: { deletedId: trackId, tracks: freshTracks } });
    } catch (error) {
      console.error('Failed to delete track:', error);
    }
  }, []);

  const toggleTrackHidden = useCallback(async (trackId: number, hidden: boolean) => {
    if (!isTauri()) return;

    try {
      await toggleTrackHiddenApi(trackId, hidden);
      dispatch({ type: 'TOGGLE_HIDDEN', payload: { trackId, hidden } });
    } catch (error) {
      console.error('Failed to toggle track hidden state:', error);
    }
  }, []);

  const setSelectedTrack = useCallback((trackId: number | null) => {
    dispatch({ type: 'SET_SELECTED', payload: trackId });
  }, []);

  const updateFilter = useCallback((filter: Partial<TrackFilterState>) => {
    dispatch({ type: 'UPDATE_FILTER', payload: filter });
  }, []);

  // ============ Load tracks on mount ============

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  return {
    // State
    state,
    stateRef,

    // Derived state
    selectedTrack,
    selectedTrackWithPoints,
    recordingTrack,
    filteredTracks,
    visibleTracksWithPoints,
    isEditing,
    isSaving,
    isRecording,

    // Actions
    loadTracks,
    startRecording,
    stopRecording,
    addTrackPoint,
    startEdit,
    updateForm,
    saveTrack,
    cancelEdit,
    deleteTrack,
    toggleTrackHidden,
    setSelectedTrack,
    updateFilter,

    // Raw dispatch for advanced use
    dispatch,
  };
}

// Export types for consumers
export type { TrackAction };
