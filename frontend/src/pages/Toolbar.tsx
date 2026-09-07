import React, { useState } from 'react';
import {
  PenTool,
  Eraser,
  Hand,
  MousePointer2
} from 'lucide-react';
import { HoverCard } from '@/components/ui/HoverCard';
import { Popover } from '@/components/ui/Popover';
import { Slider } from '@/components/ui/Slider';
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
        {/* Chalk/Brush settings — click-triggered Astryx Popover when active */}
        {activeTool === 'chalk' ? (
          <Popover
            isOpen={showChalkSettings}
            onOpenChange={setShowChalkSettings}
            placement="above"
            alignment="center"
            sideOffset={12}
            contentClassName="chalk-settings-flyout"
            content={
              <>
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
              </>
            }
          >
            <button
              type="button"
              className="action-stick active"
              onClick={() => setShowChalkSettings((prev) => !prev)}
              aria-label="Chalk (Ctrl+B)"
            >
              <PenTool size={14} />
            </button>
          </Popover>
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

        {/* Eraser settings — click-triggered Astryx Popover when active */}
        {activeTool === 'eraser' ? (
          <Popover
            isOpen={showEraserSettings}
            onOpenChange={setShowEraserSettings}
            placement="above"
            alignment="center"
            sideOffset={12}
            contentClassName="chalk-settings-flyout eraser-settings-flyout"
            content={
              <>
                <div className="eraser-flyout-header">
                  <span className="eraser-flyout-title">Eraser</span>
                </div>
                <div className="settings-divider" />

                {/* Eraser Preview */}
                <div className="eraser-preview-area">
                  <div
                    className="eraser-preview-rect"
                    data-width={eraserWidth}
                    data-height={eraserHeight}
                    style={{ width: Math.min(eraserWidth, 160), height: Math.min(eraserHeight, 52) }}
                  />
                </div>

                <div className="settings-section">
                  <span className="settings-label">Size — {eraserWidth} × {eraserHeight}px</span>
                  <Slider
                    value={Math.max(5, Math.round(eraserHeight))}
                    onChange={(size) => {
                      const s = Math.max(5, Math.min(120, size));
                      onEraserWidthChange(Math.round(s * 2));
                      onEraserHeightChange(Math.round(s));
                    }}
                    min={5}
                    max={120}
                    step={1}
                    showInput={true}
                    aria-label="Eraser Size"
                  />
                </div>
              </>
            }
          >
            <button
              type="button"
              className="action-stick active"
              onClick={() => setShowEraserSettings((prev) => !prev)}
              aria-label="Eraser (Ctrl+E)"
            >
              <Eraser size={14} />
            </button>
          </Popover>
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
