const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg; }

function normalizePair(s) {
  return (s || "")
    .toString()
    .replace(/["']/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

function parseCsvRows(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Find the real header line (starts with pair1,pair2)
  const headerIndex = lines.findIndex(line =>
    line.toLowerCase().startsWith("pair1,") ||
    line.toLowerCase().startsWith("pair1;")
  );

  if (headerIndex === -1) {
    // Might be matrix format (often starts right away, no pair1/pair2 header)
    // We'll still parse it by detecting delimiter on the first line.
    const firstLine = lines[0] || "";
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount  = (firstLine.match(/;/g) || []).length;
    const sep = semiCount > commaCount ? ";" : ",";
    return lines.map(line => line.split(sep).map(s => s.replace(/^"|"$/g, "").trim()));
  }

  const dataLines = lines.slice(headerIndex);
  const sep = dataLines[0].includes(";") ? ";" : ",";

  return dataLines.map(line =>
    line.split(sep).map(s => s.replace(/^"|"$/g, "").trim())
  );
}

/* ---------- FORMAT A: LONG CSV (pair1,pair2,5min,...,day,week) ---------- */
function isLongFormat(rows) {
  if (rows.length < 2) return false;
  const header = rows[0].map(x => (x || "").toLowerCase());
  return header.includes("pair1") && header.includes("pair2") && header.includes("day");
}

function topNFromLongFormat(rows, n = 6, basePair = "") {
  const header = rows[0].map(x => (x || "").toLowerCase());
  const idxPair1 = header.indexOf("pair1");
  const idxPair2 = header.indexOf("pair2");
  const idxDay   = header.indexOf("day");

  if (idxPair1 < 0 || idxPair2 < 0 || idxDay < 0) return [];

  const base = normalizePair(basePair);
  const bestByKey = new Map();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const a = normalizePair(r[idxPair1]);
    const b = normalizePair(r[idxPair2]);
    if (!a || !b || a === b) continue;

    // If base pair is set, only keep rows where base is involved
    if (base && a !== base && b !== base) continue;

    const raw = (r[idxDay] || "").toString().replace("%","").trim();
    const corr = Number(raw);
    if (!Number.isFinite(corr)) continue;

    const key = [a, b].sort().join("::");
    const abs = Math.abs(corr);

    const prev = bestByKey.get(key);
    if (!prev || abs > prev.abs) bestByKey.set(key, { a, b, corr, abs });
  }

  return [...bestByKey.values()]
    .sort((x, y) => y.abs - x.abs)
    .slice(0, n);
}

/* ---------- FORMAT B: MATRIX CSV (grid of correlations) ---------- */
function isMatrixFormat(rows) {
  if (rows.length < 2) return false;
  // Heuristic: matrix typically has many columns and is roughly square,
  // and first row are headers while first column is row labels.
  return rows[0].length > 5 && rows[1] && rows[1].length === rows[0].length;
}

function topNFromMatrix(rows, n = 6, basePair = "") {
  const base = normalizePair(basePair);

  // Header row: first cell blank/label, then pair names
  const headers = rows[0].slice(1).map(normalizePair);

  const bestByKey = new Map();
  const baseList = [];

  for (let i = 1; i < rows.length; i++) {
    const rowPair = normalizePair(rows[i][0]);
    if (!rowPair) continue;

    for (let j = 1; j < rows[i].length; j++) {
      const colPair = headers[j - 1];
      if (!colPair || rowPair === colPair) continue;

      const raw = (rows[i][j] || "").toString().replace("%","").trim();
      const corr = Number(raw);
      if (!Number.isFinite(corr)) continue;

      const abs = Math.abs(corr);
      const key = [rowPair, colPair].sort().join("::");

      const prev = bestByKey.get(key);
      if (!prev || abs > prev.abs) {
        bestByKey.set(key, { a: rowPair, b: colPair, corr, abs });
      }
    }
  }

  const all = [...bestByKey.values()];

  // If base is provided, return only pairs involving base
  const filtered = base
    ? all.filter(x => x.a === base || x.b === base)
    : all;

  return filtered
    .sort((x, y) => y.abs - x.abs)
    .slice(0, n);
}

/* ---------- Render ---------- */
function render(list, basePair = "") {
  const out = $("out");
  out.innerHTML = "";

  const base = normalizePair(basePair);

  if (!list.length) {
    out.innerHTML = `<div class="result">No results found${base ? ` for base pair <strong>${base}</strong>` : ""}.</div>`;
    return;
  }

  list.forEach((x, idx) => {
    const div = document.createElement("div");
    div.className = "result";

    const baseTag = base ? `<span class="pill">Base: ${base}</span>` : "";
    const title = `<strong>#${idx + 1} ${x.a} ↔ ${x.b}</strong> ${baseTag}`;

    div.innerHTML = `
      <div>${title}</div>
      <div class="small">Correlation (1D/day): ${x.corr}% (ranked by absolute value)</div>
    `;
    out.appendChild(div);
  });
}

async function handleCsvText(csvText) {
  const basePair = $("base").value;
  const base = normalizePair(basePair);

  setStatus("Parsing CSV...");
  const rows = parseCsvRows(csvText);

  if (!rows.length) {
    setStatus("CSV is empty.");
    render([], basePair);
    return;
  }

  setStatus(`Rows: ${rows.length}\nDetecting format...`);

  let top = [];

  if (isLongFormat(rows)) {
    setStatus(
      `Detected: LONG format (pair1/pair2/.../day)\n` +
      `Computing Top 6${base ? " for base " + base : ""} (day)...`
    );
    top = topNFromLongFormat(rows, 6, basePair);
  } else if (isMatrixFormat(rows)) {
    setStatus(
      `Detected: MATRIX format (grid)\n` +
      `Computing Top 6${base ? " for base " + base : ""}...`
    );
    top = topNFromMatrix(rows, 6, basePair);
  } else {
    setStatus(
      `Unknown CSV format.\n\nTip: Your CSV should be either:\n` +
      `- pair1,pair2,5min,...,day,week\nOR\n` +
      `- a correlation matrix grid.`
    );
    render([], basePair);
    return;
  }

  if (base && top.length === 0) {
    setStatus(
      `Done, but no matches for base pair "${base}".\n` +
      `Make sure your base pair exactly matches Mataf pair codes in the CSV.`
    );
    render([], basePair);
    return;
  }

  setStatus(
    `Done. Showing Top ${top.length} strongest correlations` +
    (base ? ` for base pair ${base}.` : ".")
  );
  render(top, basePair);
}

/* ---------- Upload handler ---------- */
$("file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setStatus(`Reading file: ${file.name}...`);
  const text = await file.text();
  $("csv").value = text; // show in textarea
  await handleCsvText(text);
});

/* ---------- Buttons ---------- */
$("go").addEventListener("click", async () => {
  const text = $("csv").value;
  if (!text.trim()) {
    setStatus("Paste CSV text or upload a CSV file first.");
    return;
  }
  await handleCsvText(text);
});

$("clear").addEventListener("click", () => {
  $("base").value = "";
  $("csv").value = "";
  $("file").value = "";
  $("out").innerHTML = "";
  setStatus("Waiting for CSV…");
});