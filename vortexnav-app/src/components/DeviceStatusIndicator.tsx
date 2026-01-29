// ==============================================
// Device Status Indicator Component
// ==============================================
//
// A glowing status button that indicates device connection
// and subscription status at a glance.
//
// Colors:
//   - Green: Connected and valid (>7 days remaining)
//   - Blue: Connected, within 7 days of expiry
//   - Yellow: Connected, within 24 hours of expiry
//   - Orange: Connected but expired
//   - Red: Not connected
//

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { ThemeMode } from '../types';
import { useLicensingAgent } from '../hooks/useLicensingAgent';
import { daysUntilExpiry } from '../services/laClient';
import { DeviceRegistration } from './DeviceRegistration';

interface DeviceStatusIndicatorProps {
  theme: ThemeMode;
}

type StatusLevel = 'connected' | 'expiring_soon' | 'expiring_critical' | 'expired' | 'disconnected';

interface StatusConfig {
  color: string;
  glowColor: string;
  label: string;
  description: string;
  pulse: boolean;
}

const STATUS_CONFIG: Record<StatusLevel, StatusConfig> = {
  connected: {
    color: '#22c55e',
    glowColor: 'rgba(34, 197, 94, 0.5)',
    label: 'Connected',
    description: 'Device is registered and subscription is active',
    pulse: false,
  },
  expiring_soon: {
    color: '#3b82f6',
    glowColor: 'rgba(59, 130, 246, 0.5)',
    label: 'Expiring Soon',
    description: 'Subscription expires within 7 days',
    pulse: true,
  },
  expiring_critical: {
    color: '#eab308',
    glowColor: 'rgba(234, 179, 8, 0.5)',
    label: 'Expiring Today',
    description: 'Subscription expires within 24 hours',
    pulse: true,
  },
  expired: {
    color: '#f97316',
    glowColor: 'rgba(249, 115, 22, 0.5)',
    label: 'Expired',
    description: 'Subscription has expired - please renew',
    pulse: true,
  },
  disconnected: {
    color: '#ef4444',
    glowColor: 'rgba(239, 68, 68, 0.5)',
    label: 'Disconnected',
    description: 'Unable to connect to Licensing Agent',
    pulse: true,
  },
};

