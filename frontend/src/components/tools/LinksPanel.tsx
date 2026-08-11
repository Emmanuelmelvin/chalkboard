import React, { useState } from 'react';
import { Link, Plus, Check, Edit3, Trash2, X } from 'lucide-react';
import type { SavedLink } from '@/types';

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

  const handleStartRename = (link: SavedLink) => {
    setEditingLinkId(link.id);
    setEditTag(link.tag);
  };

  const handleFinishRename = () => {
    const tag = editTag.trim();
    if (editingLinkId && tag) {
      onRenameLink(editingLinkId, tag);
    }
    setEditingLinkId(null);
    setEditTag('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishRename();
    } else if (e.key === 'Escape') {
      setEditingLinkId(null);
      setEditTag('');
    }
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateLink();
    } else if (e.key === 'Escape') {
      setShowCreateInput(false);
      setNewTag('');
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
          <button
            className="insert-links-add-btn"
            disabled={!hasSelection}
            onClick={() => setShowCreateInput(true)}
            title={hasSelection ? 'Create a link from the current selection' : 'Select something on the canvas first'}
          >
            <Plus size={14} />
            <span>Add Link</span>
          </button>
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
            <button
              className="insert-links-confirm-btn"
              onClick={handleCreateLink}
              disabled={!newTag.trim()}
              title="Save link"
            >
              <Check size={14} />
            </button>
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
                    <button
                      className="insert-links-confirm-btn"
                      onClick={handleFinishRename}
                      disabled={!editTag.trim()}
                      title="Save"
                    >
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="insert-links-item-btn"
                      onClick={() => onNavigateToLink(link)}
                      title={`Navigate to "${link.tag}"`}
                    >
                      <Link size={14} />
                      <span className="insert-links-item-tag">{link.tag}</span>
                    </button>
                    <div className="insert-links-item-actions">
                      <button
                        className="insert-links-action-btn"
                        onClick={() => handleStartRename(link)}
                        title="Rename"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        className="insert-links-action-btn danger"
                        onClick={() => onDeleteLink(link.id)}
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
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
