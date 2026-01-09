const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg; }

function detectSeparator(text) {
  const firstLine = text.trim().split(/\r?\n/)[0] || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount  = (firstLine.match(/;/g) || []).length;
  return semiCount > commaCount ? ";" : ",";
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

  if (headerIndex === -1) return [];

  const dataLines = lines.slice(headerIndex);

  const sep = dataLines[0].includes(";") ? ";" : ",";

  return dataLines.map(line =>
    line.split(sep).map(s => s.replace(/^"|"$/g, "").trim())
  );
}

/* ---------- FORMAT A: LONG CSV (pair1,pair2,5min,...,day,week) ---------- */
function isLongFormat(rows) {
  if (rows.length < 2) return false;
  const header = rows[0].map(x => x.toLowerCase());
  return header.includes("pair1") && header.includes("pair2") && header.includes("day");
}

function top6FromLongFormat(rows) {
  const header = rows[0].map(x => x.toLowerCase());
  const idxPair1 = header.indexOf("pair1");
  const idxPair2 = header.indexOf("pair2");
  const idxDay   = header.indexOf("day");

  if (idxPair1 < 0 || idxPair2 < 0 || idxDay < 0) return [];

  const bestByKey = new Map();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const a = (r[idxPair1] || "").trim();
    const b = (r[idxPair2] || "").trim();
    if (!a || !b || a === b) continue;

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
    .slice(0, 6);
}

/* ---------- FORMAT B: MATRIX CSV (grid of correlations) ---------- */
function isMatrixFormat(rows) {
  if (rows.length < 2) return false;
  // Matrix typically has many columns, first row are pair headers
  // and first column is also a pair name.
  return rows[0].length > 5 && rows[1].length === rows[0].length;
}

function top6FromMatrix(rows) {
  const headers = rows[0].slice(1).map(x => x.replace(/\s+/g, ""));
  const bestByKey = new Map();

  for (let i = 1; i < rows.length; i++) {
    const rowPair = (rows[i][0] || "").replace(/\s+/g, "");
    if (!rowPair) continue;

    for (let j = 1; j < rows[i].length; j++) {
      const colPair = headers[j - 1];
      if (!colPair || rowPair === colPair) continue;

      const raw = (rows[i][j] || "").toString().replace("%","").trim();
      const corr = Number(raw);
      if (!Number.isFinite(corr)) continue;

      const key = [rowPair, colPair].sort().join("::");
      const abs = Math.abs(corr);

      const prev = bestByKey.get(key);
      if (!prev || abs > prev.abs) {
        bestByKey.set(key, { a: rowPair, b: colPair, corr, abs });
      }
    }
  }

  return [...bestByKey.values()]
    .sort((x, y) => y.abs - x.abs)
    .slice(0, 6);
}

/* ---------- Render ---------- */
function render(list) {
  const out = $("out");
  out.innerHTML = "";

  if (!list.length) {
    out.innerHTML = `<div class="result">No results. CSV parsed, but no correlations found.</div>`;
    return;
  }

  list.forEach((x, idx) => {
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `
      <div><strong>#${idx + 1} ${x.a} ↔ ${x.b}</strong></div>
      <div class="small">Correlation (1D/day): ${x.corr}% (ranked by absolute value)</div>
    `;
    out.appendChild(div);
  });
}

async function handleCsvText(csvText) {
  setStatus("Parsing CSV...");
  const rows = parseCsvRows(csvText);

  if (!rows.length) {
    setStatus("CSV is empty.");
    render([]);
    return;
  }

  setStatus(`Rows: ${rows.length}\nDetecting format...`);

  let top6 = [];

  if (isLongFormat(rows)) {
    setStatus(`Detected: LONG format (pair1/pair2/.../day)\nComputing Top 6 (day)...`);
    top6 = top6FromLongFormat(rows);
  } else if (isMatrixFormat(rows)) {
    setStatus(`Detected: MATRIX format (grid)\nComputing Top 6...`);
    top6 = top6FromMatrix(rows);
  } else {
    setStatus(
      `Unknown CSV format.\n\nTip: Your CSV should be either:\n- pair1,pair2,5min,...,day,week\nOR\n- a correlation matrix grid.`
    );
    render([]);
    return;
  }

  setStatus(`Done. Showing Top ${top6.length} strongest correlations.`);
  render(top6);
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
  $("csv").value = "";
  $("file").value = "";
  $("out").innerHTML = "";
  setStatus("Waiting for CSV…");
});