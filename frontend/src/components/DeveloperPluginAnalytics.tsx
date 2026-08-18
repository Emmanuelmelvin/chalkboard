import { useMemo, useState } from "react";
import { LoaderCircle, PieChart } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMyPluginAnalyticsQuery } from "@/api/hooks";
import { ApiRequestError } from "@/api/client";
import type {
  ManagedPluginAnalytics,
  ManagedPluginPlan
} from "@/api/types";

/**
 * The developer's own analytics for one of their plugins.
 *
 * The same numbers the admin community drawer shows — usage units, unique
 * users, active days, daily/monthly series — but deliberately without the pool
 * breakdown. A developer gets to see how their plugin is used and the share of
 * the pool it is entitled to; how every other plugin's slice compares is the
 * admin's view, not a developer's business.
 *
 * The dashboard tab renders Recharts only when a plugin is selected, so a
 * board user never pays for this module.
 */

const GOLD = "var(--dashboard-gold)";
const GOLD_BRIGHT = "var(--dashboard-gold-bright)";
const GREEN = "#91ce96";
const LINE = "rgba(141, 136, 127, 0.18)";
const MUTED = "var(--dashboard-muted)";

const axisStyle = { fontSize: 9, fill: MUTED } as const;

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMonth(label: string) {
  const [year, month] = label.split("-").map(Number);
  if (!year || !month) return label;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/**
 * `apiRequest` normalises every failure into an `ApiRequestError` carrying the
 * server's stable error code, so we translate that code rather than parsing a
 * raw response. Anything unmapped keeps the message the client derived.
 */
function errorMessage(error: unknown, fallback: string) {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  if (!code) return error instanceof Error ? error.message : fallback;
  const messages: Record<string, string> = {
    plugin_not_found: "That plugin no longer exists.",
    rate_limited: "Too many requests in a short window. Wait a moment.",
    forbidden: "This is not one of your plugins.",
  };
  return messages[code] ?? (error instanceof Error ? error.message : code.replace(/_/g, " "));
}

/**
 * Recharts' default tooltip is a white card, which is unreadable on this
 * palette, so it is replaced wholesale rather than themed prop by prop.
 */
function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  label?: string | number;
  labelFormatter?: (value: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dashboard-analytics-tooltip">
      <strong>{labelFormatter ? labelFormatter(String(label)) : String(label)}</strong>
      {payload.map((entry) => (
        <span key={String(entry.dataKey)}>
          <i style={{ background: entry.color }} />
          {entry.name}
          <b>{entry.value}</b>
        </span>
      ))}
    </div>
  );
}

