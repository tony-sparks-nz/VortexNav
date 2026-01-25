// Floating import progress indicator - shows background import status
import { useState, useEffect } from 'react';
import type { ImportProgress, ThemeMode } from '../types';

interface ImportProgressIndicatorProps {
  progress: ImportProgress | null;
  theme: ThemeMode;
  onExpand: () => void;  // Called when user clicks to see full dialog
  onDismiss: () => void; // Called when import complete and user dismisses
}

export function ImportProgressIndicator({
  progress,
  theme,
  onExpand,
  onDismiss,
}: ImportProgressIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-dismiss after 5 seconds when complete
  useEffect(() => {
    if (progress?.phase === 'complete') {
      const timer = setTimeout(() => {
        onDismiss();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [progress?.phase, onDismiss]);

  // Don't show if no progress
  if (!progress) return null;

  const isComplete = progress.phase === 'complete';
  const isScanning = progress.phase === 'scanning';
  const percentage = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  const handleClick = () => {
    if (isComplete) {
      onDismiss();
    } else if (isExpanded) {
      setIsExpanded(false);
    } else {
      setIsExpanded(true);
    }
  };

  return (
    <div
      className={`import-progress-indicator import-progress-indicator--${theme} ${isExpanded ? 'import-progress-indicator--expanded' : ''}`}
      onClick={handleClick}
    >
      {/* Compact view */}
      <div className="import-progress-indicator__compact">
        <div className="import-progress-indicator__icon">
          {isComplete ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <div className="import-progress-indicator__spinner" />
          )}
        </div>
        <div className="import-progress-indicator__summary">
          {isScanning ? (
            <span>Scanning...</span>
          ) : isComplete ? (
            <span>{progress.converted} imported</span>
          ) : (
            <span>{progress.current}/{progress.total}</span>
          )}
        </div>
        {!isComplete && (
          <div className="import-progress-indicator__percentage">
            {percentage}%
          </div>
        )}
        <button
          className="import-progress-indicator__expand-btn"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          title="Open import dialog"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>

      {/* Expanded view */}
      {isExpanded && (
        <div className="import-progress-indicator__details">
          <div className="import-progress-indicator__progress-bar">
            <div
              className="import-progress-indicator__progress-fill"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="import-progress-indicator__file">
            {progress.current_file}
          </div>
          <div className="import-progress-indicator__stats">
            <span className="import-progress-indicator__stat import-progress-indicator__stat--success">
              {progress.converted} converted
            </span>
            {progress.skipped > 0 && (
              <span className="import-progress-indicator__stat import-progress-indicator__stat--skip">
                {progress.skipped} skipped
              </span>
            )}
            {progress.failed > 0 && (
              <span className="import-progress-indicator__stat import-progress-indicator__stat--error">
                {progress.failed} failed
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
