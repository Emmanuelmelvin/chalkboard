import React, { useState } from 'react';
import {
  PenTool,
  Eraser,
  Hand,
  MousePointer2
} from 'lucide-react';
import { HoverCard } from '@/components/ui/HoverCard';
import ColorPicker from '@/components/tools/ColorPicker';
import BrushSize from '@/components/tools/BrushSize';
import BrushIntensity from '@/components/tools/BrushIntensity';
import type { ToolbarProps } from '@/types';

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  activeColor,
  brushSize,
  brushIntensity,
  eraserWidth,
  eraserHeight,
  onToolChange,
  onColorChange,
  onBrushSizeChange,
  onIntensityChange,
  onEraserWidthChange,
  onEraserHeightChange,
}) => {
  const [showChalkSettings, setShowChalkSettings] = useState(false);
  const [showEraserSettings, setShowEraserSettings] = useState(false);

  const [prevActiveTool, setPrevActiveTool] = useState(activeTool);

  if (activeTool !== prevActiveTool) {
    setPrevActiveTool(activeTool);
    if (activeTool !== 'chalk') {
      setShowChalkSettings(false);
    }
    if (activeTool !== 'eraser') {
      setShowEraserSettings(false);
    }
  }

  return (
    <div className="bottom-toolbar-container">
      <div className="bottom-toolbar-card">
        {/* Chalk/Brush settings — opens on hover while chalk is active */}
        {activeTool === 'chalk' ? (
          <HoverCard.Root
            open={showChalkSettings}
            onOpenChange={setShowChalkSettings}
            openDelay={0}
            closeDelay={100}
          >
            <HoverCard.Trigger asChild>
              <button
                type="button"
                className="action-stick active"
                onClick={() => setShowChalkSettings((prev) => !prev)}
                aria-label="Chalk (Ctrl+B)"
              >
                <PenTool size={14} />
              </button>
            </HoverCard.Trigger>

            <HoverCard.Content className="chalk-settings-flyout" side="top" sideOffset={12} align="center">
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
              <HoverCard.Arrow className="chalk-settings-arrow" width={12} height={6} />
            </HoverCard.Content>
          </HoverCard.Root>
        ) : (
          <HoverCard content="Chalk (Ctrl+B)" placement="above" sideOffset={12}>
            <button
              type="button"
              className="action-stick"
              onClick={() => {
                onToolChange('chalk');
                setShowChalkSettings(true);
              }}
              aria-label="Chalk (Ctrl+B)"
            >
              <PenTool size={14} />
            </button>
          </HoverCard>
        )}

        {/* Eraser settings — opens on hover while eraser is active */}
        {activeTool === 'eraser' ? (
          <HoverCard.Root
            open={showEraserSettings}
            onOpenChange={setShowEraserSettings}
            openDelay={0}
            closeDelay={100}
          >
            <HoverCard.Trigger asChild>
              <button
                type="button"
                className="action-stick active"
                onClick={() => setShowEraserSettings((prev) => !prev)}
                aria-label="Eraser (Ctrl+E)"
              >
                <Eraser size={14} />
              </button>
            </HoverCard.Trigger>

            <HoverCard.Content className="chalk-settings-flyout eraser-settings-flyout" side="top" sideOffset={12} align="center">
              <div className="eraser-flyout-header">
                <span className="eraser-flyout-icon">⬜</span>
                <span className="eraser-flyout-title">Eraser Size</span>
              </div>
              <div className="settings-divider" />

              {/* Eraser Preview */}
              <div className="eraser-preview-area">
                <div
                  className="eraser-preview-rect"
                  data-width={Math.min(eraserWidth, 200)}
                  data-height={Math.min(eraserHeight, 60)}
                  style={{ width: Math.min(eraserWidth, 200), height: Math.min(eraserHeight, 60) }}
                />
              </div>

              <div className="settings-section">
                <span className="settings-label">Width — {eraserWidth}px</span>
                <div className="slider-container">
                  <input
                    type="range"
                    className="slider-input"
                    min={10}
                    max={300}
                    step={5}
                    value={eraserWidth}
                    onChange={(e) => onEraserWidthChange(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    className="number-input"
                    min={10}
                    max={300}
                    value={eraserWidth}
                    onChange={(e) => {
                      const v = Math.min(300, Math.max(10, Number(e.target.value)));
                      onEraserWidthChange(v);
                    }}
                  />
                </div>
              </div>
              <div className="settings-divider" />
              <div className="settings-section">
                <span className="settings-label">Height — {eraserHeight}px</span>
                <div className="slider-container">
                  <input
                    type="range"
                    className="slider-input"
                    min={10}
                    max={200}
                    step={5}
                    value={eraserHeight}
                    onChange={(e) => onEraserHeightChange(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    className="number-input"
                    min={10}
                    max={200}
                    value={eraserHeight}
                    onChange={(e) => {
                      const v = Math.min(200, Math.max(10, Number(e.target.value)));
                      onEraserHeightChange(v);
                    }}
                  />
                </div>
              </div>
              <HoverCard.Arrow className="chalk-settings-arrow" width={12} height={6} />
            </HoverCard.Content>
          </HoverCard.Root>
        ) : (
          <HoverCard content="Eraser (Ctrl+E)" placement="above" sideOffset={12}>
            <button
              type="button"
              className="action-stick"
              onClick={() => {
                onToolChange('eraser');
                setShowEraserSettings(true);
              }}
              aria-label="Eraser (Ctrl+E)"
            >
              <Eraser size={14} />
            </button>
          </HoverCard>
        )}

        <HoverCard content="Move Board (Ctrl+H / Ctrl+M)" placement="above" sideOffset={12}>
          <button
            type="button"
            className={`action-stick ${activeTool === 'pan' ? 'active' : ''}`}
            onClick={() => {
              onToolChange('pan');
              setShowChalkSettings(false);
              setShowEraserSettings(false);
            }}
            aria-label="Move Board"
          >
            <Hand size={14} />
          </button>
        </HoverCard>

        <HoverCard content="Select Items (Ctrl+S)" placement="above" sideOffset={12}>
          <button
            type="button"
            className={`action-stick ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => {
              onToolChange('select');
              setShowChalkSettings(false);
              setShowEraserSettings(false);
            }}
            aria-label="Select Items"
          >
            <MousePointer2 size={14} />
          </button>
        </HoverCard>
      </div>
    </div>
  );
};

export default Toolbar;
