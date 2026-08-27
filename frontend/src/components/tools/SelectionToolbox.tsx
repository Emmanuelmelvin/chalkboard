import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
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
import { HoverCard } from '@/components/ui/HoverCard';

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
  const barRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(360);
  const [barHeight, setBarHeight] = useState(44);
  const [colorMode, setColorMode] = useState<'stroke' | 'fill'>('stroke');
  const [brushSize, setBrushSize] = useState(currentSize);
  const [customAngle, setCustomAngle] = useState(currentRotation);
  const [dimW, setDimW] = useState(Math.round(currentWidth));
  const [dimH, setDimH] = useState(Math.round(currentHeight));

  // Sync internal states with incoming props
  useEffect(() => {
    setBrushSize(currentSize);
  }, [currentSize]);

  useEffect(() => {
    setCustomAngle(currentRotation);
  }, [currentRotation]);

  useEffect(() => {
    setDimW(Math.round(currentWidth));
    setDimH(Math.round(currentHeight));
  }, [currentWidth, currentHeight]);

  // Measure bar size once rendered
  useLayoutEffect(() => {
    if (barRef.current) {
      const rect = barRef.current.getBoundingClientRect();
      if (rect.width > 0) setBarWidth(rect.width);
      if (rect.height > 0) setBarHeight(rect.height);
    }
  });

  // Calculate screen-space position: centered horizontally above the selection box.
  // If too close to the top of the viewport, place below the selection box instead.
  const idealX = boxScreenCenterX - barWidth / 2;
  const clampedX = Math.max(
    BAR_EDGE_MARGIN,
    Math.min(window.innerWidth - barWidth - BAR_EDGE_MARGIN, idealX)
  );

  const placeAbove = boxScreenTop - barHeight - BAR_GAP >= BAR_EDGE_MARGIN;
  const idealY = placeAbove
    ? boxScreenTop - barHeight - BAR_GAP
    : boxScreenBottom + BAR_GAP;
  const clampedY = Math.max(
    BAR_EDGE_MARGIN,
    Math.min(window.innerHeight - barHeight - BAR_EDGE_MARGIN, idealY)
  );

  const barX = Math.round(clampedX);
  const barY = Math.round(clampedY);

  const handleDimWChange = (val: string) => {
    const num = Math.max(1, parseInt(val, 10) || 0);
    setDimW(num);
  };

  const handleDimHChange = (val: string) => {
    const num = Math.max(1, parseInt(val, 10) || 0);
    setDimH(num);
  };

  const commitDimW = () => {
    if (dimW > 0 && dimH > 0 && onSetDimensions) {
      onSetDimensions(dimW, dimH);
    }
  };

  const commitDimH = () => {
    if (dimW > 0 && dimH > 0 && onSetDimensions) {
      onSetDimensions(dimW, dimH);
    }
  };

  const dropdownContentProps = {
    side: 'top' as const,
    collisionPadding: 12,
  };

  return (
    <div
      className="selection-toolbox"
      data-panel-x={barX}
      data-panel-y={barY}
      style={{ left: barX, top: barY }}
    >
      <div ref={barRef} className="sel-bar" style={{ padding: BAR_PADDING }}>
        {/* ── Color ── */}
        <DropdownMenu.Root modal={false}>
          <HoverCard content="Color" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Color">
                <Palette size={16} />
                <span className="sel-bar-color-dot" data-color={activeColor} style={{ background: activeColor }} />
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
          <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
            <p className="sel-subpanel-title">Color</p>
            <ToggleGroup.Root
              type="single"
              value={colorMode}
              onValueChange={(v) => { if (v) setColorMode(v as 'stroke' | 'fill'); }}
              className="sel-color-mode-toggle"
            >
              <HoverCard content="Stroke color" placement="top">
                <ToggleGroup.Item value="stroke" className="sel-color-mode-button" aria-label="Stroke color">
                  <PenLine size={12} />
                  Stroke
                </ToggleGroup.Item>
              </HoverCard>
              <HoverCard content="Fill color" placement="top">
                <ToggleGroup.Item value="fill" className="sel-color-mode-button" aria-label="Fill color">
                  <PaintBucket size={12} />
                  Fill
                </ToggleGroup.Item>
              </HoverCard>
            </ToggleGroup.Root>
            <HoverCard content="Custom Color" placement="top">
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
                aria-label="Custom Color"
                className="native-color-picker sel-native-color-picker"
              />
            </HoverCard>
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
                  <HoverCard key={c.name} content={c.name} placement="top">
                    <ToggleGroup.Item
                      value={c.value}
                      aria-label={c.name}
                      className={`sel-swatch sel-swatch-${c.name} ${selected ? 'sel-swatch-active' : ''}`}
                    >
                      {selected && <Check size={12} strokeWidth={3} className="sel-swatch-check" />}
                    </ToggleGroup.Item>
                  </HoverCard>
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
          <HoverCard content="Stroke size" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Stroke size">
                <Brush size={16} />
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
          <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
            <p className="sel-subpanel-title">Stroke Size</p>
            <div className="sel-size-preview">
              <div
                className="sel-size-dot"
                data-size={Math.min(brushSize * 3, 48)}
                style={{ width: Math.min(brushSize * 3, 48), height: Math.min(brushSize * 3, 48) }}
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
              <HoverCard content="Decrease ([)" placement="top">
                <button
                  type="button"
                  className="sel-size-btn"
                  aria-label="Decrease size"
                  onClick={onDecreaseSize}
                >
                  <Minus size={14} />
                </button>
              </HoverCard>
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
              <HoverCard content="Increase (])" placement="top">
                <button
                  type="button"
                  className="sel-size-btn"
                  aria-label="Increase size"
                  onClick={onIncreaseSize}
                >
                  <Plus size={14} />
                </button>
              </HoverCard>
            </div>
            <p className="sel-size-hint">Use <kbd className="sel-kbd">[ ]</kbd> keys to change size</p>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {/* ── Dimensions ── */}
        <DropdownMenu.Root modal={false}>
          <HoverCard content="Dimensions" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Dimensions">
                <Frame size={16} />
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
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
          <HoverCard content="Rotate" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Rotate">
                <RotateCw size={16} />
                {currentRotation !== 0 && (
                  <span className="sel-bar-badge">{Math.round(currentRotation)}°</span>
                )}
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
          <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
            <p className="sel-subpanel-title">
              Rotate
              <span className="sel-rotation-value sel-rotation-value-inline">
                {Math.round(currentRotation)}°
              </span>
            </p>
            <div className="sel-rotate-presets" role="group" aria-label="Rotation presets">
              <HoverCard content="Rotate 45° CCW" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 45° counter-clockwise"
                  onClick={() => onRotate?.(-45)}
                >
                  <RotateCcw size={13} />
                  45°
                </button>
              </HoverCard>
              <HoverCard content="Rotate 90° CCW (Ctrl+[)" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 90° counter-clockwise (Ctrl+[)"
                  onClick={() => onRotate?.(-90)}
                >
                  <RotateCcw size={13} />
                  90°
                </button>
              </HoverCard>
              <HoverCard content="Rotate 180°" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 180°"
                  onClick={() => onRotate?.(180)}
                >
                  <RotateCw size={13} />
                  180°
                </button>
              </HoverCard>
              <HoverCard content="Rotate 90° CW (Ctrl+])" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 90° clockwise (Ctrl+])"
                  onClick={() => onRotate?.(90)}
                >
                  <RotateCw size={13} />
                  90°
                </button>
              </HoverCard>
              <HoverCard content="Rotate 45° CW" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 45° clockwise"
                  onClick={() => onRotate?.(45)}
                >
                  <RotateCw size={13} />
                  45°
                </button>
              </HoverCard>
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
          <HoverCard content="Crop" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Crop">
                <Crop size={16} />
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
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
        <HoverCard content="Copy (Ctrl+C)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn" aria-label="Copy (Ctrl+C)" onClick={onCopy}>
            <Copy size={16} />
          </button>
        </HoverCard>

        <HoverCard content="Duplicate (Ctrl+D)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn" aria-label="Duplicate (Ctrl+D)" onClick={onDuplicate}>
            <CopyPlus size={16} />
          </button>
        </HoverCard>

        <HoverCard content="Cut (Ctrl+X)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn" aria-label="Cut (Ctrl+X)" onClick={onCut}>
            <Scissors size={16} />
          </button>
        </HoverCard>

        <div className="sel-bar-divider" />

        {/* ── Group / Ungroup ── */}
        <HoverCard content="Group (Ctrl+G)" placement="above" sideOffset={6}>
          <button
            type="button"
            className={`sel-bar-btn ${selectedCount < 2 || isGrouped ? 'sel-bar-btn-disabled' : ''}`}
            aria-label="Group (Ctrl+G)"
            disabled={selectedCount < 2 || isGrouped}
            onClick={onGroup}
          >
            <Group size={16} />
          </button>
        </HoverCard>

        <HoverCard content="Ungroup (Ctrl+Shift+G)" placement="above" sideOffset={6}>
          <button
            type="button"
            className={`sel-bar-btn ${!isGrouped || selectedCount < 1 ? 'sel-bar-btn-disabled' : ''}`}
            aria-label="Ungroup (Ctrl+Shift+G)"
            disabled={!isGrouped || selectedCount < 1}
            onClick={onUngroup}
          >
            <Ungroup size={16} />
          </button>
        </HoverCard>

        <div className="sel-bar-divider" />

        {/* ── Delete / Deselect ── */}
        <HoverCard content="Delete (Del)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn sel-bar-btn-danger" aria-label="Delete (Del)" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        </HoverCard>

        <HoverCard content="Deselect (Esc)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn" aria-label="Deselect (Esc)" onClick={onDeselect}>
            <X size={16} />
          </button>
        </HoverCard>
      </div>
    </div>
  );
};

export default SelectionToolbox;
