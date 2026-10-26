import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createState, flatten, runPass, setGoal, snapshot } from "./engine.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 8791);
const chains = new Set(["solana", "base", "bsc", "ethereum"]);

let state = createState();
let board = [];
let boardAt = 0;
const clients = new Set();
let busy = false;

function normalize(pair) {
  const now = Date.now();
  const m5 = pair.txns?.m5 || { buys: 0, sells: 0 };
  const h1 = pair.txns?.h1 || m5;
  const buys = m5.buys + m5.sells > 0 ? m5.buys : h1.buys;
  const sells = m5.buys + m5.sells > 0 ? m5.sells : h1.sells;
  const flow = Math.max(1, buys + sells);
  const volM5 = pair.volume?.m5 || 0;
  const volH1 = pair.volume?.h1 || 0;
  return {
    symbol: (pair.baseToken?.symbol || "???").replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "???",
    address: pair.baseToken?.address,
    chain: pair.chainId,
    pair: pair.pairAddress,
    url: pair.url,
    price: Number(pair.priceUsd || 0),
    liq: Number(pair.liquidity?.usd || 0),
    ageMin: Math.max(0, (now - (pair.pairCreatedAt || now)) / 60_000),
    buyShare: buys / flow,
    volX: volM5 / Math.max(volH1 / 12, 1),
    chgM5: Number(pair.priceChange?.m5 || 0),
    chgH1: Number(pair.priceChange?.h1 || 0),
  };
}

async function loadBoard() {
  const response = await fetch("https://api.dexscreener.com/token-profiles/latest/v1", { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("profiles " + response.status);
  const profiles = await response.json();
  const picked = [];
  const seen = new Set();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!chains.has(profile.chainId) || !profile.tokenAddress || seen.has(profile.tokenAddress)) continue;
    seen.add(profile.tokenAddress);
    picked.push(profile);
    if (picked.length >= 8) break;
  }
  const detailed = [];
  for (const profile of picked) {
    try {
      const body = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${profile.tokenAddress}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!body.ok) continue;
      const json = await body.json();
      const pairs = (json.pairs || []).filter((pair) => pair.chainId === profile.chainId && pair.baseToken?.address);
      pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      if (pairs[0]) detailed.push(normalize(pairs[0]));
    } catch {
      // skip one token
    }
  }
  detailed.sort((a, b) => b.volX - a.volX);
  return detailed;
}

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot(state))}\n\n`;
  for (const client of clients) client.write(payload);
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (Date.now() - boardAt > 12_000 || board.length === 0) {
      const next = await loadBoard();
      if (next.length) {
        board = next;
        boardAt = Date.now();
      }
    }
    if (board.length) {
      runPass(state, board);
      broadcast();
    }
  } catch (error) {
    console.error(error.message);
  } finally {
    busy = false;
  }
}

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname === "/api/state") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(snapshot(state)));
    return;
  }
  if (url.pathname === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify(snapshot(state))}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname === "/api/control" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      body = {};
    }
    if (body.action === "goal") setGoal(state, Number(body.goal));
    if (body.action === "flatten") flatten(state);
    broadcast();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(snapshot(state)));
    return;
  }
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(publicDir, path.normalize(requested));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`desk http://127.0.0.1:${port}`);
});
setInterval(tick, 1000);
tick();