export function DeviceStatusIndicator({ theme }: DeviceStatusIndicatorProps) {
  const [showModal, setShowModal] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    isConnected,
    isRegistered,
    deviceStatus,
    entitlements,
  } = useLicensingAgent();

  const isDark = theme === 'night';

  // Determine status level based on connection and expiry
  const { statusLevel, daysRemaining } = useMemo(() => {
    if (!isConnected) {
      return { statusLevel: 'disconnected' as StatusLevel, daysRemaining: null };
    }

    if (!isRegistered) {
      return { statusLevel: 'disconnected' as StatusLevel, daysRemaining: null };
    }

    // Find earliest expiry date among entitlements
    const expiryDates = entitlements
      .filter(e => e.expires_at)
      .map(e => new Date(e.expires_at));

    if (expiryDates.length === 0) {
      // No expiry dates = connected and valid
      return { statusLevel: 'connected' as StatusLevel, daysRemaining: null };
    }

    const earliestExpiry = new Date(Math.min(...expiryDates.map(d => d.getTime())));
    const days = daysUntilExpiry(earliestExpiry.toISOString());

    if (days <= 0) {
      return { statusLevel: 'expired' as StatusLevel, daysRemaining: days };
    } else if (days <= 1) {
      return { statusLevel: 'expiring_critical' as StatusLevel, daysRemaining: days };
    } else if (days <= 7) {
      return { statusLevel: 'expiring_soon' as StatusLevel, daysRemaining: days };
    } else {
      return { statusLevel: 'connected' as StatusLevel, daysRemaining: days };
    }
  }, [isConnected, isRegistered, entitlements]);

  const config = STATUS_CONFIG[statusLevel];

  // Handle tooltip positioning
  const handleMouseEnter = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipPosition({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
      });
    }

    tooltipTimeoutRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
    setShowTooltip(false);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  // Generate tooltip content
  const tooltipContent = useMemo(() => {
    let statusText = config.label;
    let detailText = config.description;

    if (isRegistered && deviceStatus) {
      if (daysRemaining !== null && daysRemaining > 0) {
        detailText = `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`;
      } else if (daysRemaining !== null && daysRemaining <= 0) {
        detailText = 'Subscription expired';
      }
    } else if (!isConnected) {
      statusText = 'Not Connected';
      detailText = 'Licensing Agent unavailable';
    } else if (!isRegistered) {
      statusText = 'Not Registered';
      detailText = 'Click to register device';
    }

    return { statusText, detailText };
  }, [config, isConnected, isRegistered, deviceStatus, daysRemaining]);

  // ==============================================
  // Styles
  // ==============================================
  const buttonStyle: React.CSSProperties = {
    position: 'relative',
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: 'none',
    background: isDark ? '#2a2a2a' : '#ffffff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: isDark
      ? `0 2px 8px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1)`
      : `0 2px 8px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)`,
    transition: 'transform 0.2s, box-shadow 0.2s',
  };

  const dotStyle: React.CSSProperties = {
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    backgroundColor: config.color,
    boxShadow: `0 0 8px ${config.glowColor}, 0 0 16px ${config.glowColor}`,
    animation: config.pulse ? 'pulse 2s ease-in-out infinite' : 'none',
  };

  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    left: tooltipPosition.x,
    top: tooltipPosition.y,
    transform: 'translateX(-50%)',
    backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
    border: `1px solid ${isDark ? '#404040' : '#e5e7eb'}`,
    borderRadius: '8px',
    padding: '10px 14px',
    boxShadow: isDark
      ? '0 4px 20px rgba(0, 0, 0, 0.4)'
      : '0 4px 20px rgba(0, 0, 0, 0.15)',
    zIndex: 9999,
    minWidth: '160px',
    pointerEvents: 'none',
    opacity: showTooltip ? 1 : 0,
    transition: 'opacity 0.2s',
  };

  const tooltipArrowStyle: React.CSSProperties = {
    position: 'absolute',
    top: '-6px',
    left: '50%',
    width: '12px',
    height: '12px',
    backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
    border: `1px solid ${isDark ? '#404040' : '#e5e7eb'}`,
    borderRight: 'none',
    borderBottom: 'none',
    borderRadius: '2px 0 0 0',
    transform: 'translateX(-50%) rotate(45deg)',
  };

  const statusRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  };

  const statusDotStyle: React.CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: config.color,
    boxShadow: `0 0 4px ${config.glowColor}`,
  };

  const statusLabelStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: isDark ? '#ffffff' : '#1a1a1a',
  };

  const statusDetailStyle: React.CSSProperties = {
    fontSize: '11px',
    color: isDark ? '#a0a0a0' : '#666666',
    marginLeft: '16px',
  };

  // Keyframes for pulse animation (injected via style tag)
  const pulseKeyframes = `
    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.7;
        transform: scale(1.1);
      }
    }
  `;

  return (
    <>
      <style>{pulseKeyframes}</style>

      <button
        ref={buttonRef}
        onClick={() => setShowModal(true)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={buttonStyle}
        title="" // Disable native tooltip
        aria-label={`Device status: ${config.label}`}
      >
        <div style={dotStyle} />
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div style={tooltipStyle}>
          <div style={tooltipArrowStyle} />
          <div style={statusRowStyle}>
            <div style={statusDotStyle} />
            <span style={statusLabelStyle}>{tooltipContent.statusText}</span>
          </div>
          <div style={statusDetailStyle}>{tooltipContent.detailText}</div>
        </div>
      )}

      {/* Full modal */}
      {showModal && (
        <DeviceRegistration
          theme={theme}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

export default DeviceStatusIndicator;
