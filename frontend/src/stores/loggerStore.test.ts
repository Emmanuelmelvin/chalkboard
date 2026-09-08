import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLoggerStore } from './loggerStore';

const { toastMock, dismissToastMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  dismissToastMock: vi.fn(),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: toastMock,
  dismissToast: dismissToastMock,
}));

describe('useLoggerStore.notify', () => {
  beforeEach(() => {
    toastMock.mockReset();
    dismissToastMock.mockReset();
    useLoggerStore.setState({ notices: [] });
  });

  it('generates a unique id for each notice when none is provided', () => {
    useLoggerStore.getState().notify('first');
    useLoggerStore.getState().notify('second');

    const notices = useLoggerStore.getState().notices;
    expect(notices).toHaveLength(2);
    expect(notices[0].id).not.toBe(notices[1].id);
  });

  it('replaces an existing notice/toast when the same stable id is used', () => {
    useLoggerStore.getState().notify('first failure', 'error', 7000, 'live-room-connect-error');
    useLoggerStore.getState().notify('second failure', 'error', 7000, 'live-room-connect-error');

    const notices = useLoggerStore.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toEqual({
      id: 'live-room-connect-error',
      message: 'second failure',
      level: 'error',
    });
    // The toast helper receives the stable id so the visible toast is
    // replaced (not stacked) by ToastProvider's id-based deduplication.
    expect(toastMock).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'live-room-connect-error',
      type: 'error',
      autoHideDuration: 7000,
    }));
  });

  it('dismisses the toast through the global helper', () => {
    useLoggerStore.getState().notify('hello', 'info', 3200, 'custom-id');
    useLoggerStore.getState().dismiss('custom-id');

    expect(dismissToastMock).toHaveBeenCalledWith('custom-id');
    expect(useLoggerStore.getState().notices).toEqual([]);
  });
});