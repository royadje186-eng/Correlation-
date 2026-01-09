const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg; }

function parseCsv(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Mataf CSV could be comma or semicolon separated
  const firstLine = trimmed.split(/\r?\n/)[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount  = (firstLine.match(/;/g) || []).length;
  const sep = semiCount > commaCount ? ";" : ",";

  const lines = trimmed.split(/\r?\n/).filter(Boolean);

  // Simple split (works for Mataf-style numeric tables)
  return lines.map(line =>
    line.split(sep).map(s => s.replace(/^"|"$/g, "").trim())
  );
}

function computeTop6(rows) {
  if (rows.length < 2) return [];

  // Expect a matrix:
  // rows[0] = headers, first cell blank, then pair names
  // rows[i][0] = row pair name, rows[i][j] = correlation value
  const headers = rows[0].slice(1).map(x => x.replace(/\s+/g,""));

  const bestByKey = new Map();

  for (let i = 1; i < rows.length; i++) {
    const rowPair = (rows[i][0] || "").replace(/\s+/g,"");
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

function render(list) {
  const out = $("out");
  out.innerHTML = "";

  if (!list.length) {
    out.innerHTML = `<div class="result">No results. Make sure you pasted/uploaded the full correlation CSV (matrix table).</div>`;
    return;
  }

  list.forEach((x, idx) => {
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `
      <div><strong>#${idx + 1} ${x.a} ↔ ${x.b}</strong></div>
      <div class="small">Correlation (1D): ${x.corr}% (ranked by absolute value)</div>
    `;
    out.appendChild(div);
  });
}

async function handleCsvText(csvText) {
  setStatus("Parsing CSV...");
  const rows = parseCsv(csvText);

  setStatus(`Rows: ${rows.length}\nComputing Top 6...`);
  const top6 = computeTop6(rows);

  setStatus(`Done. Showing Top ${top6.length} strongest correlations.`);
  render(top6);
}

// Upload handler
$("file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setStatus(`Reading file: ${file.name}...`);
  const text = await file.text();
  $("csv").value = text; // optional: show it in the textarea
  await handleCsvText(text);
});

// Buttons
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