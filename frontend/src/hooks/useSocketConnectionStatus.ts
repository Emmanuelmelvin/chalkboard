import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useLoggerStore } from '@/stores/loggerStore';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

const GRACE_MS = Number(import.meta.env.VITE_SOCKET_GRACE_MS ?? 15000);

export function useSocketConnectionStatus(socket: Socket, enabled: boolean) {
  const [status, setStatus] = useState<ConnectionStatus>(socket.connected ? 'connected' : 'reconnecting');
  const notify = useLoggerStore((state) => state.notify);

  useEffect(() => {
    if (!enabled) return;

    let graceTimer: number | undefined;
    const clearGraceTimer = () => {
      if (graceTimer !== undefined) window.clearTimeout(graceTimer);
      graceTimer = undefined;
    };

    const markConnected = () => {
      clearGraceTimer();
      setStatus('connected');
      notify('Back on the board.', 'success', 2200);
    };

    const markReconnecting = () => {
      setStatus('reconnecting');
      notify('Connection dropped — dusting off and reconnecting…', 'warning', 2800);
      if (!socket.connected) socket.connect();
      clearGraceTimer();
      graceTimer = window.setTimeout(() => setStatus('disconnected'), GRACE_MS);
    };

    const markDisconnected = () => {
      clearGraceTimer();
      setStatus('disconnected');
      notify('Still disconnected. Use Rejoin when your connection is back.', 'error', 6000);
    };

    const markAttempt = () => setStatus('reconnecting');

    socket.on('connect', markConnected);
    socket.on('disconnect', markReconnecting);
    socket.io.on('reconnect_attempt', markAttempt);
    socket.io.on('reconnect_failed', markDisconnected);
    socket.io.on('reconnect_error', markAttempt);

    const initialStatusTimer = window.setTimeout(() => {
      if (socket.connected) setStatus('connected');
      else markReconnecting();
    }, 0);

    return () => {
      window.clearTimeout(initialStatusTimer);
      clearGraceTimer();
      socket.off('connect', markConnected);
      socket.off('disconnect', markReconnecting);
      socket.io.off('reconnect_attempt', markAttempt);
      socket.io.off('reconnect_failed', markDisconnected);
      socket.io.off('reconnect_error', markAttempt);
    };
  }, [enabled, notify, socket]);

  const rejoin = () => {
    setStatus('reconnecting');
    socket.connect();
  };

  return { status, rejoin };
}
