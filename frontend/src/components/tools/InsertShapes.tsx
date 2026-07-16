import React, { useState } from 'react';
import {
  Square,
  Circle,
  Triangle,
  Minus,
  ArrowRight,
  Hexagon,
  Star,
  Diamond,
  X,
  Pentagon,
  RectangleHorizontal,
  Octagon,
  Heart,
  Plus,
  Shapes,
  Link,
  Puzzle,
  Trash2,
  Edit3,
  Check,
} from 'lucide-react';

import type { ShapeType, SavedLink } from '@/types';
import type { PluginManifest } from '@/plugins/types';

interface InsertShapesProps {
  onInsertShape: (shape: ShapeType) => void;
  pluginManifests: PluginManifest[];
  onOpenPlugin: (pluginId: string) => void;
  onClose: () => void;
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
  /** Initial active tab when opening the modal */
  initialTab?: 'shapes' | 'links' | 'plugins';
  /** Link ID to highlight in the list */
  highlightedLinkId?: string | null;
}

const shapes: { type: ShapeType; label: string; icon: React.ReactNode }[] = [
  { type: 'rectangle', label: 'Rectangle', icon: <RectangleHorizontal size={20} /> },
  { type: 'square', label: 'Square', icon: <Square size={20} /> },
  { type: 'circle', label: 'Circle', icon: <Circle size={20} /> },
  { type: 'triangle', label: 'Triangle', icon: <Triangle size={20} /> },
  { type: 'pentagon', label: 'Pentagon', icon: <Pentagon size={20} /> },
  { type: 'hexagon', label: 'Hexagon', icon: <Hexagon size={20} /> },
  { type: 'heptagon', label: 'Heptagon', icon: <Shapes size={20} /> },
  { type: 'octagon', label: 'Octagon', icon: <Octagon size={20} /> },
  { type: 'nonagon', label: 'Nonagon', icon: <Shapes size={20} /> },
  { type: 'decagon', label: 'Decagon', icon: <Shapes size={20} /> },
  { type: 'star', label: 'Star', icon: <Star size={20} /> },
  { type: 'diamond', label: 'Diamond', icon: <Diamond size={20} /> },
  { type: 'cross', label: 'Cross', icon: <Plus size={20} /> },
  { type: 'heart', label: 'Heart', icon: <Heart size={20} /> },
  { type: 'line', label: 'Line', icon: <Minus size={20} /> },
  { type: 'arrow', label: 'Arrow', icon: <ArrowRight size={20} /> },
];

const InsertShapes: React.FC<InsertShapesProps> = ({
  onInsertShape,
  pluginManifests,
  onOpenPlugin,
  onClose,
  links,
  hasSelection,
  onNavigateToLink,
  onCreateLink,
  onDeleteLink,
  onRenameLink,
  initialTab = 'shapes',
  highlightedLinkId,
}) => {
  const [activeTab, setActiveTab] = useState<'shapes' | 'links' | 'plugins'>(initialTab);


  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editTag, setEditTag] = useState('');
  const [pluginSearch, setPluginSearch] = useState('');

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

  const filteredPlugins = pluginManifests.filter((plugin) => {
    const query = pluginSearch.trim().toLowerCase();
    if (!query) return true;
    return `${plugin.name} ${plugin.description}`.toLowerCase().includes(query);
  });
  return (
    <div className="insert-shapes-overlay" onClick={onClose}>
      <div className="insert-shapes-panel" onClick={(e) => e.stopPropagation()}>
        <div className="insert-shapes-header">
          <h3>Insert</h3>
          <button className="insert-shapes-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="insert-shapes-tabs">
          <button
            className={`insert-shapes-tab ${activeTab === 'shapes' ? 'active' : ''}`}
            onClick={() => setActiveTab('shapes')}
          >
            <Shapes size={14} />
            <span>Shapes</span>
          </button>
          <button
            className={`insert-shapes-tab ${activeTab === 'links' ? 'active' : ''}`}
            onClick={() => setActiveTab('links')}
          >
            <Link size={14} />
            <span>Links</span>
          </button>
          <button
            className={`insert-shapes-tab ${activeTab === 'plugins' ? 'active' : ''}`}
            onClick={() => setActiveTab('plugins')}
          >
            <Puzzle size={14} />
            <span>Plugins</span>
          </button>
        </div>

        {/* Shapes Tab */}
        {activeTab === 'shapes' && (
          <div className="insert-shapes-grid">
            {shapes.map((s) => (
              <button
                key={s.type}
                className="insert-shape-btn"
                onClick={() => onInsertShape(s.type)}
                title={s.label}
              >
                {s.icon}
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Plugins Tab */}
        {activeTab === 'plugins' && (
          <div className="insert-plugins-content">
            <input
              className="insert-links-input"
              type="search"
              placeholder="Search available plugins..."
              value={pluginSearch}
              onChange={(e) => setPluginSearch(e.target.value)}
            />
            {filteredPlugins.length === 0 ? (
              <div className="insert-links-empty">
                <Puzzle size={24} />
                <p>No plugins found.</p>
              </div>
            ) : (
              <div className="insert-plugins-list">
                {filteredPlugins.map((plugin) => (
                  <button
                    key={plugin.id}
                    className="insert-plugin-card"
                    disabled={plugin.id === 'chalkboard.tag' && !hasSelection}
                    onClick={() => { if (plugin.id !== 'chalkboard.tag' || hasSelection) onOpenPlugin(plugin.id); }}
                    title={plugin.description}
                  >
                    <span className="insert-plugin-logo">{plugin.name.slice(0, 1)}</span>
                    <span className="insert-plugin-copy">
                      <strong>{plugin.name}</strong>
                      <small>{plugin.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Links Tab */}
        {activeTab === 'links' && (
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
        )}
      </div>

    </div>
  );
};

export default InsertShapes;
