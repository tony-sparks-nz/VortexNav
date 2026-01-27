import { useState, useCallback } from 'react';
import type { ThemeMode, TrackSortOption, Track } from '../types';
import { TRACK_COLORS, DEFAULT_TRACK_COLOR } from '../types';
import type { useTrackManager } from '../hooks/useTrackManager';
import { convertTrackToRoute, isTauri } from '../hooks/useTauri';
import { ShareTrackModal } from './ShareTrackModal';

// Get the return type of useTrackManager
type TrackManagerType = ReturnType<typeof useTrackManager>;

interface TrackPanelProps {
  theme: ThemeMode;
  trackManager: TrackManagerType;
  onCenterOnTrack?: (trackId: number) => void;
  onConvertToRoute?: (routeId: number) => void;
  onClose: () => void;
}

export function TrackPanel({
  theme,
  trackManager,
  onCenterOnTrack,
  onConvertToRoute,
  onClose,
}: TrackPanelProps) {
  const {
    state,
    selectedTrack,
    filteredTracks,
    isEditing: _isEditing,
    isSaving,
    isRecording,
    startRecording,
    stopRecording,
    startEdit,
    updateForm,
    saveTrack,
    cancelEdit,
    deleteTrack,
    toggleTrackHidden,
    setSelectedTrack,
    updateFilter,
  } = trackManager;

  const { editState, recording, filter } = state;

  // View mode: 'list' | 'edit'
  const [viewMode, setViewMode] = useState<'list' | 'edit'>('list');

  // Delete confirmation dialog state
  const [deleteDialogState, setDeleteDialogState] = useState<{
    isOpen: boolean;
    trackId: number | null;
    trackName: string;
  }>({
    isOpen: false,
    trackId: null,
    trackName: '',
  });

  // Share modal state
  const [shareModalTrack, setShareModalTrack] = useState<Track | null>(null);

  // New track name for recording
  const [newTrackName, setNewTrackName] = useState('');

  // Handle starting recording
  const handleStartRecording = async () => {
    const name = newTrackName.trim() || undefined;
    await startRecording(name);
    setNewTrackName('');
  };

  // Handle stopping recording
  const handleStopRecording = async () => {
    await stopRecording();
  };

  // Handle edit track
  const handleEditTrack = (trackId: number) => {
    startEdit(trackId);
    setViewMode('edit');
  };

  // Handle save
  const handleSave = async () => {
    await saveTrack();
    setViewMode('list');
  };

  // Handle cancel
  const handleCancel = () => {
    cancelEdit();
    setViewMode('list');
  };

  // Handle delete - show confirmation dialog
  const handleDelete = (trackId: number, trackName: string) => {
    setDeleteDialogState({
      isOpen: true,
      trackId,
      trackName,
    });
  };

  // Handle confirming track deletion
  const handleConfirmDelete = async () => {
    if (deleteDialogState.trackId) {
      await deleteTrack(deleteDialogState.trackId);
    }
    setDeleteDialogState({
      isOpen: false,
      trackId: null,
      trackName: '',
    });
  };

  // Handle canceling track deletion
  const handleCancelDelete = () => {
    setDeleteDialogState({
      isOpen: false,
      trackId: null,
      trackName: '',
    });
  };

  // Handle convert to route
  const handleConvertToRoute = useCallback(async (trackId: number) => {
    if (!isTauri()) return;

    try {
      const routeId = await convertTrackToRoute(trackId, 50);
      onConvertToRoute?.(routeId);
      alert('Track converted to route successfully!');
    } catch (error) {
      console.error('Failed to convert track to route:', error);
      alert(`Failed to convert track to route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [onConvertToRoute]);

  // Sort options
  const sortOptions: { value: TrackSortOption; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'name', label: 'Name' },
    { value: 'distance', label: 'Distance' },
    { value: 'points', label: 'Points' },
  ];

  // Format duration
  const formatDuration = (startedAt: string | null, endedAt: string | null): string => {
    if (!startedAt) return '--';
    const start = new Date(startedAt);
    const end = endedAt ? new Date(endedAt) : new Date();
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  // Render recording status bar
  const renderRecordingStatus = () => {
    if (!isRecording) return null;

    return (
      <div className={`track-panel__recording-status track-panel__recording-status--${theme}`}>
        <div className="track-panel__recording-indicator">
          <span className="track-panel__recording-dot" />
          <span className="track-panel__recording-label">Recording</span>
        </div>
        <div className="track-panel__recording-stats">
          <span>{recording.pointCount} pts</span>
          <span>{recording.distance.toFixed(2)} nm</span>
          <span>{formatDuration(recording.startedAt, null)}</span>
        </div>
        <button
          className="track-panel__stop-button"
          onClick={handleStopRecording}
          title="Stop Recording"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop
        </button>
      </div>
    );
  };

  // Render start recording section
  const renderStartRecording = () => {
    if (isRecording) return null;

    return (
      <div className={`track-panel__start-recording track-panel__start-recording--${theme}`}>
        <input
          type="text"
          className={`track-panel__name-input track-panel__name-input--${theme}`}
          placeholder="Track name (optional)"
          value={newTrackName}
          onChange={(e) => setNewTrackName(e.target.value)}
        />
        <button
          className="track-panel__record-button"
          onClick={handleStartRecording}
          title="Start Recording"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <circle cx="12" cy="12" r="8" />
          </svg>
          Record
        </button>
      </div>
    );
  };

  // Render list view
  const renderListView = () => (
    <>
      {/* Recording Controls */}
      {renderRecordingStatus()}
      {renderStartRecording()}

      {/* Search and Sort */}
      <div className={`track-panel__filters track-panel__filters--${theme}`}>
        <input
          type="text"
          className={`track-panel__search track-panel__search--${theme}`}
          placeholder="Search tracks..."
          value={filter.searchQuery}
          onChange={(e) => updateFilter({ searchQuery: e.target.value })}
        />
        <select
          className={`track-panel__sort track-panel__sort--${theme}`}
          value={filter.sortBy}
          onChange={(e) => updateFilter({ sortBy: e.target.value as TrackSortOption })}
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          className={`track-panel__sort-direction track-panel__sort-direction--${theme}`}
          onClick={() => updateFilter({ sortDirection: filter.sortDirection === 'asc' ? 'desc' : 'asc' })}
          title={filter.sortDirection === 'asc' ? 'Ascending' : 'Descending'}
        >
          {filter.sortDirection === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Track List */}
      <div className={`track-panel__list track-panel__list--${theme}`}>
        {filteredTracks.length === 0 ? (
          <div className="track-panel__empty">
            {state.tracks.length === 0
              ? 'No tracks yet. Start recording!'
              : 'No tracks match your search.'}
          </div>
        ) : (
          filteredTracks.map((track) => (
            <div
              key={track.id}
              className={`track-panel__item track-panel__item--${theme} ${
                selectedTrack?.id === track.id ? 'track-panel__item--selected' : ''
              } ${track.hidden ? 'track-panel__item--hidden' : ''} ${
                track.is_recording ? 'track-panel__item--recording' : ''
              }`}
              onClick={() => setSelectedTrack(track.id)}
            >
              <div
                className="track-panel__item-color"
                style={{ backgroundColor: track.color || DEFAULT_TRACK_COLOR }}
              />
              <div className="track-panel__item-info">
                <div className="track-panel__item-name">
                  {track.name}
                  {track.is_recording && (
                    <span className="track-panel__recording-badge">REC</span>
                  )}
                </div>
                <div className="track-panel__item-stats">
                  <span>{track.point_count} pts</span>
                  <span>{(track.total_distance_nm || 0).toFixed(2)} nm</span>
                  <span>{formatDuration(track.started_at, track.ended_at)}</span>
                </div>
              </div>
              <div className="track-panel__item-actions">
                <button
                  className="track-panel__action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTrackHidden(track.id!, !track.hidden);
                  }}
                  title={track.hidden ? 'Show on map' : 'Hide from map'}
                >
                  {track.hidden ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
                <button
                  className="track-panel__action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditTrack(track.id!);
                  }}
                  title="Edit track"
                  disabled={track.is_recording}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
                <button
                  className="track-panel__action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShareModalTrack(track);
                  }}
                  title="Share/Export GPX"
                  disabled={track.is_recording}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </button>
                <button
                  className="track-panel__action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCenterOnTrack?.(track.id!);
                  }}
                  title="Center on track"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="22" y1="12" x2="18" y2="12" />
                    <line x1="6" y1="12" x2="2" y2="12" />
                    <line x1="12" y1="6" x2="12" y2="2" />
                    <line x1="12" y1="22" x2="12" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Selected Track Actions */}
      {selectedTrack && !selectedTrack.is_recording && (
        <div className={`track-panel__selected-actions track-panel__selected-actions--${theme}`}>
          <button
            className="track-panel__action-btn-large"
            onClick={() => handleConvertToRoute(selectedTrack.id!)}
            title="Convert to route"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Convert to Route
          </button>
          <button
            className="track-panel__action-btn-large track-panel__action-btn-large--danger"
            onClick={() => handleDelete(selectedTrack.id!, selectedTrack.name)}
            title="Delete track"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </>
  );

  // Render edit view
  const renderEditView = () => {
    if (!editState.formData) return null;

    return (
      <div className={`track-panel__edit track-panel__edit--${theme}`}>
        <h3 className="track-panel__edit-title">Edit Track</h3>

        <div className="track-panel__form-group">
          <label className="track-panel__label">Name</label>
          <input
            type="text"
            className={`track-panel__input track-panel__input--${theme}`}
            value={editState.formData.name}
            onChange={(e) => updateForm({ name: e.target.value })}
            placeholder="Track name"
          />
        </div>

        <div className="track-panel__form-group">
          <label className="track-panel__label">Description</label>
          <textarea
            className={`track-panel__textarea track-panel__textarea--${theme}`}
            value={editState.formData.description}
            onChange={(e) => updateForm({ description: e.target.value })}
            placeholder="Optional description..."
            rows={3}
          />
        </div>

        <div className="track-panel__form-group">
          <label className="track-panel__label">Color</label>
          <div className="track-panel__color-picker">
            {TRACK_COLORS.map((color) => (
              <button
                key={color.id}
                className={`track-panel__color-option ${
                  editState.formData?.color === color.id ? 'track-panel__color-option--selected' : ''
                }`}
                style={{ backgroundColor: color.id }}
                onClick={() => updateForm({ color: color.id })}
                title={color.name}
              />
            ))}
          </div>
        </div>

        {editState.error && (
          <div className="track-panel__error">{editState.error}</div>
        )}

        <div className="track-panel__edit-actions">
          <button
            className={`track-panel__btn track-panel__btn--secondary track-panel__btn--${theme}`}
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            className={`track-panel__btn track-panel__btn--primary track-panel__btn--${theme}`}
            onClick={handleSave}
            disabled={isSaving || !editState.isDirty}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`track-panel track-panel--${theme}`}>
      {/* Header */}
      <div className={`track-panel__header track-panel__header--${theme}`}>
        <h2 className="track-panel__title">
          {viewMode === 'edit' ? 'Edit Track' : 'Tracks'}
        </h2>
        <div className="track-panel__header-actions">
          {viewMode === 'edit' && (
            <button
              className="track-panel__back-btn"
              onClick={handleCancel}
              title="Back to list"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
          <button
            className="track-panel__close-btn"
            onClick={onClose}
            title="Close panel"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="track-panel__content">
        {viewMode === 'list' && renderListView()}
        {viewMode === 'edit' && renderEditView()}
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteDialogState.isOpen && (
        <div className={`track-panel__dialog-overlay track-panel__dialog-overlay--${theme}`}>
          <div className={`track-panel__dialog track-panel__dialog--${theme}`}>
            <h3 className="track-panel__dialog-title">Delete Track</h3>
            <p className="track-panel__dialog-message">
              Are you sure you want to delete "{deleteDialogState.trackName}"?
            </p>
            <p className="track-panel__dialog-warning">
              This action cannot be undone.
            </p>
            <div className="track-panel__dialog-actions">
              <button
                className={`track-panel__btn track-panel__btn--secondary track-panel__btn--${theme}`}
                onClick={handleCancelDelete}
              >
                Cancel
              </button>
              <button
                className={`track-panel__btn track-panel__btn--danger track-panel__btn--${theme}`}
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareModalTrack && (
        <ShareTrackModal
          theme={theme}
          track={shareModalTrack}
          onClose={() => setShareModalTrack(null)}
        />
      )}
    </div>
  );
}
