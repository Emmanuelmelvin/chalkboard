import { useEffect, useState } from 'react';
import { LoaderCircle, Star } from 'lucide-react';
import {
  useAdminFeedbackQuery,
  useAdminFeedbackStatsQuery,
  useAdminRoomFeedbackQuery,
  useUpdateFeedbackStatusMutation,
} from '@/api/hooks';
import { useLoggerStore } from '@/stores/loggerStore';
import type { FeedbackCategory, FeedbackStatus, FeedbackSubmission, RoomSessionFeedbackRecord } from '@/api/types';
import AdminFeedbackCharts, { SentimentBadge } from '@/admin/AdminFeedbackCharts';

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug_report: 'Bug',
  feature_request: 'Feature',
  general: 'General',
};

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  closed: 'Closed',
  all: 'All statuses',
};

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Reporter({ submission }: { submission: FeedbackSubmission | RoomSessionFeedbackRecord }) {
  const { displayName, email, plan } = submission.user;
  return (
    <span className="admin-feedback-reporter" title={email}>
      {displayName}
      {plan && <em className={`admin-feedback-plan is-${plan}`}>{PLAN_LABELS[plan] ?? plan}</em>}
    </span>
  );
}

function getCategoryFromUrl(): FeedbackCategory | '' {
  const value = new URLSearchParams(window.location.search).get('category');
  return value === 'bug_report' || value === 'feature_request' || value === 'general' ? value : '';
}

/** Keep ?category= in the URL so the filter survives reloads and back/forward. */
function setCategoryInUrl(category: FeedbackCategory | '') {
  const nextUrl = new URL(window.location.href);
  if (category) nextUrl.searchParams.set('category', category);
  else nextUrl.searchParams.delete('category');
  window.history.pushState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}

function SubmissionRow({
  submission,
  busyId,
  onStatusChange,
}: {
  submission: FeedbackSubmission;
  busyId: string | null;
  onStatusChange: (id: string, status: Exclude<FeedbackStatus, 'new'>) => void;
}) {
  const nextActions: { status: Exclude<FeedbackStatus, 'new'>; label: string }[] =
    submission.status === 'new'
      ? [{ status: 'acknowledged', label: 'Acknowledge' }]
      : submission.status === 'acknowledged'
        ? [{ status: 'resolved', label: 'Resolve' }]
        : [{ status: 'closed', label: 'Close' }];

  return (
    <div className="admin-feedback-row">
      <div className="admin-feedback-row-head">
        <em className={`admin-status is-${submission.status}`}>{STATUS_LABELS[submission.status]}</em>
        <SentimentBadge sentiment={submission.sentiment} />
        <span className={`admin-feedback-category is-${submission.category}`}>
          {CATEGORY_LABELS[submission.category]}
        </span>
        <Reporter submission={submission} />
        {submission.contactEmail && <span className="admin-feedback-contact">{submission.contactEmail}</span>}
        <time className="admin-feedback-date">{formatDate(submission.createdAt)}</time>
      </div>
      <p className="admin-feedback-message">{submission.message}</p>
      {nextActions.length > 0 && (
        <button
          className="admin-secondary-button"
          type="button"
          disabled={busyId === submission.id}
          onClick={() => onStatusChange(submission.id, nextActions[0].status)}
        >
          {busyId === submission.id ? 'Updating…' : nextActions[0].label}
        </button>
      )}
    </div>
  );
}

function AdminFeedback() {
  const [statusFilter, setStatusFilter] = useState('new');
  const [categoryFilter, setCategoryFilter] = useState<FeedbackCategory | ''>(() => getCategoryFromUrl());
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const submissionsQuery = useAdminFeedbackQuery(statusFilter || undefined, categoryFilter || undefined);
  const roomFeedbackQuery = useAdminRoomFeedbackQuery();
  const statsQuery = useAdminFeedbackStatsQuery(days);
  const updateStatus = useUpdateFeedbackStatusMutation();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (submissionsQuery.error) {
      useLoggerStore.getState().notify('User feedback could not be loaded.', 'error', 4000);
    }
    if (roomFeedbackQuery.error) {
      useLoggerStore.getState().notify('Room session feedback could not be loaded.', 'error', 4000);
    }
    if (statsQuery.error) {
      useLoggerStore.getState().notify('Feedback stats could not be loaded.', 'error', 4000);
    }
  }, [submissionsQuery.error, roomFeedbackQuery.error, statsQuery.error]);

  // Keep the category filter in sync with the URL when the user navigates
  // back or forward through the admin console's pushState history.
  useEffect(() => {
    const handlePopState = () => setCategoryFilter(getCategoryFromUrl());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleCategoryChange = (category: FeedbackCategory | '') => {
    setCategoryFilter(category);
    setCategoryInUrl(category);
  };

  const handleStatusChange = (id: string, status: Exclude<FeedbackStatus, 'new'>) => {
    setBusyId(id);
    updateStatus.mutate(
      { id, input: { status } },
      {
        onSuccess: () => {
          useLoggerStore.getState().notify(`Feedback marked ${STATUS_LABELS[status].toLowerCase()}.`, 'success', 3000);
        },
        onError: () => {
          useLoggerStore.getState().notify('Could not update this submission.', 'error', 4000);
        },
        onSettled: () => setBusyId(null),
      },
    );
  };

  const submissions = submissionsQuery.data?.submissions ?? [];
  const roomFeedback = roomFeedbackQuery.data?.feedback ?? [];
  const loading = submissionsQuery.isLoading || roomFeedbackQuery.isLoading;

  return (
    <section className="admin-feedback-workspace">
      <AdminFeedbackCharts
        stats={statsQuery.data?.stats}
        loading={statsQuery.isLoading}
        days={days}
        onDaysChange={setDays}
        categoryFilter={categoryFilter}
        onCategoryFilter={handleCategoryChange}
      />
      <div className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <p className="admin-eyebrow">User voices</p>
            <h2>Product feedback</h2>
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="new">New</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="">All statuses</option>
          </select>
          <select value={categoryFilter} onChange={(event) => handleCategoryChange(event.target.value as FeedbackCategory | '')}>
            <option value="">All categories</option>
            <option value="bug_report">Bug</option>
            <option value="feature_request">Feature</option>
            <option value="general">General</option>
          </select>
        </div>
        {loading ? (
          <div className="admin-empty">
            <LoaderCircle className="admin-spin" size={18} />
            <span>Loading feedback…</span>
          </div>
        ) : submissions.length === 0 ? (
          <div className="admin-empty">
            <span>No submissions match this filter.</span>
          </div>
        ) : (
          <div className="admin-feedback-list">
            {submissions.map((submission) => (
              <SubmissionRow
                key={submission.id}
                submission={submission}
                busyId={busyId}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}
      </div>

      <div className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <p className="admin-eyebrow">Room sessions</p>
            <h2>Session ratings</h2>
          </div>
        </div>
        {loading ? (
          <div className="admin-empty">
            <LoaderCircle className="admin-spin" size={18} />
            <span>Loading ratings…</span>
          </div>
        ) : roomFeedback.length === 0 ? (
          <div className="admin-empty">
            <span>No session ratings yet.</span>
          </div>
        ) : (
          <div className="admin-feedback-list">
            {roomFeedback.map((item) => (
              <div className="admin-feedback-row" key={item.id}>
                <div className="admin-feedback-row-head">
                  <span className="admin-feedback-stars" aria-label={`${item.rating} out of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <Star
                        key={value}
                        size={14}
                        aria-hidden="true"
                        fill={value <= item.rating ? 'currentColor' : 'none'}
                      />
                    ))}
                  </span>
                  <SentimentBadge sentiment={item.sentiment} />
                  <strong className="admin-feedback-room">{item.room.title}</strong>
                  <Reporter submission={item} />
                  <time className="admin-feedback-date">{formatDate(item.updatedAt)}</time>
                </div>
                {item.note && <p className="admin-feedback-message">{item.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default AdminFeedback;