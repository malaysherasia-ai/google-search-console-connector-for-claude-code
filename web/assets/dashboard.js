import { fill, $, $$, api, fmt, h, icon, initTheme, siteKind, siteLabel, toast, toggleTheme } from "./common.js";
import { countryName } from "./countries.js";

initTheme();

// ---------- State ----------

const S = {
  state: null,
  sites: [],
  site: null,
  days: 28,
  type: "web",
  metric: "clicks",
  grain: "day",
  queryType: "all",
  project: { brandTerms: [], annotations: [] },
  view: "overview",
  cache: new Map(),
};

// Discover and Google News don't report queries or positions.
const noQueries = () => S.type === "discover" || S.type === "googleNews";
const hourly = () => S.days === 1;

const METRICS = {
  clicks: { label: "Total clicks", short: "Clicks", fmt: fmt.compact, full: fmt.int, better: "up" },
  impressions: { label: "Total impressions", short: "Impressions", fmt: fmt.compact, full: fmt.int, better: "up" },
  ctr: { label: "Average CTR", short: "CTR", fmt: (v) => fmt.pct(v, 1), full: (v) => fmt.pct(v, 2), better: "up" },
  position: { label: "Average position", short: "Position", fmt: fmt.pos, full: fmt.pos, better: "down" },
};

// Search Console keeps 16 months of data; comparisons beyond that would be partial.
const RETENTION_DAYS = 485;

const content = $("#content");
const LS = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

function track(name, params) {
  if (S.state?.telemetryConsent === "granted") api("/api/telemetry/event", { name, params }).catch(() => {});
}

// ---------- Dates ----------

const iso = (d) => d.toLocaleDateString("en-CA");
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function ranges() {
  const end = addDays(new Date(), -1);
  const start = addDays(end, -(S.days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(S.days - 1));
  return {
    start: iso(start),
    end: iso(end),
    prevStart: iso(prevStart),
    prevEnd: iso(prevEnd),
    compare: S.days * 2 <= RETENTION_DAYS,
  };
}

function eachDate(startIso, endIso) {
  const out = [];
  let d = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (d <= end) {
    out.push(iso(d));
    d = addDays(d, 1);
  }
  return out;
}

// ---------- Data ----------

async function queryFull(body) {
  return api("/api/analytics", { siteUrl: S.site, type: S.type, dataState: "all", queryType: S.queryType, ...body });
}

async function query(body) {
  return (await queryFull(body)).rows;
}

/** Sum rows by key over a time window; CTR and position are recomputed impression-weighted. */
function aggregate(rows, keyIndex, from, to) {
  const by = new Map();
  for (const r of rows) {
    const t = Date.parse(r.keys[0]);
    if (from !== undefined && (t < from || t >= to)) continue;
    const k = keyIndex === null ? "total" : r.keys[keyIndex];
    const a = by.get(k) ?? { keys: [k], clicks: 0, impressions: 0, posW: 0 };
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a.posW += r.position * r.impressions;
    by.set(k, a);
  }
  return [...by.values()].map((a) => ({ keys: a.keys, clicks: a.clicks, impressions: a.impressions, ctr: a.impressions ? a.clicks / a.impressions : 0, position: a.impressions ? a.posW / a.impressions : 0 }));
}

// The last 24 hours vs the 24 before, from Google's hourly data (dataState hourly_all).
async function loadHourly() {
  const today = new Date();
  const range = { startDate: iso(addDays(today, -3)), endDate: iso(today), dataState: "hourly_all" };
  const dims = ["query", "page", "country", "device"].filter((d) => !(d === "query" && noQueries()));
  const [series, ...breakdowns] = await Promise.all([query({ ...range, dimensions: ["hour"], rowLimit: 25000 }), ...dims.map((d) => query({ ...range, dimensions: ["hour", d], rowLimit: 25000 }))]);
  const sorted = [...series].sort((a, b) => Date.parse(a.keys[0]) - Date.parse(b.keys[0]));
  const last = sorted.length ? Date.parse(sorted[sorted.length - 1].keys[0]) : Date.now();
  const H = 3_600_000;
  const cur = [last - 23 * H, last + H];
  const prev = [last - 47 * H, last - 23 * H];
  const by = new Map(sorted.map((r) => [Date.parse(r.keys[0]), r]));
  const point = (t) => {
    const r = by.get(t);
    return { date: new Date(t).toISOString(), clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0, ctr: r?.ctr ?? 0, position: r?.position ?? null };
  };
  const hoursOf = ([from]) => Array.from({ length: 24 }, (_, i) => point(from + i * H));
  const pick = (d) => breakdowns[dims.indexOf(d)] ?? [];
  const zero = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    r: { start: iso(new Date(cur[0])), end: iso(new Date(last)), compare: true, hourly: true, lastHour: last },
    totals: aggregate(sorted, null, ...cur)[0] ?? zero,
    totalsPrev: aggregate(sorted, null, ...prev)[0] ?? zero,
    series: hoursOf(cur),
    seriesPrev: hoursOf(prev),
    queries: joinPrev(aggregate(pick("query"), 1, ...cur), aggregate(pick("query"), 1, ...prev), true),
    pages: joinPrev(aggregate(pick("page"), 1, ...cur), aggregate(pick("page"), 1, ...prev), true),
    countries: aggregate(pick("country"), 1, ...cur).map((c) => ({ key: c.keys[0], ...c })),
    devices: aggregate(pick("device"), 1, ...cur).map((d) => ({ key: d.keys[0], ...d })),
    metadata: {},
  };
}

function fillSeries(rows, start, end) {
  const by = new Map(rows.map((r) => [r.keys[0], r]));
  return eachDate(start, end).map((date) => {
    const r = by.get(date);
    return r ? { date, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } : { date, clicks: 0, impressions: 0, ctr: 0, position: null };
  });
}

function joinPrev(cur, prev, compare) {
  const before = new Map(prev.map((r) => [r.keys[0], r]));
  return cur.map((r) => {
    const p = before.get(r.keys[0]);
    return {
      key: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      prevClicks: p?.clicks ?? 0,
      dClicks: compare ? r.clicks - (p?.clicks ?? 0) : null,
      dPos: compare && p ? r.position - p.position : null,
      isNew: compare && !p,
    };
  });
}

function loadPerformance() {
  const key = [S.site, S.days, S.type, S.queryType].join("|");
  if (S.cache.has(key)) return S.cache.get(key);
  if (hourly()) {
    const p = loadHourly();
    S.cache.set(key, p);
    p.catch(() => S.cache.delete(key));
    return p;
  }
  const r = ranges();
  const cur = { startDate: r.start, endDate: r.end };
  const prev = { startDate: r.prevStart, endDate: r.prevEnd };
  const none = Promise.resolve([]);
  const promise = (async () => {
    const [tot, totPrev, series, seriesPrev, queries, queriesPrev, pages, pagesPrev, countries, devices] = await Promise.all([
      query(cur),
      r.compare ? query(prev) : none,
      queryFull({ ...cur, dimensions: ["date"], rowLimit: 25000 }),
      r.compare ? query({ ...prev, dimensions: ["date"], rowLimit: 25000 }) : none,
      noQueries() ? none : query({ ...cur, dimensions: ["query"], rowLimit: 5000 }),
      r.compare && !noQueries() ? query({ ...prev, dimensions: ["query"], rowLimit: 5000 }) : none,
      query({ ...cur, dimensions: ["page"], rowLimit: 5000 }),
      r.compare ? query({ ...prev, dimensions: ["page"], rowLimit: 5000 }) : none,
      query({ ...cur, dimensions: ["country"], rowLimit: 250 }),
      query({ ...cur, dimensions: ["device"], rowLimit: 10 }),
    ]);
    const zero = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    return {
      r,
      totals: tot[0] ?? zero,
      totalsPrev: r.compare ? (totPrev[0] ?? zero) : null,
      series: fillSeries(series.rows, r.start, r.end),
      metadata: series.metadata ?? {},
      seriesPrev: r.compare ? fillSeries(seriesPrev, r.prevStart, r.prevEnd) : null,
      queries: joinPrev(queries, queriesPrev, r.compare),
      pages: joinPrev(pages, pagesPrev, r.compare),
      countries: countries.map((c) => ({ key: c.keys[0], ...c })),
      devices: devices.map((d) => ({ key: d.keys[0], ...d })),
    };
  })();
  S.cache.set(key, promise);
  promise.catch(() => S.cache.delete(key));
  return promise;
}

