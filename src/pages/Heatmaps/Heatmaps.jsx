import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { pushToast } from "../../services/toastService";
import { fetchResidents } from "../../services/demographicsService";
import { useRegisterRefresh } from "../../context/RefreshContext";
import {
  AGE_GROUPS,
  DEMOGRAPHIC_TYPES,
  DEMO_STATS,
  EMPLOYMENT_FILTERS,
  VOTING_FILTERS,
  aggregateByBarangay,
  filterRecords,
  formatPercent,
  prepareResidents,
  sumStats,
} from "../../utils/demographics";
import "./Heatmaps.css";

/* ════════════════════════════════════
   DATA & CONSTANTS
════════════════════════════════════ */

const RAW_BARANGAY_DATA = [
  { name: "Barangay I (Poblacion)", birth: 240, marriage: 95, death: 55 },
  { name: "Barangay II (Poblacion)", birth: 225, marriage: 88, death: 50 },
  { name: "Prosperidad", birth: 265, marriage: 88, death: 40 },
  { name: "Barangay III (Poblacion)", birth: 198, marriage: 70, death: 45 },
  { name: "Barangay IV (Poblacion)", birth: 180, marriage: 65, death: 40 },
  { name: "Quezon", birth: 205, marriage: 60, death: 30 },
  { name: "Barangay V (Poblacion)", birth: 165, marriage: 58, death: 35 },
  { name: "San Juan (Sipaway)", birth: 210, marriage: 45, death: 32 },
  { name: "Barangay VI (Poblacion)", birth: 150, marriage: 50, death: 30 },
  { name: "Rizal", birth: 190, marriage: 52, death: 28 },
  { name: "Guadalupe", birth: 155, marriage: 38, death: 24 },
  { name: "Punao", birth: 175, marriage: 40, death: 25 },
  { name: "Codcod", birth: 140, marriage: 35, death: 22 },
  { name: "Ermita (Sipaway)", birth: 130, marriage: 30, death: 20 },
  { name: "Bagonbon", birth: 120, marriage: 28, death: 18 },
  { name: "Buluangan", birth: 110, marriage: 25, death: 16 },
  { name: "Nataban", birth: 95, marriage: 20, death: 14 },
  { name: "Palampas", birth: 0, marriage: 0, death: 0 },
];

const BARANGAY_NAMES = RAW_BARANGAY_DATA.map((b) => b.name);

const BARANGAY_COORDS = {
  "Bagonbon": { lat: 10.5820, lng: 123.3989 },
  "Barangay I (Poblacion)": { lat: 10.4939, lng: 123.4273 },
  "Barangay II (Poblacion)": { lat: 10.4842, lng: 123.4111 },
  "Barangay III (Poblacion)": { lat: 10.4844, lng: 123.4236 },
  "Barangay IV (Poblacion)": { lat: 10.4826, lng: 123.4172 },
  "Barangay V (Poblacion)": { lat: 10.4792, lng: 123.4127 },
  "Barangay VI (Poblacion)": { lat: 10.4800, lng: 123.4222 },
  "Buluangan": { lat: 10.3874, lng: 123.3376 },
  "Codcod": { lat: 10.4574, lng: 123.2173 },
  "Ermita (Sipaway)": { lat: 10.4435, lng: 123.4186 },
  "Guadalupe": { lat: 10.4541, lng: 123.3696 },
  "Nataban": { lat: 10.4973, lng: 123.3049 },
  "Palampas": { lat: 10.5135, lng: 123.4106 },
  "Prosperidad": { lat: 10.5122, lng: 123.2785 },
  "Punao": { lat: 10.5305, lng: 123.4329 },
  "Quezon": { lat: 10.4360, lng: 123.2604 },
  "Rizal": { lat: 10.4970, lng: 123.3599 },
  "San Juan (Sipaway)": { lat: 10.4627, lng: 123.4398 },
};

const POBLACION_ORDER = [
  "Barangay I (Poblacion)",
  "Barangay II (Poblacion)",
  "Barangay III (Poblacion)",
  "Barangay IV (Poblacion)",
  "Barangay V (Poblacion)",
  "Barangay VI (Poblacion)",
];
const POBLACION_SHORT = { 0: "I", 1: "II", 2: "III", 3: "IV", 4: "V", 5: "VI" };

const REFERENCE_POINTS = [
  { label: "Calatrava", lat: 10.60, lng: 123.48, kind: "town" },
  { label: "Don Salvador Benedicto", lat: 10.55056, lng: 123.23639, kind: "town" },
  { label: "Tañon Strait", lat: 10.49, lng: 123.52, kind: "water" },
];

const BOUNDARY_URL = "/data/san-carlos-barangays.geojson";

const CITY_BOUNDS = (() => {
  const lats = Object.values(BARANGAY_COORDS).map((c) => c.lat);
  const lngs = Object.values(BARANGAY_COORDS).map((c) => c.lng);
  const latPad = (Math.max(...lats) - Math.min(...lats)) * 0.35;
  const lngPad = (Math.max(...lngs) - Math.min(...lngs)) * 0.35;
  return L.latLngBounds(
    [Math.min(...lats) - latPad, Math.min(...lngs) - lngPad],
    [Math.max(...lats) + latPad, Math.max(...lngs) + lngPad]
  );
})();
const CITY_CENTER = CITY_BOUNDS.getCenter();

const YEAR_MULTIPLIERS = { "2024": 0.82, "2025": 0.91, "2026": 1 };

const TREND_MONTHS_BASE = [
  { label: "Jan", birth: 480, death: 90 },
  { label: "Feb", birth: 510, death: 82 },
  { label: "Mar", birth: 470, death: 95 },
  { label: "Apr", birth: 560, death: 88 },
  { label: "May", birth: 620, death: 101 },
];

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* Low = red, High = blue. Warm colors cover the lower-middle range, cool colors the upper range. */
const HEAT_SCALE = [
  { max: 150, label: "0 - 150 (Very Low)", color: "#dc2626", text: "#ffffff" },
  { max: 250, label: "151 - 250 (Low)", color: "#f97316", text: "#1c2233" },
  { max: 350, label: "251 - 350 (Moderate)", color: "#facc15", text: "#1c2233" },
  { max: 450, label: "351 - 450 (High)", color: "#3b82f6", text: "#ffffff" },
  { max: Infinity, label: "450 and above (Very High)", color: "#1e3a8a", text: "#ffffff" },
];

const NO_DATA_COLOR = "#9aa2b5";
const ALL_BARANGAYS = "All Barangays";
const VIEW_CIVIL = "civil";
const VIEW_DEMOGRAPHICS = "demographics";
const SOURCE_DEMO = "demo";
const SOURCE_REAL = "real";

const CERT_TYPES = ["All Certificates", "Live Birth", "Marriage", "Death"];
const CIVIL_TYPES = ["Live Birth", "Marriage", "Death"];
const YEARS = ["2024", "2025", "2026"];

/* Filter values come from the shared demographics constants, so demo and imported
   residents always use the same categories the filters understand. */
const EMPLOYMENT_VALUES = EMPLOYMENT_FILTERS.map((f) => f.value).filter((v) => v !== "all");
const VOTING_VALUES = VOTING_FILTERS.map((f) => f.value).filter((v) => v !== "all");

/* Sample generator limits. */
const SAMPLE_MAX = 2000;
const SAMPLE_DEFAULT = 100;

/* Skeleton tuning: how many placeholder rows to draw, and how long the map
   waits for tiles before giving up on the overlay. */
const SKELETON_TABLE_ROWS = 8;
const SKELETON_TOP5_ROWS = 5;
const MAP_TILE_TIMEOUT_MS = 1500;

const CBMS_RECORDS = [
  { id: "CR-0001", name: "Juan Dela Cruz", barangay: "Barangay I (Poblacion)", recordType: "Live Birth", age: 34, philSysId: true, philSysNo: "6304-XXXX-XXXX", seniorCitizen: false, pwd: false, fourPs: true },
  { id: "CR-0002", name: "Maria Santos", barangay: "Prosperidad", recordType: "Marriage", age: 29, philSysId: true, philSysNo: "6217-XXXX-XXXX", seniorCitizen: false, pwd: false, fourPs: false },
  { id: "CR-0003", name: "Pedro Reyes", barangay: "San Juan (Sipaway)", recordType: "Death", age: 78, philSysId: false, philSysNo: null, seniorCitizen: true, pwd: false, fourPs: false },
  { id: "CR-0004", name: "Ana Bautista", barangay: "Barangay II (Poblacion)", recordType: "Live Birth", age: 26, philSysId: true, philSysNo: "6112-XXXX-XXXX", seniorCitizen: false, pwd: false, fourPs: true },
  { id: "CR-0005", name: "Jose Ramirez", barangay: "Quezon", recordType: "Marriage", age: 41, philSysId: false, philSysNo: null, seniorCitizen: false, pwd: false, fourPs: false },
  { id: "CR-0006", name: "Rosario Villanueva", barangay: "Rizal", recordType: "Death", age: 82, philSysId: true, philSysNo: "6098-XXXX-XXXX", seniorCitizen: true, pwd: true, fourPs: false },
  { id: "CR-0007", name: "Antonio Garcia", barangay: "Barangay III (Poblacion)", recordType: "Live Birth", age: 31, philSysId: true, philSysNo: "6255-XXXX-XXXX", seniorCitizen: false, pwd: false, fourPs: false },
  { id: "CR-0008", name: "Luz Fernandez", barangay: "Guadalupe", recordType: "Marriage", age: 38, philSysId: false, philSysNo: null, seniorCitizen: false, pwd: false, fourPs: true },
  { id: "CR-0009", name: "Ricardo Mendoza", barangay: "Punao", recordType: "Death", age: 69, philSysId: true, philSysNo: "6301-XXXX-XXXX", seniorCitizen: true, pwd: false, fourPs: false },
  { id: "CR-0010", name: "Corazon Aquino-Diaz", barangay: "Codcod", recordType: "Live Birth", age: 24, philSysId: true, philSysNo: "6144-XXXX-XXXX", seniorCitizen: false, pwd: false, fourPs: false },
  { id: "CR-0011", name: "Eduardo Torres", barangay: "Ermita (Sipaway)", recordType: "Marriage", age: 45, philSysId: false, philSysNo: null, seniorCitizen: false, pwd: true, fourPs: false },
  { id: "CR-0012", name: "Teresita Flores", barangay: "Bagonbon", recordType: "Death", age: 74, philSysId: true, philSysNo: "6087-XXXX-XXXX", seniorCitizen: true, pwd: false, fourPs: false },
  { id: "CR-0013", name: "Manuel Cruz", barangay: "Buluangan", recordType: "Live Birth", age: 28, philSysId: false, philSysNo: null, seniorCitizen: false, pwd: false, fourPs: true },
  { id: "CR-0014", name: "Estrella Navarro", barangay: "Barangay IV (Poblacion)", recordType: "Marriage", age: 33, philSysId: true, philSysNo: "6209-XXXX-XXXX", seniorCitizen: false, pwd: false, fourPs: false },
  { id: "CR-0015", name: "Fernando Castillo", barangay: "Barangay V (Poblacion)", recordType: "Death", age: 71, philSysId: true, philSysNo: "6033-XXXX-XXXX", seniorCitizen: true, pwd: false, fourPs: false },
  { id: "CR-0016", name: "Gloria Pascual", barangay: "Barangay VI (Poblacion)", recordType: "Live Birth", age: 22, philSysId: false, philSysNo: null, seniorCitizen: false, pwd: false, fourPs: true },
];

