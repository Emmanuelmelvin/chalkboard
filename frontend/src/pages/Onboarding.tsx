import { useLocation } from 'wouter';
import Button from '@/components/ui/Button';
import AppShell from '@/layouts/AppShell';
import { useAuthStore } from '@/stores/authStore';

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);
  const finish = async () => { await completeOnboarding(); setLocation('/dashboard'); };
  return (
    <AppShell title="First-run guide">
      <section className="onboarding-grid">
        <article className="chalk-card"><strong>1. Create a room</strong><p>Name the slate, choose open, approval, or password access, and decide whether voice is enabled.</p></article>
        <article className="chalk-card"><strong>2. Invite learners</strong><p>Share a room link. Approval-required rooms park viewers in a waiting state until staff lets them in.</p></article>
        <article className="chalk-card"><strong>3. Teach on the slate</strong><p>Open the classroom to draw, use plugins, raise hands, reactions, and role-aware member controls.</p></article>
      </section>
      <Button onClick={finish}>Start building my rooms</Button>
    </AppShell>
  );
}