function formatDayTick(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatMonthTick(value: string) {
  const date = new Date(`${value}-01T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

function UsageChart({
  usage,
  range,
}: {
  usage: ManagedPluginAnalytics["usage"];
  range: "daily" | "monthly";
}) {
  const data = useMemo(
    () =>
      range === "daily"
        ? usage.daily.map((point) => ({ label: point.day, units: point.units, users: point.uniqueUsers }))
        : usage.monthly.map((point) => ({ label: point.month, units: point.units, users: point.uniqueUsers })),
    [usage, range],
  );

  const formatTick = range === "daily" ? formatDayTick : formatMonthTick;

  return (
    <div className="dashboard-analytics-chart">
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -22 }}>
          <defs>
            {/* A fade rather than a flat fill: it keeps the area from
                overwhelming the unique-users line drawn across it. */}
            <linearGradient id="dashboard-analytics-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--dashboard-gold)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--dashboard-gold)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={LINE} vertical={false} />
          <XAxis
            dataKey="label"
            tickFormatter={formatTick}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: LINE }}
            minTickGap={18}
          />
          <YAxis
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
            width={46}
            // Usage units are whole numbers; fractional ticks would be nonsense.
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: GOLD, strokeOpacity: 0.35 }}
            content={<ChartTooltip labelFormatter={formatTick} />}
          />
          <Area
            type="monotone"
            dataKey="units"
            name="Usage units"
            stroke={GOLD_BRIGHT}
            strokeWidth={1.5}
            fill="url(#dashboard-analytics-fill)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="users"
            name="Unique users"
            stroke={GREEN}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="dashboard-analytics-legend">
        <span>
          <i style={{ background: GOLD_BRIGHT }} /> Usage units
        </span>
        <span>
          <i style={{ background: GREEN }} /> Unique users
        </span>
      </div>
    </div>
  );
}

export default function DeveloperPluginAnalytics({
  pluginId,
  plan,
}: {
  pluginId: string;
  plan: ManagedPluginPlan;
}) {
  const [range, setRange] = useState<"daily" | "monthly">("daily");
  const query = useMyPluginAnalyticsQuery(pluginId);
  const analytics = query.data?.analytics ?? null;
  const error = query.isError ? errorMessage(query.error, "Could not load this plugin.") : "";

  // The charts are zero-filled server-side, so "has data" cannot be inferred
  // from series length — an all-zero month is still thirty points.
  const hasUsage = useMemo(() => {
    if (!analytics) return false;
    const series = range === "daily" ? analytics.usage.daily : analytics.usage.monthly;
    return series.some((point) => point.units > 0);
  }, [analytics, range]);

  // Free plugins can earn units, and the pool split counts them, so the share
  // block is shown whenever there is something to say — a Pro plugin always,
  // a Free plugin only once it has actually measured usage.
  const showEntitlement =
    plan === "pro" || (analytics ? Number(analytics.entitlement.poolSharePercent) > 0 : false);

  return (
    <section className="dashboard-developer-analytics">
      <div className="dashboard-developer-analytics-heading">
        <div>
          <p className="dashboard-panel-kicker">Analytics</p>
          <h3>Usage by paying users</h3>
        </div>
        <div className="dashboard-analytics-range">
          <button
            type="button"
            className={range === "daily" ? "is-active" : ""}
            onClick={() => setRange("daily")}
          >
            Daily
          </button>
          <button
            type="button"
            className={range === "monthly" ? "is-active" : ""}
            onClick={() => setRange("monthly")}
          >
            Monthly
          </button>
        </div>
      </div>

      {error ? (
        <p className="dashboard-analytics-error">{error}</p>
      ) : !analytics ? (
        <div className="dashboard-analytics-empty">
          <LoaderCircle className="is-spinning" size={18} /> Loading analytics…
        </div>
      ) : (
        <>
          {hasUsage ? (
            <UsageChart usage={analytics.usage} range={range} />
          ) : (
            <div className="dashboard-analytics-empty">
              <PieChart size={20} />
              <strong>No measured usage.</strong>
              <span>Nothing has been recorded for this range yet.</span>
            </div>
          )}

          <div className="dashboard-analytics-stats">
            <article>
              <span>Usage this period</span>
              <strong>{analytics.usage.unitsThisPeriod}</strong>
              <small>{analytics.usage.uniqueUsersThisPeriod} unique user(s)</small>
            </article>
            <article>
              <span>Active days</span>
              <strong>{analytics.usage.activeDaysThisPeriod}</strong>
              <small>days with at least one use</small>
            </article>
            <article>
              <span>All time</span>
              <strong>{analytics.usage.unitsAllTime}</strong>
              <small>{analytics.usage.uniqueUsersAllTime} unique user(s)</small>
            </article>
          </div>

          <div className="dashboard-analytics-meta">
            <span>
              First seen <strong>{formatDate(analytics.usage.firstSeen)}</strong>
            </span>
            <span>
              Last seen <strong>{formatDate(analytics.usage.lastSeen)}</strong>
            </span>
            <span>
              Version <strong>{analytics.plugin.currentVersion ?? "—"}</strong>
            </span>
            <span>
              Status <strong>{analytics.plugin.status.replace("_", " ")}</strong>
            </span>
          </div>

          {/* One unit, once per user per day: the rule that makes a share
              impossible to inflate by calling the host in a loop. */}
          <small className="dashboard-analytics-note">
            A usage unit is one paying user exercising this plugin on one UTC day. Repeat calls within a day
            count once, so a plugin cannot inflate its own share.
          </small>

          {showEntitlement && (
            <div className="dashboard-analytics-entitlement">
              <span>Developer pool entitlement</span>
              <strong>{analytics.entitlement.poolSharePercent}%</strong>
              <small>
                of the developer pool ({analytics.entitlement.poolRate} of paid revenue)
                {" · "}
                {formatMonth(analytics.entitlement.periodLabel)}
                {analytics.entitlement.distributed ? " · closed" : " · still accruing"}
              </small>
            </div>
          )}
        </>
      )}
    </section>
  );
}
