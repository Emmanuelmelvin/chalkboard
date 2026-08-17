import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LoaderCircle, Star } from 'lucide-react';
import type { FeedbackCategory, FeedbackSentiment, FeedbackStats } from '@/api/types';

const POSITIVE = 'var(--admin-green)';
const NEUTRAL = '#8a8577';
const NEGATIVE = 'var(--admin-red)';
const LINE = 'rgba(198, 181, 145, 0.18)';
const axisStyle = { fontSize: 9, fill: '#918b80' } as const;

const CATEGORY_META: { id: FeedbackCategory; label: string; color: string }[] = [
  { id: 'bug_report', label: 'Bug reports', color: 'var(--admin-red)' },
  { id: 'feature_request', label: 'Feature requests', color: 'var(--admin-gold-bright)' },
  { id: 'general', label: 'General', color: '#7fb2e8' },
];

const SENTIMENT_META: { id: FeedbackSentiment; label: string; color: string }[] = [
  { id: 'positive', label: 'Positive', color: POSITIVE },
  { id: 'neutral', label: 'Neutral', color: NEUTRAL },
  { id: 'negative', label: 'Negative', color: NEGATIVE },
];

const RANGE_OPTIONS: { value: 7 | 30 | 90; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

function formatShortDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const title = label === undefined || label === '' ? payload[0]?.name ?? '' : formatShortDate(String(label));
  return (
    <div className="admin-chart-tooltip">
      <strong>{title}</strong>
      {payload.map((entry) => (
        <span key={String(entry.dataKey)}>
          <i style={{ background: entry.color }} />
          {entry.name}: {entry.value}
        </span>
      ))}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'positive' | 'neutral' | 'negative';
  children?: React.ReactNode;
}) {
  return (
    <div className="admin-feedback-kpi">
      <span className="admin-feedback-kpi-label">{label}</span>
      <strong className={tone ? `is-${tone}` : undefined}>{value}</strong>
      {hint && <span className="admin-feedback-kpi-hint">{hint}</span>}
      {children}
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment: FeedbackSentiment }) {
  const label = sentiment === 'positive' ? 'Positive' : sentiment === 'negative' ? 'Negative' : 'Neutral';
  return <em className={`admin-sentiment is-${sentiment}`}>{label}</em>;
}

