/**
 * @file HoverCard.tsx
 * @description Astryx HoverCard component implementation.
 * Complies with Astryx Design System (https://astryx.atmeta.com/components/HoverCard)
 * built on top of Radix UI HoverCard primitive with fullscreen support.
 */

import React from 'react';
import * as RadixHoverCard from '@radix-ui/react-hover-card';
import '@/styles/HoverCard.css';

export type HoverCardPlacement =
  | 'above'
  | 'below'
  | 'start'
  | 'end'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right';

export interface HoverCardProps {
  children: React.ReactNode;
  content: React.ReactNode;
  placement?: HoverCardPlacement;
  openDelay?: number;
  closeDelay?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  showArrow?: boolean;
  sideOffset?: number;
  alignOffset?: number;
  align?: 'start' | 'center' | 'end';
  collisionPadding?: number;
  className?: string;
  contentClassName?: string;
  portal?: boolean;
  container?: HTMLElement | null;
}

const mapPlacementToSide = (placement: HoverCardPlacement): 'top' | 'bottom' | 'left' | 'right' => {
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

function formatHoverCardContent(content: React.ReactNode) {
  if (typeof content !== 'string') return content;
  const match = content.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (match) {
    return (
      <span className="astryx-hover-card-tip">
        <span>{match[1]}</span>
        <kbd className="hover-card-tip-kbd">{match[2]}</kbd>
      </span>
    );
  }
  return <span className="astryx-hover-card-tip">{content}</span>;
}

/**
 * Astryx HoverCard Portal with automatic Fullscreen support
 */
export const HoverCardPortal: React.FC<RadixHoverCard.HoverCardPortalProps> = ({
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
    <RadixHoverCard.Portal container={targetContainer} {...props}>
      {children}
    </RadixHoverCard.Portal>
  );
};

export interface HoverCardContentProps
  extends React.ComponentPropsWithoutRef<typeof RadixHoverCard.Content> {
  showArrow?: boolean;
}

export const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof RadixHoverCard.Content>,
  HoverCardContentProps
>(({ className = '', children, showArrow = true, ...props }, ref) => (
  <RadixHoverCard.Content
    ref={ref}
    className={`astryx-hover-card-content ${className}`}
    {...props}
  >
    <div className="astryx-hover-card-inner">{children}</div>
    {showArrow && (
      <RadixHoverCard.Arrow
        className="astryx-hover-card-arrow"
        width={12}
        height={6}
      />
    )}
  </RadixHoverCard.Content>
));
HoverCardContent.displayName = 'HoverCardContent';

/**
 * Astryx HoverCard single-wrapper component
 */
export const HoverCard: React.FC<HoverCardProps> & {
  Root: typeof RadixHoverCard.Root;
  Trigger: typeof RadixHoverCard.Trigger;
  Portal: typeof HoverCardPortal;
  Content: typeof HoverCardContent;
  Arrow: typeof RadixHoverCard.Arrow;
} = ({
  children,
  content,
  placement = 'below',
  openDelay = 180,
  closeDelay = 150,
  open,
  defaultOpen,
  onOpenChange,
  showArrow = true,
  sideOffset = 8,
  alignOffset = 0,
  align = 'center',
  collisionPadding = 16,
  className = '',
  contentClassName = '',
  portal = false,
  container,
}) => {
  const side = mapPlacementToSide(placement);

  const contentElement = (
    <RadixHoverCard.Content
      className={`astryx-hover-card-content ${contentClassName}`}
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      collisionPadding={collisionPadding}
    >
      <div className={`astryx-hover-card-inner ${className}`}>
        {formatHoverCardContent(content)}
      </div>
      {showArrow && (
        <RadixHoverCard.Arrow
          className="astryx-hover-card-arrow"
          width={12}
          height={6}
        />
      )}
    </RadixHoverCard.Content>
  );

  return (
    <RadixHoverCard.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      openDelay={openDelay}
      closeDelay={closeDelay}
    >
      <RadixHoverCard.Trigger asChild>
        {children}
      </RadixHoverCard.Trigger>
      {portal ? (
        <HoverCardPortal container={container}>{contentElement}</HoverCardPortal>
      ) : (
        contentElement
      )}
    </RadixHoverCard.Root>
  );
};

HoverCard.Root = RadixHoverCard.Root;
HoverCard.Trigger = RadixHoverCard.Trigger;
HoverCard.Portal = HoverCardPortal;
HoverCard.Content = HoverCardContent;
HoverCard.Arrow = RadixHoverCard.Arrow;

export default HoverCard;
