import {
  useEffect,
  useState
} from 'react';
import {
  useLocation,
  useParams
} from 'wouter';
import {
  Clock,
  LoaderCircle,
  Mail,
  UsersRound,
  XCircle
} from 'lucide-react';
import { useAcceptWorkspaceInviteMutation } from '@/api/hooks';
import { getApiError } from '@/api/client';
import { getWorkspaceInvite } from '@/api/workspace';
import { useAuthStore } from '@/stores/authStore';
import '@/styles/PublicPages.css';

/**
 * The invite link's landing page.
 *
 * Acceptance is gated on the signed-in email matching the invite: the server
 * compares them and this page only explains the outcome. It never renders
 * member data, only what `GET /workspace/invites/:token` allows.
 */

interface InviteView {
  workspaceName: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked';
  expiresAt: string;
  expired: boolean;
}

function InviteAccept() {
  const params = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { profile, status } = useAuthStore();
  const acceptMutation = useAcceptWorkspaceInviteMutation();
  const token = params.token ?? '';
  const [view, setView] = useState<InviteView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    document.title = 'Workspace invite - Chalkboard';
  }, []);

  // The invite routes sit behind the session guard, so an anonymous visitor is
  // sent to sign in before we even look the invite up.
  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    void (async () => {
      setLoadError('');
      try {
        const data = await getWorkspaceInvite(token);
        if (!cancelled) setView(data);
      } catch (cause) {
        const message = getApiError(cause, 'This invite link is not valid.').message;
        if (!cancelled) setLoadError(message === 'invite_not_found' ? 'This invite link is not valid.' : message);
      }
    })();
    return () => { cancelled = true; };
  }, [token, status]);

  const handleAccept = async () => {
    setActionError('');
    try {
      await acceptMutation.mutateAsync(token);
      // The Team tab belongs to the workspace owner; a member lands on the
      // overview and finds their Team plan under Plan & billing.
      setLocation('/dashboard');
    } catch (cause) {
      const message = getApiError(cause, 'We could not accept the invite.').message;
      setActionError(message === 'invite_not_found' ? 'This invite link is not valid.' : message);
    }
  };

  return (
    <div className="billing-return-page">
      <div className="billing-return-card">
        {status === 'unauthenticated' ? (
          <>
            <span className="billing-return-mark"><Mail size={22} /></span>
            <h1>You are invited to a workspace.</h1>
            <p>Sign in with the email address the invite was sent to, and you can accept it right away.</p>
            <div className="billing-return-actions">
              <button className="dashboard-button dashboard-button-gold" type="button" onClick={() => setLocation(`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`)}>
                Sign in to accept
              </button>
            </div>
          </>
        ) : loadError ? (
          <>
            <span className="billing-return-mark"><XCircle size={22} /></span>
            <h1>This invite is not valid.</h1>
            <p>{loadError}. Ask the workspace owner to send it again.</p>
          </>
        ) : !view ? (
          <>
            <span className="billing-return-mark"><LoaderCircle className="dashboard-spin" size={22} /></span>
            <h1>Checking your invite.</h1>
            <p>One moment while we look it up.</p>
          </>
        ) : view.status !== 'pending' || view.expired ? (
          <>
            <span className="billing-return-mark"><Clock size={22} /></span>
            <h1>This invite is no longer open.</h1>
            <p>
              {view.status === 'accepted'
                ? `The invite for ${view.email} has already been used.`
                : view.status === 'revoked'
                  ? 'The workspace owner withdrew this invite.'
                  : 'It expired after 7 days.'} Ask the owner to send a new one.
            </p>
          </>
        ) : (
          <>
            <span className="billing-return-mark"><Mail size={22} /></span>
            <h1>Join <em>{view.workspaceName}.</em></h1>
            <p>
              The invite was sent to <strong>{view.email}</strong>.
              {status === 'authenticated' && profile
                ? profile.email.toLowerCase() === view.email.toLowerCase()
                  ? ' Your signed-in account matches, so you are ready to join.'
                  : ` Your signed-in account (${profile.email}) does not match, so this invite cannot seat it. Sign in with ${view.email} to accept.`
                : ' Sign in with the same email to accept.'}
            </p>
            <div className="billing-return-actions">
              <button
                className="dashboard-button dashboard-button-gold"
                type="button"
                onClick={() => { void handleAccept(); }}
                disabled={acceptMutation.isPending || (status === 'authenticated' && Boolean(profile && profile.email.toLowerCase() !== view.email.toLowerCase()))}
              >
                {acceptMutation.isPending ? <LoaderCircle className="dashboard-spin" size={15} /> : <UsersRound size={15} />}
                {acceptMutation.isPending ? 'Joining…' : 'Accept invitation'}
              </button>
              {status === 'authenticated' && profile && profile.email.toLowerCase() !== view.email.toLowerCase() && (
                <button className="dashboard-link-button" type="button" onClick={() => setLocation('/login')}>
                  Switch account
                </button>
              )}
              {actionError && <span className="billing-return-inline-error" role="alert">{actionError}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default InviteAccept;
