const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg; }

// A reasonable “Mataf-style” basket (same idea as their default CSV link).
// You can expand this list later.
const SYMBOLS = [
  "AUDCAD","AUDCHF","AUDJPY","AUDNZD","AUDUSD",
  "CADCHF","CADJPY","CHFJPY",
  "EURAUD","EURCAD","EURCHF","EURGBP","EURJPY","EURNZD","EURUSD",
  "GBPAUD","GBPCAD","GBPCHF","GBPJPY","GBPNZD","GBPUSD",
  "NZDCAD","NZDCHF","NZDJPY","NZDUSD",
  "USDCAD","USDCHF","USDJPY"
];

// This is the CSV API behind “Download CSV” on the Mataf correlation page.  [oai_citation:1‡Mataf](https://www.mataf.net/en/forex/tools/correlation)
// NOTE: "50" is the "Num Period" used for the snapshot on that page.
// It’s a daily snapshot by default (1D).
function buildCsvUrl() {
  const symbolsParam = encodeURIComponent(SYMBOLS.join("|"));
  return `https://www.mataf.io/api/tools/csv/correl/snapshot/forex/50/correlation.csv?symbol=${symbolsParam}`;
}

async function fetchText(url, useProxy) {
  const finalUrl = useProxy
    ? `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    : url;

  const res = await fetch(finalUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// Basic CSV parser (handles commas and semicolons).
function parseCsv(text) {
  const sep = text.includes(";") && !text.includes(",") ? ";" : ",";
  const lines = text.trim().split(/\r?\n/).filter(Boolean);

  // Split line safely (simple version; Mataf CSV is usually plain)
  const rows = lines.map(line => line.split(sep).map(s => s.replace(/^"|"$/g, "").trim()));
  return rows;
}

// Build unique pair correlations from a matrix-like CSV.
// We assume first row is headers: Pair, Pair, Pair...
function computeTop6(rows) {
  if (rows.length < 2) return [];

  const headers = rows[0].slice(1); // column pair names
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const rowPair = rows[i][0];
    for (let j = 1; j < rows[i].length; j++) {
      const colPair = headers[j - 1];
      const valRaw = rows[i][j];
      const corr = Number(String(valRaw).replace("%",""));
      if (!Number.isFinite(corr)) continue;
      if (!rowPair || !colPair) continue;
      if (rowPair === colPair) continue;

      // Make a unique key so (A,B) and (B,A) are treated as one
      const a = rowPair;
      const b = colPair;
      const key = [a,b].sort().join("::");

      results.push({ key, a, b, corr, abs: Math.abs(corr) });
    }
  }

  // De-dupe by keeping the strongest abs correlation for each unique pair
  const bestByKey = new Map();
  for (const r of results) {
    const prev = bestByKey.get(r.key);
    if (!prev || r.abs > prev.abs) bestByKey.set(r.key, r);
  }

  return [...bestByKey.values()]
    .sort((x,y) => y.abs - x.abs)
    .slice(0, 6);
}

function renderTop6(list) {
  const out = $("out");
  out.innerHTML = "";
  if (!list.length) {
    out.innerHTML = `<div class="card">No results. (Either CSV format changed or fetch was blocked.)</div>`;
    return;
  }

  list.forEach((x, idx) => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div><strong>#${idx+1} ${x.a} ↔ ${x.b}</strong></div>
      <div class="small">Correlation (1D snapshot): ${x.corr}% (ranked by absolute value)</div>
    `;
    out.appendChild(div);
  });
}

$("go").addEventListener("click", async () => {
  const link = $("matafLink").value.trim();
  const useProxy = $("proxy").checked;

  if (!link.includes("mataf.net/en/forex/tools/correlation")) {
    setStatus("That link doesn’t look like the Mataf correlation page. Paste the correlation page link.");
    return;
  }

  const csvUrl = buildCsvUrl();

  try {
    setStatus(`Fetching Daily (1D) CSV snapshot...\nMode: ${useProxy ? "proxy" : "direct"}\nCSV: ${csvUrl}`);
    const csvText = await fetchText(csvUrl, useProxy);

    setStatus(`CSV fetched (${csvText.length} chars). Parsing...`);
    const rows = parseCsv(csvText);
    const top6 = computeTop6(rows);

    setStatus(`Done. Showing Top ${top6.length} strongest correlations.`);
    renderTop6(top6);
  } catch (e) {
    setStatus(
      `Failed: ${e.message}\n\nIf this is blocked, tick “Use proxy”.\nIf proxy still fails, the CSV endpoint is blocking browser access and then you’d need a backend OR manual copy/paste mode.`
    );
  }
});
