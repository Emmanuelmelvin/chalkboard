import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CommunityPluginAnalytics } from '@/api/adminCommunity';

/**
 * Charts for the community drawer.
 *
 * Kept out of `AdminCommunity.tsx` so the Recharts import sits in one place —
 * it is the heaviest dependency in the admin bundle, and a single module makes
 * it obvious where the weight is. It only ever loads on `admin.html`, which is
 * a separate Rollup entry, so no board user pays for it.
 *
 * Colours are read from the CSS custom properties rather than hard-coded. SVG
 * `fill` and `stroke` accept `var()` directly, so the charts follow the admin
 * palette in `Admin.css` and cannot drift out of sync with it.
 */

const GOLD = 'var(--admin-gold)';
const GOLD_BRIGHT = 'var(--admin-gold-bright)';
const GREEN = 'var(--admin-green)';
const LINE = 'rgba(198, 181, 145, 0.18)';
const MUTED = '#918b80';

/** Dim golds for the "other plugins" slices, so the current one stands out. */
const OTHER_SLICE_COLOURS = [
  'rgba(198, 181, 145, 0.42)',
  'rgba(198, 181, 145, 0.30)',
  'rgba(198, 181, 145, 0.22)',
  'rgba(198, 181, 145, 0.16)',
];

const axisStyle = { fontSize: 9, fill: MUTED } as const;

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
    <div className="admin-chart-tooltip">
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
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatMonthTick(value: string) {
  const date = new Date(`${value}-01T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
}

export interface UsageChartProps {
  usage: CommunityPluginAnalytics['usage'];
  range: 'daily' | 'monthly';
}

/**
 * Usage over time: units as a filled area, unique users as a line on top.
 *
 * The two series share an axis on purpose. Unique users can never exceed units
 * — a user contributes at most one unit per day — so the line always sits at or
 * below the area, and the gap between them is directly readable as intensity of
 * use: a wide gap means a handful of people using the plugin every day, the two
 * converging means many people trying it once.
 */
export function UsageChart({ usage, range }: UsageChartProps) {
  const data = useMemo(
    () =>
      range === 'daily'
        ? usage.daily.map((point) => ({ label: point.day, units: point.units, users: point.uniqueUsers }))
        : usage.monthly.map((point) => ({ label: point.month, units: point.units, users: point.uniqueUsers })),
    [usage, range],
  );

  const formatTick = range === 'daily' ? formatDayTick : formatMonthTick;

  return (
    <div className="admin-chart">
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -22 }}>
          <defs>
            {/* A fade rather than a flat fill: it keeps the area from
                overwhelming the unique-users line drawn across it. */}
            <linearGradient id="admin-usage-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--admin-gold)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--admin-gold)" stopOpacity={0.02} />
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
            fill="url(#admin-usage-fill)"
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
      <div className="admin-chart-legend">
        <span><i style={{ background: GOLD_BRIGHT }} /> Usage units</span>
        <span><i style={{ background: GREEN }} /> Unique users</span>
      </div>
    </div>
  );
}

export interface PoolShareChartProps {
  breakdown: CommunityPluginAnalytics['poolBreakdown'];
  currentName: string;
  sharePercent: string;
}

/**
 * The plugin's slice of the pool, against every other plugin that earned units.
 *
 * The tail is collapsed into a single "others" slice past the top few: a donut
 * with thirty hairline wedges communicates nothing, and the question this
 * answers is "how big is *this* one", not "rank them all".
 */
export function PoolShareChart({ breakdown, currentName, sharePercent }: PoolShareChartProps) {
  const data = useMemo(() => {
    const current = breakdown.find((entry) => entry.isCurrent);
    const others = breakdown.filter((entry) => !entry.isCurrent);
    const top = others.slice(0, 4);
    const rest = others.slice(4);
    const restTotal = rest.reduce((sum, entry) => sum + Number(entry.poolSharePercent), 0);

    const slices = [
      { name: current?.name ?? currentName, value: Number(sharePercent), isCurrent: true },
      ...top.map((entry) => ({ name: entry.name, value: Number(entry.poolSharePercent), isCurrent: false })),
    ];
    if (restTotal > 0) {
      slices.push({ name: `${rest.length} other plugin(s)`, value: Number(restTotal.toFixed(2)), isCurrent: false });
    }
    return slices.filter((slice) => slice.value > 0);
  }, [breakdown, currentName, sharePercent]);

  if (data.length === 0) return null;

  return (
    <div className="admin-chart admin-chart-donut">
      <ResponsiveContainer width="100%" height={190}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={52}
            outerRadius={78}
            paddingAngle={1.5}
            stroke="var(--admin-panel)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((slice, index) => (
              <Cell
                key={slice.name}
                fill={slice.isCurrent ? GOLD : OTHER_SLICE_COLOURS[index % OTHER_SLICE_COLOURS.length]}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {/* The headline number sits in the hole rather than on a slice: it is the
          one figure the donut exists to make concrete. */}
      <div className="admin-chart-donut-centre">
        <strong>{sharePercent}%</strong>
        <small>of pool</small>
      </div>
    </div>
  );
}