const ID_FILTERS = [
  { value: "all", label: "All PhilSys Status" },
  { value: "with", label: "Has PhilSys ID" },
  { value: "without", label: "No PhilSys ID" },
];

/* Import targets: each describes its columns, validation, and template. */
const IMPORT_TARGETS = {
  civil: {
    title: "Import Civil Registry Records",
    description:
      "One row per certificate. Required columns: barangay, type (Live Birth, Marriage or Death), date (YYYY-MM-DD).",
    required: ["barangay", "type", "date"],
    validate: validateCivilRows,
    label: "civil registry records",
    filename: "civil-registry-template.csv",
    template: [
      "barangay,type,date",
      `${BARANGAY_NAMES[0]},Live Birth,2026-01-14`,
      "Prosperidad,Marriage,2026-02-03",
      "Rizal,Death,2026-03-21",
    ],
  },
  demographics: {
    title: "Import Resident Records",
    description: `One row per resident. Required columns: barangay, age (0 to 120), employment (${EMPLOYMENT_VALUES.join(
      ", "
    )}), voting (${VOTING_VALUES.join(", ")}).`,
    required: ["barangay", "age", "employment", "voting"],
    validate: validateResidentRows,
    label: "resident records",
    filename: "resident-records-template.csv",
    template: [
      "barangay,age,employment,voting",
      `${BARANGAY_NAMES[0]},34,${EMPLOYMENT_VALUES[0]},${VOTING_VALUES[0]}`,
      `Prosperidad,68,${EMPLOYMENT_VALUES[EMPLOYMENT_VALUES.length - 1]},${VOTING_VALUES[0]}`,
    ],
  },
};

/* ════════════════════════════════════
   HELPERS
════════════════════════════════════ */

function heatColor(value) {
  return HEAT_SCALE.find((b) => value <= b.max).color;
}

function heatTextColor(value) {
  return HEAT_SCALE.find((b) => value <= b.max).text;
}

function buildDemoScale(maxValue) {
  const step = Math.max(Math.floor(maxValue / 5), 1);
  const lastIndex = HEAT_SCALE.length - 1;

  return HEAT_SCALE.map((s, i) => {
    const isLast = i === lastIndex;
    const lower = i === 0 ? 0 : step * i + 1;
    const upper = isLast ? Infinity : step * (i + 1);
    let label;
    if (isLast) {
      label = `${lower} and above`;
    } else if (lower === upper) {
      label = `${lower}`;
    } else {
      label = `${lower} - ${upper}`;
    }
    return { ...s, max: upper, label };
  });
}

function colorForScale(scale, value) {
  return scale.find((b) => value <= b.max).color;
}

function metricValue(b, certType) {
  if (certType === "Live Birth") return b.birth;
  if (certType === "Marriage") return b.marriage;
  if (certType === "Death") return b.death;
  return b.total;
}

function metricLabel(certType) {
  if (certType === "Live Birth") return "Live Birth Records";
  if (certType === "Marriage") return "Marriage Records";
  if (certType === "Death") return "Death Records";
  return "Total Records";
}

function niceStep(raw) {
  const safe = Math.max(raw, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(safe)));
  const n = safe / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * pow;
}

function buildPopup(title, rows) {
  const body = rows
    .map(
      (r) =>
        `<div class="hm-popup__row${r.total ? " hm-popup__row--total" : ""}"><span>${r.label}</span><b>${r.value.toLocaleString()}</b></div>`
    )
    .join("");
  return `<div class="hm-popup"><div class="hm-popup__title">${title}</div>${body}</div>`;
}

function shortLabel(name) {
  const idx = POBLACION_ORDER.indexOf(name);
  return idx >= 0 ? `Brgy ${POBLACION_SHORT[idx]}` : name;
}

/* Darkens a hex color by mixing it with black. Used for the selected outline so it stands out from its fill. */
function darkenHex(hex, amount = 0.3) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function heatPinIcon(color, label, active) {
  return L.divIcon({
    className: "hm-pin-wrap",
    html: `<div class="hm-pin-stack">
             <div class="hm-pin${active ? " hm-pin--active" : ""}" style="--pin:${color}"><span></span></div>
             <div class="hm-pin__label">${label}</div>
           </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* Small seeded PRNG so demo residents are the same on every load. */
function mulberry32(seed) {
  let s = seed;
  return function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Demo residents, distributed across barangays in proportion to the civil demo volumes. */
function generateDemoResidents(total) {
  const rng = mulberry32(20260);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const sumW = RAW_BARANGAY_DATA.reduce((s, b) => s + b.birth + b.marriage + b.death, 0);
  const out = [];
  RAW_BARANGAY_DATA.forEach((b) => {
    const w = b.birth + b.marriage + b.death;
    const n = Math.round((total * w) / sumW);
    for (let i = 0; i < n; i++) {
      out.push({
        barangay: b.name,
        age: Math.min(95, Math.floor(rng() * rng() * 100)),
        employment: pick(EMPLOYMENT_VALUES),
        voting: pick(VOTING_VALUES),
      });
    }
  });
  return out;
}

const DEMO_RESIDENTS = generateDemoResidents(1400);

/* Minimal CSV parser: handles quoted fields, escaped quotes, and CRLF line endings. */
function parseCsvText(text) {
  const lines = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      lines.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    lines.push(row);
  }

  const nonEmpty = lines.filter((r) => r.some((v) => v.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  const rows = nonEmpty.slice(1).map((vals, idx) => {
    const values = {};
    headers.forEach((h, j) => {
      values[h] = (vals[j] ?? "").trim();
    });
    return { lineNo: idx + 2, values };
  });
  return { headers, rows };
}

function validateCivilRows(rows) {
  const valid = [];
  const errors = [];
  rows.forEach(({ lineNo, values }) => {
    const type = CIVIL_TYPES.find((t) => t.toLowerCase() === (values.type || "").toLowerCase());
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(values.date || "");
    if (!BARANGAY_NAMES.includes(values.barangay)) {
      errors.push(`Row ${lineNo}: unknown barangay "${values.barangay}"`);
    } else if (!type) {
      errors.push(`Row ${lineNo}: type must be Live Birth, Marriage or Death`);
    } else if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
      errors.push(`Row ${lineNo}: date must be in YYYY-MM-DD format`);
    } else {
      valid.push({ barangay: values.barangay, type, year: Number(m[1]), month: Number(m[2]) });
    }
  });
  return { valid, errors };
}

function validateResidentRows(rows) {
  const valid = [];
  const errors = [];
  rows.forEach(({ lineNo, values }) => {
    const age = Number(values.age);
    const emp = EMPLOYMENT_VALUES.find((v) => v.toLowerCase() === (values.employment || "").toLowerCase());
    const vot = VOTING_VALUES.find((v) => v.toLowerCase() === (values.voting || "").toLowerCase());
    if (!BARANGAY_NAMES.includes(values.barangay)) {
      errors.push(`Row ${lineNo}: unknown barangay "${values.barangay}"`);
    } else if (values.age === "" || !Number.isInteger(age) || age < 0 || age > 120) {
      errors.push(`Row ${lineNo}: age must be a whole number from 0 to 120`);
    } else if (!emp) {
      errors.push(`Row ${lineNo}: employment must be one of ${EMPLOYMENT_VALUES.join(", ")}`);
    } else if (!vot) {
      errors.push(`Row ${lineNo}: voting must be one of ${VOTING_VALUES.join(", ")}`);
    } else {
      valid.push({ barangay: values.barangay, age, employment: emp, voting: vot });
    }
  });
  return { valid, errors };
}

/* Random barangay picker, weighted by the civil demo volumes so the sample looks realistic. */
function weightedBarangayPicker() {
  const items = RAW_BARANGAY_DATA.map((b) => ({
    name: b.name,
    weight: b.birth + b.marriage + b.death,
  })).filter((i) => i.weight > 0);
  const total = items.reduce((s, i) => s + i.weight, 0);
  return () => {
    let r = Math.random() * total;
    for (const item of items) {
      r -= item.weight;
      if (r < 0) return item.name;
    }
    return items[items.length - 1].name;
  };
}

/* Builds a CSV string in the same format as the template for the given import target. */
function generateSampleCsv(target, count, year) {
  const header = IMPORT_TARGETS[target].template[0];
  const pickBarangay = weightedBarangayPicker();
  const pad = (n) => String(n).padStart(2, "0");
  const lines = [header];

  for (let i = 0; i < count; i++) {
    const barangay = pickBarangay();
    if (target === "civil") {
      const type = CIVIL_TYPES[Math.floor(Math.random() * CIVIL_TYPES.length)];
      const month = 1 + Math.floor(Math.random() * 12);
      const day = 1 + Math.floor(Math.random() * 28);
      lines.push(`${barangay},${type},${year}-${pad(month)}-${pad(day)}`);
    } else {
      const age = Math.min(95, Math.floor(Math.random() * Math.random() * 100));
      const employment = EMPLOYMENT_VALUES[Math.floor(Math.random() * EMPLOYMENT_VALUES.length)];
      const voting = VOTING_VALUES[Math.floor(Math.random() * VOTING_VALUES.length)];
      lines.push(`${barangay},${age},${employment},${voting}`);
    }
  }
  return lines.join("\n");
}

/* Civil counts per barangay for one year, from imported records. */
function civilFromImports(records, year) {
  const base = Object.fromEntries(BARANGAY_NAMES.map((n) => [n, { birth: 0, marriage: 0, death: 0 }]));
  records.forEach((r) => {
    if (r.year !== Number(year) || !base[r.barangay]) return;
    if (r.type === "Live Birth") base[r.barangay].birth++;
    else if (r.type === "Marriage") base[r.barangay].marriage++;
    else base[r.barangay].death++;
  });
  return base;
}

/* Monthly live birth and death counts for one year, from imported records. */
function monthlyFromImports(records, year) {
  const months = MONTH_LABELS.map((label) => ({ label, birth: 0, death: 0 }));
  records.forEach((r) => {
    if (r.year !== Number(year)) return;
    const m = months[r.month - 1];
    if (r.type === "Live Birth") m.birth++;
    else if (r.type === "Death") m.death++;
  });
  return months;
}

/* ════════════════════════════════════
   SKELETON PRIMITIVES
════════════════════════════════════ */

/* A single shimmering placeholder block. Purely decorative, so it is hidden from screen readers;
   the surrounding region carries aria-busy / role="status" instead. */
function Skeleton({ width = "100%", height = 12, radius, className = "", style }) {
  return (
    <span
      className={`skeleton${className ? ` ${className}` : ""}`}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

function StatCardSkeleton() {
  return (
    <div className="stat-card stat-card--skeleton" aria-hidden="true">
      <Skeleton width={40} height={40} radius={10} style={{ flexShrink: 0 }} />
      <div className="stat-card__body skeleton-stack">
        <Skeleton width="55%" height={24} />
        <Skeleton width="80%" height={11} />
        <Skeleton width="60%" height={10} />
      </div>
    </div>
  );
}

function StatGridSkeleton({ count }) {
  return (
    <div className="stat-grid" role="status" aria-live="polite" aria-label="Loading statistics">
      {Array.from({ length: count }, (_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

/* Keeps the real column headers on screen so the table does not jump when data arrives. */
function DemoTableSkeleton({ columns, rows = SKELETON_TABLE_ROWS }) {
  return (
    <div className="table-scroll" role="status" aria-live="polite" aria-label="Loading demographics table">
      <table className="demo-table table--skeleton">
        <thead>
          <tr>
            <th>No</th>
            <th>Barangay</th>
            {columns.map((s) => (
              <th key={s.key} className="num">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <td>
                <Skeleton width={16} height={12} />
              </td>
              <td>
                <Skeleton width={110 + ((r * 23) % 50)} height={12} />
              </td>
              {columns.map((s) => (
                <td key={s.key} className="num">
                  <Skeleton width={28} height={12} style={{ marginLeft: "auto" }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Top5Skeleton({ rows = SKELETON_TOP5_ROWS }) {
  return (
    <div className="top5" role="status" aria-live="polite" aria-label="Loading top barangays">
      {Array.from({ length: rows }, (_, i) => (
        <div className="top5__row" key={i}>
          <Skeleton width={10} height={11} />
          <Skeleton className="top5__name" width={`${70 - i * 8}%`} height={12} />
          <div className="top5__bar-track">
            <Skeleton height="100%" radius={999} />
          </div>
          <Skeleton className="top5__value" width={26} height={12} style={{ marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════
   SMALL COMPONENTS
════════════════════════════════════ */

function StatCard({ icon, label, value, sub, tone, active, dim }) {
  return (
    <div
      className={
        "stat-card stat-card--" +
        tone +
        (active ? " stat-card--active" : "") +
        (dim ? " stat-card--dim" : "")
      }
    >
      <div className="stat-card__icon">{icon}</div>
      <div className="stat-card__body">
        <span className="stat-card__value">{value.toLocaleString()}</span>
        <span className="stat-card__label">{label}</span>
        {sub && <span className="stat-card__sub">{sub}</span>}
      </div>
    </div>
  );
}

function DonutChart({ slices, size = 148, stroke = 26 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;

  // Start value of each slice, computed up front so no variable changes during render.
  const offsets = slices.map((_, i) =>
    slices.slice(0, i).reduce((sum, x) => sum + x.value, 0)
  );

  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((s, i) => {
        const fraction = s.value / total;
        const dash = fraction * circumference;
        const gap = circumference - dash;
        const rotation = (offsets[i] / total) * 360 - 90;
        return (
          <circle
            key={s.label}
            r={radius}
            cx={size / 2}
            cy={size / 2}
            fill="transparent"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${gap}`}
            strokeLinecap="butt"
            opacity={s.dimmed ? 0.28 : 1}
            transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
            style={{ transition: "opacity 0.15s ease" }}
          />
        );
      })}
      <text x="50%" y="47%" textAnchor="middle" className="donut__total">
        {total.toLocaleString()}
      </text>
      <text x="50%" y="62%" textAnchor="middle" className="donut__caption">
        Total Records
      </text>
    </svg>
  );
}

function CoverageRing({ pct, size = 46, stroke = 6 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.min(Math.max(pct, 0), 100) / 100) * circumference;
  const c = size / 2;

  return (
    <svg
      className="coverage__ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${pct}% of barangays reporting`}
    >
      <circle className="coverage__ring-track" cx={c} cy={c} r={radius} strokeWidth={stroke} />
      <circle
        className="coverage__ring-fill"
        cx={c}
        cy={c}
        r={radius}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeLinecap="butt"
        transform={`rotate(-90 ${c} ${c})`}
      />
      <text x={c} y={c} textAnchor="middle" dominantBaseline="central" className="coverage__ring-text">
        {pct}%
      </text>
    </svg>
  );
}