// ---------- Small renderers ----------

function hydrateIcons(root = document) {
  $$("[data-icon]", root).forEach((el) => fill(el, icon(el.dataset.icon)));
}

function bar(fraction, cls = "share") {
  const i = h("i");
  i.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  return h("span", { class: cls }, i);
}

/** Change badge. `kind`: pct (relative), pp (percentage points), pos (absolute, lower is better). */
function delta(cur, prev, kind) {
  if (prev === null || prev === undefined) return null;
  let diff;
  let text;
  if (kind === "pct") {
    if (!prev) return cur ? h("span", { class: "delta up" }, "New") : h("span", { class: "delta flat" }, "0%");
    diff = (cur - prev) / prev;
    text = `${Math.abs(diff * 100).toFixed(Math.abs(diff) < 0.1 ? 1 : 0)}%`;
  } else if (kind === "pp") {
    diff = (cur - prev) * 100;
    text = `${Math.abs(diff).toFixed(2)} pp`;
  } else {
    if (!cur || !prev) return null;
    diff = prev - cur; // positive = moved up the rankings
    text = Math.abs(diff).toFixed(1);
  }
  const flat = Math.abs(diff) < 1e-9 || text.replace(/[^\d]/g, "").replace(/^0+/, "") === "";
  const dir = flat ? "flat" : diff > 0 ? "up" : "down";
  const label = kind === "pos" ? (dir === "up" ? "improved by" : dir === "down" ? "dropped by" : "unchanged") : dir === "up" ? "up" : dir === "down" ? "down" : "unchanged";
  return h("span", { class: `delta ${dir}`, title: `${label} ${text} vs previous period` }, dir === "flat" ? "" : icon(dir === "up" ? "arrowUp" : "arrowDown"), text);
}

function signedInt(n) {
  if (n === null) return "–";
  if (n === 0) return h("span", { class: "delta flat" }, "0");
  return h("span", { class: `delta ${n > 0 ? "up" : "down"}` }, `${n > 0 ? "+" : "−"}${fmt.int(Math.abs(n))}`);
}

function posChange(d) {
  if (d === null) return "–";
  const moved = -d; // negative position change = better ranking
  if (Math.abs(moved) < 0.05) return h("span", { class: "delta flat" }, "0.0");
  return h("span", { class: `delta ${moved > 0 ? "up" : "down"}`, title: moved > 0 ? "Ranking improved" : "Ranking dropped" }, icon(moved > 0 ? "arrowUp" : "arrowDown"), Math.abs(moved).toFixed(1));
}

function pageLink(url) {
  let label = url;
  try {
    const u = new URL(url);
    label = u.pathname + u.search || "/";
  } catch {}
  return h("a", { class: "cell-key", href: url, target: "_blank", rel: "noopener", title: url }, label);
}

function pageHead(title, text, note, tools) {
  return h(
    "div",
    { class: "page-head-wrap" },
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), text && h("p", {}, text)), note && h("span", { class: "range-note" }, note)),
    tools && h("div", { class: "page-tools" }, tools),
  );
}

/** All / Branded / Non-branded, driven by the project's brand terms. */
function filterBar() {
  if (noQueries()) return null;
  if (!S.project.brandTerms?.length) {
    return h("a", { class: "link-btn hint-link", href: "#settings" }, "Split branded and non-branded searches: add your brand terms");
  }
  const opts = [["all", "All queries"], ["branded", "Branded"], ["nonBranded", "Non-branded"]];
  return h(
    "div",
    { class: "filter-row" },
    h(
      "div",
      { class: "segmented", role: "group", "aria-label": "Query type" },
      opts.map(([v, label]) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": String(S.queryType === v),
            onclick: () => {
              S.queryType = v;
              track("query_type_changed", { query_type: v });
              render();
            },
          },
          label,
        ),
      ),
    ),
    S.queryType !== "all" && h("span", { class: "muted" }, `Brand terms: ${S.project.brandTerms.join(", ")}. Totals only count queries Google reports.`),
  );
}

function noQueriesPanel(title) {
  return h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, title))), h("div", { class: "empty" }, h("strong", {}, "Not reported for this search type"), h("span", {}, "Discover and Google News don’t report search queries.")));
}

function rangeNote() {
  if (hourly()) return "Last 24 hours (Pacific time), compared with the 24 hours before";
  const r = ranges();
  const span = `${fmt.dateLong(r.start)} to ${fmt.dateLong(r.end)}`;
  return r.compare ? `${span}, compared with the previous ${S.days} days` : `${span}. No comparison: Search Console keeps 16 months of data.`;
}

function skeleton(lines = 6) {
  return h("div", { class: "panel" }, h("div", { class: "skeleton loading-block" }), Array.from({ length: lines }, () => h("div", { class: "skeleton sk-line" })));
}

function errorPanel(err, retry) {
  const notConnected = /not connected|revoked|expired|connect/i.test(err.message);
  track("dashboard_error", { area: S.view });
  return h(
    "div",
    { class: "panel" },
    h(
      "div",
      { class: "empty" },
      h("strong", {}, notConnected ? "Google access needs to be renewed" : "Couldn’t load data from Search Console"),
      h("span", {}, err.message),
      h("div", { class: "actions-inline" }, notConnected ? h("a", { class: "btn btn-primary", href: "/connect" }, "Connect again") : h("button", { class: "btn", onclick: retry }, "Try again")),
    ),
  );
}

// ---------- Data table ----------

const COLS = {
  key: (label, kind) => ({
    key: "key",
    label,
    cls: "key",
    render: (r) => (kind === "page" ? pageLink(r.key) : h("span", { class: "cell-key", title: r.key }, r.key)),
  }),
  clicks: (max) => ({ key: "clicks", label: "Clicks", num: true, render: (r) => h("span", {}, fmt.int(r.clicks), max ? bar(r.clicks / max) : null) }),
  dClicks: { key: "dClicks", label: "Change", num: true, render: (r) => (r.isNew ? h("span", { class: "badge badge-brand" }, "New") : signedInt(r.dClicks)) },
  impressions: { key: "impressions", label: "Impressions", num: true, render: (r) => fmt.int(r.impressions) },
  ctr: { key: "ctr", label: "CTR", num: true, render: (r) => fmt.pct(r.ctr, 1) },
  position: { key: "position", label: "Position", num: true, render: (r) => fmt.pos(r.position) },
  dPos: { key: "dPos", label: "Pos. change", num: true, sortValue: (r) => (r.dPos === null ? 0 : -r.dPos), render: (r) => posChange(r.dPos) },
};