export default function AdminFeedbackCharts({
  stats,
  loading,
  days,
  onDaysChange,
  categoryFilter,
  onCategoryFilter,
}: {
  stats: FeedbackStats | undefined;
  loading: boolean;
  days: 7 | 30 | 90;
  onDaysChange: (days: 7 | 30 | 90) => void;
  categoryFilter: FeedbackCategory | '';
  onCategoryFilter: (category: FeedbackCategory | '') => void;
}) {
  if (loading && !stats) {
    return (
      <div className="admin-empty">
        <LoaderCircle className="admin-spin" size={18} />
        <span>Crunching feedback…</span>
      </div>
    );
  }
  if (!stats) return null;

  const { submissions, roomRatings } = stats;
  const satisfactionTone: 'positive' | 'neutral' | 'negative' =
    submissions.total === 0 ? 'neutral' : submissions.positivePct >= 60 ? 'positive' : submissions.positivePct >= 40 ? 'neutral' : 'negative';

  const donutData = CATEGORY_META.map((meta) => ({
    name: meta.label,
    value: stats.byCategory[meta.id].total,
    color: meta.color,
    category: meta.id,
  }));
  const totalDonut = donutData.reduce((sum, item) => sum + item.value, 0);

  const stackedData = CATEGORY_META.map((meta) => ({
    name: meta.label,
    positive: stats.byCategory[meta.id].positive,
    neutral: stats.byCategory[meta.id].neutral,
    negative: stats.byCategory[meta.id].negative,
  }));

  const toggleCategory = (category: FeedbackCategory | '') => {
    const next = categoryFilter === category ? '' : category;
    onCategoryFilter(next);
  };

  const selectedIndex = categoryFilter ? CATEGORY_META.findIndex((meta) => meta.id === categoryFilter) : -1;

  return (
    <>
      <div className="admin-feedback-kpis">
        <KpiCard label="Submissions" value={String(submissions.total)} hint={`last ${days} days`}>
          <div className="admin-feedback-spark" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.volume} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="feedbackSparkFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--admin-gold)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--admin-gold)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--admin-gold)"
                  strokeWidth={1.5}
                  fill="url(#feedbackSparkFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </KpiCard>

        <KpiCard
          label="Satisfaction"
          value={submissions.total === 0 ? '—' : `${submissions.positivePct}%`}
          hint={submissions.total === 0 ? 'no submissions yet' : `${submissions.positive} positive of ${submissions.total}`}
          tone={satisfactionTone}
        />

        <KpiCard
          label="Avg room rating"
          value={roomRatings.average === null ? '—' : `${roomRatings.average.toFixed(1)} / 5`}
          hint={`${roomRatings.count} rating${roomRatings.count === 1 ? '' : 's'}`}
        >
          <span className="admin-feedback-kpi-stars" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((value) => (
              <Star
                key={value}
                size={13}
                fill={
                  roomRatings.average !== null && value <= Math.round(roomRatings.average)
                    ? 'currentColor'
                    : 'none'
                }
              />
            ))}
          </span>
        </KpiCard>

        <KpiCard label="Open backlog" value={String(stats.openCount)} hint="new + acknowledged" />
      </div>

      <div className="admin-feedback-charts">
        <div className="admin-feedback-chart admin-feedback-chart-donut">
          <div className="admin-feedback-chart-head">
            <span>Category mix</span>
            <div className="admin-range-toggle" role="group" aria-label="Stats window">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={days === option.value ? 'is-active' : undefined}
                  onClick={() => onDaysChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {totalDonut === 0 ? (
            <div className="admin-empty">
              <span>No submissions in this window.</span>
            </div>
          ) : (
            <>
              <div className="admin-feedback-donut">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Tooltip content={<ChartTooltip />} />
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={2}
                      strokeWidth={0}
                      isAnimationActive={false}
                      onClick={(entry: { category: FeedbackCategory }) => toggleCategory(entry.category)}
                    >
                      {donutData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={entry.color}
                          opacity={categoryFilter && selectedIndex !== index ? 0.28 : 1}
                          cursor="pointer"
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="admin-feedback-donut-center">
                  <strong>{totalDonut}</strong>
                  <span>total</span>
                </div>
              </div>
              <div className="admin-chart-legend">
                {CATEGORY_META.map((meta) => (
                  <button
                    key={meta.id}
                    type="button"
                    className={`admin-chart-legend-chip${categoryFilter === meta.id ? ' is-active' : ''}`}
                    onClick={() => toggleCategory(meta.id)}
                  >
                    <i style={{ background: meta.color }} />
                    {meta.label}
                    <b>{stats.byCategory[meta.id].total}</b>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="admin-feedback-chart">
          <div className="admin-feedback-chart-head">
            <span>Sentiment by category</span>
          </div>
          {totalDonut === 0 ? (
            <div className="admin-empty">
              <span>Nothing to break down yet.</span>
            </div>
          ) : (
            <>
              <div className="admin-feedback-bars">
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart
                    data={stackedData}
                    layout="vertical"
                    margin={{ top: 4, right: 10, bottom: 0, left: 0 }}
                    barSize={14}
                  >
                    <CartesianGrid stroke={LINE} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ ...axisStyle }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={92}
                      tick={{ ...axisStyle }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip cursor={{ fill: 'rgba(198, 181, 145, 0.08)' }} content={<ChartTooltip />} />
                    {SENTIMENT_META.map((meta) => (
                      <Bar key={meta.id} dataKey={meta.id} stackId="sentiment" fill={meta.color} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="admin-chart-legend">
                {SENTIMENT_META.map((meta) => (
                  <span key={meta.id} className="admin-chart-legend-chip">
                    <i style={{ background: meta.color }} />
                    {meta.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {categoryFilter && (
        <p className="admin-feedback-filter-note">
          Showing {CATEGORY_META.find((meta) => meta.id === categoryFilter)?.label.toLowerCase()} in the
          list below. <button type="button" onClick={() => onCategoryFilter('')}>Clear filter</button>
        </p>
      )}
    </>
  );
}

export { SentimentBadge };