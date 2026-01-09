const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg; }

function normalize(s) {
  return (s || "")
    .toString()
    .replace(/["']/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

// Returns { mode: "none" | "currency" | "pair", value: string }
function parseBaseInput(input) {
  const v = normalize(input);

  if (!v) return { mode: "none", value: "" };

  // If they typed exactly 3 letters, treat as currency (NZD, USD, EUR, etc.)
  if (/^[A-Z]{3}$/.test(v)) return { mode: "currency", value: v };

  // If they typed exactly 6 letters, treat as a pair (NZDUSD, GBPJPY, etc.)
  if (/^[A-Z]{6}$/.test(v)) return { mode: "pair", value: v };

  // Fallback: if they typed >= 6 letters, first 6 is pair attempt
  if (/^[A-Z]{6,}$/.test(v)) return { mode: "pair", value: v.slice(0, 6) };

  // Otherwise it's invalid-ish, treat as none but we will warn later
  return { mode: "invalid", value: v };
}

function pairContainsCurrency(pair, ccy) {
  // Pair is expected like "NZDUSD"
  return pair && ccy && (pair.startsWith(ccy) || pair.endsWith(ccy));
}

function parseCsvRows(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Find header line for LONG format
  const headerIndex = lines.findIndex(line =>
    line.toLowerCase().startsWith("pair1,") ||
    line.toLowerCase().startsWith("pair1;")
  );

  // If no pair1/pair2 header, we try to parse as MATRIX using delimiter detection
  if (headerIndex === -1) {
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

function topNFromLongFormat(rows, n = 6, baseInfo = { mode: "none", value: "" }) {
  const header = rows[0].map(x => (x || "").toLowerCase());
  const idxPair1 = header.indexOf("pair1");
  const idxPair2 = header.indexOf("pair2");
  const idxDay   = header.indexOf("day");

  if (idxPair1 < 0 || idxPair2 < 0 || idxDay < 0) return [];

  const bestByKey = new Map();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const a = normalize(r[idxPair1]);
    const b = normalize(r[idxPair2]);
    if (!a || !b || a === b) continue;

    // Filtering rules:
    if (baseInfo.mode === "pair") {
      const basePair = baseInfo.value;
      if (a !== basePair && b !== basePair) continue;
    } else if (baseInfo.mode === "currency") {
      const ccy = baseInfo.value;
      // keep if either side is a pair containing the currency
      if (!pairContainsCurrency(a, ccy) && !pairContainsCurrency(b, ccy)) continue;
    } else if (baseInfo.mode === "invalid") {
      // don't filter here; we will warn user later
    }

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
  return rows[0].length > 5 && rows[1] && rows[1].length === rows[0].length;
}

function topNFromMatrix(rows, n = 6, baseInfo = { mode: "none", value: "" }) {
  // Header row: first cell blank/label, then pair names
  const headers = rows[0].slice(1).map(normalize);
  const bestByKey = new Map();

  for (let i = 1; i < rows.length; i++) {
    const rowPair = normalize(rows[i][0]);
    if (!rowPair) continue;

    for (let j = 1; j < rows[i].length; j++) {
      const colPair = headers[j - 1];
      if (!colPair || rowPair === colPair) continue;

      // Filter early (saves time)
      if (baseInfo.mode === "pair") {
        const basePair = baseInfo.value;
        if (rowPair !== basePair && colPair !== basePair) continue;
      } else if (baseInfo.mode === "currency") {
        const ccy = baseInfo.value;
        if (!pairContainsCurrency(rowPair, ccy) && !pairContainsCurrency(colPair, ccy)) continue;
      }

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

  return [...bestByKey.values()]
    .sort((x, y) => y.abs - x.abs)
    .slice(0, n);
}

/* ---------- Render ---------- */
function labelForBase(baseInfo) {
  if (!baseInfo || baseInfo.mode === "none") return "";
  if (baseInfo.mode === "pair") return `Base pair: ${baseInfo.value}`;
  if (baseInfo.mode === "currency") return `Base currency: ${baseInfo.value}`;
  if (baseInfo.mode === "invalid") return `Base: ${baseInfo.value} (invalid)`;
  return "";
}

function render(list, baseInfo) {
  const out = $("out");
  out.innerHTML = "";

  const baseLabel = labelForBase(baseInfo);
  const pill = baseLabel ? `<span class="pill">${baseLabel}</span>` : "";

  if (!list.length) {
    out.innerHTML = `<div class="result">No results found ${pill ? pill : ""}.</div>`;
    return;
  }

  list.forEach((x, idx) => {
    const div = document.createElement("div");
    div.className = "result";

    div.innerHTML = `
      <div><strong>#${idx + 1} ${x.a} ↔ ${x.b}</strong> ${pill}</div>
      <div class="small">Correlation (1D/day): ${x.corr}% (ranked by absolute value)</div>
    `;
    out.appendChild(div);
  });
}

async function handleCsvText(csvText) {
  const baseRaw = $("base").value;
  const baseInfo = parseBaseInput(baseRaw);

  setStatus("Parsing CSV...");
  const rows = parseCsvRows(csvText);

  if (!rows.length) {
    setStatus("CSV is empty.");
    render([], baseInfo);
    return;
  }

  if (baseInfo.mode === "invalid") {
    setStatus(
      `Base input looks invalid: "${normalize(baseRaw)}"\n` +
      `Type 3 letters (e.g. NZD) or 6 letters (e.g. NZDUSD).`
    );
    render([], baseInfo);
    return;
  }

  setStatus(`Rows: ${rows.length}\nDetecting format...`);

  let top = [];

  if (isLongFormat(rows)) {
    setStatus(
      `Detected: LONG format (pair1/pair2/.../day)\n` +
      `Computing Top 6${baseInfo.mode !== "none" ? " for " + labelForBase(baseInfo) : ""}...`
    );
    top = topNFromLongFormat(rows, 6, baseInfo);
  } else if (isMatrixFormat(rows)) {
    setStatus(
      `Detected: MATRIX format (grid)\n` +
      `Computing Top 6${baseInfo.mode !== "none" ? " for " + labelForBase(baseInfo) : ""}...`
    );
    top = topNFromMatrix(rows, 6, baseInfo);
  } else {
    setStatus(
      `Unknown CSV format.\n\nTip: Your CSV should be either:\n` +
      `- pair1,pair2,5min,...,day,week\nOR\n` +
      `- a correlation matrix grid.`
    );
    render([], baseInfo);
    return;
  }

  if (baseInfo.mode !== "none" && top.length === 0) {
    setStatus(
      `Done, but no matches for ${labelForBase(baseInfo)}.\n` +
      `Make sure your base matches the CSV pair codes (e.g. NZD, USD, EUR, NZDUSD).`
    );
    render([], baseInfo);
    return;
  }

  setStatus(
    `Done. Showing Top ${top.length} strongest correlations` +
    (baseInfo.mode !== "none" ? ` for ${labelForBase(baseInfo)}.` : ".")
  );
  render(top, baseInfo);
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