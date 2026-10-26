import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvePending,
  closePosition,
  createState,
  rejectPending,
  runStep,
  snapshot,
} from "./engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const SESSION_FILE = path.join(DATA_DIR, "session.json");
const PORT = Number(process.env.PORT || 8787);
const TICK_MS = 3500;
const BOARD_MS = 20_000;

const CHAINS = new Set(["solana", "base", "bsc", "ethereum"]);

let state = createState();
const clients = new Set();
let ticking = false;

function normalizePair(pair) {
  const now = Date.now();
  const ageMin = Math.max(0, (now - (pair.pairCreatedAt || now)) / 60_000);
  const m5 = pair.txns?.m5 || { buys: 0, sells: 0 };
  const h1 = pair.txns?.h1 || { buys: 0, sells: 0 };
  const useM5 = m5.buys + m5.sells > 0;
  const buys = useM5 ? m5.buys : h1.buys;
  const sells = useM5 ? m5.sells : h1.sells;
  const flow = Math.max(1, buys + sells);
  const volM5 = pair.volume?.m5 || 0;
  const volH1 = pair.volume?.h1 || 0;
  const baseline = Math.max(volH1 / 12, 1);
  return {
    symbol: (pair.baseToken?.symbol || "???").slice(0, 12),
    name: pair.baseToken?.name || pair.baseToken?.symbol || "unknown",
    address: pair.baseToken?.address,
    chain: pair.chainId,
    dex: pair.dexId,
    pair: pair.pairAddress,
    url: pair.url,
    quote: pair.quoteToken?.symbol || "",
    price: Number(pair.priceUsd || 0),
    liq: Number(pair.liquidity?.usd || 0),
    fdv: Number(pair.fdv || pair.marketCap || 0),
    ageMin,
    buyShare: buys / flow,
    volX: volM5 / baseline,
    chgM5: Number(pair.priceChange?.m5 || 0),
    chgH1: Number(pair.priceChange?.h1 || 0),
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function loadBoard() {
  const profiles = await fetchJson("https://api.dexscreener.com/token-profiles/latest/v1");
  const picked = [];
  const seen = new Set();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!CHAINS.has(profile.chainId) || !profile.tokenAddress) continue;
    if (seen.has(profile.tokenAddress)) continue;
    seen.add(profile.tokenAddress);
    picked.push(profile);
    if (picked.length >= 6) break;
  }
  const detailed = [];
  for (const profile of picked) {
    try {
      const body = await fetchJson(
        `https://api.dexscreener.com/latest/dex/tokens/${profile.tokenAddress}`,
      );
      const pairs = (body.pairs || []).filter((pair) => pair.chainId === profile.chainId);
      pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      if (!pairs[0]?.baseToken?.address) continue;
      detailed.push(normalizePair(pairs[0]));
    } catch {
      // One token failing should not stall the desk.
    }
  }
  detailed.sort((a, b) => b.volX - a.volX || b.liq - a.liq);
  return detailed;
}

async function loadPrice(position) {
  const body = await fetchJson(
    `https://api.dexscreener.com/latest/dex/pairs/${position.chain}/${position.pair}`,
  );
  const pair = (body.pairs || body.pair) && (body.pairs?.[0] || body.pair);
  const price = Number(pair?.priceUsd || 0);
  if (pair?.liquidity?.usd) position.liq = Number(pair.liquidity.usd);
  return price;
}

const market = {
  boardDue(current) {
    return Date.now() - current.boardAt > BOARD_MS || current.board.length === 0;
  },
  board: loadBoard,
  async price(position) {
    try {
      return await loadPrice(position);
    } catch {
      return null;
    }
  },
};

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot(state))}\n\n`;
  for (const client of clients) client.write(payload);
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(state));
}

async function tick() {
  if (!state.running || ticking) return;
  ticking = true;
  try {
    await runStep(state, market);
    broadcast();
    await persist();
  } catch (error) {
    state.agents.scanner = {
      ...state.agents.scanner,
      status: "SCAN",
      detail: "feed hiccup · retrying",
    };
    state.headline = "SCANNER · FEED RETRY";
    broadcast();
    console.error(error.message);
  } finally {
    ticking = false;
  }
}

function applyControl(body) {
  const action = body?.action;
  if (action === "start") state.running = true;
  else if (action === "pause") state.running = false;
  else if (action === "toggle") state.running = !state.running;
  else if (action === "mode") {
    state.mode = state.mode === "live" ? "paper" : "live";
    state.agents.chief = {
      ...state.agents.chief,
      status: state.mode === "live" ? "HOLD" : "ROUTE",
      line: state.mode === "live" ? "nothing leaves until you approve" : "routes only, never trades",
      detail: state.mode === "live" ? "live gate armed" : "paper book is the destination",
    };
    if (!state.pending) {
      state.route = {
        ...state.route,
        to: state.mode === "live" ? "approval gate" : "paper book",
      };
    }
  } else if (action === "approve") {
    const result = approvePending(state);
    if (!result.ok) return result;
  } else if (action === "reject") {
    const result = rejectPending(state);
    if (!result.ok) return result;
  } else if (action === "flatten") {
    if (!state.position) return { ok: false, error: "no open position" };
    closePosition(state, state.position.markPrice, "manual flatten");
  } else if (action === "reset") {
    const mode = state.mode;
    state = createState();
    state.mode = mode;
  } else {
    return { ok: false, error: "unknown action" };
  }
  return { ok: true };
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname === "/api/state") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(snapshot(state)));
    return;
  }
  if (url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
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
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "bad json" }));
      return;
    }
    if (body.action === "approve" && state.pending?.token?.pair) {
      try {
        const price = await loadPrice(state.pending.token);
        if (price > 0) state.pending.token.price = price;
      } catch {
        // Approval still uses the last scanned price if the pair lookup misses.
      }
    }
    const result = applyControl(body);
    broadcast();
    await persist();
    res.writeHead(result.ok ? 200 : 400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...result, state: snapshot(state) }));
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const file = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

try {
  const saved = JSON.parse(await readFile(SESSION_FILE, "utf8"));
  if (saved && typeof saved.cash === "number" && saved.agents) state = saved;
} catch {
  // First boot starts a fresh night.
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`trading terminal http://127.0.0.1:${PORT}`);
});

setInterval(() => {
  tick();
}, TICK_MS);
tick();
