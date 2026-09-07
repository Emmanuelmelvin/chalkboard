/**
 * @file DropdownMenu.tsx
 * @description Astryx Design System Dropdown Menu with robust React portal positioning.
 * @see https://astryx.atmeta.com/components/DropdownMenu
 */

import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import '@/styles/DropdownMenu.css';

export interface RoleDropdownProps {
  role: 'instructor' | 'viewer';
  onChange?: (newRole: 'instructor' | 'viewer') => void;
  disabled?: boolean;
  ariaLabel?: string;
}


export const RoleDropdown: React.FC<RoleDropdownProps> = ({
  role,
  onChange,
  disabled = false,
  ariaLabel = 'Select role',
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  const currentLabel = role === 'instructor' ? 'Editor' : 'Viewer';

  // Calculate fixed popup position based on trigger button bounding box
  const updateCoords = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 5,
      right: window.innerWidth - rect.right,
    });
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    if (!open) {
      updateCoords();
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  // Close on outside pointerdown
  useEffect(() => {
    if (!open) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    const handleScrollOrResize = () => {
      if (open) {
        updateCoords();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    window.addEventListener('resize', handleScrollOrResize, true);
    window.addEventListener('scroll', handleScrollOrResize, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
      window.removeEventListener('resize', handleScrollOrResize, true);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelect = (newRole: 'instructor' | 'viewer', e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.(newRole);
    setOpen(false);
  };


  // Get mount target (fullscreen container, root, or body)
  const portalTarget =
    (typeof document !== 'undefined'
      ? document.fullscreenElement || document.getElementById('root') || document.body
      : null) as HTMLElement | null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`astryx-role-dropdown-trigger${open ? ' is-open' : ''}`}
        onClick={handleToggle}
        data-state={open ? 'open' : 'closed'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span>{currentLabel}</span>
        <ChevronDown size={11} className="astryx-role-dropdown-chevron" />
      </button>

      {open &&
        coords &&
        portalTarget &&
        ReactDOM.createPortal(
          <div
            ref={menuRef}
            className="astryx-dropdown-content"
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              right: `${coords.right}px`,
              zIndex: 100000,
            }}
            role="menu"
            aria-orientation="vertical"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`astryx-dropdown-radio-item${role === 'instructor' ? ' active' : ''}`}
              role="menuitemradio"
              aria-checked={role === 'instructor'}
              onClick={(e) => handleSelect('instructor', e)}
            >
              <div className="astryx-dropdown-radio-left">
                <span className="astryx-dropdown-item-title">Editor</span>
                <span className="astryx-dropdown-item-desc">Can draw, erase & use tools</span>
              </div>
              {role === 'instructor' && (
                <span className="astryx-dropdown-indicator-check">
                  <Check size={12} strokeWidth={2.5} />
                </span>
              )}
            </div>

            <div
              className={`astryx-dropdown-radio-item${role === 'viewer' ? ' active' : ''}`}
              role="menuitemradio"
              aria-checked={role === 'viewer'}
              onClick={(e) => handleSelect('viewer', e)}
            >
              <div className="astryx-dropdown-radio-left">
                <span className="astryx-dropdown-item-title">Viewer</span>
                <span className="astryx-dropdown-item-desc">Read-only live participant</span>
              </div>
              {role === 'viewer' && (
                <span className="astryx-dropdown-indicator-check">
                  <Check size={12} strokeWidth={2.5} />
                </span>
              )}
            </div>
          </div>,
          portalTarget
        )}
    </>
  );
};

export default RoleDropdown;
