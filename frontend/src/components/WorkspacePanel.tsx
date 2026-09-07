import { useMemo, useState } from 'react';
import {
  Check,
  LoaderCircle,
  Mail,
  Minus,
  Plus,
  Send,
  Trash2,
  UsersRound,
  X
} from 'lucide-react';
import { useSearch } from 'wouter';
import ConfirmModal from '@/components/ui/ConfirmModal';
import UserAvatar from '@/components/UserAvatar';
import { getApiError } from '@/api/client';
import {
  useCreateWorkspaceInviteMutation,
  useRemoveWorkspaceMemberMutation,
  useRevokeWorkspaceInviteMutation,
  useStartSeatCheckoutMutation,
  useWorkspaceQuery,
} from '@/api/hooks';
import type {
  WorkspaceInfo,
  WorkspaceMemberInfo
} from '@/api/types';
import '@/styles/PublicPages.css';

/**
 * The Team tab: who is seated in the workspace, who is waiting on an invite,
 * and how to add seats when the paid cap runs out.
 *
 * The dashboard shows this tab only to the owner of a Team-plan workspace, so
 * everyone who reaches this panel is the owner. Everything is still re-checked
 * on the server regardless of what this panel lets through.
 */

/** The add-on prices the backend was configured with, for the preview only. */
const SEAT_PRICE_MONTHLY = 2;
const SEAT_PRICE_ANNUAL = 20;
const MIN_SEAT_QUANTITY = 1;
const MAX_SEAT_QUANTITY = 100;

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function SeatsCard({ workspace, isOwner }: { workspace: WorkspaceInfo; isOwner: boolean }) {
  const startSeatCheckoutMutation = useStartSeatCheckoutMutation();
  const [quantity, setQuantity] = useState(5);
  const [error, setError] = useState('');

  const used = workspace.seats.used;
  const limit = workspace.seats.limit;
  const remaining = Math.max(0, limit - used);
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  const handleBuy = async () => {
    setError('');
    try {
      const { checkoutUrl } = await startSeatCheckoutMutation.mutateAsync({ quantity });
      window.location.assign(checkoutUrl);
    } catch (cause) {
      setError(getApiError(cause, 'We could not start the seat checkout.').message);
    }
  };

  return (
    <div className="dashboard-panel dashboard-workspace-seats">
      <div className="dashboard-panel-heading">
        <div>
          <p className="dashboard-panel-kicker">Seats</p>
          <h3>Paid seats in your workspace.</h3>
        </div>
        <span className="dashboard-workspace-seats-count">{used} of {limit}</span>
      </div>

      <div className="dashboard-workspace-seats-meter" role="img" aria-label={`${used} of ${limit} seats used`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="dashboard-workspace-seats-copy">
        {remaining > 0
          ? `${remaining} seat${remaining === 1 ? '' : 's'} still available. Invites reserve a seat until they are accepted or expire.`
          : 'Every seat is taken. Revoke a pending invite or remove a member to free one, or add seats to your subscription.'}
      </p>

      {isOwner && (
        <div className="dashboard-workspace-seats-buy">
          <div className="dashboard-quantity-stepper">
            <button type="button" onClick={() => setQuantity((q) => Math.max(MIN_SEAT_QUANTITY, q - 1))} disabled={quantity <= MIN_SEAT_QUANTITY} aria-label="One fewer seat">
              <Minus size={13} strokeWidth={2} />
            </button>
            <input
              type="number"
              min={MIN_SEAT_QUANTITY}
              max={MAX_SEAT_QUANTITY}
              value={quantity}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                setQuantity(Math.min(MAX_SEAT_QUANTITY, Math.max(MIN_SEAT_QUANTITY, Math.trunc(value))));
              }}
              aria-label="Number of seats to add"
            />
            <button type="button" onClick={() => setQuantity((q) => Math.min(MAX_SEAT_QUANTITY, q + 1))} disabled={quantity >= MAX_SEAT_QUANTITY} aria-label="One more seat">
              <Plus size={13} strokeWidth={2} />
            </button>
          </div>
          <button className="dashboard-button dashboard-button-outline" type="button" onClick={() => { void handleBuy(); }} disabled={startSeatCheckoutMutation.isPending}>
            {startSeatCheckoutMutation.isPending ? <LoaderCircle className="dashboard-spin" size={15} /> : <Plus size={15} />}
            {startSeatCheckoutMutation.isPending ? 'Opening checkout…' : `Buy ${quantity} seat${quantity === 1 ? '' : 's'}`}
          </button>
          <span className="dashboard-workspace-seats-estimate">
            Each seat is {SEAT_PRICE_MONTHLY} a month or {SEAT_PRICE_ANNUAL} a year. You are billed at your subscription&apos;s own interval, pro-rated from today.
          </span>
          {error && <p className="dashboard-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

function InviteForm({ workspace }: { workspace: WorkspaceInfo }) {
  const createInviteMutation = useCreateWorkspaceInviteMutation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await createInviteMutation.mutateAsync(email.trim());
      setEmail('');
      setNotice(`Invite sent to ${email.trim()}. The seat is reserved until it is accepted or expires in 7 days.`);
    } catch (cause) {
      setError(getApiError(cause, 'We could not send the invite.').message);
    }
  };

  return (
    <div className="dashboard-panel dashboard-workspace-invite">
      <div className="dashboard-panel-heading"><div><p className="dashboard-panel-kicker">Invite</p><h3>Add people to the workspace.</h3></div></div>
      <p className="dashboard-panel-copy">They need a Chalkboard account with the same email address. The invite reserves a seat for 7 days.</p>
      <form className="dashboard-form dashboard-workspace-invite-form" onSubmit={(event) => { void handleSubmit(event); }}>
        <label htmlFor="dashboard-workspace-invite-email">Email address</label>
        <div className="dashboard-workspace-invite-row">
          <input
            id="dashboard-workspace-invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            autoComplete="off"
            required
          />
          <button className="dashboard-button dashboard-button-dark" type="submit" disabled={createInviteMutation.isPending || workspace.seats.used + workspace.pendingInvites.length >= workspace.seats.limit}>
            {createInviteMutation.isPending ? <LoaderCircle className="dashboard-spin" size={15} /> : <Send size={15} />}
            {createInviteMutation.isPending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </form>
      {notice && <p className="dashboard-workspace-notice" role="status"><Check size={13} /> {notice}</p>}
      {error && <p className="dashboard-error" role="alert">{error}</p>}
    </div>
  );
}

function PendingInvites({ workspace, isOwner }: { workspace: WorkspaceInfo; isOwner: boolean }) {
  const revokeInviteMutation = useRevokeWorkspaceInviteMutation();
  const [error, setError] = useState('');

  if (workspace.pendingInvites.length === 0) {
    return (
      <div className="dashboard-panel dashboard-workspace-invites">
        <div className="dashboard-panel-heading"><div><p className="dashboard-panel-kicker">Pending invites</p><h3>No one is waiting.</h3></div></div>
        <div className="dashboard-empty-state">
          <Mail size={20} strokeWidth={1.4} />
          <strong>Nothing pending.</strong>
          <span>Invites you send will show up here until they are accepted or expire.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-panel dashboard-workspace-invites">
      <div className="dashboard-panel-heading"><div><p className="dashboard-panel-kicker">Pending invites</p><h3>Seats being held.</h3></div></div>
      <ul className="dashboard-workspace-invite-list">
        {workspace.pendingInvites.map((invite) => (
          <li key={`${invite.email}:${invite.createdAt}`}>
            <span className="dashboard-workspace-invite-email">
              <Mail size={14} strokeWidth={1.6} />
              <span>{invite.email}</span>
            </span>
            <small>expires {formatDate(invite.expiresAt)}</small>
            {isOwner && (
              <button
                type="button"
                className="dashboard-workspace-revoke"
                onClick={() => {
                  void (async () => {
                    setError('');
                    try {
                      await revokeInviteMutation.mutateAsync(invite.token);
                    } catch (cause) {
                      setError(getApiError(cause, 'We could not revoke the invite.').message);
                    }
                  })();
                }}
                disabled={revokeInviteMutation.isPending}
                aria-label={`Revoke invite for ${invite.email}`}
              >
                <X size={13} strokeWidth={1.8} /> Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="dashboard-error" role="alert">{error}</p>}
    </div>
  );
}

function MemberRow({ member, isOwner, onRemove }: { member: WorkspaceMemberInfo; isOwner: boolean; onRemove: (member: WorkspaceMemberInfo) => void }) {
  return (
    <li className="dashboard-workspace-member-row">
      <UserAvatar name={member.displayName} avatarUrl={member.avatarUrl} size="sm" className="dashboard-workspace-member-avatar" />
      <span className="dashboard-workspace-member-copy">
        <strong>{member.displayName}</strong>
        <small>{member.email} · joined {formatDate(member.joinedAt)}</small>
      </span>
      <span className={`dashboard-workspace-role-badge${member.role === 'owner' ? ' is-owner' : ''}`}>{member.role === 'owner' ? 'Owner' : 'Member'}</span>
      {isOwner && member.role !== 'owner' && (
        <button type="button" className="dashboard-workspace-remove" onClick={() => onRemove(member)} aria-label={`Remove ${member.displayName}`}>
          <Trash2 size={13} strokeWidth={1.8} /> Remove
        </button>
      )}
    </li>
  );
}

function MembersCard({ workspace, isOwner, onRemoveRequest }: { workspace: WorkspaceInfo; isOwner: boolean; onRemoveRequest: (member: WorkspaceMemberInfo) => void }) {
  return (
    <div className="dashboard-panel dashboard-workspace-members">
      <div className="dashboard-panel-heading">
        <div><p className="dashboard-panel-kicker">Members</p><h3>Who is seated.</h3></div>
        <span className="dashboard-workspace-members-count"><UsersRound size={13} /> {workspace.members.length}</span>
      </div>
      <ul className="dashboard-workspace-member-list">
        {workspace.members.map((member) => (
          <MemberRow key={member.userId} member={member} isOwner={isOwner} onRemove={onRemoveRequest} />
        ))}
      </ul>
    </div>
  );
}

function WorkspacePanel() {
  const workspaceQuery = useWorkspaceQuery();
  const removeMemberMutation = useRemoveWorkspaceMemberMutation();
  const search = useSearch();
  const [error, setError] = useState('');
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMemberInfo | null>(null);
  const [removing, setRemoving] = useState(false);

  const workspace = workspaceQuery.data?.workspace ?? null;
  const isOwner = workspace?.myRole === 'owner';
  const justCancelledSeats = useMemo(() => new URLSearchParams(search).get('seats') === 'cancelled', [search]);
  // A failed load is rendered straight from the query state rather than synced
  // into a local state.
  const loadError = workspaceQuery.isError
    ? getApiError(workspaceQuery.error, 'We could not load the workspace.').message
    : '';

  const handleRemove = async () => {
    const member = memberToRemove;
    if (!member) return;
    setMemberToRemove(null);
    setRemoving(true);
    setError('');
    try {
      await removeMemberMutation.mutateAsync(member.userId);
    } catch (cause) {
      setError(getApiError(cause, 'We could not remove the member.').message);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <section className="dashboard-section-intro">
        <div>
          <p className="dashboard-kicker"><span /> Workspace / Team</p>
          <h2>Give the room<br /><em>a home.</em></h2>
        </div>
        <p>One subscription seats the whole team. Invite people by email, keep an eye on who is in, and add seats when the cap is not enough.</p>
      </section>

      {justCancelledSeats && (
        <p className="dashboard-billing-notice" role="status">
          <Check size={15} /> The seat checkout was cancelled. Nothing was charged and your seat count is unchanged.
        </p>
      )}

      {loadError ? (
        <p className="dashboard-error" role="alert">{loadError}</p>
      ) : workspaceQuery.isLoading ? (
        <div className="dashboard-empty-state"><span className="dashboard-loader" /> Loading your workspace…</div>
      ) : workspace ? (
        <section className="dashboard-workspace-grid">
          <SeatsCard workspace={workspace} isOwner={isOwner} />
          {isOwner && <InviteForm workspace={workspace} />}
          <MembersCard workspace={workspace} isOwner={isOwner} onRemoveRequest={setMemberToRemove} />
          {isOwner && <PendingInvites workspace={workspace} isOwner={isOwner} />}
        </section>
      ) : (
        <div className="dashboard-panel">
          <div className="dashboard-empty-state">
            <UsersRound size={20} strokeWidth={1.4} />
            <strong>No workspace yet.</strong>
            <span>The Team plan creates one the moment it is active. Nothing to do here until then.</span>
          </div>
        </div>
      )}

      {error && <p className="dashboard-error" role="alert">{error}</p>}

      {memberToRemove && (
        <ConfirmModal
          title="Remove member?"
          message={`“${memberToRemove.displayName}” loses access to the workspace and frees a seat. Their rooms and canvases are not deleted.`}
          confirmLabel={removing ? 'Removing…' : 'Remove member'}
          danger
          variant="dashboard"
          onCancel={() => { if (!removing) setMemberToRemove(null); }}
          onConfirm={() => { void handleRemove(); }}
        />
      )}
    </>
  );
}

export default WorkspacePanel;
