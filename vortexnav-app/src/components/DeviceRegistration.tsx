// ==============================================
// Device Registration Component
// ==============================================
//
// First-run registration flow for connecting to Horizon.
// Shows subscription status, entitlements, and sync status.
//

import { useState, useCallback, useMemo } from 'react';
import type { ThemeMode } from '../types';
import { useLicensingAgent } from '../hooks/useLicensingAgent';
import { daysUntilExpiry } from '../services/laClient';

interface DeviceRegistrationProps {
  theme: ThemeMode;
  onClose: () => void;
  onRegistered?: () => void;
}

// Basemap display names for formatting
const BASEMAP_NAMES: Record<string, string> = {
  osm: 'OpenStreetMap',
  sentinel: 'Sentinel-2',
  esri: 'Esri Imagery',
  gebco: 'GEBCO Bathymetry',
  openseamap: 'OpenSeaMap',
};

// All possible basemaps (for showing restricted ones)
const ALL_BASEMAPS = ['osm', 'sentinel', 'esri', 'gebco', 'openseamap'];

// Feature display configuration
const FEATURE_CONFIG: Record<string, { label: string; description: string; icon: string }> = {
  premium_charts: {
    label: 'Premium Charts',
    description: 'Access to high-resolution nautical charts',
    icon: '🗺️',
  },
  weather_overlay: {
    label: 'Weather Overlay',
    description: 'Real-time weather data on charts',
    icon: '🌤️',
  },
  ais_integration: {
    label: 'AIS Integration',
    description: 'Automatic Identification System tracking',
    icon: '📡',
  },
  offline_packs: {
    label: 'Offline Packs',
    description: 'Download charts for offline use',
    icon: '📦',
  },
  max_offline_regions: {
    label: 'Offline Regions',
    description: 'Maximum number of offline regions',
    icon: '🌍',
  },
  max_zoom_level: {
    label: 'Max Zoom Level',
    description: 'Maximum chart detail level',
    icon: '🔍',
  },
  allowed_basemaps: {
    label: 'Allowed Basemaps',
    description: 'Available map data sources',
    icon: '🗺️',
  },
  priority_generation: {
    label: 'Priority Tile Generation',
    description: 'Faster processing for tile requests',
    icon: '⚡',
  },
  api_access: {
    label: 'API Access',
    description: 'Access to Vortex Marine API',
    icon: '🔌',
  },
  included_tokens: {
    label: 'Monthly Tokens',
    description: 'Tile generation tokens per month',
    icon: '🎫',
  },
  subscription_tier: {
    label: 'Subscription',
    description: 'Your current subscription plan',
    icon: '⭐',
  },
};

// Subscription tier display configuration
const TIER_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  basic: { label: 'Basic', color: '#6b7280', bgColor: '#f3f4f6' },
  pro: { label: 'Pro', color: '#2563eb', bgColor: '#dbeafe' },
  enterprise: { label: 'Enterprise', color: '#7c3aed', bgColor: '#ede9fe' },
};

