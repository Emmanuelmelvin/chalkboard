import { create } from 'zustand';
import { toast, dismissToast, type ToastType } from '@/components/ui/Toast';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface LogNotice {
  id: string;
  message: string;
  level: LogLevel;
}

interface LoggerState {
  notices: LogNotice[];
  /**
   * @param id optional stable id. When provided, an existing notice/toast with
   *   the same id is replaced instead of duplicating, which prevents repeated
   *   events (e.g. socket connect errors) from stacking on screen.
   */
  notify: (message: string, level?: LogLevel, ttlMs?: number, id?: string) => void;
  dismiss: (id: string) => void;
}

export const useLoggerStore = create<LoggerState>((set, get) => ({
  notices: [],
  notify: (message, level = 'info', ttlMs = 3200, id?) => {
    const noticeId = id || crypto.randomUUID();
    set((state) => ({
      notices: [...state.notices.filter((notice) => notice.id !== noticeId), { id: noticeId, message, level }],
    }));
    toast({ id: noticeId, body: message, type: level as ToastType, autoHideDuration: ttlMs });
    window.setTimeout(() => get().dismiss(noticeId), ttlMs);
  },
  dismiss: (id) => {
    dismissToast(id);
    set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) }));
  },
}));
