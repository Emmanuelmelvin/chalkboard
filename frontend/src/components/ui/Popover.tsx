/**
 * @file Popover.tsx
 * @description Astryx Popover component implementation.
 * Complies with Astryx Design System (https://astryx.atmeta.com/components/Popover)
 * built on top of Radix UI Popover primitive with fullscreen support.
 */

import React from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import '@/styles/Popover.css';

export type PopoverPlacement =
  | 'above'
  | 'below'
  | 'start'
  | 'end'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right';

export type PopoverAlignment = 'start' | 'center' | 'end';

export interface PopoverProps {
  children: React.ReactNode;
  content: React.ReactNode;
  placement?: PopoverPlacement;
  alignment?: PopoverAlignment;
  isOpen?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  isEnabled?: boolean;
  showArrow?: boolean;
  sideOffset?: number;
  alignOffset?: number;
  collisionPadding?: number;
  width?: number | string;
  className?: string;
  contentClassName?: string;
  portal?: boolean;
  container?: HTMLElement | null;
  hasLightDismiss?: boolean;
  hasEscapeDismiss?: boolean;
}

const mapPlacementToSide = (placement: PopoverPlacement): 'top' | 'bottom' | 'left' | 'right' => {
  switch (placement) {
    case 'above':
    case 'top':
      return 'top';
    case 'below':
    case 'bottom':
      return 'bottom';
    case 'start':
    case 'left':
      return 'left';
    case 'end':
    case 'right':
      return 'right';
    default:
      return 'bottom';
  }
};

/**
 * Astryx Popover Portal with automatic Fullscreen support
 */
export const PopoverPortal: React.FC<RadixPopover.PopoverPortalProps> = ({
  container,
  children,
  ...props
}) => {
  const targetContainer =
    container ??
    (typeof document !== 'undefined' && document.fullscreenElement
      ? (document.fullscreenElement as HTMLElement)
      : undefined);

  return (
    <RadixPopover.Portal container={targetContainer} {...props}>
      {children}
    </RadixPopover.Portal>
  );
};

export interface PopoverContentProps
  extends React.ComponentPropsWithoutRef<typeof RadixPopover.Content> {
  showArrow?: boolean;
}

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof RadixPopover.Content>,
  PopoverContentProps
>(({ className = '', children, showArrow = true, ...props }, ref) => {
  return (
    <RadixPopover.Content
      ref={ref}
      className={`astryx-popover-content ${className}`}
      {...props}
    >
      <div className="astryx-popover-inner">{children}</div>
      {showArrow && <RadixPopover.Arrow className="astryx-popover-arrow" width={12} height={6} />}
    </RadixPopover.Content>
  );
});
PopoverContent.displayName = 'PopoverContent';

/**
 * Astryx Popover single-wrapper component
 */
export const Popover: React.FC<PopoverProps> & {
  Root: typeof RadixPopover.Root;
  Trigger: typeof RadixPopover.Trigger;
  Portal: typeof PopoverPortal;
  Content: typeof PopoverContent;
  Arrow: typeof RadixPopover.Arrow;
  Close: typeof RadixPopover.Close;
} = ({
  children,
  content,
  placement = 'below',
  alignment = 'center',
  isOpen,
  open,
  defaultOpen,
  onOpenChange,
  isEnabled = true,
  showArrow = true,
  sideOffset = 8,
  alignOffset = 0,
  collisionPadding = 16,
  width,
  className = '',
  contentClassName = '',
  portal = false,
  container,
  hasLightDismiss = true,
  hasEscapeDismiss = true,
}) => {
  const isControlled = open !== undefined || isOpen !== undefined;
  const activeOpen = open !== undefined ? open : isOpen;
  const side = mapPlacementToSide(placement);

  if (!isEnabled) {
    return <>{children}</>;
  }

  const contentElement = (
    <RadixPopover.Content
      className={`astryx-popover-content ${contentClassName || className}`}
      side={side}
      sideOffset={sideOffset}
      align={alignment}
      alignOffset={alignOffset}
      collisionPadding={collisionPadding}
      onPointerDownOutside={hasLightDismiss ? undefined : (e) => e.preventDefault()}
      onEscapeKeyDown={hasEscapeDismiss ? undefined : (e) => e.preventDefault()}
      style={width ? { width } : undefined}
    >
      <div className="astryx-popover-inner">
        {content}
      </div>
      {showArrow && <RadixPopover.Arrow className="astryx-popover-arrow" width={12} height={6} />}
    </RadixPopover.Content>
  );

  return (
    <RadixPopover.Root
      open={isControlled ? activeOpen : undefined}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      <RadixPopover.Trigger asChild>
        {children}
      </RadixPopover.Trigger>
      {portal ? (
        <PopoverPortal container={container}>
          {contentElement}
        </PopoverPortal>
      ) : (
        contentElement
      )}
    </RadixPopover.Root>
  );
};

Popover.Root = RadixPopover.Root;
Popover.Trigger = RadixPopover.Trigger;
Popover.Portal = PopoverPortal;
Popover.Content = PopoverContent;
Popover.Arrow = RadixPopover.Arrow;
Popover.Close = RadixPopover.Close;

export default Popover;
