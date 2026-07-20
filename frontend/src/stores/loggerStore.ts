import { create } from 'zustand';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface LogNotice {
  id: string;
  message: string;
  level: LogLevel;
}

interface LoggerState {
  notices: LogNotice[];
  notify: (message: string, level?: LogLevel, ttlMs?: number) => void;
  dismiss: (id: string) => void;
}

export const useLoggerStore = create<LoggerState>((set, get) => ({
  notices: [],
  notify: (message, level = 'info', ttlMs = 3200) => {
    const id = crypto.randomUUID();
    set((state) => ({ notices: [...state.notices, { id, message, level }] }));
    window.setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
}));