function dataTable({ name, title, desc, rows, columns, sort = { key: "clicks", dir: "desc" }, pageSize = 25, search = true, exportable = true, empty = "No data for this period." }) {
  let sortKey = sort.key;
  let sortDir = sort.dir;
  let filter = "";
  let shown = pageSize;
  let searched = false;

  const tbody = h("tbody");
  const thead = h("thead");
  const foot = h("div", { class: "panel-foot" });

  const sorted = () => {
    const col = columns.find((c) => c.key === sortKey);
    const val = col?.sortValue ?? ((r) => r[sortKey]);
    const f = filter.toLowerCase();
    return rows
      .filter((r) => !f || String(r.key).toLowerCase().includes(f))
      .sort((a, b) => {
        const x = val(a) ?? -Infinity;
        const y = val(b) ?? -Infinity;
        const c = typeof x === "string" ? x.localeCompare(y) : x - y;
        return sortDir === "asc" ? c : -c;
      });
  };

  const renderHead = () => {
    fill(thead, 
      h(
        "tr",
        {},
        columns.map((c) =>
          h(
            "th",
            { class: c.num ? "num" : "", scope: "col", "aria-sort": c.key === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : null },
            h(
              "button",
              {
                type: "button",
                onclick: () => {
                  if (sortKey === c.key) sortDir = sortDir === "asc" ? "desc" : "asc";
                  else {
                    sortKey = c.key;
                    sortDir = c.num ? "desc" : "asc";
                  }
                  track("table_sorted", { table: name, column: c.key });
                  renderHead();
                  renderBody();
                },
              },
              c.label,
              icon(c.key === sortKey ? (sortDir === "asc" ? "arrowUp" : "arrowDown") : "sort"),
            ),
          ),
        ),
      ),
    );
  };

  const renderBody = () => {
    const all = sorted();
    const visible = all.slice(0, shown);
    fill(tbody, 
      ...(visible.length
        ? visible.map((r) => h("tr", {}, columns.map((c) => h("td", { class: [c.num ? "num" : "", c.cls ?? ""].join(" ").trim() }, c.render(r)))))
        : [h("tr", {}, h("td", { colspan: columns.length }, h("div", { class: "empty" }, filter ? `No ${name} match “${filter}”.` : empty)))]),
    );
    fill(foot, 
      ...[
      h("span", {}, all.length ? `Showing ${fmt.int(visible.length)} of ${fmt.int(all.length)}` : ""),
      all.length > shown
        ? h(
            "button",
            {
              class: "link-btn",
              type: "button",
              onclick: () => {
                shown += pageSize * 2;
                track("rows_expanded", { table: name });
                renderBody();
              },
            },
            "Show more",
          )
        : null,
      ].filter(Boolean),
    );
    foot.hidden = !all.length && !filter;
  };

  const exportCsv = () => {
    const header = columns.map((c) => c.label);
    const lines = sorted().map((r) => columns.map((c) => csvValue(c, r)));
    const csv = [header, ...lines].map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `${name}-${siteLabel(S.site).replace(/[^\w.-]+/g, "_")}-${ranges().start}_${ranges().end}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    track("export_csv", { table: name });
  };

  let searchTimer;
  const tools = h(
    "div",
    { class: "table-tools" },
    search &&
      h(
        "div",
        { class: "table-search" },
        icon("queries"),
        h("input", {
          class: "input",
          type: "search",
          placeholder: `Filter ${name}`,
          "aria-label": `Filter ${name}`,
          oninput: (e) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
              filter = e.target.value.trim();
              shown = pageSize;
              if (!searched) track("table_searched", { table: name });
              searched = true;
              renderBody();
            }, 120);
          },
        }),
      ),
    exportable && rows.length ? h("button", { class: "btn", type: "button", onclick: exportCsv }, "Export CSV") : null,
  );

  renderHead();
  renderBody();
  return h(
    "section",
    { class: "panel" },
    h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, title), desc && h("p", {}, desc)), tools),
    h("div", { class: "table-wrap" }, h("table", { class: "data" }, thead, tbody)),
    foot,
  );
}

function csvValue(c, r) {
  const v = r[c.key];
  if (c.key === "ctr" || c.key === "expected") return v === undefined ? "" : (v * 100).toFixed(2) + "%";
  if (c.key === "position" || c.key === "dPos") return v === null || v === undefined ? "" : v.toFixed(1);
  if (c.key === "key" && r.countryName) return r.countryName;
  return v;
}

function compactTable({ title, rows, kind, label, link }) {
  const max = Math.max(...rows.map((r) => r.clicks), 1);
  const cols = [COLS.key(label, kind), COLS.clicks(max), COLS.impressions, COLS.position];
  const tbody = h(
    "tbody",
    {},
    rows.length
      ? rows.map((r) => h("tr", {}, cols.map((c) => h("td", { class: [c.num ? "num" : "", c.cls ?? ""].join(" ").trim() }, c.render(r)))))
      : h("tr", {}, h("td", { colspan: cols.length }, h("div", { class: "empty" }, "No data for this period."))),
  );
  return h(
    "section",
    { class: "panel" },
    h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, title))),
    h("div", { class: "table-wrap" }, h("table", { class: "data" }, h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : "", scope: "col" }, c.label)))), tbody)),
    link && h("div", { class: "panel-foot" }, h("span"), h("a", { class: "link-btn", href: link.href }, link.label)),
  );
}

// ---------- Trend chart ----------

function niceTicks(min, max, count = 4) {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

const hourFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "America/Los_Angeles" });
const hourLongFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "America/Los_Angeles" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

function pointLabel(d, grain, long) {
  if (grain === "hour") return (long ? hourLongFmt : hourFmt).format(new Date(d));
  if (grain === "month") return monthFmt.format(new Date(`${d}T00:00:00`));
  if (grain === "week") return long ? `Week of ${fmt.dateLong(d)}` : fmt.date(d);
  return long ? fmt.dateLong(d) : fmt.date(d);
}

/** Roll daily points up into weeks (starting Monday) or months, impression-weighting position. */
function groupSeries(series, grain) {
  if (!series || grain === "day" || grain === "hour") return series;
  const buckets = new Map();
  for (const p of series) {
    const d = new Date(`${p.date}T00:00:00`);
    const start = grain === "month" ? new Date(d.getFullYear(), d.getMonth(), 1) : addDays(d, -((d.getDay() + 6) % 7));
    const k = iso(start);
    const b = buckets.get(k) ?? { date: k, clicks: 0, impressions: 0, posW: 0 };
    b.clicks += p.clicks;
    b.impressions += p.impressions;
    if (p.position) b.posW += p.position * p.impressions;
    buckets.set(k, b);
  }
  return [...buckets.values()].map((b) => ({ date: b.date, clicks: b.clicks, impressions: b.impressions, ctr: b.impressions ? b.clicks / b.impressions : 0, position: b.impressions ? b.posW / b.impressions : null }));
}

/** Which chart point each note belongs to (the bucket whose start is on or before the note's date). */
function notesByIndex(series, grain) {
  const out = new Map();
  if (grain === "hour" || !series.length) return out;
  const last = series[series.length - 1].date;
  const lastEnd = grain === "day" ? last : iso(addDays(new Date(`${last}T00:00:00`), grain === "week" ? 6 : 31));
  for (const a of S.project.annotations ?? []) {
    if (a.date < series[0].date || a.date > lastEnd) continue;
    let idx = 0;
    series.forEach((p, i) => {
      if (p.date <= a.date) idx = i;
    });
    out.set(idx, [...(out.get(idx) ?? []), a]);
  }
  return out;
}

function trendChart(series, seriesPrev, metric, grain = "day") {
  const m = METRICS[metric];
  const notes = notesByIndex(series, grain);
  const wrap = h("div", { class: "chart", tabindex: "0", role: "img", "aria-label": `${m.label} by ${grain}. Use the left and right arrow keys to read values.` });
  const tooltip = h("div", { class: "tooltip", hidden: true });
  wrap.append(tooltip);
  let active = -1;

  const draw = () => {
    wrap.querySelector("svg")?.remove();
    const W = wrap.clientWidth;
    const H = wrap.clientHeight - 12;
    if (W < 50) return;
    const M = { l: 56, r: 16, t: 12, b: 28 };
    const iw = W - M.l - M.r;
    const ih = H - M.t - M.b;
    const vals = series.map((d) => d[metric]);
    const prevVals = seriesPrev ? seriesPrev.map((d) => d[metric]) : [];
    const defined = [...vals, ...prevVals].filter((v) => v !== null && v !== undefined);
    const inverted = metric === "position";
    let ticks;
    if (inverted) {
      const lo = Math.max(1, Math.floor(Math.min(...defined, 1)));
      ticks = niceTicks(lo, Math.max(...defined, lo + 1));
      if (ticks[0] < 1) ticks[0] = 1;
    } else {
      ticks = niceTicks(0, Math.max(...defined, metric === "ctr" ? 0.01 : 1));
    }
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const y = (v) => M.t + (inverted ? (v - y0) / (y1 - y0) : 1 - (v - y0) / (y1 - y0)) * ih;
    const n = series.length;
    const x = (i) => M.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);

    const path = (arr) => {
      let d = "";
      let pen = false;
      arr.forEach((v, i) => {
        if (v === null || v === undefined || i >= n) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };

    const svg = h("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    for (const t of ticks) {
      svg.append(h("line", { class: "grid-line", x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }));
      svg.append(h("text", { class: "axis-label", x: M.l - 10, y: y(t) + 4, "text-anchor": "end" }, metric === "ctr" ? fmt.pct(t, t < 0.1 ? 1 : 0) : metric === "position" ? String(t) : fmt.compact(t)));
    }
    const xTickCount = Math.max(2, Math.min(7, Math.floor(iw / 110)));
    for (let k = 0; k < xTickCount; k++) {
      const i = Math.round((k / (xTickCount - 1)) * (n - 1));
      svg.append(h("text", { class: "axis-label", x: x(i), y: H - 6, "text-anchor": k === 0 ? "start" : k === xTickCount - 1 ? "end" : "middle" }, pointLabel(series[i].date, grain)));
    }
    for (const [i, list] of notes) {
      svg.append(h("line", { class: "note-line", x1: x(i), x2: x(i), y1: M.t + 8, y2: M.t + ih }));
      svg.append(h("circle", { class: "note-dot", cx: x(i), cy: M.t + 6, r: 5 }, h("title", {}, list.map((a) => a.text).join("\n"))));
    }
    if (!inverted) {
      const line = path(vals);
      if (line) svg.append(h("path", { class: "area", d: `${line}L${x(n - 1)},${y(y0)}L${x(0)},${y(y0)}Z` }));
    }
    if (seriesPrev) svg.append(h("path", { class: "series-prev", d: path(prevVals) }));
    svg.append(h("path", { class: "series", d: path(vals) }));

    const cross = h("line", { class: "crosshair", y1: M.t, y2: M.t + ih, visibility: "hidden" });
    const dot = h("circle", { class: "dot", r: 4.5, visibility: "hidden" });
    const dotPrev = h("circle", { class: "dot-prev", r: 3.5, visibility: "hidden" });
    svg.append(cross, dotPrev, dot);
    wrap.prepend(svg);

    const show = (i) => {
      active = i;
      if (i < 0) {
        tooltip.hidden = true;
        [cross, dot, dotPrev].forEach((el) => el.setAttribute("visibility", "hidden"));
        return;
      }
      const cx = x(i);
      cross.setAttribute("x1", cx);
      cross.setAttribute("x2", cx);
      cross.setAttribute("visibility", "visible");
      const v = vals[i];
      if (v !== null && v !== undefined) {
        dot.setAttribute("cx", cx);
        dot.setAttribute("cy", y(v));
        dot.setAttribute("visibility", "visible");
      } else dot.setAttribute("visibility", "hidden");
      const pv = prevVals[i];
      if (seriesPrev && pv !== null && pv !== undefined) {
        dotPrev.setAttribute("cx", cx);
        dotPrev.setAttribute("cy", y(pv));
        dotPrev.setAttribute("visibility", "visible");
      } else dotPrev.setAttribute("visibility", "hidden");

      fill(tooltip, 
        h("div", { class: "tt-date" }, pointLabel(series[i].date, grain, true)),
        h("div", { class: "tt-row" }, h("span", {}, h("i"), m.short), h("strong", {}, v === null ? "No data" : m.full(v))),
        seriesPrev?.[i] && h("div", { class: "tt-row" }, h("span", {}, h("i", { class: "prev" }), pointLabel(seriesPrev[i].date, grain, true)), h("strong", {}, pv === null || pv === undefined ? "No data" : m.full(pv))),
        ...(notes.get(i) ?? []).map((a) => h("div", { class: "tt-note" }, h("span", { class: "note-swatch" }), a.text)),
      );
      tooltip.hidden = false;
      const tw = tooltip.offsetWidth;
      const left = cx + 14 + tw > W ? cx - 14 - tw : cx + 14;
      tooltip.style.left = `${Math.max(0, left)}px`;
      tooltip.style.top = `${M.t + 4}px`;
    };

    wrap.onpointermove = (e) => {
      const rect = wrap.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const i = Math.round(((px - M.l) / iw) * (n - 1));
      show(Math.max(0, Math.min(n - 1, i)));
    };
    wrap.onpointerleave = () => show(-1);
    wrap.onkeydown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next = active < 0 ? n - 1 : active + (e.key === "ArrowRight" ? 1 : -1);
      show(Math.max(0, Math.min(n - 1, next)));
    };
    wrap.onblur = () => show(-1);
  };

  const ro = new ResizeObserver(() => draw());
  ro.observe(wrap);
  return wrap;
}

// ---------- Views ----------

function kpiTiles(data, onSelect) {
  return h(
    "div",
    { class: "kpis", role: "group", "aria-label": "Metric shown in the chart" },
    Object.entries(METRICS).map(([key, m]) => {
      const cur = data.totals[key];
      const prev = data.totalsPrev?.[key];
      return h(
        "button",
        {
          class: `kpi m-${key}`,
          type: "button",
          "aria-pressed": String(S.metric === key),
          onclick: () => onSelect(key),
        },
        h("span", { class: "kpi-label" }, h("span", { class: "kpi-swatch" }), m.label),
        h("span", { class: "kpi-value" }, key === "position" && (!data.totals.impressions || noQueries()) ? "–" : m.fmt(cur)),
        key === "position" && noQueries()
          ? h("span", { class: "kpi-sub" }, "Not reported for this search type")
          : h(
              "span",
              { class: "kpi-sub" },
              data.totalsPrev ? delta(cur, prev, key === "ctr" ? "pp" : key === "position" ? "pos" : "pct") : null,
              data.totalsPrev ? h("span", {}, `vs ${key === "position" ? fmt.pos(prev) : m.fmt(prev)}`) : h("span", {}, "No comparison"),
            ),
      );
    }),
  );
}

function grainControl(onChange) {
  if (hourly() || S.days < 28) return null;
  const opts = [["day", "Daily"], ["week", "Weekly"], ...(S.days >= 90 ? [["month", "Monthly"]] : [])];
  return h(
    "div",
    { class: "segmented segmented-sm", role: "group", "aria-label": "Group chart by" },
    opts.map(([g, label]) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(S.grain === g),
          onclick: () => {
            S.grain = g;
            LS.set("gscc-grain", g);
            track("chart_grouped", { grain: g });
            onChange();
          },
        },
        label,
      ),
    ),
  );
}

function noteForm(data, onDone) {
  const date = h("input", { class: "input", type: "date", value: data.r.end, min: data.r.start, max: iso(new Date()), "aria-label": "Note date", required: true });
  const text = h("input", { class: "input", type: "text", maxlength: "120", placeholder: "What changed? e.g. Rewrote service page titles", "aria-label": "Note", required: true });
  return h(
    "form",
    {
      class: "note-form",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const res = await api("/api/project/annotations", { date: date.value, text: text.value });
          S.project.annotations = res.annotations;
          track("note_added");
          toast("Note added");
          onDone();
        } catch (err) {
          toast(err.message, 6000);
        }
      },
    },
    date,
    text,
    h("button", { class: "btn btn-primary", type: "submit" }, "Add note"),
    h("button", { class: "btn btn-ghost", type: "button", onclick: onDone }, "Cancel"),
  );
}

function trendBlock(data) {
  const host = h("div");
  let adding = false;
  const render = () => {
    const m = METRICS[S.metric];
    const grain = hourly() ? "hour" : S.days < 28 ? "day" : S.grain === "month" && S.days < 90 ? "week" : S.grain;
    const fresh = data.metadata?.first_incomplete_date;
    fill(host, 
      kpiTiles(data, (key) => {
        S.metric = key;
        LS.set("gscc-metric", key);
        track("metric_selected", { metric: key });
        render();
      }),
      h(
        "section",
        { class: `panel chart-panel m-${S.metric}` },
        h(
          "div",
          { class: "chart-head" },
          h("strong", {}, `${m.label} by ${grain}`),
          grainControl(render),
          !hourly() && h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => ((adding = !adding), render()) }, "Add note"),
          h("div", { class: "legend" }, h("span", {}, h("i"), "This period"), data.seriesPrev ? h("span", {}, h("i", { class: "prev" }), "Previous period") : null, (S.project.annotations ?? []).length && !hourly() ? h("span", {}, h("b", { class: "note-swatch" }), "Note") : null),
        ),
        adding && noteForm(data, () => ((adding = false), render())),
        trendChart(groupSeries(data.series, grain), groupSeries(data.seriesPrev, grain), S.metric, grain),
        h(
          "div",
          { class: "chart-foot" },
          S.metric === "position" ? h("span", {}, "Lower is better, so the axis is flipped.") : null,
          S.type === "web" ? h("span", {}, "Web results include AI Overviews and AI Mode. Google’s API doesn’t report them separately.") : null,
          fresh && !hourly() ? h("span", {}, `Data from ${fmt.dateLong(fresh)} is still being processed and may change.`) : null,
        ),
      ),
    );
  };
  render();
  return host;
}

const DEVICE_ICON = { DESKTOP: "desktop", MOBILE: "mobile", TABLET: "tablet" };

function devicesPanel(devices) {
  const total = devices.reduce((s, d) => s + d.clicks, 0) || 1;
  const sorted = [...devices].sort((a, b) => b.clicks - a.clicks);
  return h(
    "section",
    { class: "panel" },
    h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, "Devices"), h("p", {}, "Share of clicks"))),
    sorted.length
      ? h(
          "div",
          { class: "bars" },
          sorted.map((d) =>
            h(
              "div",
              { class: "bar-row" },
              icon(DEVICE_ICON[d.key] ?? "globe"),
              h("span", { class: "bar-label" }, d.key.charAt(0) + d.key.slice(1).toLowerCase()),
              h("span", { class: "bar-value" }, `${fmt.int(d.clicks)} (${fmt.pct(d.clicks / total, 0)})`),
              bar(d.clicks / total, "bar-track"),
            ),
          ),
        )
      : h("div", { class: "empty" }, "No data for this period."),
  );
}

async function viewOverview() {
  fill(content, pageHead("Performance", null, rangeNote()), skeleton());
  const data = await loadPerformance();
  const countries = data.countries.map((c) => ({ ...c, countryName: countryName(c.key) }));
  const countryCols = [{ key: "key", label: "Country", cls: "key", sortValue: (r) => r.countryName, render: (r) => h("span", { class: "cell-key" }, r.countryName) }, COLS.clicks(Math.max(...countries.map((c) => c.clicks), 1)), COLS.impressions, COLS.ctr, COLS.position];
  fill(content, 
    pageHead("Performance", null, rangeNote(), filterBar()),
    trendBlock(data),
    h(
      "div",
      { class: "grid grid-2" },
      noQueries() ? noQueriesPanel("Top queries") : compactTable({ title: "Top queries", rows: [...data.queries].sort((a, b) => b.clicks - a.clicks).slice(0, 10), label: "Query", link: { href: "#queries", label: "View all queries" } }),
      compactTable({ title: "Top pages", rows: [...data.pages].sort((a, b) => b.clicks - a.clicks).slice(0, 10), kind: "page", label: "Page", link: { href: "#pages", label: "View all pages" } }),
    ),
    h(
      "div",
      { class: "grid grid-3-1" },
      dataTable({ name: "countries", title: "Countries", rows: countries, columns: countryCols, pageSize: 10, search: true }),
      devicesPanel(data.devices),
    ),
  );
}

async function viewDimension(kind) {
  const isQuery = kind === "query";
  const title = isQuery ? "Queries" : "Pages";
  fill(content, pageHead(title, null, rangeNote()), skeleton(10));
  const data = await loadPerformance();
  const rows = isQuery ? data.queries : data.pages;
  const max = Math.max(...rows.map((r) => r.clicks), 1);
  const columns = [COLS.key(isQuery ? "Query" : "Page", kind), COLS.clicks(max), data.r.compare && COLS.dClicks, COLS.impressions, COLS.ctr, COLS.position, data.r.compare && COLS.dPos].filter(Boolean);
  fill(content, 
    pageHead(title, isQuery ? "Search terms that showed your site in Google results." : "Your pages that appeared in Google results.", rangeNote(), filterBar()),
    trendBlock(data),
    h(
      "div",
      { class: "grid" },
      isQuery && noQueries() ? noQueriesPanel("Queries") : dataTable({
        name: isQuery ? "queries" : "pages",
        title: `${fmt.int(rows.length)} ${isQuery ? "queries" : "pages"}`,
        desc: isQuery ? "Google hides queries that very few people searched, so totals can exceed the sum of rows." : null,
        rows,
        columns,
        pageSize: 50,
      }),
    ),
  );
}

// Approximate organic CTR by position, used to flag under-performing snippets.
const EXPECTED_CTR = [0, 0.28, 0.16, 0.11, 0.08, 0.06, 0.045, 0.035, 0.03, 0.025, 0.02];
const expectedCtr = (pos) => EXPECTED_CTR[Math.min(10, Math.max(1, Math.round(pos)))] ?? 0.01;

async function viewOpportunities() {
  fill(content, pageHead("Opportunities", null, rangeNote()), skeleton(10));
  const data = await loadPerformance();
  const minImpr = Math.max(10, Math.round(S.days * 1.5));

  const striking = data.queries
    .filter((q) => q.position >= 3.5 && q.position <= 20.5 && q.impressions >= minImpr)
    .map((q) => ({ ...q, potential: Math.max(0, Math.round(q.impressions * EXPECTED_CTR[3] - q.clicks)) }));

  const lowCtr = data.pages
    .filter((p) => p.position <= 10 && p.impressions >= minImpr * 3)
    .map((p) => ({ ...p, expected: expectedCtr(p.position), missed: Math.round(p.impressions * (expectedCtr(p.position) - p.ctr)) }))
    .filter((p) => p.ctr < p.expected * 0.6 && p.missed > 0);

  const losing = data.r.compare ? data.queries.filter((q) => q.dClicks !== null && q.dClicks < 0) : [];

  fill(content, 
    pageHead("Opportunities", "Where a small improvement is likely to bring the most extra clicks.", rangeNote(), filterBar()),
    h(
      "div",
      { class: "grid" },
      dataTable({
        name: "striking-distance",
        title: "Striking distance queries",
        desc: `Ranking between positions 4 and 20 with at least ${minImpr} impressions. Moving these into the top 3 usually brings the biggest gains.`,
        rows: striking,
        columns: [COLS.key("Query"), COLS.position, COLS.impressions, COLS.clicks(), COLS.ctr, { key: "potential", label: "Extra clicks at #3", num: true, render: (r) => h("strong", {}, `+${fmt.int(r.potential)}`) }],
        sort: { key: "potential", dir: "desc" },
        empty: "No queries in striking distance for this period.",
      }),
      dataTable({
        name: "low-ctr-pages",
        title: "Pages with a low click-through rate",
        desc: "On page one, but clicked far less often than pages at a similar position. Rewrite the title and meta description.",
        rows: lowCtr,
        columns: [
          COLS.key("Page", "page"),
          COLS.position,
          COLS.impressions,
          COLS.ctr,
          { key: "expected", label: "Typical CTR", num: true, render: (r) => fmt.pct(r.expected, 1) },
          { key: "missed", label: "Missed clicks", num: true, render: (r) => h("strong", {}, fmt.int(r.missed)) },
        ],
        sort: { key: "missed", dir: "desc" },
        empty: "Every page-one result is earning a typical share of clicks.",
      }),
      data.r.compare &&
        dataTable({
          name: "declining-queries",
          title: "Declining queries",
          desc: "Queries that lost the most clicks compared with the previous period.",
          rows: losing,
          columns: [COLS.key("Query"), COLS.dClicks, { key: "prevClicks", label: "Before", num: true, render: (r) => fmt.int(r.prevClicks) }, COLS.clicks(), COLS.position, COLS.dPos],
          sort: { key: "dClicks", dir: "asc" },
          empty: "No queries lost clicks. Nice.",
        }),
    ),
  );
}

function sitemapStatus(s) {
  if (s.isPending) return h("span", { class: "badge badge-warn" }, "Pending");
  if (Number(s.errors) > 0) return h("span", { class: "badge badge-bad" }, icon("alert"), `${s.errors} ${Number(s.errors) === 1 ? "error" : "errors"}`);
  if (Number(s.warnings) > 0) return h("span", { class: "badge badge-warn" }, icon("alert"), `${s.warnings} ${Number(s.warnings) === 1 ? "warning" : "warnings"}`);
  return h("span", { class: "badge badge-good" }, icon("check"), "Success");
}

const VERDICT_TEXT = {
  PASS: "URL is on Google",
  PARTIAL: "URL is on Google, with issues",
  FAIL: "URL is not on Google",
  NEUTRAL: "URL is not on Google",
  VERDICT_UNSPECIFIED: "Status unknown",
};

function inspectionView(result) {
  const r = result.inspectionResult ?? {};
  const idx = r.indexStatusResult ?? {};
  const verdict = idx.verdict ?? "VERDICT_UNSPECIFIED";
  const rich = r.richResultsResult?.detectedItems?.map((d) => d.richResultType).join(", ");
  const facts = [
    ["Coverage", idx.coverageState],
    ["Indexing allowed", idx.indexingState?.replace(/_/g, " ").toLowerCase()],
    ["Robots.txt", idx.robotsTxtState?.toLowerCase()],
    ["Page fetch", idx.pageFetchState?.replace(/_/g, " ").toLowerCase()],
    ["Last crawl", idx.lastCrawlTime ? fmt.dateTime(idx.lastCrawlTime) : "Never crawled"],
    ["Crawled as", idx.crawledAs?.toLowerCase()],
    ["Google-selected canonical", idx.googleCanonical],
    ["User-declared canonical", idx.userCanonical],
    ["Found in sitemaps", idx.sitemap?.join(", ")],
    ["Referring pages", idx.referringUrls?.length ? `${idx.referringUrls.length} found` : null],
    ["Rich results", rich ? `${rich} (${r.richResultsResult.verdict?.toLowerCase()})` : null],
  ].filter(([, v]) => v);
  return h(
    "div",
    { class: "inspect-result" },
    h("div", { class: `verdict verdict-${verdict}` }, icon(verdict === "PASS" ? "check" : "alert"), h("div", {}, h("strong", {}, VERDICT_TEXT[verdict] ?? verdict), idx.coverageState && h("span", {}, idx.coverageState))),
    h("dl", { class: "facts" }, facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    r.inspectionResultLink && h("a", { class: "btn", href: r.inspectionResultLink, target: "_blank", rel: "noopener" }, "Open in Search Console", icon("external")),
  );
}

async function viewIndexing() {
  const origin = S.site.startsWith("sc-domain:") ? `https://${S.site.slice(10)}/` : S.site;
  const sitemapHost = h("div", {}, skeleton(3));
  const feedInput = h("input", { class: "input", type: "url", required: true, value: `${origin}sitemap.xml`, "aria-label": "Sitemap URL" });
  const urlInput = h("input", { class: "input", type: "url", required: true, placeholder: `${origin}your-page`, "aria-label": "URL to inspect" });
  const inspectOut = h("div", { "aria-live": "polite" });

  const loadSitemaps = async () => {
    try {
      const { sitemaps } = await api(`/api/sitemaps?siteUrl=${encodeURIComponent(S.site)}`);
      const rows = sitemaps.map((s) => ({
        ...s,
        key: s.path,
        submitted: (s.contents ?? []).reduce((n, c) => n + Number(c.submitted ?? 0), 0),
      }));
      fill(sitemapHost, 
        dataTable({
          name: "sitemaps",
          title: "Sitemaps",
          desc: "Sitemaps you’ve submitted for this property.",
          rows,
          columns: [
            { key: "key", label: "Sitemap", cls: "key", render: (r) => pageLink(r.path) },
            { key: "type", label: "Type", render: (r) => (r.isSitemapsIndex ? "Sitemap index" : { sitemap: "Sitemap", rssFeed: "RSS feed", atomFeed: "Atom feed", urlList: "URL list" }[r.type] ?? "Sitemap") },
            { key: "lastSubmitted", label: "Submitted", sortValue: (r) => r.lastSubmitted ?? "", render: (r) => h("span", { title: fmt.dateTime(r.lastSubmitted) }, fmt.day(r.lastSubmitted)) },
            { key: "lastDownloaded", label: "Last read", sortValue: (r) => r.lastDownloaded ?? "", render: (r) => h("span", { title: fmt.dateTime(r.lastDownloaded) }, fmt.day(r.lastDownloaded)) },
            { key: "errors", label: "Status", sortValue: (r) => Number(r.errors) * 1000 + Number(r.warnings), render: sitemapStatus },
            { key: "submitted", label: "Discovered URLs", num: true, render: (r) => fmt.int(r.submitted) },
          ],
          sort: { key: "lastSubmitted", dir: "desc" },
          search: false,
          exportable: false,
          empty: "No sitemaps submitted yet. Add one above.",
        }),
      );
    } catch (err) {
      fill(sitemapHost, errorPanel(err, loadSitemaps));
    }
  };

  fill(content, 
    pageHead("Sitemaps & inspection", "Tell Google about your pages and check how it sees any URL."),
    h(
      "div",
      { class: "grid grid-2" },
      h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, "Inspect a URL"), h("p", {}, "Index status, last crawl and canonical, straight from Google."))),
        h(
          "div",
          { class: "panel-body" },
          h(
            "form",
            {
              class: "form-row",
              onsubmit: async (e) => {
                e.preventDefault();
                const btn = e.target.querySelector("button");
                btn.disabled = true;
                fill(inspectOut, h("div", { class: "panel-loading muted" }, h("span", { class: "spinner" }), " Asking Google…"));
                try {
                  const res = await api("/api/inspect", { siteUrl: S.site, url: urlInput.value });
                  fill(inspectOut, inspectionView(res));
                  track("url_inspected", { verdict: res.inspectionResult?.indexStatusResult?.verdict ?? "unknown" });
                } catch (err) {
                  fill(inspectOut, h("div", { class: "alert alert-bad" }, icon("alert"), h("div", {}, err.message)));
                } finally {
                  btn.disabled = false;
                }
              },
            },
            urlInput,
            h("button", { class: "btn btn-primary", type: "submit" }, "Inspect"),
          ),
          inspectOut,
        ),
      ),
      h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, "Submit a sitemap"), h("p", {}, "Google reads it within a few days. Resubmit after big site changes."))),
        h(
          "div",
          { class: "panel-body" },
          h(
            "form",
            {
              class: "form-row",
              onsubmit: async (e) => {
                e.preventDefault();
                const btn = e.target.querySelector("button");
                btn.disabled = true;
                try {
                  await api("/api/sitemaps/submit", { siteUrl: S.site, feedpath: feedInput.value });
                  toast("Sitemap submitted");
                  track("sitemap_submitted");
                  loadSitemaps();
                } catch (err) {
                  toast(err.message, 6000);
                } finally {
                  btn.disabled = false;
                }
              },
            },
            feedInput,
            h("button", { class: "btn btn-primary", type: "submit" }, "Submit"),
          ),
        ),
      ),
    ),
    h("div", { class: "grid" }, sitemapHost),
  );
  loadSitemaps();
}

