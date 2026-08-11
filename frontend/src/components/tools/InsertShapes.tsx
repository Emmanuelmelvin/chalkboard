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
  Puzzle,
  Crown,
} from 'lucide-react';


import type { ShapeType } from '@/types';
import PluginIcon from '@/components/svg/PluginIcons';
import type { PluginManifest } from '@/plugins/types';

interface InsertShapesProps {
  onInsertShape: (shape: ShapeType) => void;
  pluginManifests: PluginManifest[];
  onOpenPlugin: (pluginId: string) => void;
  onClose: () => void;
  /** Initial active tab when opening the modal */
  initialTab?: 'shapes' | 'plugins';
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
  initialTab = 'shapes',
}) => {
  const [activeTab, setActiveTab] = useState<'shapes' | 'plugins'>(initialTab);

  const [pluginSearch, setPluginSearch] = useState('');

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
                    className={`insert-plugin-card${plugin.locked ? ' is-pro-locked' : ''}`}
                    disabled={plugin.id === 'chalkboard.tag' && !hasSelection}
                    onClick={() => { if (plugin.id !== 'chalkboard.tag' || hasSelection) onOpenPlugin(plugin.id); }}
                    title={plugin.locked ? `${plugin.name} — Pro plugin, upgrade to use` : plugin.description}
                  >
                    {plugin.locked && (
                      <span className="insert-plugin-pro-badge" aria-label="Pro plugin">
                        <Crown size={9} /> PRO
                      </span>
                    )}
                    <span className="insert-plugin-logo">{plugin.logoUrl ? <img src={plugin.logoUrl} alt="" /> : <PluginIcon pluginId={plugin.id} fallback={plugin.name.slice(0, 1)} />}</span>
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
      </div>

    </div>
  );
};

export default InsertShapes;