export function DeviceRegistration({ theme, onClose, onRegistered }: DeviceRegistrationProps) {
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'input' | 'registering' | 'success' | 'error' | 'change-registration'>('input');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showChangeConfirm, setShowChangeConfirm] = useState(false);

  const {
    isConnected,
    isRegistered,
    deviceStatus,
    entitlements,
    register,
    sync,
    error: laError,
  } = useLicensingAgent();

  const isDark = theme === 'night';

  // Derive subscription tier from entitlements
  const subscriptionInfo = useMemo(() => {
    // First, check for explicit subscription_tier entitlement (set by backend)
    const tierEntitlement = entitlements.find(e => e.key === 'subscription_tier');
    const explicitTier = tierEntitlement?.value as string | undefined;

    // Also check feature flags for fallback tier detection
    const hasPremiumCharts = entitlements.some(e => e.key === 'premium_charts' && e.value === true);
    const hasWeather = entitlements.some(e => e.key === 'weather_overlay' && e.value === true);
    const hasAis = entitlements.some(e => e.key === 'ais_integration' && e.value === true);

    // Find earliest expiry date among entitlements
    const expiryDates = entitlements
      .filter(e => e.expires_at)
      .map(e => new Date(e.expires_at));
    const earliestExpiry = expiryDates.length > 0
      ? new Date(Math.min(...expiryDates.map(d => d.getTime())))
      : null;

    // Use explicit tier from backend, or derive from features as fallback
    let tier: 'basic' | 'pro' | 'enterprise' = 'basic';
    if (explicitTier && ['basic', 'pro', 'enterprise'].includes(explicitTier)) {
      tier = explicitTier as 'basic' | 'pro' | 'enterprise';
    } else if (hasAis && hasWeather && hasPremiumCharts) {
      tier = 'enterprise';
    } else if (hasPremiumCharts) {
      tier = 'pro';
    }

    // Get included tokens entitlement
    const tokensEntitlement = entitlements.find(e => e.key === 'included_tokens');
    const includedTokens = typeof tokensEntitlement?.value === 'number' ? tokensEntitlement.value : 0;

    // Count only user-visible feature entitlements (exclude internal ones)
    const visibleFeatures = entitlements.filter(e =>
      !['subscription_tier', 'included_tokens'].includes(e.key)
    );

    return {
      tier,
      expiresAt: earliestExpiry,
      daysRemaining: earliestExpiry ? daysUntilExpiry(earliestExpiry.toISOString()) : null,
      featureCount: visibleFeatures.length,
      includedTokens,
    };
  }, [entitlements]);

  // Handle registration submit
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code.trim()) {
      setErrorMessage('Please enter a registration code');
      return;
    }

    setStep('registering');
    setErrorMessage(null);

    try {
      const success = await register(code.trim());

      if (success) {
        setStep('success');
        onRegistered?.();
      } else {
        setStep('error');
        setErrorMessage('Registration failed. Please check your code and try again.');
      }
    } catch (err) {
      setStep('error');
      setErrorMessage(err instanceof Error ? err.message : 'Registration failed');
    }
  }, [code, register, onRegistered]);

  // Handle sync
  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      await sync();
    } finally {
      setIsSyncing(false);
    }
  }, [sync]);

  // Handle change registration request
  const handleChangeRegistration = useCallback(() => {
    setShowChangeConfirm(true);
  }, []);

  // Confirm change registration - switch to input mode
  const confirmChangeRegistration = useCallback(() => {
    setShowChangeConfirm(false);
    setCode('');
    setStep('change-registration');
    setErrorMessage(null);
  }, []);

  // Cancel change registration
  const cancelChangeRegistration = useCallback(() => {
    setShowChangeConfirm(false);
    setCode('');
    setStep('input');
    setErrorMessage(null);
  }, []);

  // Format code input (uppercase alphanumeric only, 8 chars)
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setCode(value);
  };

  // ==============================================
  // Styles
  // ==============================================
  const modalStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '20px',
  };

  const contentStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
    borderRadius: '16px',
    padding: '32px',
    maxWidth: '520px',
    width: '100%',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)',
    color: isDark ? '#ffffff' : '#1a1a1a',
    maxHeight: '90vh',
    overflowY: 'auto',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '24px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: 600,
    margin: 0,
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: '14px',
    color: isDark ? '#a0a0a0' : '#666666',
    marginBottom: '24px',
    textAlign: 'center',
  };

  const statusBadgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 600,
  };

  const tierBadgeStyle = (tier: string): React.CSSProperties => {
    const config = TIER_CONFIG[tier] || TIER_CONFIG.basic;
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 16px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: 600,
      color: config.color,
      backgroundColor: isDark ? `${config.color}20` : config.bgColor,
      border: `1px solid ${config.color}40`,
    };
  };

  const sectionStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#2a2a2a' : '#f8f9fa',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '16px',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: isDark ? '#a0a0a0' : '#666666',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '12px',
  };

  const featureRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: `1px solid ${isDark ? '#404040' : '#e5e7eb'}`,
  };

  const featureIconStyle: React.CSSProperties = {
    fontSize: '18px',
    marginRight: '10px',
  };

  const featureLabelStyle: React.CSSProperties = {
    flex: 1,
    fontSize: '14px',
    fontWeight: 500,
  };

  const featureValueStyle = (enabled: boolean): React.CSSProperties => ({
    fontSize: '13px',
    fontWeight: 600,
    color: enabled ? '#22c55e' : (isDark ? '#6b7280' : '#9ca3af'),
  });

  const infoRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
  };

  const infoLabelStyle: React.CSSProperties = {
    fontSize: '13px',
    color: isDark ? '#a0a0a0' : '#666666',
  };

  const infoValueStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 500,
    fontFamily: 'monospace',
  };

  const expiryWarningStyle = (daysRemaining: number | null): React.CSSProperties => {
    let bgColor = isDark ? '#22c55e20' : '#dcfce7';
    let borderColor = '#22c55e40';

    if (daysRemaining !== null) {
      if (daysRemaining <= 7) {
        bgColor = isDark ? '#ef444420' : '#fee2e2';
        borderColor = '#ef444440';
      } else if (daysRemaining <= 30) {
        bgColor = isDark ? '#f59e0b20' : '#fef3c7';
        borderColor = '#f59e0b40';
      }
    }

    return {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      borderRadius: '8px',
      backgroundColor: bgColor,
      border: `1px solid ${borderColor}`,
      marginBottom: '16px',
    };
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '16px',
    fontSize: '24px',
    letterSpacing: '4px',
    textAlign: 'center',
    fontFamily: 'monospace',
    backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5',
    border: `2px solid ${isDark ? '#404040' : '#e0e0e0'}`,
    borderRadius: '8px',
    color: isDark ? '#ffffff' : '#1a1a1a',
    outline: 'none',
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 600,
    backgroundColor: '#0066cc',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    marginTop: '16px',
    transition: 'background-color 0.2s',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: 'transparent',
    border: `1px solid ${isDark ? '#404040' : '#d0d0d0'}`,
    color: isDark ? '#a0a0a0' : '#666666',
  };

  const errorStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#ef444420' : '#fee2e2',
    color: '#ef4444',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '14px',
    border: '1px solid #ef444440',
  };

  const successStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#22c55e20' : '#dcfce7',
    color: '#22c55e',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '14px',
    textAlign: 'center',
    border: '1px solid #22c55e40',
  };

  const infoBoxStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#2a2a2a' : '#f0f7ff',
    border: `1px solid ${isDark ? '#404040' : '#cce0ff'}`,
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '24px',
    fontSize: '13px',
    lineHeight: '1.5',
  };

  const warningBoxStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#f59e0b20' : '#fef3c7',
    border: '1px solid #f59e0b40',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    fontSize: '13px',
    lineHeight: '1.5',
  };

  const dangerBoxStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#ef444420' : '#fee2e2',
    border: '1px solid #ef444440',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    fontSize: '13px',
    lineHeight: '1.5',
  };

  const linkButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#0066cc',
    fontSize: '13px',
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
  };

  const dangerButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#ef4444',
  };

  // ==============================================
  // Change Registration form (re-register with new code)
  // This must come BEFORE the registered view check
  // ==============================================
  if (step === 'change-registration') {
    return (
      <div style={modalStyle} onClick={onClose}>
        <div style={contentStyle} onClick={e => e.stopPropagation()}>
          <h2 style={{ ...titleStyle, textAlign: 'center' }}>Change Registration</h2>
          <p style={subtitleStyle}>
            Enter a new registration code to connect this device to a different Horizon account.
          </p>

          {/* Current Device Info */}
          {deviceStatus?.device_id && (
            <div style={{
              ...sectionStyle,
              marginBottom: '16px',
              padding: '12px 16px',
            }}>
              <div style={{ fontSize: '11px', color: isDark ? '#a0a0a0' : '#666666', textTransform: 'uppercase', marginBottom: '4px' }}>
                Current Device
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                  {deviceStatus.device_id.substring(0, 8)}...
                </span>
                <span style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  backgroundColor: '#22c55e20',
                  color: '#22c55e',
                }}>
                  Currently Registered
                </span>
              </div>
            </div>
          )}

          <div style={warningBoxStyle}>
            <div style={{ fontWeight: 600, marginBottom: '8px', color: '#f59e0b' }}>
              Important
            </div>
            <p style={{ margin: 0 }}>
              Changing registration will disconnect this device from the current account.
              You will need to re-download any offline packs after re-registering.
            </p>
          </div>

          {errorMessage && (
            <div style={errorStyle}>
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '12px', color: isDark ? '#a0a0a0' : '#666666', textTransform: 'uppercase' }}>
                New Registration Code
              </label>
            </div>
            <input
              type="text"
              value={code}
              onChange={handleCodeChange}
              placeholder="XXXXXXXX"
              maxLength={8}
              style={inputStyle}
              autoFocus
            />

            <button
              type="submit"
              disabled={!code.trim()}
              style={{
                ...dangerButtonStyle,
                opacity: !code.trim() ? 0.6 : 1,
                cursor: !code.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              Re-Register Device
            </button>

            <button
              type="button"
              onClick={cancelChangeRegistration}
              style={secondaryButtonStyle}
            >
              Cancel
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==============================================
  // Already registered view - Enhanced subscription status
  // ==============================================
  if (isRegistered && deviceStatus) {
    const tierConfig = TIER_CONFIG[subscriptionInfo.tier] || TIER_CONFIG.basic;

    return (
      <div style={modalStyle} onClick={onClose}>
        <div style={contentStyle} onClick={e => e.stopPropagation()}>
          {/* Header with status */}
          <div style={headerStyle}>
            <h2 style={titleStyle}>Device Status</h2>
            <div style={{
              ...statusBadgeStyle,
              backgroundColor: '#22c55e20',
              color: '#22c55e',
              border: '1px solid #22c55e40',
            }}>
              <span style={{ fontSize: '8px' }}>●</span>
              Connected
            </div>
          </div>

          {/* Subscription Status Card - Matching Portal Style */}
          <div style={{
            ...sectionStyle,
            background: isDark
              ? `linear-gradient(135deg, ${tierConfig.color}15, ${tierConfig.color}05)`
              : `linear-gradient(135deg, ${tierConfig.bgColor}, #ffffff)`,
            border: `1px solid ${tierConfig.color}30`,
          }}>
            {/* Plan Name and Status Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={tierBadgeStyle(subscriptionInfo.tier)}>
                  {tierConfig.label} Plan
                </div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: '#22c55e20',
                  color: '#22c55e',
                  border: '1px solid #22c55e40',
                }}>
                  <span style={{ fontSize: '6px' }}>●</span>
                  Active
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: isDark ? '#a0a0a0' : '#666666', textTransform: 'uppercase' }}>
                  Features
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: tierConfig.color }}>
                  {subscriptionInfo.featureCount}
                </div>
              </div>
            </div>

            {/* Subscription Period Info */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              padding: '12px',
              backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)',
              borderRadius: '8px',
            }}>
              <div>
                <div style={{ fontSize: '11px', color: isDark ? '#a0a0a0' : '#666666', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Valid Until
                </div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: isDark ? '#ffffff' : '#1a1a1a' }}>
                  {subscriptionInfo.expiresAt
                    ? subscriptionInfo.expiresAt.toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'No expiry'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: isDark ? '#a0a0a0' : '#666666', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Days Remaining
                </div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: isDark ? '#ffffff' : '#1a1a1a' }}>
                  {subscriptionInfo.daysRemaining !== null ? `${subscriptionInfo.daysRemaining} days` : 'Unlimited'}
                </div>
              </div>
            </div>
          </div>

          {/* Subscription Expiry Warning Banner */}
          {subscriptionInfo.expiresAt && subscriptionInfo.daysRemaining !== null && subscriptionInfo.daysRemaining <= 30 && (
            <div style={expiryWarningStyle(subscriptionInfo.daysRemaining)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '24px' }}>
                  {subscriptionInfo.daysRemaining <= 7 ? '⚠️' : '📅'}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {subscriptionInfo.daysRemaining <= 0
                      ? 'Subscription Expired'
                      : subscriptionInfo.daysRemaining <= 7
                        ? 'Subscription Expiring Soon'
                        : 'Renewal Approaching'}
                  </div>
                  <div style={{ fontSize: '12px', opacity: 0.9 }}>
                    {subscriptionInfo.daysRemaining <= 0
                      ? 'Please renew your subscription to continue using premium features.'
                      : `Your subscription will expire on ${subscriptionInfo.expiresAt.toLocaleDateString()}.`}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right', minWidth: '80px' }}>
                <div style={{ fontSize: '28px', fontWeight: 700 }}>
                  {Math.max(0, subscriptionInfo.daysRemaining)}
                </div>
                <div style={{ fontSize: '10px', opacity: 0.8, textTransform: 'uppercase' }}>
                  days left
                </div>
              </div>
            </div>
          )}

          {/* Entitlements/Features Section */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Your Features</div>
            {(() => {
              // Filter out internal entitlements shown elsewhere
              const displayableEntitlements = entitlements.filter(e =>
                !['subscription_tier'].includes(e.key)
              );

              if (displayableEntitlements.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '20px', color: isDark ? '#6b7280' : '#9ca3af' }}>
                    No entitlements found. Try syncing with Horizon.
                  </div>
                );
              }

              return displayableEntitlements.map((entitlement, index) => {
                const config = FEATURE_CONFIG[entitlement.key];
                const isLast = index === displayableEntitlements.length - 1;
                const value = entitlement.value;

                // Format the display value based on type
                let displayValue: string | number;
                if (Array.isArray(value)) {
                  // Format array values (like allowed_basemaps)
                  if (entitlement.key === 'allowed_basemaps') {
                    // Show count and list of basemap names
                    const basemapNames = value.map(b => BASEMAP_NAMES[b] || b);
                    displayValue = `${value.length} sources`;
                    // We'll show a tooltip or expanded view with full list
                  } else {
                    displayValue = value.length > 0 ? value.join(', ') : 'None';
                  }
                } else if (typeof value === 'number') {
                  // Format large numbers with commas
                  displayValue = value >= 1000
                    ? value.toLocaleString()
                    : value;
                } else if (typeof value === 'boolean') {
                  displayValue = value ? 'Enabled' : 'Disabled';
                } else if (typeof value === 'string') {
                  // Capitalize string values
                  displayValue = value.charAt(0).toUpperCase() + value.slice(1);
                } else {
                  displayValue = 'Enabled';
                }

                // Handle feature: prefixed entitlements
                const displayKey = entitlement.key.startsWith('feature:')
                  ? entitlement.key.replace('feature:', '')
                  : entitlement.key;
                const displayLabel = config?.label || displayKey.split('_').map(
                  w => w.charAt(0).toUpperCase() + w.slice(1)
                ).join(' ');

                // Special rendering for allowed_basemaps to show the full list
                if (entitlement.key === 'allowed_basemaps' && Array.isArray(value)) {
                  const allowedSet = new Set(value as string[]);
                  const restrictedBasemaps = ALL_BASEMAPS.filter(b => !allowedSet.has(b));
                  return (
                    <div
                      key={entitlement.key}
                      style={{
                        padding: '10px 0',
                        borderBottom: isLast ? 'none' : `1px solid ${isDark ? '#404040' : '#e5e7eb'}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={featureIconStyle}>{config?.icon || '✓'}</span>
                        <span style={featureLabelStyle}>{displayLabel}</span>
                        <span style={featureValueStyle(true)}>{value.length} of {ALL_BASEMAPS.length}</span>
                      </div>
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px',
                        marginLeft: '28px',
                      }}>
                        {ALL_BASEMAPS.map((basemap) => {
                          const isAllowed = allowedSet.has(basemap);
                          const name = BASEMAP_NAMES[basemap] || basemap;
                          return (
                            <span
                              key={basemap}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                borderRadius: '4px',
                                backgroundColor: isAllowed
                                  ? (isDark ? '#374151' : '#dcfce7')
                                  : (isDark ? '#1f2937' : '#f3f4f6'),
                                color: isAllowed
                                  ? (isDark ? '#86efac' : '#166534')
                                  : (isDark ? '#6b7280' : '#9ca3af'),
                                textDecoration: isAllowed ? 'none' : 'line-through',
                                opacity: isAllowed ? 1 : 0.7,
                              }}
                            >
                              {isAllowed ? '✓ ' : '✗ '}{name}
                            </span>
                          );
                        })}
                      </div>
                      {restrictedBasemaps.length > 0 && (
                        <div style={{
                          marginLeft: '28px',
                          marginTop: '8px',
                          fontSize: '11px',
                          color: isDark ? '#9ca3af' : '#6b7280',
                          fontStyle: 'italic',
                        }}>
                          Upgrade to Pro for Sentinel-2 imagery, Enterprise for Esri World Imagery
                        </div>
                      )}
                    </div>
                  );
                }

                // Special rendering for max_zoom_level to show tier comparison
                if (entitlement.key === 'max_zoom_level' && typeof value === 'number') {
                  const maxZoom = value as number;
                  const isBasic = maxZoom <= 14;
                  const isPro = maxZoom <= 18 && maxZoom > 14;
                  return (
                    <div
                      key={entitlement.key}
                      style={{
                        padding: '10px 0',
                        borderBottom: isLast ? 'none' : `1px solid ${isDark ? '#404040' : '#e5e7eb'}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={featureIconStyle}>{config?.icon || '✓'}</span>
                        <span style={featureLabelStyle}>{displayLabel}</span>
                        <span style={featureValueStyle(true)}>Level {maxZoom}</span>
                      </div>
                      {isBasic && (
                        <div style={{
                          marginLeft: '28px',
                          fontSize: '11px',
                          color: isDark ? '#9ca3af' : '#6b7280',
                          fontStyle: 'italic',
                        }}>
                          Pro offers Level 18, Enterprise offers Level 20 for higher detail
                        </div>
                      )}
                      {isPro && (
                        <div style={{
                          marginLeft: '28px',
                          fontSize: '11px',
                          color: isDark ? '#9ca3af' : '#6b7280',
                          fontStyle: 'italic',
                        }}>
                          Enterprise offers Level 20 for maximum detail
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={entitlement.key}
                    style={{
                      ...featureRowStyle,
                      borderBottom: isLast ? 'none' : featureRowStyle.borderBottom
                    }}
                  >
                    <span style={featureIconStyle}>{config?.icon || '✓'}</span>
                    <span style={featureLabelStyle}>{displayLabel}</span>
                    <span style={featureValueStyle(value !== false)}>{displayValue}</span>
                  </div>
                );
              });
            })()}
          </div>

          {/* Device Info Section */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Device Information</div>
            <div style={infoRowStyle}>
              <span style={infoLabelStyle}>Device ID</span>
              <span style={infoValueStyle}>
                {deviceStatus.device_id?.substring(0, 8)}...
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={infoLabelStyle}>Full Device ID</span>
              <span style={{ ...infoValueStyle, fontSize: '11px', wordBreak: 'break-all' }}>
                {deviceStatus.device_id}
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={infoLabelStyle}>Horizon Server</span>
              <span style={{
                ...infoValueStyle,
                fontSize: '12px',
                color: deviceStatus.horizon_url?.includes('localhost') ? '#22c55e' : '#f59e0b',
              }}>
                {deviceStatus.horizon_url?.replace('https://', '').replace('http://', '')}
                {deviceStatus.horizon_url?.includes('localhost') ? ' (dev)' : ' (prod)'}
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={infoLabelStyle}>Registered</span>
              <span style={infoValueStyle}>
                {deviceStatus.registered_at
                  ? new Date(deviceStatus.registered_at).toLocaleDateString()
                  : 'Unknown'}
              </span>
            </div>
            <div style={{ ...infoRowStyle, borderBottom: 'none', paddingTop: '12px' }}>
              <span style={infoLabelStyle}>Registration</span>
              <button
                onClick={handleChangeRegistration}
                style={linkButtonStyle}
              >
                Change Registration Code
              </button>
            </div>
          </div>

          {/* Change Registration Confirmation Dialog */}
          {showChangeConfirm && (
            <div style={dangerBoxStyle}>
              <div style={{ fontWeight: 600, marginBottom: '8px', color: '#ef4444' }}>
                Change Registration?
              </div>
              <p style={{ margin: '0 0 12px 0', color: isDark ? '#fca5a5' : '#b91c1c' }}>
                This will disconnect this device from the current Horizon account and require a new registration code.
                Downloaded packs and cached entitlements will be cleared.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={confirmChangeRegistration}
                  style={{ ...dangerButtonStyle, flex: 1, marginTop: 0, padding: '10px' }}
                >
                  Yes, Change Registration
                </button>
                <button
                  onClick={() => setShowChangeConfirm(false)}
                  style={{ ...secondaryButtonStyle, flex: 1, marginTop: 0, padding: '10px' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleSync}
              disabled={isSyncing}
              style={{
                ...secondaryButtonStyle,
                flex: 1,
                marginTop: 0,
                opacity: isSyncing ? 0.6 : 1,
              }}
            >
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={onClose}
              style={{
                ...buttonStyle,
                flex: 1,
                marginTop: 0,
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==============================================
  // Not connected to LA
  // ==============================================
  if (!isConnected) {
    return (
      <div style={modalStyle} onClick={onClose}>
        <div style={contentStyle} onClick={e => e.stopPropagation()}>
          <h2 style={{ ...titleStyle, textAlign: 'center', marginBottom: '16px' }}>
            Licensing Agent Not Available
          </h2>

          <div style={errorStyle}>
            Unable to connect to the Vortex Licensing Agent.
            {laError && <div style={{ marginTop: '8px' }}>{laError}</div>}
          </div>

          <div style={infoBoxStyle}>
            <p style={{ margin: 0 }}>
              The Licensing Agent service must be running to register this device.
              Please ensure the service is installed and running.
            </p>
          </div>

          <button
            onClick={onClose}
            style={secondaryButtonStyle}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // ==============================================
  // Success view - Enhanced
  // ==============================================
  if (step === 'success') {
    return (
      <div style={modalStyle} onClick={onClose}>
        <div style={contentStyle} onClick={e => e.stopPropagation()}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
            <h2 style={{ ...titleStyle, textAlign: 'center' }}>Registration Complete!</h2>
          </div>

          <div style={successStyle}>
            Your device has been successfully registered with Horizon.
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>What's Next</div>
            <div style={{ ...featureRowStyle, borderBottom: `1px solid ${isDark ? '#404040' : '#e5e7eb'}` }}>
              <span style={featureIconStyle}>📦</span>
              <span style={featureLabelStyle}>Download offline chart packs</span>
            </div>
            <div style={{ ...featureRowStyle, borderBottom: `1px solid ${isDark ? '#404040' : '#e5e7eb'}` }}>
              <span style={featureIconStyle}>⭐</span>
              <span style={featureLabelStyle}>Access premium features</span>
            </div>
            <div style={{ ...featureRowStyle, borderBottom: 'none' }}>
              <span style={featureIconStyle}>🔄</span>
              <span style={featureLabelStyle}>Sync data across devices</span>
            </div>
          </div>

          <button
            onClick={onClose}
            style={buttonStyle}
          >
            Get Started
          </button>
        </div>
      </div>
    );
  }

  // ==============================================
  // Registration form
  // ==============================================
  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={contentStyle} onClick={e => e.stopPropagation()}>
        <h2 style={{ ...titleStyle, textAlign: 'center' }}>Register Device</h2>
        <p style={subtitleStyle}>
          Enter your registration code to connect this device to your Horizon account.
        </p>

        {(errorMessage || (step === 'error' && laError)) && (
          <div style={errorStyle}>
            {errorMessage || laError}
          </div>
        )}

        <div style={infoBoxStyle}>
          <p style={{ margin: 0 }}>
            <strong>How to get a registration code:</strong>
          </p>
          <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
            <li>Log in to your Horizon account at portal.vortex.marine</li>
            <li>Navigate to Devices in your dashboard</li>
            <li>Click "Add Device" and follow the instructions</li>
            <li>Enter the code shown here</li>
          </ol>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={code}
            onChange={handleCodeChange}
            placeholder="XXXXXXXX"
            maxLength={8}
            disabled={step === 'registering'}
            style={inputStyle}
            autoFocus
          />

          <button
            type="submit"
            disabled={step === 'registering' || !code.trim()}
            style={{
              ...buttonStyle,
              opacity: step === 'registering' || !code.trim() ? 0.6 : 1,
              cursor: step === 'registering' || !code.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {step === 'registering' ? 'Registering...' : 'Register Device'}
          </button>

          <button
            type="button"
            onClick={onClose}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

export default DeviceRegistration;