function brandAndNotesPanel() {
  const termsInput = h("input", { class: "input", type: "text", value: (S.project.brandTerms ?? []).join(", "), placeholder: "e.g. northshore, north shore plumbing", "aria-label": "Brand terms" });
  const notes = [...(S.project.annotations ?? [])].reverse();
  return h(
    "section",
    { class: "panel" },
    h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, "Brand terms and chart notes"), h("p", {}, "Saved in this project’s .gsc-connect.json, so Claude Code uses them too."))),
    h(
      "div",
      { class: "setting-row" },
      h("div", { class: "grow" }, h("strong", {}, "Brand terms"), h("span", { class: "muted" }, "Queries containing any of these count as branded. Separate with commas. Include common misspellings.")),
    ),
    h(
      "form",
      {
        class: "setting-row form-row",
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const brandTerms = termsInput.value.split(",").map((t) => t.trim()).filter(Boolean);
            const res = await api("/api/project/brand-terms", { brandTerms });
            S.project.brandTerms = res.brandTerms;
            S.cache.clear();
            toast(brandTerms.length ? "Brand terms saved" : "Brand terms cleared");
          } catch (err) {
            toast(err.message, 6000);
          }
        },
      },
      termsInput,
      h("button", { class: "btn", type: "submit" }, "Save"),
    ),
    h(
      "div",
      { class: "setting-row" },
      h("div", { class: "grow" }, h("strong", {}, `Chart notes (${notes.length})`), h("span", { class: "muted" }, "Add them from the chart, or ask Claude Code to note what it changed.")),
    ),
    notes.length
      ? h(
          "ul",
          { class: "note-list" },
          notes.map((a) =>
            h(
              "li",
              {},
              h("span", { class: "muted num" }, fmt.dateLong(a.date)),
              h("span", { class: "grow" }, a.text, a.source === "claude" ? h("span", { class: "badge badge-brand" }, "Claude") : null),
              h(
                "button",
                {
                  class: "btn btn-ghost btn-sm",
                  type: "button",
                  "aria-label": `Delete note: ${a.text}`,
                  onclick: async () => {
                    const res = await api("/api/project/annotations", { action: "remove", date: a.date, text: a.text });
                    S.project.annotations = res.annotations;
                    viewSettings();
                  },
                },
                "Delete",
              ),
            ),
          ),
        )
      : null,
  );
}

