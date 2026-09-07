/**
 * @file ColorPicker.tsx
 * @description Astryx Color Picker component implementation.
 * Provides preset swatches, hex text editing, and native color picking.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Pipette, Check, Ban } from 'lucide-react';
import { HoverCard } from '@/components/ui/HoverCard';
import '@/styles/ColorPicker.css';

export interface ChalkColor {
  name: string;
  value: string;
}

export const CHALK_COLORS: ChalkColor[] = [
  { name: 'white', value: '#ffffff' },
  { name: 'yellow', value: '#fef08a' },
  { name: 'blue', value: '#93c5fd' },
  { name: 'pink', value: '#f472b6' },
  { name: 'green', value: '#86efac' },
  { name: 'orange', value: '#fdba74' },
];

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  colors?: ChalkColor[];
  showInput?: boolean;
  showSwatches?: boolean;
  label?: string;
  allowTransparent?: boolean;
  onSelectTransparent?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

function normalizeHex(hex: string): string {
  let clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  return clean.toUpperCase();
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  colors = CHALK_COLORS,
  showInput = true,
  showSwatches = true,
  label,
  allowTransparent = false,
  onSelectTransparent,
  className = '',
  style,
}) => {
  const nativeInputRef = useRef<HTMLInputElement>(null);
  const [hexInput, setHexInput] = useState(normalizeHex(value === 'transparent' ? 'FFFFFF' : value));

  useEffect(() => {
    if (value && value !== 'transparent') {
      setHexInput(normalizeHex(value));
    }
  }, [value]);

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
    setHexInput(raw.toUpperCase());
    if (raw.length === 6 || raw.length === 3) {
      const fullHex = '#' + (raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw);
      onChange(fullHex);
    }
  };

  const handleHexBlur = () => {
    if (hexInput.length === 6 || hexInput.length === 3) {
      const fullHex = '#' + (hexInput.length === 3 ? hexInput.split('').map((c) => c + c).join('') : hexInput);
      onChange(fullHex);
    } else {
      setHexInput(normalizeHex(value === 'transparent' ? 'FFFFFF' : value));
    }
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleOpenEyedropper = async () => {
    if (typeof window !== 'undefined' && 'EyeDropper' in window) {
      try {
        const EyeDropperClass = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
        const eyeDropper = new EyeDropperClass();
        const result = await eyeDropper.open();
        if (result?.sRGBHex) {
          onChange(result.sRGBHex);
        }
      } catch {
        // User cancelled or not supported
      }
    } else {
      nativeInputRef.current?.click();
    }
  };

  const isTransparent = value === 'transparent';
  const displayColor = isTransparent ? '#ffffff' : value;

  return (
    <div className={`astryx-color-picker ${className}`} style={style}>
      {label && (
        <div className="astryx-color-picker-header">
          <span className="astryx-color-picker-label">{label}</span>
        </div>
      )}

      {showInput && (
        <div className="astryx-color-input-row">
          <HoverCard content="Click for Color Wheel" placement="top" sideOffset={6}>
            <button
              type="button"
              className="astryx-color-preview-trigger"
              onClick={() => nativeInputRef.current?.click()}
              aria-label="Color preview"
            >
              <div
                className="astryx-color-preview-swatch"
                style={{
                  background: isTransparent
                    ? 'repeating-conic-gradient(#cbd5e1 0% 25%, #ffffff 0% 50%) 50% / 8px 8px'
                    : displayColor,
                }}
              />
            </button>
          </HoverCard>

          <input
            ref={nativeInputRef}
            type="color"
            className="astryx-color-native-hidden"
            value={displayColor.startsWith('#') && displayColor.length === 7 ? displayColor : '#ffffff'}
            onChange={handleNativeChange}
            aria-label="Custom color picker"
          />

          <div className="astryx-color-hex-field">
            <span className="astryx-color-hex-prefix">#</span>
            <input
              type="text"
              className="astryx-color-hex-input"
              value={hexInput}
              onChange={handleHexChange}
              onBlur={handleHexBlur}
              maxLength={6}
              spellCheck={false}
              aria-label="Hex color value"
            />
          </div>

          <HoverCard content="Pick Screen Color" placement="top" sideOffset={6}>
            <button
              type="button"
              className="astryx-color-pipette-btn"
              onClick={handleOpenEyedropper}
              aria-label="Pick color"
            >
              <Pipette size={14} />
            </button>
          </HoverCard>
        </div>
      )}

      {showSwatches && (
        <div className="astryx-color-swatches">
          {colors.map((color) => {
            const isSelected = !isTransparent && value.toLowerCase() === color.value.toLowerCase();
            const isLightColor = ['#ffffff', '#fef08a', '#fdba74', '#86efac', '#93c5fd'].includes(color.value.toLowerCase());
            return (
              <HoverCard key={color.name} content={`Chalk: ${color.name}`} placement="top" sideOffset={6}>
                <button
                  type="button"
                  className={`astryx-color-swatch-item ${isSelected ? 'active' : ''}`}
                  style={{ background: color.value }}
                  onClick={() => onChange(color.value)}
                  aria-label={`Color: ${color.name}`}
                >
                  {isSelected && (
                    <Check
                      size={12}
                      strokeWidth={3}
                      className="astryx-color-swatch-check"
                      color={isLightColor ? '#1e293b' : '#ffffff'}
                    />
                  )}
                </button>
              </HoverCard>
            );
          })}
        </div>
      )}

      {allowTransparent && (
        <button
          type="button"
          className="astryx-color-transparent-btn"
          onClick={() => {
            onChange('transparent');
            onSelectTransparent?.();
          }}
        >
          <Ban size={12} />
          <span>No Fill (Transparent)</span>
        </button>
      )}
    </div>
  );
};

export default ColorPicker;
