/**
 * @file Toast.tsx
 * @description Astryx Toast component and useToast() hook implementation.
 * Complies with Astryx Design System (https://astryx.atmeta.com/components/Toast)
 * and matches the dark pill notification design with fullscreen portal support.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as RadixToast from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import '@/styles/Toast.css';

export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'neutral';

export interface ToastOptions {
  id?: string;
  title?: string | React.ReactNode;
  body: string | React.ReactNode;
  type?: ToastType;
  icon?: React.ReactNode;
  endContent?: React.ReactNode;
  isAutoHide?: boolean;
  autoHideDuration?: number;
  onDismiss?: () => void;
}

export interface ToastProps extends ToastOptions {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

const ToastContext = createContext<((options: ToastOptions | string) => string) | null>(null);

let globalToastHandler: ((options: ToastOptions | string) => string) | null = null;

/**
 * Astryx Toast visual component
 */
export const Toast: React.FC<ToastProps> = ({
  open,
  onOpenChange,
  title,
  body,
  type = 'info',
  icon,
  endContent,
  isAutoHide = true,
  autoHideDuration = 4000,
  onDismiss,
  className = '',
}) => {
  return (
    <RadixToast.Root
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange?.(nextOpen);
        if (!nextOpen) onDismiss?.();
      }}
      duration={isAutoHide ? autoHideDuration : Infinity}
      className={`astryx-toast-root astryx-toast-type-${type} ${className}`}
    >
      {icon && (
        <div className="astryx-toast-icon-wrap" aria-hidden="true">
          {icon}
        </div>
      )}

      <div className="astryx-toast-content">
        {title && (
          <RadixToast.Title className="astryx-toast-title">
            {title}
          </RadixToast.Title>
        )}
        <RadixToast.Description className="astryx-toast-body">
          {body}
        </RadixToast.Description>
      </div>

      <div className="astryx-toast-end">
        {endContent}
        <RadixToast.Close
          className="astryx-toast-close-btn"
          aria-label="Close notification"
        >
          <X size={15} />
        </RadixToast.Close>
      </div>
    </RadixToast.Root>
  );
};

interface ActiveToastItem extends ToastOptions {
  id: string;
}

/**
 * Astryx ToastProvider component
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ActiveToastItem[]>([]);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? (document.fullscreenElement as HTMLElement) || document.body : null
  );

  useEffect(() => {
    const updateContainer = () => {
      setPortalContainer((document.fullscreenElement as HTMLElement) || document.body);
    };
    document.addEventListener('fullscreenchange', updateContainer);
    return () => document.removeEventListener('fullscreenchange', updateContainer);
  }, []);

  const showToast = useCallback((options: ToastOptions | string): string => {
    const item: ActiveToastItem =
      typeof options === 'string'
        ? { id: `toast-${Date.now()}-${Math.random()}`, body: options, type: 'info' }
        : {
            ...options,
            id: options.id || `toast-${Date.now()}-${Math.random()}`,
            type: options.type || 'info',
          };

    setToasts((prev) => [...prev.filter((t) => t.id !== item.id), item]);
    return item.id;
  }, []);

  globalToastHandler = showToast;

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <Toast
            key={t.id}
            {...t}
            onDismiss={() => {
              t.onDismiss?.();
              dismissToast(t.id);
            }}
          />
        ))}
        {portalContainer &&
          createPortal(
            <RadixToast.Viewport className="astryx-toast-viewport" />,
            portalContainer
          )}
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
};

/**
 * useToast() hook providing imperative toast dispatching
 */
export function useToast() {
  const context = useContext(ToastContext);
  const trigger = context || globalToastHandler;

  const toastFn = useCallback(
    (options: ToastOptions | string) => {
      if (trigger) {
        return trigger(options);
      }
      return '';
    },
    [trigger]
  );

  const toastMethods = Object.assign(toastFn, {
    info: (body: string | React.ReactNode, title?: string) =>
      toastFn({ body, title, type: 'info' }),
    success: (body: string | React.ReactNode, title?: string) =>
      toastFn({ body, title, type: 'success' }),
    warning: (body: string | React.ReactNode, title?: string) =>
      toastFn({ body, title, type: 'warning' }),
    error: (body: string | React.ReactNode, title?: string) =>
      toastFn({ body, title, type: 'error' }),
  });

  return toastMethods;
}

/**
 * Global imperative toast helper callable from anywhere
 */
export const toast = Object.assign(
  (options: ToastOptions | string) => {
    if (globalToastHandler) {
      return globalToastHandler(options);
    }
    return '';
  },
  {
    info: (body: string | React.ReactNode, title?: string) =>
      globalToastHandler ? globalToastHandler({ body, title, type: 'info' }) : '',
    success: (body: string | React.ReactNode, title?: string) =>
      globalToastHandler ? globalToastHandler({ body, title, type: 'success' }) : '',
    warning: (body: string | React.ReactNode, title?: string) =>
      globalToastHandler ? globalToastHandler({ body, title, type: 'warning' }) : '',
    error: (body: string | React.ReactNode, title?: string) =>
      globalToastHandler ? globalToastHandler({ body, title, type: 'error' }) : '',
  }
);

export default Toast;