async function viewSettings() {
  const st = S.state;
  const tel = await api("/api/telemetry").catch(() => null);
  const granted = tel?.consent === "granted";

  const siteSelect = h(
    "select",
    { class: "select", "aria-label": "Property for this project" },
    h("option", { value: "" }, "Not linked"),
    S.sites.map((s) => h("option", { value: s.siteUrl, selected: s.siteUrl === st.linkedSite }, `${siteLabel(s.siteUrl)} (${siteKind(s.siteUrl)})`)),
  );

  const toggle = h("button", {
    class: "switch",
    type: "button",
    role: "switch",
    "aria-checked": String(granted),
    "aria-label": "Share anonymous usage metrics",
    onclick: async () => {
      const next = granted ? "denied" : "granted";
      await api("/api/telemetry/consent", { consent: next });
      S.state.telemetryConsent = next;
      toast(next === "granted" ? "Thanks. Anonymous usage sharing is on." : "Usage sharing is off. Nothing will be sent.");
      viewSettings();
    },
  });

  const log = tel?.log ?? [];

  fill(content, 
    pageHead("Settings", "Your Google connection, this project, and privacy."),
    h(
      "div",
      { class: "settings" },
      h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, "Google account"))),
        h(
          "div",
          { class: "setting-row" },
          h("span", { class: "avatar" }, (st.email ?? "G").charAt(0).toUpperCase()),
          h("div", { class: "grow" }, h("strong", {}, st.email ?? "Connected"), h("span", { class: "muted" }, "Access to Search Console and Site Verification")),
          h(
            "button",
            {
              class: "btn btn-danger",
              type: "button",
              onclick: async () => {
                if (!confirm("Disconnect Google? This revokes the connector’s access. You can connect again any time.")) return;
                await api("/api/disconnect", {});
                location.href = "/connect";
              },
            },
            icon("logout"),
            "Disconnect",
          ),
        ),
        h(
          "div",
          { class: "setting-row" },
          h(
            "div",
            { class: "grow" },
            h("strong", {}, "Google sign-in"),
            h(
              "span",
              { class: "muted" },
              st.clientSource === "builtin"
                ? "Built-in Search Console Connector sign-in. Agencies can use their own Google Cloud project instead."
                : `Your own OAuth client ${st.clientIdHint ?? ""} from ${st.clientSource === "environment" ? "environment variables" : st.configDir}`,
            ),
          ),
          st.clientSource !== "environment" && h("a", { class: "btn", href: "/connect?step=cloud" }, st.clientSource === "builtin" ? "Use my own" : "Change"),
        ),
      ),
      h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, "This project"), h("p", {}, st.projectDir))),
        h(
          "div",
          { class: "setting-row" },
          h("div", { class: "grow" }, h("strong", {}, "Default property"), h("span", { class: "muted" }, "Claude Code uses this when you don’t name a property. Saved in .gsc-connect.json, which contains no secrets.")),
          siteSelect,
          h(
            "button",
            {
              class: "btn",
              type: "button",
              onclick: async () => {
                if (!siteSelect.value) return toast("Choose a property first");
                await api("/api/project-link", { siteUrl: siteSelect.value });
                S.state.linkedSite = siteSelect.value;
                toast(`Linked to ${siteLabel(siteSelect.value)}`);
              },
            },
            "Save",
          ),
        ),
      ),
      brandAndNotesPanel(),
      h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, "Anonymous usage metrics"), h("p", {}, "Helps the open-source project see which features are used. Never includes your sites, URLs, queries or Search Console data."))),
        h(
          "div",
          { class: "setting-row" },
          h(
            "div",
            { class: "grow" },
            h("strong", {}, "Share anonymous usage"),
            h(
              "span",
              { class: "muted" },
              tel?.forcedOff
                ? "Turned off by DO_NOT_TRACK or GSC_CONNECT_TELEMETRY=0 on this computer."
                : granted
                  ? tel?.measurementId
                    ? `On. Events are sent to Google Analytics 4 (${tel.measurementId}).`
                    : "On, but this build has no analytics property configured, so events are only logged locally."
                  : "Off. Nothing is sent.",
            ),
          ),
          !tel?.forcedOff && toggle,
        ),
        h(
          "details",
          { class: "setting-details" },
          h("summary", { class: "setting-row" }, h("strong", {}, `What’s been sent (${log.length})`)),
          h(
            "div",
            { class: "log" },
            log.length
              ? log.map((e) => h("div", { class: "log-entry" }, h("span", { class: "muted" }, fmt.dateTime(e.at)), h("code", {}, JSON.stringify(e.event))))
              : h("p", { class: "muted" }, granted ? "Nothing yet." : "Nothing has been sent."),
          ),
        ),
      ),
      h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-head" }, h("div", { class: "grow" }, h("h2", {}, "About"))),
        h(
          "div",
          { class: "setting-row" },
          h("div", { class: "grow" }, h("strong", {}, `Search Console Connector ${st.version ?? ""}`), h("span", { class: "muted" }, "Free and open source under the MIT license.")),
          h("a", { class: "btn", href: "https://claude-repo.com/google-search-console-connector", target: "_blank", rel: "noopener" }, "Docs", icon("external")),
        ),
      ),
    ),
  );
}

