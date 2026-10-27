import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import useAnalyticsData from "../../hooks/useAnalyticsData";
import useOnlineStatus from "../../hooks/useOnlineStatus";
import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh";
import { useRegisterRefresh } from "../../context/RefreshContext";
import { Skeleton, SkeletonGrid } from "../../components/Skeleton";
import "./Dashboard.css";

/* ══ CONSTANTS ═══════════════════════════════════════════════════════════════ */

/* Records + payments: ang Today/revenue gikan sa payment tables, mao nga kinahanglan sila pareho.
   Ilisi sa exact table names kung lahi sa imong Supabase. */
const DASHBOARD_TABLES = [
  "birth_records",
  "marriage_records",
  "death_records",
  "birth_payments",
  "marriage_transactions",
  "death_transactions",
];

const COLORS = {
  birth:        "#378ADD",
  marriage:     "#1D9E75",
  death:        "#7F77DD",
  verification: "#BA7517",
};

const TYPE_COLORS = {
  Birth: COLORS.birth,
  Marriage: COLORS.marriage,
  Death: COLORS.death,
  Verification: COLORS.verification,
};

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ══ HELPERS ═════════════════════════════════════════════════════════════════ */
const numFmt = new Intl.NumberFormat("en-PH");
const phpFmt = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 });
const fmtNum = (v) => numFmt.format(Number(v || 0));
const fmtPct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`);
const fmtPHP = (v) => `₱${phpFmt.format(Number(v || 0))}`;
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_DATA = Object.freeze({});
const safeArr = (v) => (Array.isArray(v) ? v : EMPTY_ARRAY);

const useContainerWidth = (fallback = 560) => {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      setW(Math.round(el.getBoundingClientRect().width) || fallback);
    };

    update();
    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);

  return [ref, w];
};

/* ══ SVG LINE CHART ══════════════════════════════════════════════════════════ */
const LineChartStaticLayer = memo(function LineChartStaticLayer({ chartLabels, chartSeries, W, H, PAD, gradientPrefix }) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const allValues = chartSeries.flatMap((item) => safeArr(item.data));
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;
  const xScale = (index) => chartLabels.length <= 1
    ? PAD.left + innerW / 2
    : PAD.left + (index / (chartLabels.length - 1)) * innerW;
  const yScale = (value) => PAD.top + innerH - ((value - minVal) / range) * innerH;
  const pathD = (points) => {
    if (points.length < 2) return "";
    const result = [`M ${xScale(0)} ${yScale(points[0])}`];
    for (let i = 1; i < points.length; i++) {
      const x0 = xScale(i - 1), y0 = yScale(points[i - 1]);
      const x1 = xScale(i), y1 = yScale(points[i]);
      const controlX = (x0 + x1) / 2;
      result.push(`C ${controlX} ${y0} ${controlX} ${y1} ${x1} ${y1}`);
    }
    return result.join(" ");
  };
  const areaD = (points) => {
    if (points.length < 2) return "";
    const base = yScale(minVal);
    return `${pathD(points)} L ${xScale(points.length - 1)} ${base} L ${xScale(0)} ${base} Z`;
  };
  const tickVals = Array.from({ length: 5 }, (_, index) =>
    Math.round(minVal + (range / 4) * index)
  );

  // Thin x-axis labels based on actual available pixel space, so long labels
  // like "Aug 2026"/"Sep 2026" never overlap.
  const charWidth = 5.6;
  const longestLabelLen = Math.max(1, ...chartLabels.map((label) => (label || "").length));
  const estimatedLabelWidth = longestLabelLen * charWidth + 10;
  const spacingPerIndex = chartLabels.length > 1 ? innerW / (chartLabels.length - 1) : innerW;
  const maxLabelsThatFit = Math.max(1, Math.floor(innerW / estimatedLabelWidth) + 1);
  const step = Math.max(1, Math.ceil(chartLabels.length / maxLabelsThatFit));
  const lastRegularIdx = Math.floor((chartLabels.length - 1) / step) * step;
  const shouldShowLabel = (index) => {
    if (!chartLabels[index]) return false;
    if (index % step === 0) return true;
    if (index === chartLabels.length - 1) {
      return (index - lastRegularIdx) * spacingPerIndex >= estimatedLabelWidth;
    }
    return false;
  };

  return (
    <>
      <defs>
        {chartSeries.map((item, index) => (
          <linearGradient key={index} id={`${gradientPrefix}-grad-${index}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={item.color} stopOpacity="0.14" />
            <stop offset="100%" stopColor={item.color} stopOpacity="0.01" />
          </linearGradient>
        ))}
      </defs>
      {tickVals.map((value, index) => (
        <g key={index}>
          <line
            x1={PAD.left} y1={yScale(value)}
            x2={W - PAD.right} y2={yScale(value)}
            stroke="var(--an-border, #e5e7eb)"
            strokeWidth="0.5"
          />
          <text
            x={PAD.left - 6} y={yScale(value) + 4}
            textAnchor="end" fontSize="9"
            fill="var(--an-text-muted, #6b7280)"
          >
            {fmtNum(value)}
          </text>
        </g>
      ))}
      {chartLabels.map((label, index) => (
        shouldShowLabel(index) ? (
          <text
            key={index} x={xScale(index)} y={H - 4}
            textAnchor="middle" fontSize="9"
            fill="var(--an-text-muted, #6b7280)"
          >
            {label}
          </text>
        ) : null
      ))}
      {chartSeries.map((item, index) => (
        <path key={`area-${index}`} d={areaD(safeArr(item.data))} fill={`url(#${gradientPrefix}-grad-${index})`} />
      ))}
      {chartSeries.map((item, index) => (
        <path
          key={`line-${index}`}
          d={pathD(safeArr(item.data))}
          fill="none"
          stroke={item.color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
});

const LineChart = ({ series = [], labels = [], height = 180, showLegend = true }) => {
  const [hoverIdx, setHoverIdx] = useState(null);
  const gradientPrefix = useId().replace(/:/g, "");
  const svgRef = useRef(null);
  const [wrapRef, W] = useContainerWidth();
  const compact = W < 420;
  const H = compact ? Math.min(height, 180) : height;
  const PAD = useMemo(() => compact
    ? { top: 12, right: 10, bottom: 28, left: 34 }
    : { top: 16, right: 16, bottom: 32, left: 44 }, [compact]);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Normalize single-point data into a real 2-point ascending line (0 → value).
  const isSinglePoint = labels.length === 1;
  const chartLabels = useMemo(
    () => isSinglePoint ? ["", labels[0]] : labels,
    [isSinglePoint, labels]
  );
  const chartSeries = useMemo(
    () =>
      isSinglePoint
        ? series.map((s) => ({ ...s, data: [0, ...safeArr(s.data)] }))
        : series,
    [series, isSinglePoint]
  );

  const allValues = chartSeries.flatMap((s) => safeArr(s.data));
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  const xScale = (i) =>
    chartLabels.length <= 1
      ? PAD.left + innerW / 2
      : PAD.left + (i / (chartLabels.length - 1)) * innerW;

  const yScale = (v) => PAD.top + innerH - ((v - minVal) / range) * innerH;

  const handleMouseMove = useCallback((e) => {
    if (isSinglePoint) {
      setHoverIdx(1);
      return;
    }
    if (!svgRef.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = svgRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) * (W / rect.width);
    const relX = x - PAD.left;
    const idx = Math.round((relX / innerW) * (chartLabels.length - 1));
    setHoverIdx(Math.max(0, Math.min(chartLabels.length - 1, idx)));
  }, [chartLabels.length, isSinglePoint, W, innerW, PAD.left]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: H, display: "block", touchAction: "pan-y" }}
        onMouseMove={handleMouseMove}
        onTouchStart={handleMouseMove}
        onTouchMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchEnd={() => setHoverIdx(null)}
      >
        <LineChartStaticLayer
          chartLabels={chartLabels}
          chartSeries={chartSeries}
          W={W}
          H={H}
          PAD={PAD}
          gradientPrefix={gradientPrefix}
        />

        {hoverIdx != null && (
          <line
            x1={xScale(hoverIdx)} y1={PAD.top}
            x2={xScale(hoverIdx)} y2={H - PAD.bottom}
            stroke="var(--an-border-strong, #d1d5db)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        {hoverIdx != null && chartSeries.map((s, si) => {
          const v = safeArr(s.data)[hoverIdx];
          if (v == null) return null;
          return (
            <circle
              key={`dot-${si}`}
              cx={xScale(hoverIdx)} cy={yScale(v)}
              r="4" fill={s.color}
              stroke="var(--an-surface, #ffffff)" strokeWidth="2"
            />
          );
        })}
      </svg>

      {hoverIdx != null && (
        <div className="an-tooltip">
          <div className="an-tooltip-label">{chartLabels[hoverIdx]}</div>
          {chartSeries.map((s, si) => {
            const v = safeArr(s.data)[hoverIdx];
            return (
              <div key={si} className="an-tooltip-row">
                <span className="an-tooltip-dot" style={{ background: s.color }} />
                <span>{s.name}</span>
                <strong>{fmtNum(v)}</strong>
              </div>
            );
          })}
        </div>
      )}

      {showLegend && chartSeries.length > 1 && (
        <div className="an-legend">
          {chartSeries.map((s, si) => (
            <div key={si} className="an-legend-item">
              <span className="an-legend-dot" style={{ background: s.color }} />
              <span>{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ══ BAR CHART ═══════════════════════════════════════════════════════════════ */
const BarChart = ({
  rows = [],
  colorKey = "color",
  valueKey = "count",
  labelKey = "label",
  showValue = true,
}) => {
  const maxVal = Math.max(...rows.map((r) => Number(r[valueKey] || 0)), 1);
  return (
    <div className="an-bar-chart">
      {rows.map((row, i) => {
        const val = Number(row[valueKey] || 0);
        const pct = Math.round((val / maxVal) * 100);
        const color = row[colorKey] || COLORS.birth;
        return (
          <div key={i} className="an-bar-row">
            <div className="an-bar-label" title={row[labelKey]}>{row[labelKey]}</div>
            <div className="an-bar-track">
              <div className="an-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            {showValue && <div className="an-bar-val">{fmtNum(val)}</div>}
          </div>
        );
      })}
    </div>
  );
};

/* ══ STACKED BAR CHART ═══════════════════════════════════════════════════════ */
const StackedBar = ({ rows = [] }) => {
  const maxVal = Math.max(
    ...rows.map((r) => (r.Birth || 0) + (r.Marriage || 0) + (r.Death || 0)),
    1
  );
  return (
    <div className="an-stacked-chart">
      {rows.map((row, i) => {
        const total = (row.Birth || 0) + (row.Marriage || 0) + (row.Death || 0);
        const bPct = Math.round(((row.Birth || 0) / maxVal) * 100);
        const mPct = Math.round(((row.Marriage || 0) / maxVal) * 100);
        const dPct = Math.round(((row.Death || 0) / maxVal) * 100);
        return (
          <div key={i} className="an-stacked-row">
            <div className="an-stacked-label" title={row.name}>{row.name}</div>
            <div className="an-stacked-track">
              <div className="an-stacked-seg" style={{ width: `${bPct}%`, background: COLORS.birth }} title={`Birth: ${row.Birth}`} />
              <div className="an-stacked-seg" style={{ width: `${mPct}%`, background: COLORS.marriage }} title={`Marriage: ${row.Marriage}`} />
              <div className="an-stacked-seg" style={{ width: `${dPct}%`, background: COLORS.death }} title={`Death: ${row.Death}`} />
            </div>
            <div className="an-stacked-val">{fmtNum(total)}</div>
          </div>
        );
      })}
    </div>
  );
};

/* ══ DONUT CHART ═════════════════════════════════════════════════════════════ */
const DonutChart = ({ slices = [], size = 130 }) => {
  const [hovered, setHovered] = useState(null);
  const total = slices.reduce((s, sl) => s + Number(sl.count || 0), 0);
  if (!total) return <div className="an-empty-small">No data</div>;

  const r = 46, ir = 30, cx = size / 2, cy = size / 2;
  const visibleSlices = slices.filter((slice) => Number(slice.count || 0) > 0);
  const arcs = visibleSlices.map((sl, i) => {
    const angle = -Math.PI / 2 + visibleSlices
      .slice(0, i)
      .reduce((sum, slice) => sum + (Number(slice.count || 0) / total) * Math.PI * 2, 0);
    const val = Number(sl.count || 0);
    // Cap just below a full turn so a single 100% slice still draws a ring
    // (identical start and end points would render nothing).
    const sweep = Math.min((val / total) * Math.PI * 2, Math.PI * 2 - 0.0001);
    const end = angle + sweep;
    const la = sweep > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const ix1 = cx + ir * Math.cos(end), iy1 = cy + ir * Math.sin(end);
    const ix2 = cx + ir * Math.cos(angle), iy2 = cy + ir * Math.sin(angle);
    const path = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${la} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${ix1.toFixed(2)} ${iy1.toFixed(2)} A ${ir} ${ir} 0 ${la} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)} Z`;
    return {
      key: `${sl.label}-${i}`,
      path,
      color: sl.color,
      label: sl.label,
      count: val,
    };
  });

  const active = hovered != null ? arcs[hovered] : null;

  return (
    <div className="an-donut-wrap">
      <svg
        width={size} height={size}
        viewBox={`0 0 ${size} ${size}`}
        onMouseLeave={() => setHovered(null)}
      >
        {arcs.map((a, i) => (
          <path
            key={a.key}
            d={a.path}
            fill={a.color}
            opacity={hovered == null || hovered === i ? 1 : 0.4}
            style={{ cursor: "pointer", transition: "opacity .15s" }}
            onMouseEnter={() => setHovered(i)}
          />
        ))}
        <circle cx={cx} cy={cy} r={ir - 1} fill="var(--an-surface, #ffffff)" />
        <text
          x={cx} y={cy - 4}
          textAnchor="middle" fontSize="13" fontWeight="700"
          fill="var(--an-text, #111827)"
        >
          {active ? fmtNum(active.count) : fmtNum(total)}
        </text>
        <text
          x={cx} y={cy + 10}
          textAnchor="middle" fontSize="8"
          fill="var(--an-text-muted, #6b7280)"
        >
          {active ? active.label : "total"}
        </text>
      </svg>

      <div className="an-donut-legend">
        {slices.map((sl, i) => (
          <div
            key={sl.label}
            className="an-donut-item"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="an-donut-dot" style={{ background: sl.color }} />
            <span className="an-donut-name">{sl.label}</span>
            <strong className="an-donut-count">{fmtNum(sl.count)}</strong>
            <span className="an-donut-pct">{Math.round((sl.count / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ══ DELTA BADGE ═════════════════════════════════════════════════════════════ */
const GrowthBadge = ({ value }) => {
  if (value == null) return <span className="an-growth-neutral">—</span>;
  const tone = value > 0 ? "up" : value < 0 ? "down" : "neutral";
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  return (
    <span className={`an-delta an-delta--${tone}`}>
      {arrow} {Math.abs(value).toFixed(1)}%
    </span>
  );
};

/* ══ KPI STRIP ═══════════════════════════════════════════════════════════════
   One connected bar of stats separated by dividers, instead of separate cards.
   item: { label, value, caption, accent, delta: { text, tone }, onClick } */
const KpiStrip = ({ items = [] }) => (
  <div className="an-strip">
    {items.map((it) => {
      const clickable = typeof it.onClick === "function";
      return (
        <button
          key={it.label}
          type="button"
          className={`an-strip-item${clickable ? " an-strip-item--clickable" : ""}`}
          onClick={clickable ? it.onClick : undefined}
          disabled={!clickable}
          aria-label={clickable ? `Open ${it.label}` : undefined}
        >
          <div className="an-strip-label">
  <span>{it.label}</span>
</div>
          <div className="an-strip-row">
            <span className="an-strip-value">{it.value}</span>
            {it.delta && (
              <span className={`an-delta an-delta--${it.delta.tone}`}>{it.delta.text}</span>
            )}
          </div>
          {it.caption && <div className="an-strip-caption">{it.caption}</div>}
        </button>
      );
    })}
  </div>
);

/* ══ PANEL WRAPPER ═══════════════════════════════════════════════════════════ */
const Panel = ({ title, sub, children, full = false }) => (
  <section className={`an-panel${full ? " an-panel-full" : ""}`}>
    <div className="an-panel-head">
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
    </div>
    {children}
  </section>
);

/* ══ EMPTY ═══════════════════════════════════════════════════════════════════ */
const Empty = ({ msg = "No data available" }) => (
  <div className="an-empty">
    <span>📭</span>
    <span>{msg}</span>
  </div>
);

/* ══ TOP MUNICIPALITIES TABLE ════════════════════════════════════════════════ */
const MunicipalityTable = ({ rows = [] }) => {
  const [sortBy, setSortBy] = useState("cnt");
  const sorted = useMemo(
    () => [...rows].sort((a, b) => Number(b[sortBy] || 0) - Number(a[sortBy] || 0)),
    [rows, sortBy]
  );
  const max = sorted[0]?.[sortBy] || 1;

  const cols = [
    { key: "cnt",      label: "Total",    color: "#64748b" },
    { key: "Birth",    label: "Birth",    color: COLORS.birth },
    { key: "Marriage", label: "Marriage", color: COLORS.marriage },
    { key: "Death",    label: "Death",    color: COLORS.death },
  ];
  const activeCol = cols.find((c) => c.key === sortBy) || cols[0];

  return (
    <div className="an-muni-wrap">
      <div className="an-muni-sort">
        {cols.map((c) => (
          <button
            key={c.key}
            className={`an-muni-sort-btn${sortBy === c.key ? " active" : ""}`}
            style={
              sortBy === c.key
                ? { borderColor: c.color, color: c.color, background: `${c.color}12` }
                : {}
            }
            onClick={() => setSortBy(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="an-muni-list">
        {sorted.map((row, i) => {
          const val = Number(row[sortBy] || 0);
          const pct = Math.round((val / max) * 100);
          return (
            <div key={row.name} className="an-muni-row">
              <div className="an-muni-rank">{i + 1}</div>
              <div className="an-muni-info">
                <div className="an-muni-name">{row.name}</div>
                <div className="an-muni-bars">
                  <div className="an-muni-bar-wrap">
                    <div className="an-muni-bar-fill" style={{ width: `${pct}%`, background: activeCol.color }} />
                  </div>
                  <div className="an-muni-type-pills">
                    {row.Birth > 0 && <span className="an-type-pill" style={{ background: `${COLORS.birth}1a`, color: COLORS.birth }}>B {fmtNum(row.Birth)}</span>}
                    {row.Marriage > 0 && <span className="an-type-pill" style={{ background: `${COLORS.marriage}1a`, color: COLORS.marriage }}>M {fmtNum(row.Marriage)}</span>}
                    {row.Death > 0 && <span className="an-type-pill" style={{ background: `${COLORS.death}1a`, color: COLORS.death }}>D {fmtNum(row.Death)}</span>}
                  </div>
                </div>
              </div>
              <div className="an-muni-total" style={{ color: activeCol.color }}>{fmtNum(val)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ══ GROWTH RATE TABLE ═══════════════════════════════════════════════════════ */
const GrowthTable = ({ rows = [] }) => {
  const last12 = rows.slice(-12);
  return (
    <div className="an-growth-table-wrap">
      <table className="an-growth-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Total</th>
            <th>Birth</th>
            <th>Marriage</th>
            <th>Death</th>
            <th>MoM Growth</th>
          </tr>
        </thead>
        <tbody>
          {last12.slice().reverse().map((row, i) => (
            <tr key={row.label || i}>
              <td className="an-gt-period">{row.label}</td>
              <td className="an-gt-total">{fmtNum(row.count)}</td>
              <td style={{ color: COLORS.birth, fontWeight: 600 }}>{fmtNum(row.Birth)}</td>
              <td style={{ color: COLORS.marriage, fontWeight: 600 }}>{fmtNum(row.Marriage)}</td>
              <td style={{ color: COLORS.death, fontWeight: 600 }}>{fmtNum(row.Death)}</td>
              <td><GrowthBadge value={row.mom_growth} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ══ MONTH HEATMAP ═══════════════════════════════════════════════════════════ */
const toMonthMap = (rows) =>
  Object.fromEntries(safeArr(rows).map((r) => [Number(r.month_num), Number(r.count || 0)]));

const MonthHeatmap = ({ byMonth = [], reqByMonth = [] }) => {
  const months = MONTH_SHORT.slice(1);
  const recMap = toMonthMap(byMonth);
  const reqMap = toMonthMap(reqByMonth);

  const hasRecData = Object.values(recMap).some((v) => v > 0);
  const hasReqData = Object.values(reqMap).some((v) => v > 0);

  if (!hasRecData && !hasReqData) {
    return (
      <Empty msg="No monthly data — the date columns in your record tables may not be populated yet" />
    );
  }

  const renderRow = (label, map, baseColor) => {
    const maxVal = Math.max(...Object.values(map), 1);
    const hasAny = Object.values(map).some((v) => v > 0);

    return (
      <div className="an-heatmap-row">
        <div className="an-heatmap-track-label">{label}</div>
        {months.map((m, i) => {
          const val = map[i + 1] || 0;
          if (!hasAny) {
            return (
              <div key={m} className="an-heatmap-cell" title={`${m}: no data`}>
                <span className="an-heatmap-empty">—</span>
              </div>
            );
          }
          const alphaHex = Math.round(15 + (val / maxVal) * 80).toString(16).padStart(2, "0");
          return (
            <div
              key={m}
              className="an-heatmap-cell"
              title={`${m}: ${val > 0 ? fmtNum(val) : "no"} ${label.toLowerCase()}`}
              style={{ background: val > 0 ? `${baseColor}${alphaHex}` : "transparent" }}
            >
              <span style={{ opacity: val > 0 ? 1 : 0 }}>{fmtNum(val)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="an-heatmap">
      <div className="an-heatmap-row an-heatmap-header">
        <div className="an-heatmap-track-label" />
        {months.map((m) => (
          <div key={m} className="an-heatmap-month-label">{m}</div>
        ))}
      </div>
      {renderRow("Records", recMap, COLORS.birth)}
      {renderRow("Requests", reqMap, COLORS.marriage)}
    </div>
  );
};

/* ══ TODAY PANEL ═════════════════════════════════════════════════════════════ */
const TodayPanel = ({ today = {} }) => {
  const breakdown = safeArr(today.requests_breakdown);
  const payments = safeArr(today.payments_breakdown);

  return (
    <div className="an-today-grid">
      <div className="an-today-block">
        <div className="an-today-block-title">Requests today</div>
        <div className="an-today-big">{fmtNum(today.requests_today || 0)}</div>
        <div className="an-today-pills">
          {breakdown.map((r) => (
            <span
              key={r.label}
              className="an-today-pill"
              style={{
                background: `${TYPE_COLORS[r.label] || "#64748b"}1a`,
                color: TYPE_COLORS[r.label] || "#64748b",
              }}
            >
              {r.label} {fmtNum(r.count)}
            </span>
          ))}
        </div>
      </div>

      <div className="an-today-block">
        <div className="an-today-block-title">Revenue today</div>
        <div className="an-today-big">{fmtPHP(today.payments_amount_today || 0)}</div>
        <div className="an-today-pills">
          {payments.map((r) => (
            <span
              key={r.label}
              className="an-today-pill"
              style={{
                background: `${TYPE_COLORS[r.label] || "#64748b"}1a`,
                color: TYPE_COLORS[r.label] || "#64748b",
              }}
            >
              {r.label} {fmtPHP(r.amount)}
            </span>
          ))}
        </div>
      </div>

      <div className="an-today-block">
        <div className="an-today-block-title">Business window</div>
        <div className="an-today-window">
          <div className="an-today-window-label">Start</div>
          <div className="an-today-window-val">
            {today.business_day_start
              ? new Date(today.business_day_start).toLocaleTimeString("en-PH", {
                  hour: "2-digit", minute: "2-digit",
                })
              : "6:00 AM"}
          </div>
          <div className="an-today-window-label">Payments</div>
          <div className="an-today-window-val">
            {fmtNum(today.payments_today || 0)} transactions
          </div>
        </div>
      </div>
    </div>
  );
};

/* ══ GROWTH KPI HELPERS ══════════════════════════════════════════════════════ */
function buildGrowthKpis(growth) {
  const n = growth.length;
  const latestRow = n >= 1 ? growth[n - 1] : null;
  const prevRow = n >= 2 ? growth[n - 2] : null;

  let momValue = null;
  let momLabel = "Month-over-month request growth";

  if (latestRow) {
    if (latestRow.mom_growth != null) {
      momValue = latestRow.mom_growth;
      momLabel = `${latestRow.label} vs previous month`;
    } else if (prevRow && prevRow.count > 0) {
      momValue = parseFloat(
        (((latestRow.count - prevRow.count) / prevRow.count) * 100).toFixed(1)
      );
      momLabel = `${latestRow.label} vs ${prevRow.label}`;
    } else {
      momLabel = n === 1
        ? `Only 1 period tracked (${latestRow.label}) — need 2+ for MoM`
        : "Not enough data for comparison";
    }
  }

  let prevMomValue = null;
  let prevMomLabel = "Previous period growth rate";

  if (prevRow) {
    if (prevRow.mom_growth != null) {
      prevMomValue = prevRow.mom_growth;
      prevMomLabel = `${prevRow.label} vs its previous month`;
    } else {
      prevMomLabel = `${prevRow.label} was the first tracked period`;
    }
  } else if (n === 1) {
    prevMomLabel = "Need 2+ months of requests";
  }

  return {
    momRaw: momValue,
    momDisplay: momValue != null ? fmtPct(momValue) : (latestRow ? `${fmtNum(latestRow.count)} reqs` : "—"),
    momLabel,
    prevMomRaw: prevMomValue,
    prevMomDisplay: prevMomValue != null ? fmtPct(prevMomValue) : "—",
    prevMomLabel,
  };
}

const deltaFromPct = (v) => {
  if (v == null) return null;
  const tone = v > 0 ? "up" : v < 0 ? "down" : "neutral";
  return { text: `${v > 0 ? "↑" : v < 0 ? "↓" : "→"} ${Math.abs(v).toFixed(1)}%`, tone };
};

const MemoLineChart = memo(LineChart);
const MemoBarChart = memo(BarChart);
const MemoStackedBar = memo(StackedBar);
const MemoDonutChart = memo(DonutChart);
const MemoMunicipalityTable = memo(MunicipalityTable);

/* ══ MAIN ANALYTICS DASHBOARD ════════════════════════════════════════════════ */
const AnalyticsDashboard = ({ recordLinks = {} }) => {
  const { data: rawData, loading, error, refetch, stale } = useAnalyticsData();

  // Guard: a failed or missing response must never reach the render path as
  // null/undefined, otherwise reading data.summary throws and the page goes blank.
  const data = rawData ?? EMPTY_DATA;

  // A section is "still loading" only while no error has occurred. After an
  // error, missing sections render their empty state instead of a skeleton forever.
  const isPending = (key) => !error && data[key] === undefined;

  const online = useOnlineStatus();
  const [lastLiveAt, setLastLiveAt] = useState(null);
  const [lastSeenData, setLastSeenData] = useState(null);
  const [tab, setTab] = useState("overview");

  // Realtime: i-clear ang backend cache, dayon i-refetch ang dashboard.
  const handleRealtimeRefresh = useCallback(async () => {
    if (!navigator.onLine) return undefined;

    try {
      const base = import.meta.env.VITE_API_BASE_URL || "";
      const res = await fetch(`${base}/api/analytics/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        console.warn("[Dashboard] cache refresh failed:", res.status);
      }
    } catch (err) {
      // Dili hinungdan nga mo-stop ang refresh; mo-refetch gihapon.
      console.warn("[Dashboard] cache refresh unreachable:", err);
    }

    return refetch();
  }, [refetch]);

  // I-register ang refresh handler sa RefreshContext (naglinis una sa cache, dayon nagre-fetch).
  useRegisterRefresh(handleRealtimeRefresh);

  useRealtimeRefresh({
    tables: DASHBOARD_TABLES,
    onRefresh: handleRealtimeRefresh,
    channelName: "dashboard-live",
    debounceMs: 1500, // bulk import = usa ra ka refresh
    pollMs: 120000,   // backstop kung dili mo-live ang socket
  });

  // Remember when live (non-cached) data was last on screen, for the banner timestamp.
  useEffect(() => {
    if (
      online &&
      !stale?.fromCache &&
      data.summary &&
      !data.summary.__failed &&
      data !== lastSeenData
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- record the new live data object
      setLastSeenData(data);
      setLastLiveAt(Date.now());
    }
  }, [online, stale?.fromCache, data, lastSeenData]);

  const showOfflineBanner = !online || !!stale?.fromCache;
  const savedAt = stale?.cachedAt || lastLiveAt;

  const summary = data.summary || {};
  const byYear = safeArr(data.byYear);
  const byMonth = safeArr(data.byMonth);
  const reqYear = safeArr(data.reqByYear);
  const reqMonth = safeArr(data.reqByMonth);
  const munis = safeArr(data.topMunicipalities);
  const growth = safeArr(data.growthRate);
  const today = data.today || {};

  const byYearSeries = useMemo(() => {
    if (!byYear.length) return [];
    return [{ name: "Records uploaded", data: byYear.map((r) => r.count), color: COLORS.birth }];
  }, [byYear]);

  const growthSeries = useMemo(() => {
    if (!growth.length) return [];
    return [
      { name: "Birth", data: growth.map((r) => r.Birth || 0), color: COLORS.birth },
      { name: "Marriage", data: growth.map((r) => r.Marriage || 0), color: COLORS.marriage },
      { name: "Death", data: growth.map((r) => r.Death || 0), color: COLORS.death },
    ];
  }, [growth]);

  const yearLabels = useMemo(() => byYear.map((r) => String(r.year)), [byYear]);
  const growthLabels = useMemo(() => growth.map((r) => r.label), [growth]);

  const growthKpi = useMemo(() => buildGrowthKpis(growth), [growth]);

  const highestMonthValue = useMemo(
    () => (growth.length ? Math.max(...growth.map((r) => r.count)) : null),
    [growth]
  );

  const heroPeriod = byYear.length
    ? byYear.length > 1
      ? `${byYear[0].year}–${byYear[byYear.length - 1].year}`
      : `${byYear[0].year}`
    : null;

  const growthPeriod = growthLabels.length
    ? growthLabels.length > 1
      ? `${growthLabels[0]} – ${growthLabels[growthLabels.length - 1]}`
      : growthLabels[0]
    : null;

  const last12Growth = useMemo(() => growth.slice(-12), [growth]);
  const last12Period = last12Growth.length
    ? last12Growth.length > 1
      ? `${last12Growth[0].label} – ${last12Growth[last12Growth.length - 1].label}`
      : last12Growth[0].label
    : null;

  const donutSlices = useMemo(() => [
    { label: "Birth", count: summary.total_birth_records || 0, color: COLORS.birth },
    { label: "Marriage", count: summary.total_marriage_records || 0, color: COLORS.marriage },
    { label: "Death", count: summary.total_death_records || 0, color: COLORS.death },
  ], [summary.total_birth_records, summary.total_marriage_records, summary.total_death_records]);

  const byYearRows = useMemo(
    () => byYear.map((row) => ({ ...row, label: String(row.year), color: COLORS.birth })),
    [byYear]
  );
  const requestYearRows = useMemo(
    () => reqYear.map((row) => ({ ...row, label: String(row.year), color: COLORS.marriage })),
    [reqYear]
  );
  const byMonthRows = useMemo(
    () => byMonth.map((row) => ({ ...row, label: row.month_name, color: COLORS.birth })),
    [byMonth]
  );
  const requestMonthRows = useMemo(
    () => reqMonth.map((row) => ({ ...row, label: row.month_name, color: COLORS.marriage })),
    [reqMonth]
  );
  const topMunicipalityRows = useMemo(() => munis.slice(0, 15), [munis]);
  const hotspots = useMemo(() => {
    const top = (key, color) => [...munis]
      .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))
      .slice(0, 10)
      .map((row) => ({ label: row.name, count: row[key] || 0, color }));
    return {
      Birth: top("Birth", COLORS.birth),
      Marriage: top("Marriage", COLORS.marriage),
      Death: top("Death", COLORS.death),
    };
  }, [munis]);
  const todayRequestRows = useMemo(() => (today.requests_breakdown || []).map((row) => ({
    label: row.label,
    count: row.count,
    color: TYPE_COLORS[row.label] || "#64748b",
  })), [today.requests_breakdown]);
  const todayPaymentRows = useMemo(() => (today.payments_breakdown || []).map((row) => ({
    label: row.label,
    count: row.amount,
    color: TYPE_COLORS[row.label] || "#64748b",
  })), [today.payments_breakdown]);

  // Overview strip: totals + how many were uploaded today (shown as the delta badge).
  const uploadedToday = summary.uploaded_today_breakdown || {};
  const totalUploadedToday =
    (uploadedToday.birth || 0) + (uploadedToday.marriage || 0) + (uploadedToday.death || 0);

  const overviewKpis = [
    {
      label: "Total records",
      value: fmtNum(summary.total_records),
      caption: heroPeriod ? `All entries · ${heroPeriod}` : "All civil registry entries",
      accent: COLORS.birth,
      delta: { text: `+${fmtNum(totalUploadedToday)} today`, tone: totalUploadedToday > 0 ? "up" : "neutral" },
    },
    {
      label: "Birth records",
      value: fmtNum(summary.total_birth_records),
      caption: "Birth certificates",
      accent: COLORS.birth,
      delta: { text: `+${fmtNum(uploadedToday.birth || 0)} today`, tone: (uploadedToday.birth || 0) > 0 ? "up" : "neutral" },
      onClick: recordLinks.birth || undefined,
    },
    {
      label: "Marriage records",
      value: fmtNum(summary.total_marriage_records),
      caption: "Marriage certificates",
      accent: COLORS.marriage,
      delta: { text: `+${fmtNum(uploadedToday.marriage || 0)} today`, tone: (uploadedToday.marriage || 0) > 0 ? "up" : "neutral" },
      onClick: recordLinks.marriage || undefined,
    },
    {
      label: "Death records",
      value: fmtNum(summary.total_death_records),
      caption: "Death certificates",
      accent: COLORS.death,
      delta: { text: `+${fmtNum(uploadedToday.death || 0)} today`, tone: (uploadedToday.death || 0) > 0 ? "up" : "neutral" },
      onClick: recordLinks.death || undefined,
    },
  ];

  const growthKpis = [
    {
      label: "This Month vs. Last",
      value: growthKpi.momDisplay,
      caption: growthKpi.momLabel,
      accent: growthKpi.momRaw == null ? "#64748b" : growthKpi.momRaw >= 0 ? "#16a34a" : "#dc2626",
      delta: deltaFromPct(growthKpi.momRaw),
    },
    {
      label: "Last Month MoM",
      value: growthKpi.prevMomDisplay,
      caption: growthKpi.prevMomLabel,
      accent: "#64748b",
      delta: deltaFromPct(growthKpi.prevMomRaw),
    },
    {
      label: "Months Tracked",
      value: fmtNum(growth.length),
      caption: "Historical request periods",
      accent: COLORS.birth,
    },
    {
      label: "Highest Month",
      value: highestMonthValue !== null ? fmtNum(highestMonthValue) : "—",
      caption: "Peak request volume period",
      accent: COLORS.marriage,
    },
  ];

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "trends", label: "Trends" },
    { id: "geographic", label: "Geographic" },
    { id: "growth", label: "Growth Rate" },
    { id: "today", label: "Today" },
  ];

  if (loading) {
    return (
      <div className="an-wrapper">
        <Skeleton h={120} />
        <SkeletonGrid count={3} h={92} columns={3} style={{ marginTop: "0.75rem" }} />
        <div style={{ marginTop: "1rem" }}>
          <Skeleton h={320} />
        </div>
      </div>
    );
  }

  return (
    <div className="an-wrapper">
      {showOfflineBanner && (
        <div className="an-error-banner an-offline-banner">
          Offline mode: showing data saved on this device
          {savedAt ? ` (${new Date(savedAt).toLocaleString("en-PH")})` : ""}.
          <button className="an-error-retry an-offline-retry" onClick={() => refetch()}>Retry</button>
        </div>
      )}

      {error && (
        <div className="an-error-banner">
          {String(error)}
          <button className="an-error-retry" onClick={() => refetch()} style={{ marginLeft: 12 }}>
            Retry
          </button>
        </div>
      )}

      {/* Overview cards stay visible on every tab. */}
      <KpiStrip items={overviewKpis} />

      <div className="an-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`an-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="an-tab-content">
          <div className="an-two-col">
            <Panel title="Record type distribution" sub="Total civil registry records">
              <MemoDonutChart slices={donutSlices} size={130} />
            </Panel>
            <Panel title="Seasonal patterns" sub="Record & request volume by month of year">
              {isPending("byMonth") || isPending("reqByMonth")
                ? <Skeleton h={180} />
                : <MonthHeatmap byMonth={byMonth} reqByMonth={reqMonth} />}
            </Panel>
          </div>

          <Panel
            full
            title="Records uploaded per year"
            sub={heroPeriod ? `Historical civil registry growth, ${heroPeriod}` : "Historical civil registry growth"}
          >
            {isPending("byYear") ? <Skeleton h={200} /> : byYear.length ? (
              <MemoLineChart series={byYearSeries} labels={yearLabels} height={200} showLegend={false} />
            ) : (
              <Empty msg="No year data" />
            )}
          </Panel>
        </div>
      )}

      {tab === "trends" && (
        <div className="an-tab-content">
          <Panel
            full
            title="Monthly request volume by document type"
            sub={
              growthPeriod
                ? `Birth, marriage, and death certificate requests, ${growthPeriod}`
                : "Birth, marriage, and death certificate requests over time"
            }
          >
            {isPending("growthRate") ? <Skeleton h={220} /> : growthSeries.length ? (
              <MemoLineChart series={growthSeries} labels={growthLabels} height={220} showLegend />
            ) : (
              <Empty msg="No trend data" />
            )}
          </Panel>

          <div className="an-two-col">
            <Panel title="Records registered per year" sub="Total civil records entered into the system">
              {isPending("byYear") ? <Skeleton h={180} /> : byYear.length ? (
                <MemoBarChart rows={byYearRows} colorKey="color" valueKey="count" labelKey="label" />
              ) : <Empty />}
            </Panel>
            <Panel title="Certificate requests per year" sub="Requests across all document types">
              {isPending("reqByYear") ? <Skeleton h={180} /> : reqYear.length ? (
                <MemoBarChart rows={requestYearRows} colorKey="color" valueKey="count" labelKey="label" />
              ) : <Empty />}
            </Panel>
          </div>

          <Panel full title="Monthly seasonality — records" sub="Which months see the highest registration activity">
            {isPending("byMonth") ? <Skeleton h={180} /> : byMonth.length ? (
              <MemoBarChart rows={byMonthRows} colorKey="color" valueKey="count" labelKey="label" />
            ) : <Empty />}
          </Panel>

          <Panel full title="Monthly seasonality — requests" sub="Certificate request demand by month">
            {isPending("reqByMonth") ? <Skeleton h={180} /> : reqMonth.length ? (
              <MemoBarChart rows={requestMonthRows} colorKey="color" valueKey="count" labelKey="label" />
            ) : <Empty />}
          </Panel>
        </div>
      )}

      {tab === "geographic" && (
        <div className="an-tab-content">
          <Panel
            full
            title="Top municipalities & barangays"
            sub="Ranked by record volume — click a sort key to reorder"
          >
            {isPending("topMunicipalities") ? <Skeleton h={300} /> : munis.length ? (
              <>
                <MemoStackedBar rows={topMunicipalityRows} />
                <div style={{ marginTop: "1.25rem" }}>
                  <MemoMunicipalityTable rows={munis} />
                </div>
              </>
            ) : (
              <Empty msg="No municipality data — check that city/municipality fields are populated in your database" />
            )}
          </Panel>

          {!isPending("topMunicipalities") && munis.length > 0 && (
            <div className="an-three-col">
              <Panel title="Hotspot analysis — Birth records" sub="Municipalities with concentrated birth registrations">
                <MemoBarChart rows={hotspots.Birth} colorKey="color" valueKey="count" labelKey="label" />
              </Panel>
              <Panel title="Hotspot analysis — Marriage records" sub="Municipalities with the most marriage registrations">
                <MemoBarChart rows={hotspots.Marriage} colorKey="color" valueKey="count" labelKey="label" />
              </Panel>
              <Panel title="Hotspot analysis — Death records" sub="Municipalities with the highest death registrations">
                <MemoBarChart rows={hotspots.Death} colorKey="color" valueKey="count" labelKey="label" />
              </Panel>
            </div>
          )}
        </div>
      )}

      {tab === "growth" && (
        <div className="an-tab-content">
          {/* Growth KPIs sit below the overview cards, mirroring the Today layout. */}
          <KpiStrip items={growthKpis} />

          <Panel
            full
            title="Monthly request volume trend"
            sub={
              growthPeriod
                ? `All civil registry request types combined with per-type breakdown · ${growthPeriod}`
                : "All civil registry request types combined with per-type breakdown"
            }
          >
            {isPending("growthRate") ? <Skeleton h={240} /> : growthSeries.length ? (
              <MemoLineChart series={growthSeries} labels={growthLabels} height={240} showLegend />
            ) : <Empty />}
          </Panel>

          <Panel
            full
            title={last12Period ? `Month-over-month growth rate — ${last12Period}` : "Month-over-month growth rate"}
            sub="Positive = more requests than previous month · negative = fewer requests"
          >
            {isPending("growthRate") ? <Skeleton h={260} /> : growth.length ? <GrowthTable rows={growth} /> : <Empty />}
          </Panel>
        </div>
      )}

      {tab === "today" && (
        <div className="an-tab-content">
          <Panel full title="Today's activity" sub="Current business day window (6 AM rollover)">
            {isPending("today") ? <Skeleton h={240} /> : <TodayPanel today={today} />}
          </Panel>

          {isPending("today") ? <Skeleton h={220} /> : today.requests_breakdown?.length > 0 && (
            <div className="an-two-col">
              <Panel title="Requests breakdown" sub="Certificate types requested today">
                <MemoBarChart rows={todayRequestRows} colorKey="color" valueKey="count" labelKey="label" />
              </Panel>
              <Panel title="Revenue by type" sub="Payment amounts collected today per document type">
                <MemoBarChart rows={todayPaymentRows} colorKey="color" valueKey="count" labelKey="label" />
              </Panel>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboard;