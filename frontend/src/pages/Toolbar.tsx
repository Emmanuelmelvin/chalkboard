import React, { useState, useEffect } from 'react';
import { PenTool, Eraser, Hand, MousePointer2 } from 'lucide-react';
import ColorPicker from '@/components/tools/ColorPicker';
import BrushSize from '@/components/tools/BrushSize';
import BrushIntensity from '@/components/tools/BrushIntensity';

interface ToolbarProps {
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select';
  activeColor: string;
  brushSize: number;
  brushIntensity: number;
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan' | 'select') => void;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onIntensityChange: (intensity: number) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  activeColor,
  brushSize,
  brushIntensity,
  onToolChange,
  onColorChange,
  onBrushSizeChange,
  onIntensityChange,
}) => {
  const [showSettings, setShowSettings] = useState(false);

  // Close settings when tool is switched away from chalk
  useEffect(() => {
    if (activeTool !== 'chalk') {
      setShowSettings(false);
    }
  }, [activeTool]);

  return (
    <div className="bottom-toolbar-container">
      <div className="bottom-toolbar-card">
        {/* Chalk/Brush wrapper to manage hover/click */}
        <div
          className="chalk-tool-wrapper"
          onMouseEnter={() => {
            if (activeTool === 'chalk') {
              setShowSettings(true);
            }
          }}
          onMouseLeave={() => setShowSettings(false)}
          style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
        >
          <button
            type="button"
            className={`action-stick ${activeTool === 'chalk' ? 'active' : ''}`}
            onClick={() => {
              if (activeTool !== 'chalk') {
                onToolChange('chalk');
                setShowSettings(true);
              } else {
                setShowSettings((prev) => !prev);
              }
            }}
            title="Chalk (Ctrl+B / Ctrl+C)"
          >
            <PenTool size={20} />
          </button>

          {showSettings && activeTool === 'chalk' && (
            <div className="chalk-settings-flyout">
              <div className="settings-section">
                <span className="settings-label">Color</span>
                <ColorPicker
                  activeTool={activeTool}
                  activeColor={activeColor}
                  onToolChange={onToolChange}
                  onColorChange={onColorChange}
                />
              </div>
              <div className="settings-divider" />
              <div className="settings-section">
                <span className="settings-label">Size</span>
                <BrushSize brushSize={brushSize} onBrushSizeChange={onBrushSizeChange} />
              </div>
              <div className="settings-divider" />
              <div className="settings-section">
                <span className="settings-label">Intensity</span>
                <BrushIntensity brushIntensity={brushIntensity} onIntensityChange={onIntensityChange} />
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`action-stick ${activeTool === 'eraser' ? 'active' : ''}`}
          onClick={() => {
            onToolChange('eraser');
            setShowSettings(false);
          }}
          title="Eraser (Ctrl+E)"
        >
          <Eraser size={20} />
        </button>

        <button
          type="button"
          className={`action-stick ${activeTool === 'pan' ? 'active' : ''}`}
          onClick={() => {
            onToolChange('pan');
            setShowSettings(false);
          }}
          title="Move Board (Ctrl+H / Ctrl+M)"
        >
          <Hand size={20} />
        </button>

        <button
          type="button"
          className={`action-stick ${activeTool === 'select' ? 'active' : ''}`}
          onClick={() => {
            onToolChange('select');
            setShowSettings(false);
          }}
          title="Select Items (Ctrl+S)"
        >
          <MousePointer2 size={20} />
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
