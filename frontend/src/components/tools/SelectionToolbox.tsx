import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Slider from '@radix-ui/react-slider';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  Trash2,
  X,
  Minus,
  Plus,
  Copy,
  CopyPlus,
  Scissors,
  Crop,
  Frame,
  Group,
  Ungroup,
  RotateCw,
  RotateCcw,
  Undo2,
  Palette,
  Brush,
  PenLine,
  PaintBucket,
  Check,
} from 'lucide-react';
import { CHALK_COLORS } from '@/components/tools/ColorPicker';

interface SelectionToolboxProps {
  /** Canvas-space X of the horizontal center of the transform box in screen coords */
  boxScreenCenterX: number;
  /** Canvas-space Y of the top edge of the transform box in screen coords */
  boxScreenTop: number;
  /** Canvas-space Y of the bottom edge of the transform box in screen coords */
  boxScreenBottom: number;
  activeColor: string;
  activeFillColor?: string;
  onColorChange: (color: string) => void;
  onFillColorChange?: (fillColor: string) => void;
  onDelete: () => void;
  onDeselect: () => void;
  onIncreaseSize: () => void;
  onDecreaseSize: () => void;
  onSetSize: (size: number) => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onCut: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  /** Rotate callback: angle in degrees */
  onRotate?: (angleDeg: number) => void;
  /** Reset rotation to 0 */
  onResetRotation?: () => void;
  /** Set dimensions (width, height) */
  onSetDimensions?: (width: number, height: number) => void;
  /** Trim callback */
  onTrim?: () => void;
  onResetTrim?: () => void;
  /** Current rotation angle in degrees */
  currentRotation?: number;
  /** Current stroke size of the selection */
  currentSize?: number;
  /** Current bounding box dimensions */
  currentWidth?: number;
  currentHeight?: number;
  /** Number of selected strokes */
  selectedCount: number;
  /** Whether the selected strokes are already grouped */
  isGrouped: boolean;
}

const BAR_GAP = 12; // gap between the selection box and the toolbar
const BAR_PADDING = 4;
const BAR_EDGE_MARGIN = 8; // keep the bar on-screen

