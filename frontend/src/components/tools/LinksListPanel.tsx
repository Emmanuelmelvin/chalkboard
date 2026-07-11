import React, { useState, useEffect } from 'react';
import { X, Link2, ExternalLink } from 'lucide-react';
import type { CanvasLink } from '@/types';

interface LinksListPanelProps {
  links: CanvasLink[];
  onClose: () => void;
  onNavigateToLink: (link: CanvasLink) => void;
}

const LinksListPanel: React.FC<LinksListPanelProps> = ({ links, onClose, onNavigateToLink }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyLink = (link: CanvasLink) => {
    // Create a link that references the canvas area
    const linkData = {
      type: 'canvas-link',
      linkId: link.id,
      targetBounds: link.targetBounds,
      label: link.label,
    };
    
    const linkString = `${window.location.origin}${window.location.pathname}?room=${new URLSearchParams(window.location.search).get('room')}&link=${link.id}`;
    navigator.clipboard.writeText(linkString);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="links-list-panel">
      <div className="links-list-header">
        <h3>
          <Link2 size={14} />
          Canvas Links ({links.length})
        </h3>
        <button className="links-list-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      
      <div className="links-list-content">
        {links.length === 0 ? (
          <p className="links-list-empty">No links created yet</p>
        ) : (
          links.map((link) => (
            <div key={link.id} className="link-item">
              <div className="link-item-info">
                <Link2 size={12} />
                <span className="link-label">{link.label || `Link ${link.id.slice(-4)}`}</span>
              </div>
              <div className="link-item-actions">
                <button
                  className="link-action-btn"
                  onClick={() => onNavigateToLink(link)}
                  title="Navigate to this area"
                >
                  <ExternalLink size={12} />
                </button>
                <button
                  className="link-action-btn"
                  onClick={() => handleCopyLink(link)}
                  title="Copy link to clipboard"
                >
                  {copiedId === link.id ? '✓' : '📋'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LinksListPanel;