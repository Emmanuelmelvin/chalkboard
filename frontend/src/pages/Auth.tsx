import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import FloatingItems from '@/components/FloatingItems';
import { useAuthStore } from '@/stores/authStore';

export default function Auth() {
  const { signInWithGoogle, loading, error } = useAuthStore();
  return (
    <div className="lobby-container">
      <FloatingItems />
      <div className="lobby-bg-pattern" />
      <Card variant="slate">
        <div className="lobby-content">
          <h1 className="lobby-logo">Chalkboard</h1>
          <p className="lobby-subtitle">Sign in to create rooms, manage members, and return to your boards.</p>
          {error && <p className="chalk-error">{error}</p>}
          <Button onClick={signInWithGoogle} disabled={loading}>{loading ? 'Checking slate...' : 'Continue with Google'}</Button>
          <a className="chalk-link" href="/join/demo">Join by invite link instead</a>
        </div>
      </Card>
    </div>
  );
}