// ---------- Shell ----------

const VIEWS = {
  overview: viewOverview,
  queries: () => viewDimension("query"),
  pages: () => viewDimension("page"),
  opportunities: viewOpportunities,
  indexing: viewIndexing,
  settings: viewSettings,
};

async function render() {
  const view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
  if (view !== S.view) track("view_changed", { view });
  S.view = view;
  $$(".nav a").forEach((a) => (a.dataset.view === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const needsSite = view !== "settings";
  $(".topbar-controls").classList.toggle("is-hidden", view === "indexing" || view === "settings");
  if (needsSite && !S.site) {
    fill(content, 
      pageHead("No properties yet"),
      h(
        "div",
        { class: "panel" },
        h("div", { class: "empty" }, h("strong", {}, `${S.state.email ?? "This account"} has no Search Console properties.`), h("span", {}, "Ask Claude Code to “add this site to Search Console and verify it”, then refresh this page.")),
      ),
    );
    return;
  }
  try {
    await VIEWS[view]();
  } catch (err) {
    fill(content, pageHead(view.charAt(0).toUpperCase() + view.slice(1)), errorPanel(err, render));
  }
}

function setSite(siteUrl) {
  S.site = siteUrl;
  LS.set("gscc-site", siteUrl);
  const fav = $("#site-favicon");
  fav.onload = () => (fav.hidden = false);
  fav.onerror = () => (fav.hidden = true);
  fav.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(siteLabel(siteUrl))}&sz=32`;
}

function setRange(days) {
  S.days = days;
  LS.set("gscc-days", String(days));
  $$("#range button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.range) === days)));
}

function renderAccount() {
  if (S.state.updateAvailable) {
    $("#account").before(
      h("a", { class: "update-pill", href: "https://claude-repo.com/google-search-console-connector", target: "_blank", rel: "noopener", title: "Run npx google-search-console-connector@latest" }, `Version ${S.state.updateAvailable} is available`),
    );
  }
  fill($("#account"), 
    h("span", { class: "avatar" }, (S.state.email ?? "G").charAt(0).toUpperCase()),
    h("div", { class: "who" }, S.state.email ?? "Google account", h("small", {}, S.state.linkedSite ? `Project: ${S.state.projectName}` : "Connected")),
  );
}

function setThemeIcon() {
  const dark = (document.documentElement.dataset.theme || "dark") === "dark";
  const btn = $("#theme-btn");
  fill(btn, icon(dark ? "sun" : "moon"));
  btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}

async function boot() {
  hydrateIcons();
  S.state = await api("/api/state");
  if (!S.state.connected) {
    location.href = "/connect";
    return;
  }
  track("page_view", { page_title: "dashboard" });
  const project = await api("/api/project").catch(() => ({}));
  S.project = { brandTerms: project.brandTerms ?? [], annotations: project.annotations ?? [] };
  if (S.state.demo) $(".property-picker").append(h("span", { class: "badge badge-warn", title: "Synthetic data. Run connect to see your own." }, "Sample data"));
  renderAccount();
  setThemeIcon();

  const savedDays = Number(new URLSearchParams(location.search).get("days") ?? LS.get("gscc-days"));
  setRange([1, 7, 28, 90, 180, 365, 480].includes(savedDays) ? savedDays : 28);
  if (["day", "week", "month"].includes(LS.get("gscc-grain"))) S.grain = LS.get("gscc-grain");
  const savedMetric = LS.get("gscc-metric");
  if (METRICS[savedMetric]) S.metric = savedMetric;

  fill(content, skeleton());
  try {
    S.sites = (await api("/api/sites")).sites.filter((s) => s.permissionLevel !== "siteUnverifiedUser");
  } catch (err) {
    fill(content, errorPanel(err, () => location.reload()));
    return;
  }

  const select = $("#site-select");
  fill(select, ...S.sites.map((s) => h("option", { value: s.siteUrl }, `${siteLabel(s.siteUrl)}${s.siteUrl.startsWith("sc-domain:") ? " (domain)" : ""}`)));
  const saved = LS.get("gscc-site");
  const initial = [S.state.linkedSite, saved].find((u) => u && S.sites.some((s) => s.siteUrl === u)) ?? S.sites[0]?.siteUrl;
  if (initial) {
    setSite(initial);
    select.value = initial;
  }
  select.addEventListener("change", () => {
    setSite(select.value);
    track("property_switched");
    render();
  });

  $$("#range button").forEach((b) =>
    b.addEventListener("click", () => {
      setRange(Number(b.dataset.range));
      track("range_changed", { range: `${S.days}d` });
      render();
    }),
  );
  $("#type-select").addEventListener("change", (e) => {
    S.type = e.target.value;
    track("search_type_changed", { search_type: S.type });
    render();
  });
  $("#refresh-btn").addEventListener("click", () => {
    S.cache.clear();
    render();
  });
  $("#theme-btn").addEventListener("click", () => {
    track("theme_toggled", { theme: toggleTheme() });
    setThemeIcon();
  });

  const sidebar = $("#sidebar");
  const scrim = $("#scrim");
  const menuBtn = $("#menu-btn");
  const setMenu = (open) => {
    sidebar.classList.toggle("open", open);
    scrim.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
  };
  menuBtn.addEventListener("click", () => setMenu(!sidebar.classList.contains("open")));
  scrim.addEventListener("click", () => setMenu(false));
  $$(".nav a").forEach((a) => a.addEventListener("click", () => setMenu(false)));

  window.addEventListener("hashchange", () => {
    render();
    content.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
  render();
}

boot().catch((err) => fill(content, errorPanel(err, () => location.reload())));
