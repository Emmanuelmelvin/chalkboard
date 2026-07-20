import { useState } from 'react';
import { useLocation } from 'wouter';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import FloatingItems from '@/components/FloatingItems';
import { useAuthStore } from '@/stores/authStore';
import { useRoomsStore } from '@/stores/roomsStore';
import { useLoggerStore } from '@/stores/loggerStore';

export default function JoinRoom({ roomId }: { roomId: string }) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const joinRoom = useRoomsStore((state) => state.joinRoom);
  const notify = useLoggerStore((state) => state.notify);
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setError(null);
    try {
      const result = await joinRoom(roomId, token, password || undefined);
      if (result.status === 'joined') setLocation(`/room/${roomId}`);
      else setStatus(result.status);
    } catch (err) {
      const statusCode = typeof err === 'object' && err && 'response' in err ? (err as { response?: { status?: number; data?: { message?: string } } }).response?.status : undefined;
      const message = statusCode === 429
        ? 'Too many join attempts. Please wait a moment before trying again.'
        : err instanceof Error ? err.message : 'Unable to join room';
      setError(message);
      notify(message, statusCode === 429 ? 'warning' : 'error');
    }
  };

  return (
    <div className="lobby-container">
      <FloatingItems /><div className="lobby-bg-pattern" />
      <Card variant="slate">
        <div className="lobby-content">
          <h1 className="lobby-logo">Join room</h1>
          <p className="lobby-subtitle">Invite: {roomId}</p>
          {!user && <Button onClick={signInWithGoogle}>Sign in with Google</Button>}
          <Input label="PASSWORD (IF REQUIRED)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {status === 'waiting-approval' && <p className="waiting-state">You're on the chalk rail. An owner or instructor needs to approve your request.</p>}
          {status === 'password-required' && <p className="waiting-state">This room needs a password before you can enter.</p>}
          {error && <p className="chalk-error">{error}</p>}
          <Button onClick={join}>Enter invite</Button>
        </div>
      </Card>
    </div>
  );
}
