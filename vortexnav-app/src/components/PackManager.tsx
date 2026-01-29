// ==============================================
// Pack Manager Component
// ==============================================
//
// UI for browsing, downloading, and managing offline chart packs.
//

import { useState, useCallback } from 'react';
import type { ThemeMode } from '../types';
import { useLicensingAgent } from '../hooks/useLicensingAgent';
import { formatBytes, daysUntilExpiry, isExpired } from '../services/laClient';
import type { PackInfo, PackCatalogRegion } from '../services/laClient';

interface PackManagerProps {
  theme: ThemeMode;
  onClose: () => void;
}

type TabType = 'downloaded' | 'catalog';

export function PackManager({ theme, onClose }: PackManagerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('downloaded');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    isConnected,
    isRegistered,
    packs,
    catalog,
    refreshPacks,
    refreshCatalog,
    requestPack,
    deletePack,
    sync: _sync,
  } = useLicensingAgent();

  const isDark = theme === 'night';

  // Handle pack download request
  const handleDownload = useCallback(async (region: PackCatalogRegion) => {
    setDownloading(region.slug);
    setError(null);

    try {
      const packId = await requestPack(region.slug, region.available_zoom_levels);
      if (!packId) {
        setError('Failed to request pack download');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  }, [requestPack]);

  // Handle pack deletion
  const handleDelete = useCallback(async (packId: string) => {
    if (!confirm('Are you sure you want to delete this pack? You will need to re-download it to access these charts offline.')) {
      return;
    }

    setDeleting(packId);
    setError(null);

    try {
      const success = await deletePack(packId);
      if (!success) {
        setError('Failed to delete pack');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }, [deletePack]);

  // Styles
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
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '700px',
    width: '100%',
    maxHeight: '80vh',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)',
    color: isDark ? '#ffffff' : '#1a1a1a',
    display: 'flex',
    flexDirection: 'column',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '20px',
    fontWeight: 600,
    margin: 0,
  };

  const tabsStyle: React.CSSProperties = {
    display: 'flex',
    gap: '4px',
    marginBottom: '16px',
    borderBottom: `1px solid ${isDark ? '#404040' : '#e0e0e0'}`,
    paddingBottom: '4px',
  };

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: isActive ? 600 : 400,
    backgroundColor: isActive ? (isDark ? '#333' : '#f0f0f0') : 'transparent',
    color: isActive ? (isDark ? '#fff' : '#000') : (isDark ? '#888' : '#666'),
    border: 'none',
    borderRadius: '6px 6px 0 0',
    cursor: 'pointer',
  });

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    minHeight: '300px',
  };

  const packCardStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#2a2a2a' : '#f8f8f8',
    border: `1px solid ${isDark ? '#404040' : '#e0e0e0'}`,
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '12px',
  };

  const packTitleStyle: React.CSSProperties = {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '4px',
  };

  const packMetaStyle: React.CSSProperties = {
    fontSize: '13px',
    color: isDark ? '#888' : '#666',
    marginBottom: '8px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    backgroundColor: '#0066cc',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  };

  const dangerButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#dc2626',
  };

  const closeButtonStyle: React.CSSProperties = {
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: isDark ? '#888' : '#666',
    cursor: 'pointer',
    fontSize: '20px',
  };

  const statusBadgeStyle = (status: string): React.CSSProperties => {
    const colors: Record<string, { bg: string; text: string }> = {
      ready: { bg: '#22c55e', text: '#fff' },
      downloading: { bg: '#f59e0b', text: '#fff' },
      pending: { bg: '#3b82f6', text: '#fff' },
      expired: { bg: '#ef4444', text: '#fff' },
      error: { bg: '#dc2626', text: '#fff' },
    };
    const color = colors[status] || { bg: '#888', text: '#fff' };

    return {
      display: 'inline-block',
      padding: '2px 8px',
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase',
      backgroundColor: color.bg,
      color: color.text,
      borderRadius: '4px',
      marginLeft: '8px',
    };
  };

  const errorStyle: React.CSSProperties = {
    backgroundColor: '#ff4444',
    color: '#ffffff',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '14px',
  };

  const emptyStateStyle: React.CSSProperties = {
    textAlign: 'center',
    padding: '48px 24px',
    color: isDark ? '#888' : '#666',
  };

  // Check if region is already downloaded
  const isRegionDownloaded = (slug: string): boolean => {
    return packs.some(p => p.region_slug === slug && ['pending', 'downloading', 'ready'].includes(p.status));
  };

  // Not connected view
  if (!isConnected || !isRegistered) {
    return (
      <div style={modalStyle} onClick={onClose}>
        <div style={contentStyle} onClick={e => e.stopPropagation()}>
          <div style={headerStyle}>
            <h2 style={titleStyle}>Offline Packs</h2>
            <button onClick={onClose} style={closeButtonStyle}>&times;</button>
          </div>

          <div style={emptyStateStyle}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📡</div>
            <h3 style={{ margin: '0 0 8px 0' }}>
              {!isConnected ? 'Not Connected' : 'Not Registered'}
            </h3>
            <p style={{ margin: 0 }}>
              {!isConnected
                ? 'Unable to connect to the Licensing Agent. Please ensure the service is running.'
                : 'Please register this device to access offline packs.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render pack card
  const renderPackCard = (pack: PackInfo) => {
    const expired = isExpired(pack.expires_at);
    const daysLeft = daysUntilExpiry(pack.expires_at);

    return (
      <div key={pack.id} style={packCardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={packTitleStyle}>
              {pack.name}
              <span style={statusBadgeStyle(pack.status)}>{pack.status}</span>
            </div>
            <div style={packMetaStyle}>
              {pack.tile_count && <span>{pack.tile_count.toLocaleString()} tiles</span>}
              {pack.size_bytes && <span> &bull; {formatBytes(pack.size_bytes)}</span>}
            </div>
            <div style={{ fontSize: '12px', color: expired ? '#ef4444' : (isDark ? '#888' : '#666') }}>
              {expired
                ? 'Expired'
                : daysLeft <= 7
                  ? `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
                  : `Valid until ${new Date(pack.expires_at).toLocaleDateString()}`}
            </div>
          </div>

          {pack.status === 'ready' && (
            <button
              onClick={() => handleDelete(pack.id)}
              disabled={deleting === pack.id}
              style={{
                ...dangerButtonStyle,
                opacity: deleting === pack.id ? 0.6 : 1,
              }}
            >
              {deleting === pack.id ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    );
  };

  // Render catalog card
  const renderCatalogCard = (region: PackCatalogRegion) => {
    const downloaded = isRegionDownloaded(region.slug);

    return (
      <div key={region.id} style={packCardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={packTitleStyle}>{region.name}</div>
            {region.description && (
              <div style={packMetaStyle}>{region.description}</div>
            )}
            <div style={{ fontSize: '12px', color: isDark ? '#888' : '#666' }}>
              {region.estimated_size_bytes && (
                <span>~{formatBytes(region.estimated_size_bytes)}</span>
              )}
              <span> &bull; Zoom {Math.min(...region.available_zoom_levels)}-{Math.max(...region.available_zoom_levels)}</span>
              <span> &bull; {region.provider}</span>
            </div>
          </div>

          {downloaded ? (
            <span style={{
              padding: '8px 16px',
              fontSize: '13px',
              color: '#22c55e',
              fontWeight: 500,
            }}>
              Downloaded
            </span>
          ) : (
            <button
              onClick={() => handleDownload(region)}
              disabled={downloading === region.slug}
              style={{
                ...buttonStyle,
                opacity: downloading === region.slug ? 0.6 : 1,
              }}
            >
              {downloading === region.slug ? 'Requesting...' : 'Download'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={contentStyle} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>Offline Packs</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => { refreshPacks(); refreshCatalog(); }}
              style={{
                ...buttonStyle,
                backgroundColor: 'transparent',
                border: `1px solid ${isDark ? '#404040' : '#d0d0d0'}`,
                color: isDark ? '#888' : '#666',
              }}
            >
              Refresh
            </button>
            <button onClick={onClose} style={closeButtonStyle}>&times;</button>
          </div>
        </div>

        {error && (
          <div style={errorStyle}>{error}</div>
        )}

        <div style={tabsStyle}>
          <button
            style={tabStyle(activeTab === 'downloaded')}
            onClick={() => setActiveTab('downloaded')}
          >
            Downloaded ({packs.filter(p => p.status === 'ready').length})
          </button>
          <button
            style={tabStyle(activeTab === 'catalog')}
            onClick={() => setActiveTab('catalog')}
          >
            Available ({catalog.length})
          </button>
        </div>

        <div style={listStyle}>
          {activeTab === 'downloaded' ? (
            packs.length > 0 ? (
              packs.map(renderPackCard)
            ) : (
              <div style={emptyStateStyle}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📦</div>
                <h3 style={{ margin: '0 0 8px 0' }}>No Packs Downloaded</h3>
                <p style={{ margin: 0 }}>
                  Switch to the "Available" tab to browse and download offline chart packs.
                </p>
              </div>
            )
          ) : (
            catalog.length > 0 ? (
              catalog.map(renderCatalogCard)
            ) : (
              <div style={emptyStateStyle}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌍</div>
                <h3 style={{ margin: '0 0 8px 0' }}>No Regions Available</h3>
                <p style={{ margin: 0 }}>
                  Unable to load pack catalog. Please check your connection and try refreshing.
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default PackManager;