const SelectionToolbox: React.FC<SelectionToolboxProps> = ({
  boxScreenCenterX,
  boxScreenTop,
  boxScreenBottom,
  activeColor,
  activeFillColor = 'transparent',
  onColorChange,
  onFillColorChange,
  onDelete,
  onDeselect,
  onIncreaseSize,
  onDecreaseSize,
  onSetSize,
  onCopy,
  onDuplicate,
  onCut,
  onGroup,
  onUngroup,
  onRotate,
  onResetRotation,
  onSetDimensions,
  onTrim,
  onResetTrim,
  currentRotation = 0,
  currentSize = 8,
  currentWidth = 0,
  currentHeight = 0,
  selectedCount,
  isGrouped,
}) => {
  const [colorMode, setColorMode] = useState<'stroke' | 'fill'>('stroke');
  const [brushSize, setBrushSize] = useState<number>(currentSize);
  const [dimW, setDimW] = useState<string>(String(Math.round(currentWidth)));
  const [dimH, setDimH] = useState<string>(String(Math.round(currentHeight)));
  const [customAngle, setCustomAngle] = useState<number>(currentRotation);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barSize, setBarSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Sync size when the selection's stroke size changes
  useEffect(() => {
    const timer = window.setTimeout(() => setBrushSize(currentSize), 0);
    return () => window.clearTimeout(timer);
  }, [currentSize]);

  // Sync custom-angle slider with external rotation changes (rotate handles, presets)
  useEffect(() => {
    const timer = window.setTimeout(() => setCustomAngle(Math.max(-180, Math.min(180, currentRotation))), 0);
    return () => window.clearTimeout(timer);
  }, [currentRotation]);

  // Sync dimension inputs when currentWidth/currentHeight change
  useEffect(() => {
    const timer = window.setTimeout(() => setDimW(String(Math.round(currentWidth))), 0);
    return () => window.clearTimeout(timer);
  }, [currentWidth]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDimH(String(Math.round(currentHeight))), 0);
    return () => window.clearTimeout(timer);
  }, [currentHeight]);

  // Measure the bar so we can center it over the selection and clamp it on-screen
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setBarSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Place the bar above the selection; flip below when there is no room on top.
  const rawTop = boxScreenTop - barSize.h - BAR_GAP;
  const placeBelow = rawTop < BAR_EDGE_MARGIN;
  const barY = placeBelow
    ? boxScreenBottom + BAR_GAP
    : rawTop;
  const rawLeft = boxScreenCenterX - barSize.w / 2;
  const barX = Math.max(BAR_EDGE_MARGIN, Math.min(rawLeft, window.innerWidth - barSize.w - BAR_EDGE_MARGIN));

  const handleDimWChange = (val: string) => {
    setDimW(val);
  };

  const handleDimHChange = (val: string) => {
    setDimH(val);
  };

  const commitDimW = () => {
    const num = parseInt(dimW, 10);
    if (!isNaN(num) && num > 0) {
      onSetDimensions?.(num, parseInt(dimH, 10) || currentHeight);
    } else {
      setDimW(String(Math.round(currentWidth)));
    }
  };

  const commitDimH = () => {
    const num = parseInt(dimH, 10);
    if (!isNaN(num) && num > 0) {
      onSetDimensions?.(parseInt(dimW, 10) || currentWidth, num);
    } else {
      setDimH(String(Math.round(currentHeight)));
    }
  };

  const dropdownContentProps = {
    side: 'top' as const,
    collisionPadding: 12,
  };

  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={0}>
      <div
        className="selection-toolbox"
        data-panel-x={barX}
        data-panel-y={barY}
      >
        <div ref={barRef} className="sel-bar" style={{ padding: BAR_PADDING }}>
          {/* ── Color ── */}
          <DropdownMenu.Root modal={false}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="sel-bar-btn" aria-label="Color" title="">
                    <Palette size={16} />
                    <span className="sel-bar-color-dot" data-color={activeColor} />
                  </button>
                </DropdownMenu.Trigger>
              </Tooltip.Trigger>
              <Tooltip.Content className="sel-tooltip" sideOffset={6}>
                Color
                <Tooltip.Arrow className="sel-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Root>
            <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
              <p className="sel-subpanel-title">Color</p>
              <ToggleGroup.Root
                type="single"
                value={colorMode}
                onValueChange={(v) => { if (v) setColorMode(v as 'stroke' | 'fill'); }}
                className="sel-color-mode-toggle"
              >
                <ToggleGroup.Item value="stroke" className="sel-color-mode-button" title="Stroke color">
                  <PenLine size={12} />
                  Stroke
                </ToggleGroup.Item>
                <ToggleGroup.Item value="fill" className="sel-color-mode-button" title="Fill color">
                  <PaintBucket size={12} />
                  Fill
                </ToggleGroup.Item>
              </ToggleGroup.Root>
              <input
                type="color"
                value={colorMode === 'stroke' ? activeColor : activeFillColor === 'transparent' ? '#ffffff' : activeFillColor}
                onChange={(e) => {
                  if (colorMode === 'stroke') {
                    onColorChange(e.target.value);
                  } else {
                    onFillColorChange?.(e.target.value);
                  }
                }}
                title="Custom Color"
                className="native-color-picker sel-native-color-picker"
              />
              <ToggleGroup.Root
                type="single"
                className="sel-swatch-grid"
                value={(colorMode === 'stroke' ? activeColor : activeFillColor).toLowerCase()}
                onValueChange={(value) => {
                  if (!value) return;
                  if (colorMode === 'stroke') {
                    onColorChange(value);
                  } else {
                    onFillColorChange?.(value);
                  }
                }}
              >
                {CHALK_COLORS.map((c) => {
                  const selected = (colorMode === 'stroke' ? activeColor : activeFillColor).toLowerCase() === c.value;
                  return (
                    <ToggleGroup.Item
                      key={c.name}
                      value={c.value}
                      title={c.name}
                      className={`sel-swatch sel-swatch-${c.name} ${selected ? 'sel-swatch-active' : ''}`}
                    >
                      {selected && <Check size={12} strokeWidth={3} className="sel-swatch-check" />}
                    </ToggleGroup.Item>
                  );
                })}
              </ToggleGroup.Root>
              {colorMode === 'fill' && (
                <button
                  type="button"
                  className="sel-toolbox-row sel-action-row sel-transparent-fill-button"
                  onClick={() => onFillColorChange?.('transparent')}
                >
                  <span className="sel-small-label">No Fill (Transparent)</span>
                </button>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          {/* ── Size ── */}
          <DropdownMenu.Root modal={false}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="sel-bar-btn" aria-label="Stroke size" title="">
                    <Brush size={16} />
                  </button>
                </DropdownMenu.Trigger>
              </Tooltip.Trigger>
              <Tooltip.Content className="sel-tooltip" sideOffset={6}>
                Size
                <Tooltip.Arrow className="sel-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Root>
            <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
              <p className="sel-subpanel-title">Stroke Size</p>
              <div className="sel-size-preview">
                <div
                  className="sel-size-dot"
                  data-size={Math.min(brushSize * 3, 48)}
                />
                <span className="sel-size-value">{Math.round(brushSize)}</span>
              </div>
              <Slider.Root
                className="sel-slider"
                min={1}
                max={100}
                step={1}
                value={[brushSize]}
                onValueChange={([v]) => {
                  setBrushSize(v);
                  onSetSize(v);
                }}
              >
                <Slider.Track className="sel-slider-track">
                  <Slider.Range className="sel-slider-range" />
                </Slider.Track>
                <Slider.Thumb className="sel-slider-thumb" aria-label="Stroke size" />
              </Slider.Root>
              <div className="sel-size-stepper">
                <button
                  type="button"
                  className="sel-size-btn"
                  title="Decrease ([ )"
                  onClick={onDecreaseSize}
                >
                  <Minus size={14} />
                </button>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={brushSize}
                  className="number-input sel-size-number"
                  onChange={(e) => {
                    const v = Math.min(100, Math.max(1, Number(e.target.value)));
                    setBrushSize(v);
                    onSetSize(v);
                  }}
                />
                <button
                  type="button"
                  className="sel-size-btn"
                  title="Increase (] )"
                  onClick={onIncreaseSize}
                >
                  <Plus size={14} />
                </button>
              </div>
              <p className="sel-size-hint">Use <kbd className="sel-kbd">[ ]</kbd> keys to change size</p>
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          {/* ── Dimensions ── */}
          <DropdownMenu.Root modal={false}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="sel-bar-btn" aria-label="Dimensions" title="">
                    <Frame size={16} />
                  </button>
                </DropdownMenu.Trigger>
              </Tooltip.Trigger>
              <Tooltip.Content className="sel-tooltip" sideOffset={6}>
                Dimensions
                <Tooltip.Arrow className="sel-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Root>
            <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
              <p className="sel-subpanel-title">Dimensions</p>
              <div className="sel-dimensions-fields">
                <div className="sel-dimension-field">
                  <label>W</label>
                  <input
                    type="number"
                    min={1}
                    value={dimW}
                    className="number-input sel-dimension-input"
                    onChange={(e) => handleDimWChange(e.target.value)}
                    onBlur={commitDimW}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                </div>
                <div className="sel-dimension-field">
                  <label>H</label>
                  <input
                    type="number"
                    min={1}
                    value={dimH}
                    className="number-input sel-dimension-input"
                    onChange={(e) => handleDimHChange(e.target.value)}
                    onBlur={commitDimH}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                </div>
              </div>
              <p className="sel-size-hint sel-size-hint-spaced">
                Set exact width & height
              </p>
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          {/* ── Rotate ── */}
          <DropdownMenu.Root modal={false}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="sel-bar-btn" aria-label="Rotate" title="">
                    <RotateCw size={16} />
                    {currentRotation !== 0 && (
                      <span className="sel-bar-badge">{Math.round(currentRotation)}°</span>
                    )}
                  </button>
                </DropdownMenu.Trigger>
              </Tooltip.Trigger>
              <Tooltip.Content className="sel-tooltip" sideOffset={6}>
                Rotate
                <Tooltip.Arrow className="sel-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Root>
            <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
              <p className="sel-subpanel-title">
                Rotate
                <span className="sel-rotation-value sel-rotation-value-inline">
                  {Math.round(currentRotation)}°
                </span>
              </p>
              <div className="sel-rotate-presets" role="group" aria-label="Rotation presets">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  title="Rotate 45° counter-clockwise"
                  onClick={() => onRotate?.(-45)}
                >
                  <RotateCcw size={13} />
                  45°
                </button>
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  title="Rotate 90° counter-clockwise (Ctrl+[)"
                  onClick={() => onRotate?.(-90)}
                >
                  <RotateCcw size={13} />
                  90°
                </button>
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  title="Rotate 180°"
                  onClick={() => onRotate?.(180)}
                >
                  <RotateCw size={13} />
                  180°
                </button>
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  title="Rotate 90° clockwise (Ctrl+])"
                  onClick={() => onRotate?.(90)}
                >
                  <RotateCw size={13} />
                  90°
                </button>
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  title="Rotate 45° clockwise"
                  onClick={() => onRotate?.(45)}
                >
                  <RotateCw size={13} />
                  45°
                </button>
              </div>
              <Slider.Root
                className="sel-slider"
                min={-180}
                max={180}
                step={1}
                value={[customAngle]}
                onValueChange={([v]) => {
                  const delta = v - customAngle;
                  setCustomAngle(v);
                  if (delta !== 0) onRotate?.(delta);
                }}
              >
                <Slider.Track className="sel-slider-track">
                  <Slider.Range className="sel-slider-range" />
                </Slider.Track>
                <Slider.Thumb className="sel-slider-thumb" aria-label="Rotation angle" />
              </Slider.Root>
              <div className="sel-rotate-labels">
                <span>-180°</span>
                <span className="sel-rotate-current">{Math.round(customAngle)}°</span>
                <span>180°</span>
              </div>
              <div className="sel-divider sel-divider-spaced" />
              <button
                type="button"
                className="sel-toolbox-row sel-action-row sel-wide-action"
                onClick={onResetRotation}
              >
                <Undo2 size={14} className="sel-action-icon" />
                Reset Rotation
                <kbd className="sel-kbd sel-kbd-auto">Ctrl+Shift+R</kbd>
              </button>
              <p className="sel-size-hint sel-size-hint-spaced">Or drag the rotate handle below selection</p>
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          {/* ── Crop ── */}
          <DropdownMenu.Root modal={false}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="sel-bar-btn" aria-label="Crop" title="">
                    <Crop size={16} />
                  </button>
                </DropdownMenu.Trigger>
              </Tooltip.Trigger>
              <Tooltip.Content className="sel-tooltip" sideOffset={6}>
                Crop
                <Tooltip.Arrow className="sel-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Root>
            <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
              <p className="sel-subpanel-title">Crop</p>
              <div className="sel-rotate-actions">
                <button
                  type="button"
                  className="sel-toolbox-row sel-action-row sel-wide-action"
                  onClick={() => onTrim?.()}
                >
                  <Crop size={14} className="sel-action-icon" />
                  Crop Selection
                </button>
                <button
                  type="button"
                  className="sel-toolbox-row sel-action-row sel-wide-action"
                  onClick={() => onResetTrim?.()}
                >
                  <Undo2 size={14} className="sel-action-icon" />
                  Reset Crop
                </button>
              </div>
              <p className="sel-size-hint sel-size-hint-spaced">
                Drag edges to crop, Enter to apply
              </p>
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          <div className="sel-bar-divider" />

          {/* ── Copy / Duplicate / Cut ── */}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Copy (Ctrl+C)" onClick={onCopy}>
                <Copy size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content className="sel-tooltip" sideOffset={6}>
              Copy <kbd className="sel-kbd">Ctrl+C</kbd>
              <Tooltip.Arrow className="sel-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Duplicate (Ctrl+D)" onClick={onDuplicate}>
                <CopyPlus size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content className="sel-tooltip" sideOffset={6}>
              Duplicate <kbd className="sel-kbd">Ctrl+D</kbd>
              <Tooltip.Arrow className="sel-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Cut (Ctrl+X)" onClick={onCut}>
                <Scissors size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content className="sel-tooltip" sideOffset={6}>
              Cut <kbd className="sel-kbd">Ctrl+X</kbd>
              <Tooltip.Arrow className="sel-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Root>

          <div className="sel-bar-divider" />

          {/* ── Group / Ungroup ── */}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className={`sel-bar-btn ${selectedCount < 2 || isGrouped ? 'sel-bar-btn-disabled' : ''}`}
                aria-label="Group (Ctrl+G)"
                disabled={selectedCount < 2 || isGrouped}
                onClick={onGroup}
              >
                <Group size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content className="sel-tooltip" sideOffset={6}>
              Group <kbd className="sel-kbd">Ctrl+G</kbd>
              <Tooltip.Arrow className="sel-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className={`sel-bar-btn ${!isGrouped || selectedCount < 1 ? 'sel-bar-btn-disabled' : ''}`}
                aria-label="Ungroup (Ctrl+Shift+G)"
                disabled={!isGrouped || selectedCount < 1}
                onClick={onUngroup}
              >
                <Ungroup size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content className="sel-tooltip" sideOffset={6}>
              Ungroup <kbd className="sel-kbd">Ctrl+Shift+G</kbd>
              <Tooltip.Arrow className="sel-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Root>

          <div className="sel-bar-divider" />

          {/* ── Delete / Deselect ── */}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button type="button" className="sel-bar-btn sel-bar-btn-danger" aria-label="Delete (Del)" onClick={onDelete}>
                <Trash2 size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content className="sel-tooltip" sideOffset={6}>
              Delete <kbd className="sel-kbd">Del</kbd>
              <Tooltip.Arrow className="sel-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Deselect (Esc)" onClick={onDeselect}>
                <X size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content className="sel-tooltip" sideOffset={6}>
              Deselect <kbd className="sel-kbd">Esc</kbd>
              <Tooltip.Arrow className="sel-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>
    </Tooltip.Provider>
  );
};

export default SelectionToolbox;
