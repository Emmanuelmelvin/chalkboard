import React, { useState } from 'react';
import { Link, Plus, Check, Edit3, Trash2, X } from 'lucide-react';
import type { SavedLink } from '@/types';
import { HoverCard } from '@/components/ui/HoverCard';

interface LinksPanelProps {
  /** Saved links for the current room */
  links: SavedLink[];
  /** Whether something is currently selected on the canvas */
  hasSelection: boolean;
  /** Navigate to a link: center the viewport on the linked strokes */
  onNavigateToLink: (link: SavedLink) => void;
  /** Create a new link from the current selection */
  onCreateLink: (tag: string) => void;
  /** Delete a saved link */
  onDeleteLink: (linkId: string) => void;
  /** Rename a saved link */
  onRenameLink: (linkId: string, newTag: string) => void;
  /** Link ID to highlight in the list */
  highlightedLinkId?: string | null;
  /** Close the panel */
  onClose: () => void;
}

const LinksPanel: React.FC<LinksPanelProps> = ({
  links,
  hasSelection,
  onNavigateToLink,
  onCreateLink,
  onDeleteLink,
  onRenameLink,
  highlightedLinkId,
  onClose,
}) => {
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editTag, setEditTag] = useState('');

  const handleCreateLink = () => {
    const tag = newTag.trim();
    if (!tag) return;
    onCreateLink(tag);
    setNewTag('');
    setShowCreateInput(false);
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleCreateLink();
    if (e.key === 'Escape') {
      setShowCreateInput(false);
      setNewTag('');
    }
  };

  const handleStartRename = (link: SavedLink) => {
    setEditingLinkId(link.id);
    setEditTag(link.tag);
  };

  const handleFinishRename = () => {
    if (!editingLinkId) return;
    const tag = editTag.trim();
    if (tag) onRenameLink(editingLinkId, tag);
    setEditingLinkId(null);
    setEditTag('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleFinishRename();
    if (e.key === 'Escape') {
      setEditingLinkId(null);
      setEditTag('');
    }
  };

  return (
    <div className="links-panel">
      <div className="links-panel-header">
        <h3>Links</h3>
        <button type="button" className="links-panel-close" onClick={onClose} aria-label="Close links">
          <X size={14} />
        </button>
      </div>

      <div className="insert-links-content">
        {/* Add Link button */}
        {!showCreateInput ? (
          <HoverCard
            content={hasSelection ? 'Create a link from current selection' : 'Select something on canvas first'}
            placement="top"
          >
            <button
              className="insert-links-add-btn"
              disabled={!hasSelection}
              onClick={() => setShowCreateInput(true)}
              aria-label="Add Link"
            >
              <Plus size={14} />
              <span>Add Link</span>
            </button>
          </HoverCard>
        ) : (
          <div className="insert-links-input-row">
            <input
              className="insert-links-input"
              type="text"
              placeholder="Enter link tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={handleCreateKeyDown}
              autoFocus
            />
            <HoverCard content="Save link" placement="top">
              <button
                className="insert-links-confirm-btn"
                onClick={handleCreateLink}
                disabled={!newTag.trim()}
                aria-label="Save link"
              >
                <Check size={14} />
              </button>
            </HoverCard>
          </div>
        )}

        {/* Link list */}
        {links.length === 0 ? (
          <div className="insert-links-empty">
            <Link size={24} />
            <p>No links yet. Select something on the canvas and add a link to save it.</p>
          </div>
        ) : (
          <div className="insert-links-list">
            {links.map((link) => (
              <div
                key={link.id}
                className={`insert-links-item ${highlightedLinkId === link.id ? 'insert-links-item-highlighted' : ''}`}
              >
                {editingLinkId === link.id ? (
                  <div className="insert-links-edit-row">
                    <input
                      className="insert-links-input"
                      type="text"
                      value={editTag}
                      onChange={(e) => setEditTag(e.target.value)}
                      onKeyDown={handleRenameKeyDown}
                      autoFocus
                    />
                    <HoverCard content="Save" placement="top">
                      <button
                        className="insert-links-confirm-btn"
                        onClick={handleFinishRename}
                        disabled={!editTag.trim()}
                        aria-label="Save"
                      >
                        <Check size={14} />
                      </button>
                    </HoverCard>
                  </div>
                ) : (
                  <>
                    <HoverCard content={`Navigate to "${link.tag}"`} placement="top">
                      <button
                        className="insert-links-item-btn"
                        onClick={() => onNavigateToLink(link)}
                        aria-label={`Navigate to "${link.tag}"`}
                      >
                        <Link size={14} />
                        <span className="insert-links-item-tag">{link.tag}</span>
                      </button>
                    </HoverCard>
                    <div className="insert-links-item-actions">
                      <HoverCard content="Rename" placement="top">
                        <button
                          className="insert-links-action-btn"
                          onClick={() => handleStartRename(link)}
                          aria-label="Rename"
                        >
                          <Edit3 size={12} />
                        </button>
                      </HoverCard>
                      <HoverCard content="Delete" placement="top">
                        <button
                          className="insert-links-action-btn danger"
                          onClick={() => onDeleteLink(link.id)}
                          aria-label="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </HoverCard>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LinksPanel;