function TrendChart({ data, height = 190 }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(420);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padL = 34;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const plotW = Math.max(width - padL - padR, 1);
  const plotH = height - padT - padB;

  const rawMax = Math.max(0, ...data.flatMap((d) => [d.birth, d.death]));
  const step = niceStep(rawMax / 4);
  const maxVal = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);

  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;
  const xFor = (i) => padL + i * stepX;
  const yFor = (v) => padT + plotH - (v / maxVal) * plotH;

  const pointsFor = (key) => data.map((d, i) => `${xFor(i)},${yFor(d[key])}`).join(" ");

  return (
    <div ref={wrapRef} className="trend-chart-wrap">
      <svg
        className="trend-chart"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Monthly live birth and death records"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={width - padR}
              y1={yFor(t)}
              y2={yFor(t)}
              className={t === 0 ? "trend-chart__baseline" : "trend-chart__grid"}
            />
            <text x={padL - 8} y={yFor(t)} textAnchor="end" dominantBaseline="central" className="trend-chart__tick">
              {t}
            </text>
          </g>
        ))}

        <polyline points={pointsFor("birth")} className="trend-chart__line trend-chart__line--birth" />
        <polyline points={pointsFor("death")} className="trend-chart__line trend-chart__line--death" />

        {data.map((d, i) => (
          <g key={d.label}>
            <circle cx={xFor(i)} cy={yFor(d.birth)} r="4" className="trend-chart__dot trend-chart__dot--birth" />
            <circle cx={xFor(i)} cy={yFor(d.death)} r="4" className="trend-chart__dot trend-chart__dot--death" />
            <text x={xFor(i)} y={height - 8} textAnchor="middle" className="trend-chart__axis">
              {d.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DemographicDetail({ name, stats, onClose }) {
  return (
    <div className="demo-detail">
      <div className="demo-detail__header">
        <div>
          <span className="coverage__title">{name}</span>
          <span className="coverage__sub">
            All residents · {stats.total.toLocaleString()} total population
          </span>
        </div>
        <button className="link-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="demo-detail__rows">
        {DEMO_STATS.filter((s) => s.key !== "total").map((s) => {
          const width = stats.total > 0 ? (stats[s.key] / stats.total) * 100 : 0;
          return (
            <div className="demo-detail__row" key={s.key}>
              <div className="demo-detail__meta">
                <span>{s.label}</span>
                <b>
                  {stats[s.key].toLocaleString()} <i>({formatPercent(stats[s.key], stats.total)}%)</i>
                </b>
              </div>
              <div className="top5__bar-track">
                <div className="top5__bar-fill" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════
   IMPORT DIALOG
════════════════════════════════════ */

function ImportDialog({ target, year, existingCount, onClose, onImport, onClear }) {
  const cfg = IMPORT_TARGETS[target];
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [sampleCount, setSampleCount] = useState(SAMPLE_DEFAULT);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function analyze(source) {
    const parsed = parseCsvText(source);
    if (parsed.rows.length === 0) {
      setResult({ valid: [], errors: ["No data rows found. Paste CSV text, choose a file, or generate a sample."] });
      return;
    }
    const missing = cfg.required.filter((h) => !parsed.headers.includes(h));
    if (missing.length > 0) {
      setResult({ valid: [], errors: [`Missing column(s): ${missing.join(", ")}`] });
      return;
    }
    setResult(cfg.validate(parsed.rows));
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const content = await file.text();
      setFileName(file.name);
      setText(content);
      analyze(content);
    } catch (err) {
      console.error("File read failed:", err);
      setResult({ valid: [], errors: ["The file could not be read."] });
    }
  }

  function handleTextChange(e) {
    setText(e.target.value);
    setFileName("");
    analyze(e.target.value);
  }

  function handleGenerate() {
    const n = Math.min(SAMPLE_MAX, Math.max(1, Math.floor(Number(sampleCount) || 0)));
    const csv = generateSampleCsv(target, n, year);
    setSampleCount(n);
    setFileName(`sample-${n}-records`);
    setText(csv);
    analyze(csv);
  }

  function handleRemove() {
    setText("");
    setFileName("");
    setResult(null);
  }

  const validCount = result?.valid.length ?? 0;
  const errorCount = result?.errors.length ?? 0;
  const hasInput = text.trim().length > 0;

  return (
    <div className="import-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <div className="import-dialog__header">
          <div>
            <h2 id="import-dialog-title">{cfg.title}</h2>
            <p className="import-dialog__desc">{cfg.description}</p>
          </div>
          <button className="link-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="import-dialog__row">
          <label className="btn-secondary import-file">
            Choose CSV file
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="import-file__input" />
          </label>
          <button className="link-btn" onClick={() => downloadCsv(cfg.template.join("\n"), cfg.filename)}>
            Download template
          </button>
        </div>

        <div className="import-generate">
          <label className="import-generate__count">
            <span>Sample size</span>
            <input
              type="number"
              min={1}
              max={SAMPLE_MAX}
              value={sampleCount}
              onChange={(e) => setSampleCount(e.target.value)}
            />
          </label>
          <button className="btn-secondary" onClick={handleGenerate}>
            Generate sample
          </button>
          <button className="link-btn" onClick={handleRemove} disabled={!hasInput}>
            Remove
          </button>
          {fileName && <span className="import-dialog__meta">{fileName}</span>}
        </div>

        <textarea
          className="import-textarea"
          value={text}
          onChange={handleTextChange}
          placeholder={cfg.template.join("\n")}
          spellCheck={false}
          aria-label="CSV content"
        />

        {result && (
          <div>
            <p className={`import-summary ${validCount > 0 ? "import-summary--ok" : "import-summary--bad"}`}>
              {validCount.toLocaleString()} valid record(s), {errorCount.toLocaleString()} skipped
            </p>
            {errorCount > 0 && (
              <ul className="import-errors">
                {result.errors.slice(0, 5).map((err) => (
                  <li key={err}>{err}</li>
                ))}
                {errorCount > 5 && <li>+{errorCount - 5} more</li>}
              </ul>
            )}
          </div>
        )}

        <div className="import-actions">
          {existingCount > 0 && (
            <button className="link-btn" onClick={onClear}>
              Clear imported {cfg.label} ({existingCount.toLocaleString()})
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={validCount === 0} onClick={() => onImport(result.valid)}>
            Import {validCount > 0 ? validCount.toLocaleString() : ""} record(s)
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════
   MAP (Leaflet + barangay polygons)
════════════════════════════════════ */

const BarangayMap = forwardRef(function BarangayMap({ items, activeBarangay, onSelect, loading = false }, ref) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polyLayerRef = useRef(null);
  const pinLayerRef = useRef(null);
  const geoRef = useRef(null);
  const [tilesLoading, setTilesLoading] = useState(true);
  const [boundaryReady, setBoundaryReady] = useState(false);

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current && mapRef.current.zoomIn(),
    zoomOut: () => mapRef.current && mapRef.current.zoomOut(),
    reset: () => mapRef.current && mapRef.current.fitBounds(CITY_BOUNDS, { animate: true }),
  }));

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (mapRef.current || !container) return undefined;

    let alive = true;

    const map = L.map(container, {
      center: CITY_CENTER,
      zoom: 12,
      minZoom: 11,
      maxZoom: 17,
      maxBounds: CITY_BOUNDS.pad(0.15),
      maxBoundsViscosity: 1.0,
      zoomControl: false,
      scrollWheelZoom: true,
      attributionControl: true,
    });

    const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      subdomains: ["a", "b", "c"],
    });

    // Hide the overlay on the first tile load, or after a short timeout. Tiles can be slow
    // or blocked (for example, offline), and the loader must never keep covering the map.
    const hideOverlay = () => {
      if (alive) setTilesLoading(false);
    };
    tiles.once("load", hideOverlay);
    const overlayTimer = window.setTimeout(hideOverlay, MAP_TILE_TIMEOUT_MS);
    tiles.addTo(map);

    map.fitBounds(CITY_BOUNDS, { animate: false });
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);

    REFERENCE_POINTS.forEach((p) => {
      const icon = L.divIcon({
        className: "ref-point-icon",
        html: `<span class="ref-point-icon__label ref-point-icon__label--${p.kind}">${p.label}</span>`,
        iconSize: [0, 0],
      });
      L.marker([p.lat, p.lng], { icon, interactive: false }).addTo(map);
    });

    polyLayerRef.current = L.layerGroup().addTo(map);
    pinLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Leaflet reads the container size once, when the map is created. If the page is still
    // laying out at that moment, the map is sized wrong and the tiles stay blank. Re-measure
    // after layout, and again whenever the box changes size.
    const frame = window.requestAnimationFrame(() => {
      if (!alive) return;
      map.invalidateSize();
      map.fitBounds(CITY_BOUNDS, { animate: false });
    });
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (alive) map.invalidateSize();
          })
        : null;
    observer?.observe(container);

    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(overlayTimer);
      observer?.disconnect();
      tiles.off("load", hideOverlay);
      map.remove();
      mapRef.current = null;
      polyLayerRef.current = null;
      pinLayerRef.current = null;
    };
  }, []);

  // Load barangay boundaries once. If the file is missing, the map still works with pins only.
  useEffect(() => {
    let cancelled = false;
    fetch(BOUNDARY_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          geoRef.current = data;
          setBoundaryReady(true);
        }
      })
      .catch((err) => console.warn("Barangay boundaries unavailable, showing pins only:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Redraw polygons and pins whenever data or selection changes.
  useEffect(() => {
    const map = mapRef.current;
    const polyLayer = polyLayerRef.current;
    const pinLayer = pinLayerRef.current;
    if (!map || !polyLayer || !pinLayer) return;

    polyLayer.clearLayers();
    pinLayer.clearLayers();

    const byName = Object.fromEntries(items.map((i) => [i.name, i]));

    if (geoRef.current) {
      // White casing under every boundary, so colored lines stay readable on the map tiles.
      L.geoJSON(geoRef.current, {
        interactive: false,
        style: () => ({
          color: "#ffffff",
          weight: 6,
          opacity: 0.85,
          fill: false,
        }),
      }).addTo(polyLayer);

      // Main layer: every barangay outlined in its own heat color, clickable.
      L.geoJSON(geoRef.current, {
        className: "hm-boundary",
        style: (feature) => {
          const item = byName[feature.properties.name];
          const color = item ? item.color : NO_DATA_COLOR;
          const active = !!item && activeBarangay === item.name;
          return {
            color: active ? darkenHex(color) : color,
            weight: active ? 5 : 3,
            opacity: 1,
            fillColor: color,
            fillOpacity: item && item.hasData ? 0.55 : 0.3,
          };
        },
        onEachFeature: (feature, layer) => {
          const item = byName[feature.properties.name];
          if (!item) return;
          layer.bindTooltip(`<b>${shortLabel(item.name)}</b><br/>${item.tooltip}`, {
            sticky: true,
            opacity: 0.95,
            className: "hm-tooltip",
          });
          layer.bindPopup(item.popup);
          layer.on("click", () => onSelect(item.name));
          layer.on("mouseover", () => layer.setStyle({ weight: 5 }));
          layer.on("mouseout", () =>
            layer.setStyle({ weight: activeBarangay === item.name ? 5 : 3 })
          );
        },
      }).addTo(polyLayer);
    }

    // Pins are visual only. Clicks go through the polygon, so one click never selects twice.
    items.forEach((item) => {
      const c = BARANGAY_COORDS[item.name];
      if (!c) return;
      L.marker([c.lat, c.lng], {
        icon: heatPinIcon(item.color, shortLabel(item.name), activeBarangay === item.name),
        interactive: false,
        keyboard: false,
      }).addTo(pinLayer);
    });
  }, [items, activeBarangay, onSelect, boundaryReady]);

  const showSkeleton = tilesLoading || loading;

  return (
    <div className="leaflet-map-wrap" aria-busy={showSkeleton}>
      {/* Background comes from .leaflet-map-surface in Heatmaps.css and darkTheme.css,
          so it follows the active theme. */}
      <div
        ref={containerRef}
        className="leaflet-map-surface"
        role="img"
        aria-label="Map of San Carlos City barangays"
      />
      {/* Always mounted so it can fade out instead of popping away. */}
      <div
        className={`map-skeleton${showSkeleton ? "" : " map-skeleton--hidden"}`}
        role="status"
        aria-live="polite"
        aria-hidden={!showSkeleton}
      >
        <span className="map-skeleton__pin map-skeleton__pin--1 skeleton" />
        <span className="map-skeleton__pin map-skeleton__pin--2 skeleton" />
        <span className="map-skeleton__pin map-skeleton__pin--3 skeleton" />
        <span className="map-skeleton__pin map-skeleton__pin--4 skeleton" />
        <span className="map-skeleton__pin map-skeleton__pin--5 skeleton" />
        <div className="map-skeleton__label">
          <i className="map-skeleton__spinner" />
          {loading ? "Loading resident records…" : "Loading map…"}
        </div>
      </div>
    </div>
  );
});

/* ════════════════════════════════════
   PAGE
════════════════════════════════════ */

export default function Heatmaps() {
  const [viewMode, setViewMode] = useState(VIEW_CIVIL);
  const [dataSource, setDataSource] = useState(SOURCE_DEMO);
  const [certType, setCertType] = useState("All Certificates");
  const [year, setYear] = useState("2026");
  const [activeBarangay, setActiveBarangay] = useState(null);
  const [showLateReg, setShowLateReg] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const mapControlRef = useRef(null);

  const [demoType, setDemoType] = useState("total");
  const [ageGroup, setAgeGroup] = useState("all");
  const [employment, setEmployment] = useState("all");
  const [voting, setVoting] = useState("all");

  // Real data: residents fetched from the service, plus anything imported in this session.
  const [residentRows, setResidentRows] = useState([]);
  const [residentStatus, setResidentStatus] = useState("idle");
  const [importedCivil, setImportedCivil] = useState([]);
  const [importedResidents, setImportedResidents] = useState([]);

  const [cbmsBarangayFilter, setCbmsBarangayFilter] = useState("Follow Map Selection");
  const [cbmsIdFilter, setCbmsIdFilter] = useState("all");
  const [cbmsSeniorOnly, setCbmsSeniorOnly] = useState(false);
  const [cbmsPwdOnly, setCbmsPwdOnly] = useState(false);
  const [cbmsFourPsOnly, setCbmsFourPsOnly] = useState(false);

  const isDemo = viewMode === VIEW_DEMOGRAPHICS;
  const isReal = dataSource === SOURCE_REAL;
  // "idle" counts as loading: the fetch starts in an effect right after real demographics is selected.
  const isDemoLoading = isDemo && isReal && (residentStatus === "loading" || residentStatus === "idle");
  const importTarget = isDemo ? "demographics" : "civil";

  const loadResidents = useCallback(async () => {
    setResidentStatus("loading");
    try {
      const rows = await fetchResidents();
      setResidentRows(rows);
      setResidentStatus("ready");
    } catch (err) {
      console.error("Resident load failed:", err);
      setResidentStatus("error");
      pushToast({
        title: "Could not load residents",
        message: "Resident profiling records could not be retrieved. Please try again.",
        success: false,
      });
    }
  }, []);

  const refreshHeatmap = useCallback(() => {
    return isDemo && isReal ? loadResidents() : Promise.resolve();
  }, [isDemo, isReal, loadResidents]);

  useRegisterRefresh(refreshHeatmap);

  useEffect(() => {
    if (isDemo && isReal && residentStatus === "idle") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial resident data load
      loadResidents();
    }
  }, [isDemo, isReal, residentStatus, loadResidents]);

  /* ── Civil registry base counts (demo or real) ── */
  const barangayData = useMemo(() => {
    const mult = YEAR_MULTIPLIERS[year] ?? 1;
    const realCounts = isReal ? civilFromImports(importedCivil, year) : null;
    return RAW_BARANGAY_DATA.map((b) => {
      const src = realCounts ? realCounts[b.name] : null;
      const birth = src ? src.birth : Math.round(b.birth * mult);
      const marriage = src ? src.marriage : Math.round(b.marriage * mult);
      const death = src ? src.death : Math.round(b.death * mult);
      const total = birth + marriage + death;
      return { ...b, birth, marriage, death, total, hasRecords: total > 0 };
    });
  }, [year, isReal, importedCivil]);

  const sorted = useMemo(
    () => [...barangayData].sort((a, b) => metricValue(b, certType) - metricValue(a, certType)),
    [barangayData, certType]
  );

  const totals = useMemo(() => {
    const birth = barangayData.reduce((s, b) => s + b.birth, 0);
    const marriage = barangayData.reduce((s, b) => s + b.marriage, 0);
    const death = barangayData.reduce((s, b) => s + b.death, 0);
    return { birth, marriage, death, all: birth + marriage + death };
  }, [barangayData]);

  const lateReg = useMemo(
    () => ({
      birth: Math.round(totals.birth * 0.07),
      marriage: Math.round(totals.marriage * 0.03),
      death: Math.round(totals.death * 0.055),
    }),
    [totals]
  );

  const trendMonths = useMemo(() => {
    if (isReal) return monthlyFromImports(importedCivil, year);
    const mult = YEAR_MULTIPLIERS[year] ?? 1;
    return TREND_MONTHS_BASE.map((m) => ({
      label: m.label,
      birth: Math.round(m.birth * mult),
      death: Math.round(m.death * mult),
    }));
  }, [year, isReal, importedCivil]);

  /* ── Resident data (demo or real) through one shared pipeline ── */
  const residentSource = useMemo(
    () => (isReal ? [...residentRows, ...importedResidents] : DEMO_RESIDENTS),
    [isReal, residentRows, importedResidents]
  );

  const classified = useMemo(() => prepareResidents(residentSource, BARANGAY_NAMES), [residentSource]);

  const allStatsByBarangay = useMemo(
    () => aggregateByBarangay(classified.records, BARANGAY_NAMES),
    [classified]
  );

  const filteredStatsByBarangay = useMemo(
    () =>
      aggregateByBarangay(
        filterRecords(classified.records, { ageGroup, employment, voting }),
        BARANGAY_NAMES
      ),
    [classified, ageGroup, employment, voting]
  );

  const demoTypeLabel = DEMOGRAPHIC_TYPES.find((t) => t.value === demoType).label;

  const demoRows = useMemo(
    () =>
      BARANGAY_NAMES.map((name) => {
        const stats = filteredStatsByBarangay[name];
        return {
          name,
          stats,
          value: stats[demoType],
          hasData: allStatsByBarangay[name].total > 0,
        };
      }).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
    [filteredStatsByBarangay, allStatsByBarangay, demoType]
  );

  const demoTotals = useMemo(
    () => sumStats(Object.values(filteredStatsByBarangay)),
    [filteredStatsByBarangay]
  );

  const demoScale = useMemo(
    () => buildDemoScale(Math.max(...demoRows.map((r) => r.value), 0)),
    [demoRows]
  );

  const demoScope = activeBarangay ? filteredStatsByBarangay[activeBarangay] : demoTotals;
  const demoSelected = activeBarangay ? demoRows.find((r) => r.name === activeBarangay) : null;

  const mapItems = useMemo(() => {
    if (isDemo) {
      return demoRows.map((r) => ({
        name: r.name,
        value: r.value,
        hasData: r.hasData,
        color: r.hasData ? colorForScale(demoScale, r.value) : NO_DATA_COLOR,
        tooltip: r.hasData
          ? `${r.value.toLocaleString()} ${demoTypeLabel.toLowerCase()}`
          : "No resident records yet",
        popup: buildPopup(r.name, [
          ...DEMO_STATS.filter((s) => s.key !== "total").map((s) => ({
            label: s.label,
            value: r.stats[s.key],
          })),
          { label: "Total Population", value: r.stats.total, total: true },
        ]),
      }));
    }

    return sorted.map((b) => {
      const val = metricValue(b, certType);
      return {
        name: b.name,
        value: val,
        hasData: b.hasRecords,
        color: b.hasRecords ? heatColor(val) : NO_DATA_COLOR,
        tooltip: b.hasRecords ? `${val} ${metricLabel(certType).toLowerCase()}` : "No records yet",
        popup: buildPopup(b.name, [
          { label: "Live Birth", value: b.birth },
          { label: "Marriage", value: b.marriage },
          { label: "Death", value: b.death },
          { label: "Total", value: b.total, total: true },
        ]),
      };
    });
  }, [isDemo, demoRows, demoScale, demoTypeLabel, sorted, certType]);

  const rankedList = useMemo(
    () =>
      isDemo
        ? demoRows.map((r) => ({ name: r.name, value: r.value }))
        : sorted.map((b) => ({ name: b.name, value: metricValue(b, certType) })),
    [isDemo, demoRows, sorted, certType]
  );

  const top5 = rankedList.slice(0, 5);
  const maxTop5 = top5.length > 0 ? top5[0].value || 1 : 1;

  const selectedBarangay = activeBarangay ? sorted.find((b) => b.name === activeBarangay) : null;

  const reportingBarangays = useMemo(() => sorted.filter((b) => b.hasRecords), [sorted]);
  const pendingBarangays = useMemo(() => sorted.filter((b) => !b.hasRecords), [sorted]);
  const coveragePct = ((reportingBarangays.length / barangayData.length) * 100).toFixed(0);

  const cbmsStats = useMemo(() => {
    const total = CBMS_RECORDS.length;
    const withPhilSys = CBMS_RECORDS.filter((r) => r.philSysId).length;
    const seniors = CBMS_RECORDS.filter((r) => r.seniorCitizen).length;
    const pwd = CBMS_RECORDS.filter((r) => r.pwd).length;
    const fourPs = CBMS_RECORDS.filter((r) => r.fourPs).length;
    return {
      total,
      withPhilSys,
      philSysPct: total ? ((withPhilSys / total) * 100).toFixed(0) : "0",
      seniors,
      pwd,
      fourPs,
    };
  }, []);

  const effectiveCbmsBarangay =
    cbmsBarangayFilter === "Follow Map Selection"
      ? activeBarangay
      : cbmsBarangayFilter === ALL_BARANGAYS
      ? null
      : cbmsBarangayFilter;

  const filteredCbms = useMemo(() => {
    return CBMS_RECORDS.filter((r) => {
      if (effectiveCbmsBarangay && r.barangay !== effectiveCbmsBarangay) return false;
      if (cbmsIdFilter === "with" && !r.philSysId) return false;
      if (cbmsIdFilter === "without" && r.philSysId) return false;
      if (cbmsSeniorOnly && !r.seniorCitizen) return false;
      if (cbmsPwdOnly && !r.pwd) return false;
      if (cbmsFourPsOnly && !r.fourPs) return false;
      return true;
    });
  }, [effectiveCbmsBarangay, cbmsIdFilter, cbmsSeniorOnly, cbmsPwdOnly, cbmsFourPsOnly]);

  const handleSelectBarangay = useCallback(
    (name) => {
      if (isDemo) {
        if (isDemoLoading) return;
        if (!allStatsByBarangay[name].total) {
          pushToast({
            title: "No resident records",
            message: `${name} has no resident profiling records.`,
            success: false,
            duration: 3500,
          });
          return;
        }
      } else {
        const b = barangayData.find((x) => x.name === name);
        if (!b || !b.hasRecords) {
          pushToast({
            title: "No records yet",
            message: `${name} has no records for ${year}.`,
            success: false,
            duration: 3500,
          });
          return;
        }
      }
      setActiveBarangay((prev) => (prev === name ? null : name));
    },
    [isDemo, isDemoLoading, allStatsByBarangay, barangayData, year]
  );

  function changeSource(next) {
    setDataSource(next);
    setActiveBarangay(null);
  }

  function handleImport(records) {
    if (importTarget === "demographics") {
      setImportedResidents((prev) => [...prev, ...records]);
    } else {
      setImportedCivil((prev) => [...prev, ...records]);
    }
    setDataSource(SOURCE_REAL);
    setActiveBarangay(null);
    setImportOpen(false);
    pushToast({
      title: "Records imported",
      message: `${records.length.toLocaleString()} ${IMPORT_TARGETS[importTarget].label} added. Showing real data.`,
      success: true,
      duration: 3000,
    });
  }

  function handleClearImported() {
    if (importTarget === "demographics") {
      setImportedResidents([]);
    } else {
      setImportedCivil([]);
    }
    setActiveBarangay(null);
    pushToast({
      title: "Imported records cleared",
      message: `All imported ${IMPORT_TARGETS[importTarget].label} were removed.`,
      success: true,
      duration: 2500,
    });
  }

  function handleExport() {
    try {
      const header = ["No", "Barangay", "Birth", "Marriage", "Death", "Total Records", "% of Total"];
      const rows = sorted.map((b, i) => [
        i + 1,
        `"${b.name}"`,
        b.birth,
        b.marriage,
        b.death,
        b.total,
        `${totals.all ? ((b.total / totals.all) * 100).toFixed(2) : "0.00"}%`,
      ]);
      const meta = [
        `Data Source,${isReal ? "Real" : "Demo"}`,
        `Certificate Type,${certType}`,
        `Year,${year}`,
        `Generated,${new Date().toLocaleString()}`,
        "",
      ];
      const csv = [...meta, header.join(","), ...rows.map((r) => r.join(","))].join("\n");

      const filename = `heatmaps-report-${year}-${certType.replace(/\s+/g, "_")}.csv`;
      downloadCsv(csv, filename);

      pushToast({
        title: "Report downloaded!",
        message: `${filename} · ${certType}, ${year}`,
        success: true,
        duration: 3000,
      });
    } catch (err) {
      console.error("Export failed:", err);
      pushToast({
        title: "Export failed",
        message: "Something went wrong while generating the report. Please try again.",
        success: false,
      });
    }
  }

  function handleExportDemographics() {
    try {
      if (isDemoLoading || classified.records.length === 0) {
        pushToast({
          title: "Nothing to export",
          message: "No resident records are available to export.",
          success: false,
        });
        return;
      }

      const header = ["No", "Barangay", ...DEMO_STATS.map((s) => s.label)];
      const rows = demoRows.map((r, i) => [
        i + 1,
        `"${r.name}"`,
        ...DEMO_STATS.map((s) => r.stats[s.key]),
      ]);
      const meta = [
        `Data Source,${isReal ? "Real" : "Demo"}`,
        `Demographic Type,${demoTypeLabel}`,
        `Age Group,${AGE_GROUPS.find((f) => f.value === ageGroup).label}`,
        `Employment,${EMPLOYMENT_FILTERS.find((f) => f.value === employment).label}`,
        `Voting,${VOTING_FILTERS.find((f) => f.value === voting).label}`,
        `Generated,"${new Date().toLocaleString()}"`,
        "",
      ];
      const csv = [...meta, header.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const filename = `heatmaps-demographics-${demoType}.csv`;
      downloadCsv(csv, filename);

      pushToast({
        title: "Report downloaded!",
        message: `${filename} · ${demoTypeLabel}`,
        success: true,
        duration: 3000,
      });
    } catch (err) {
      console.error("Demographics export failed:", err);
      pushToast({
        title: "Export failed",
        message: "Something went wrong while generating the report. Please try again.",
        success: false,
      });
    }
  }

  function handleExportCbms() {
    try {
      if (filteredCbms.length === 0) {
        pushToast({
          title: "Nothing to export",
          message: "No CBMS × PSA records match the current filters.",
          success: false,
        });
        return;
      }
      const header = [
        "ID",
        "Name",
        "Barangay",
        "Record Type",
        "Age",
        "PhilSys ID",
        "PhilSys No.",
        "Senior Citizen",
        "PWD",
        "4Ps Beneficiary",
      ];
      const rows = filteredCbms.map((r) => [
        r.id,
        `"${r.name}"`,
        `"${r.barangay}"`,
        r.recordType,
        r.age,
        r.philSysId ? "Yes" : "No",
        r.philSysNo || "—",
        r.seniorCitizen ? "Yes" : "No",
        r.pwd ? "Yes" : "No",
        r.fourPs ? "Yes" : "No",
      ]);
      const meta = [
        `Barangay Filter,${effectiveCbmsBarangay || ALL_BARANGAYS}`,
        `PhilSys Filter,${ID_FILTERS.find((f) => f.value === cbmsIdFilter)?.label}`,
        `Generated,${new Date().toLocaleString()}`,
        "",
      ];
      const csv = [...meta, header.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const filename = `cbms-psa-crossref-${(effectiveCbmsBarangay || "all-barangays").replace(/\s+/g, "_")}.csv`;
      downloadCsv(csv, filename);

      pushToast({
        title: "CBMS list downloaded!",
        message: `${filename} · ${filteredCbms.length} record(s)`,
        success: true,
        duration: 3000,
      });
    } catch (err) {
      console.error("CBMS export failed:", err);
      pushToast({
        title: "Export failed",
        message: "Something went wrong while generating the CBMS list. Please try again.",
        success: false,
      });
    }
  }

  function handleToggleLateReg() {
    setShowLateReg((v) => {
      const next = !v;
      if (next) {
        pushToast({
          title: "Late registration loaded",
          message: `Showing late-registered records for ${year}.`,
          success: true,
          duration: 2500,
        });
      }
      return next;
    });
  }

  function clearCbmsFilters() {
    setCbmsBarangayFilter(ALL_BARANGAYS);
    setCbmsIdFilter("all");
    setCbmsSeniorOnly(false);
    setCbmsPwdOnly(false);
    setCbmsFourPsOnly(false);
  }

  const mapTitle = isDemo ? demoTypeLabel : metricLabel(certType);
  const legendScale = isDemo ? demoScale : HEAT_SCALE;
  const sourceLabel = isReal ? "Real data" : "Demo data";

  let legendHint;
  if (isDemo) {
    if (isDemoLoading) {
      legendHint = "Loading resident records…";
    } else {
      legendHint = demoSelected
        ? `${demoSelected.name}: ${demoSelected.value.toLocaleString()} ${demoTypeLabel.toLowerCase()} (${formatPercent(
            demoSelected.value,
            demoTotals[demoType]
          )}% of citywide). Click again to clear.`
        : "Click a barangay on the map to highlight it in the table and see its full demographic breakdown below.";
    }
  } else {
    legendHint = selectedBarangay
      ? `${selectedBarangay.name}: ${selectedBarangay.birth} birth, ${selectedBarangay.marriage} marriage, ${selectedBarangay.death} death, ${selectedBarangay.total} total (${totals.all ? ((selectedBarangay.total / totals.all) * 100).toFixed(1) : "0.0"}% of citywide). Click again to clear.`
      : "Click a barangay on the map to highlight it in the table and see its breakdown here.";
  }

  // Loading shows through the skeleton. The banner covers errors and empty real-data views.
  const viewHasData = isDemo ? classified.records.length > 0 : !isReal || importedCivil.length > 0;
  let demoNotice = null;
  if (!isDemoLoading) {
    if (isDemo && isReal && residentStatus === "error") {
      demoNotice = { tone: "error", text: "Resident records could not be loaded.", retry: true };
    } else if (isReal && !viewHasData) {
      demoNotice = {
        tone: "info",
        text: `No real ${IMPORT_TARGETS[importTarget].label} yet. Import a CSV file to populate this view.`,
        action: "Import data",
      };
    }
  }

  return (
    <div className="heatmaps">
      <header className={`heatmaps__header${isDemo ? " heatmaps__header--demo" : ""}`}>
        <div>
          <h1>Heatmaps</h1>
          <p>
            {isDemo
              ? "Demographic distribution of residents per barangay"
              : "Geographic distribution of civil registry records per barangay"}
          </p>
        </div>

        <div className="heatmaps__filters">
          <div className="filter">
            <span>View</span>
            <div className="toggle-row">
              <button
                className={`toggle-chip${!isDemo ? " toggle-chip--active" : ""}`}
                onClick={() => setViewMode(VIEW_CIVIL)}
              >
                Civil Registry
              </button>
              <button
                className={`toggle-chip${isDemo ? " toggle-chip--active" : ""}`}
                onClick={() => setViewMode(VIEW_DEMOGRAPHICS)}
              >
                Demographics
              </button>
            </div>
          </div>

          <div className="filter">
            <span>Data Source</span>
            <div className="toggle-row">
              <button
                className={`toggle-chip${!isReal ? " toggle-chip--active" : ""}`}
                onClick={() => changeSource(SOURCE_DEMO)}
              >
                Demo
              </button>
              <button
                className={`toggle-chip${isReal ? " toggle-chip--active" : ""}`}
                onClick={() => changeSource(SOURCE_REAL)}
              >
                Real
              </button>
            </div>
          </div>

          {isDemo ? (
            <>
              <label className="filter">
                <span>Demographic Type</span>
                <select value={demoType} onChange={(e) => setDemoType(e.target.value)}>
                  {DEMOGRAPHIC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter">
                <span>Barangay</span>
                <select
                  value={activeBarangay || ALL_BARANGAYS}
                  onChange={(e) => setActiveBarangay(e.target.value === ALL_BARANGAYS ? null : e.target.value)}
                >
                  <option value={ALL_BARANGAYS}>{ALL_BARANGAYS}</option>
                  {BARANGAY_NAMES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter">
                <span>Age Group</span>
                <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)}>
                  {AGE_GROUPS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter">
                <span>Employment Status</span>
                <select value={employment} onChange={(e) => setEmployment(e.target.value)}>
                  {EMPLOYMENT_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter">
                <span>Voting Status</span>
                <select value={voting} onChange={(e) => setVoting(e.target.value)}>
                  {VOTING_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="filter">
                <span>Certificate Type</span>
                <select value={certType} onChange={(e) => setCertType(e.target.value)}>
                  {CERT_TYPES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label className="filter">
                <span>Year</span>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  {YEARS.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              </label>

              <div className="filter">
                <span>Date Range</span>
                <div className="filter__range">Jan 1, {year} – {isReal ? "Dec 31" : "May 30"}, {year}</div>
              </div>
            </>
          )}

          <button className="btn-secondary" onClick={() => setImportOpen(true)}>
            <ImportIcon /> Import Data
          </button>
          <button className="btn-primary" onClick={isDemo ? handleExportDemographics : handleExport}>
            <ExportIcon /> Export Report
          </button>
        </div>
      </header>

      <section className="heatmaps__top">
        <div className="card heat-card">
          <div className="card__header">
            <div>
              <h2>{mapTitle} per Barangay</h2>
              <p className="card__subtitle">
                {isDemo
                  ? `San Carlos City, Negros Occidental (Resident Profiling) · ${sourceLabel}`
                  : `San Carlos City, Negros Occidental (${year}) · ${sourceLabel}`}
              </p>
            </div>
            <div className="zoom-controls">
              <button onClick={() => mapControlRef.current?.zoomIn()} aria-label="Zoom in" title="Zoom in">
                +
              </button>
              <button onClick={() => mapControlRef.current?.zoomOut()} aria-label="Zoom out" title="Zoom out">
                −
              </button>
              <button
                className="zoom-controls__reset"
                onClick={() => mapControlRef.current?.reset()}
                aria-label="Reset map view"
              >
                Reset view
              </button>
            </div>
          </div>

          {demoNotice && (
            <div className={`demo-status${demoNotice.tone === "error" ? " demo-status--error" : ""}`}>
              <span>{demoNotice.text}</span>
              {demoNotice.retry && (
                <button className="link-btn" onClick={loadResidents}>
                  Retry
                </button>
              )}
              {demoNotice.action && (
                <button className="link-btn" onClick={() => setImportOpen(true)}>
                  {demoNotice.action}
                </button>
              )}
            </div>
          )}

          <div className="heat-grid-wrap">
            <BarangayMap
              ref={mapControlRef}
              items={mapItems}
              activeBarangay={activeBarangay}
              onSelect={handleSelectBarangay}
              loading={isDemoLoading}
            />
          </div>
          <p className="heat-map-note">
            OpenStreetMap basemap, panning and zoom restricted to San Carlos City, Negros Occidental. Each barangay
            outline uses its heat color. Click a barangay to select it, or click it again to clear.
          </p>

          <div className="legend">
            <span className="legend__title">Legend ({mapTitle})</span>
            <div className="legend__items">
              {legendScale.map((s) => (
                <div className="legend__item" key={s.label}>
                  <i style={{ background: s.color }} />
                  {s.label}
                </div>
              ))}
              <div className="legend__item">
                <i style={{ background: NO_DATA_COLOR }} />
                {isDemo ? "No Resident Records" : "No Records Yet"}
              </div>
            </div>
            <p className="legend__hint">{legendHint}</p>
          </div>

          {isDemo ? (
            activeBarangay &&
            !isDemoLoading && (
              <DemographicDetail
                name={activeBarangay}
                stats={allStatsByBarangay[activeBarangay]}
                onClose={() => setActiveBarangay(null)}
              />
            )
          ) : (
            <div className="coverage">
              <div className="coverage__summary">
                <CoverageRing pct={Number(coveragePct)} />
                <div>
                  <span className="coverage__title">Barangay Reporting Coverage</span>
                  <span className="coverage__sub">
                    {reportingBarangays.length} of {barangayData.length} barangays have submitted civil registry
                    records{pendingBarangays.length > 0 ? `, ${pendingBarangays.length} pending` : ""}
                  </span>
                </div>
              </div>

              <div className="coverage__group">
                <span className="coverage__label">
                  <i className="coverage__dot coverage__dot--reporting" />
                  Areas with records ({reportingBarangays.length})
                </span>
                <div className="coverage__chips">
                  {reportingBarangays.map((b) => (
                    <button
                      key={b.name}
                      className={`chip chip--reporting${activeBarangay === b.name ? " chip--active" : ""}`}
                      onClick={() => handleSelectBarangay(b.name)}
                      title={`View ${b.name} in the table below`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>

              {pendingBarangays.length > 0 && (
                <div className="coverage__group">
                  <span className="coverage__label">
                    <i className="coverage__dot coverage__dot--pending" />
                    Not yet reporting ({pendingBarangays.length})
                  </span>
                  <div className="coverage__chips">
                    {pendingBarangays.map((b) => (
                      <button
                        key={b.name}
                        className="chip chip--pending"
                        onClick={() => handleSelectBarangay(b.name)}
                        title={`${b.name} has no submitted records`}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="heat-card__side">
          {isDemo ? (
            <>
              {isDemoLoading ? (
                <StatGridSkeleton count={DEMO_STATS.length} />
              ) : (
                <div className="stat-grid">
                  {DEMO_STATS.map((s) => (
                    <StatCard
                      key={s.key}
                      tone="demo"
                      icon={s.key === "voting" || s.key === "nonVoting" ? <VoteIcon /> : <UsersIcon />}
                      label={s.label}
                      value={demoScope[s.key]}
                      sub={
                        s.key === "total"
                          ? activeBarangay || ALL_BARANGAYS
                          : `${formatPercent(demoScope[s.key], demoScope.total)}% of total`
                      }
                      active={demoType === s.key}
                      dim={demoType !== "total" && demoType !== s.key}
                    />
                  ))}
                </div>
              )}

              <div className="card table-card" aria-busy={isDemoLoading}>
                <div className="card__header">
                  <h2>Demographics Breakdown per Barangay</h2>
                </div>
                {isDemoLoading ? (
                  <>
                    <DemoTableSkeleton columns={DEMO_STATS} />
                    <div className="table-footnote">
                      <Skeleton width="55%" height={11} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="table-scroll">
                      <table className="demo-table">
                        <thead>
                          <tr>
                            <th>No</th>
                            <th>Barangay</th>
                            {DEMO_STATS.map((s) => (
                              <th key={s.key} className={`num${demoType === s.key ? " th--highlight" : ""}`}>
                                {s.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {demoRows.map((r, i) => (
                            <tr
                              key={r.name}
                              className={activeBarangay === r.name ? "row--active" : ""}
                              onClick={() => handleSelectBarangay(r.name)}
                            >
                              <td>{i + 1}</td>
                              <td>{r.name}</td>
                              {DEMO_STATS.map((s) => (
                                <td
                                  key={s.key}
                                  className={`num${demoType === s.key ? " cell--highlight" : s.key === "total" ? " cell--strong" : ""}`}
                                >
                                  {r.stats[s.key].toLocaleString()}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="table-footnote">
                      Showing {demoRows.length} of {demoRows.length} barangays, sorted by {demoTypeLabel.toLowerCase()}
                      {classified.skipped > 0
                        ? ` · ${classified.skipped.toLocaleString()} resident record(s) skipped (missing barangay or age)`
                        : ""}
                    </p>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="stat-grid">
                <StatCard
                  tone="total"
                  icon={<UsersIcon />}
                  label="Total Records"
                  value={totals.all}
                  sub="All Certificates"
                  active={certType === "All Certificates"}
                />
                <StatCard
                  tone="birth"
                  icon={<BirthIcon />}
                  label="Live Birth Records"
                  value={totals.birth}
                  sub={`${totals.all ? ((totals.birth / totals.all) * 100).toFixed(2) : "0.00"}% of total`}
                  active={certType === "Live Birth"}
                  dim={certType !== "All Certificates" && certType !== "Live Birth"}
                />
                <StatCard
                  tone="marriage"
                  icon={<MarriageIcon />}
                  label="Marriage Records"
                  value={totals.marriage}
                  sub={`${totals.all ? ((totals.marriage / totals.all) * 100).toFixed(2) : "0.00"}% of total`}
                  active={certType === "Marriage"}
                  dim={certType !== "All Certificates" && certType !== "Marriage"}
                />
                <StatCard
                  tone="death"
                  icon={<DeathIcon />}
                  label="Death Records"
                  value={totals.death}
                  sub={`${totals.all ? ((totals.death / totals.all) * 100).toFixed(2) : "0.00"}% of total`}
                  active={certType === "Death"}
                  dim={certType !== "All Certificates" && certType !== "Death"}
                />
              </div>

              <div className="card table-card">
                <div className="card__header">
                  <h2>Records Breakdown per Barangay</h2>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>No</th>
                        <th>Barangay</th>
                        <th className={`num${certType === "Live Birth" ? " th--highlight" : ""}`}>Birth</th>
                        <th className={`num${certType === "Marriage" ? " th--highlight" : ""}`}>Marriage</th>
                        <th className={`num${certType === "Death" ? " th--highlight" : ""}`}>Death</th>
                        <th className="num">Total Records</th>
                        <th className="num">% of Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((b, i) => (
                        <tr
                          key={b.name}
                          className={activeBarangay === b.name ? "row--active" : ""}
                          onClick={() => handleSelectBarangay(b.name)}
                        >
                          <td>{i + 1}</td>
                          <td>{b.name}</td>
                          <td className={`num${certType === "Live Birth" ? " cell--highlight" : ""}`}>{b.birth}</td>
                          <td className={`num${certType === "Marriage" ? " cell--highlight" : ""}`}>{b.marriage}</td>
                          <td className={`num${certType === "Death" ? " cell--highlight" : ""}`}>{b.death}</td>
                          <td className="num cell--strong">{b.total}</td>
                          <td className="num">
                            <span
                              className="pct-pill"
                              style={{ background: heatColor(b.total), color: heatTextColor(b.total) }}
                            >
                              {totals.all ? ((b.total / totals.all) * 100).toFixed(2) : "0.00"}%
                            </span>
                          </td>
                          <td>
                            {b.hasRecords ? (
                              <span className="status-pill status-pill--yes">Has Records</span>
                            ) : (
                              <span className="status-pill status-pill--no">No Records</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="table-footnote">
                  Showing {sorted.length} of {sorted.length} barangays, sorted by {metricLabel(certType).toLowerCase()}
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="heatmaps__cbms">
        <div className="card cbms-card">
          <div className="card__header">
            <div>
              <h2>CBMS × PSA Cross-Reference</h2>
              <p className="card__subtitle">
                Community-Based Monitoring System profiles matched against PSA PhilSys civil registration data
              </p>
            </div>
            <button className="btn-secondary" onClick={handleExportCbms}>
              <ExportIcon /> Export List
            </button>
          </div>

          <div className="cbms-stats">
            <div className="cbms-stat">
              <span className="cbms-stat__value">{cbmsStats.total}</span>
              <span className="cbms-stat__label">Individuals Matched</span>
            </div>
            <div className="cbms-stat cbms-stat--accent">
              <span className="cbms-stat__value">{cbmsStats.philSysPct}%</span>
              <span className="cbms-stat__label">Have a PhilSys ID</span>
            </div>
            <div className="cbms-stat">
              <span className="cbms-stat__value">{cbmsStats.seniors}</span>
              <span className="cbms-stat__label">Senior Citizens</span>
            </div>
            <div className="cbms-stat">
              <span className="cbms-stat__value">{cbmsStats.pwd}</span>
              <span className="cbms-stat__label">PWD</span>
            </div>
            <div className="cbms-stat">
              <span className="cbms-stat__value">{cbmsStats.fourPs}</span>
              <span className="cbms-stat__label">4Ps Beneficiaries</span>
            </div>
          </div>

          <div className="cbms-filters">
            <label className="filter">
              <span>Barangay</span>
              <select value={cbmsBarangayFilter} onChange={(e) => setCbmsBarangayFilter(e.target.value)}>
                <option>Follow Map Selection</option>
                <option>{ALL_BARANGAYS}</option>
                {barangayData.map((b) => (
                  <option key={b.name}>{b.name}</option>
                ))}
              </select>
            </label>

            <label className="filter">
              <span>PhilSys ID</span>
              <select value={cbmsIdFilter} onChange={(e) => setCbmsIdFilter(e.target.value)}>
                {ID_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="filter">
              <span>Quick Filters</span>
              <div className="toggle-row">
                <button
                  className={`toggle-chip${cbmsSeniorOnly ? " toggle-chip--active" : ""}`}
                  onClick={() => setCbmsSeniorOnly((v) => !v)}
                >
                  Senior Citizen
                </button>
                <button
                  className={`toggle-chip${cbmsPwdOnly ? " toggle-chip--active" : ""}`}
                  onClick={() => setCbmsPwdOnly((v) => !v)}
                >
                  PWD
                </button>
                <button
                  className={`toggle-chip${cbmsFourPsOnly ? " toggle-chip--active" : ""}`}
                  onClick={() => setCbmsFourPsOnly((v) => !v)}
                >
                  4Ps Beneficiary
                </button>
              </div>
            </div>

            <button className="link-btn cbms-clear" onClick={clearCbmsFilters}>
              Clear filters
            </button>
          </div>

          {effectiveCbmsBarangay && (
            <p className="cbms-scope">
              Showing individuals in <b>{effectiveCbmsBarangay}</b> only.{" "}
              <button className="link-btn" onClick={() => setCbmsBarangayFilter(ALL_BARANGAYS)}>
                View all barangays
              </button>
            </p>
          )}

          <div className="table-scroll cbms-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Barangay</th>
                  <th>Record Type</th>
                  <th className="num">Age</th>
                  <th>PhilSys ID</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {filteredCbms.map((r) => (
                  <tr key={r.id}>
                    <td className="cell--muted">{r.id}</td>
                    <td className="cell--strong">{r.name}</td>
                    <td>{r.barangay}</td>
                    <td>{r.recordType}</td>
                    <td className="num">{r.age}</td>
                    <td>
                      {r.philSysId ? (
                        <span className="id-badge id-badge--yes" title={r.philSysNo}>
                          ✓ {r.philSysNo}
                        </span>
                      ) : (
                        <span className="id-badge id-badge--no">No ID on file</span>
                      )}
                    </td>
                    <td>
                      <div className="tag-row">
                        {r.seniorCitizen && <span className="tag tag--senior">Senior</span>}
                        {r.pwd && <span className="tag tag--pwd">PWD</span>}
                        {r.fourPs && <span className="tag tag--fourps">4Ps</span>}
                        {!r.seniorCitizen && !r.pwd && !r.fourPs && <span className="tag tag--none">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredCbms.length === 0 && (
                  <tr>
                    <td colSpan={7} className="cbms-empty">
                      No individuals match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="table-footnote">
            Showing {filteredCbms.length} of {CBMS_RECORDS.length} matched individuals
          </p>
        </div>
      </section>

      <section className="heatmaps__bottom">
        <div className="card">
          <h2>Records Distribution by Type</h2>
          <div className="donut-wrap">
            <DonutChart
              slices={[
                {
                  label: "Live Birth",
                  value: totals.birth,
                  color: "#16a34a",
                  dimmed: certType !== "All Certificates" && certType !== "Live Birth",
                },
                {
                  label: "Marriage",
                  value: totals.marriage,
                  color: "#f59e0b",
                  dimmed: certType !== "All Certificates" && certType !== "Marriage",
                },
                {
                  label: "Death",
                  value: totals.death,
                  color: "#e11d48",
                  dimmed: certType !== "All Certificates" && certType !== "Death",
                },
              ]}
            />
            <ul className="donut-legend">
              <li className={certType === "Live Birth" ? "donut-legend__item--active" : ""}>
                <i style={{ background: "#16a34a" }} />
                Live Birth <b>{totals.birth.toLocaleString()}</b>
                <span>{totals.all ? ((totals.birth / totals.all) * 100).toFixed(2) : "0.00"}%</span>
              </li>
              <li className={certType === "Marriage" ? "donut-legend__item--active" : ""}>
                <i style={{ background: "#f59e0b" }} />
                Marriage <b>{totals.marriage.toLocaleString()}</b>
                <span>{totals.all ? ((totals.marriage / totals.all) * 100).toFixed(2) : "0.00"}%</span>
              </li>
              <li className={certType === "Death" ? "donut-legend__item--active" : ""}>
                <i style={{ background: "#e11d48" }} />
                Death <b>{totals.death.toLocaleString()}</b>
                <span>{totals.all ? ((totals.death / totals.all) * 100).toFixed(2) : "0.00"}%</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="card" aria-busy={isDemoLoading}>
          <h2>Top 5 Barangays by {mapTitle}</h2>
          {isDemoLoading ? (
            <Top5Skeleton />
          ) : (
            <div className="top5">
              {top5.map((b, i) => (
                <div className="top5__row" key={b.name}>
                  <span className="top5__rank">{i + 1}</span>
                  <span className="top5__name">{b.name}</span>
                  <div className="top5__bar-track">
                    <div className="top5__bar-fill" style={{ width: `${(b.value / maxTop5) * 100}%` }} />
                  </div>
                  <span className="top5__value">{b.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card__header">
            <h2>Records Trend (Monthly)</h2>
            <div className="trend-legend">
              <span>
                <i className="dot dot--birth" /> Live Birth
              </span>
              <span>
                <i className="dot dot--death" /> Death
              </span>
            </div>
          </div>
          <TrendChart data={trendMonths} />
        </div>

        <div className="card about-card">
          <div className="about-card__title">
            <InfoIcon /> About Heatmaps
          </div>
          <p>
            The Heatmaps tool shows the total number of civil registry records — Live Birth, Marriage, and Death —
            per barangay on a single view. Click a barangay to see its detailed breakdown and analytics. Switch
            between Demo and Real data, and use Import Data to load real records from a CSV file.
          </p>
          <div className="about-card__note">
            <NoteIcon />
            Note: Late registration is shown separately from on-time records.
          </div>
          <button className="link-btn" onClick={handleToggleLateReg}>
            {showLateReg ? "Hide late registration" : "View late registration"}
          </button>

          {showLateReg && (
            <div className="late-reg">
              <div className="late-reg__row">
                <span>Live Birth</span>
                <b>{lateReg.birth.toLocaleString()}</b>
                <span className="late-reg__pct">
                  {totals.birth ? ((lateReg.birth / totals.birth) * 100).toFixed(1) : "0.0"}% of type
                </span>
              </div>
              <div className="late-reg__row">
                <span>Marriage</span>
                <b>{lateReg.marriage.toLocaleString()}</b>
                <span className="late-reg__pct">
                  {totals.marriage ? ((lateReg.marriage / totals.marriage) * 100).toFixed(1) : "0.0"}% of type
                </span>
              </div>
              <div className="late-reg__row">
                <span>Death</span>
                <b>{lateReg.death.toLocaleString()}</b>
                <span className="late-reg__pct">
                  {totals.death ? ((lateReg.death / totals.death) * 100).toFixed(1) : "0.0"}% of type
                </span>
              </div>
              <div className="late-reg__total">
                {(lateReg.birth + lateReg.marriage + lateReg.death).toLocaleString()} late-registered records in{" "}
                {year}
              </div>
            </div>
          )}
        </div>
      </section>

      {importOpen && (
        <ImportDialog
          target={importTarget}
          year={year}
          existingCount={isDemo ? importedResidents.length : importedCivil.length}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
          onClear={handleClearImported}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════
   ICONS
════════════════════════════════════ */

function ExportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3v12m0-12 4 4m-4-4-4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 15V3m0 12-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M11 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function VoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="m8 12 3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BirthIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M6 21c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function MarriageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="8" cy="14" r="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="14" r="5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function DeathIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9 12h6M12 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v6M12 7v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function NoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}