/** Paper desk. Six roles taken from the phone videos, one synchronous pass. */

export const START = 2324;
export const SLIP_CAP = 0.02;
export const CUT = 0.04;
export const SIZE = 0.25;

export const AGENTS = [
  { id: "sniper", name: "Sniper", job: "fresh pairs < 5 min", tone: "orange" },
  { id: "momentum", name: "Momentum", job: "volume breakouts", tone: "blue" },
  { id: "dip", name: "Dip Hunter", job: "−30% wicks", tone: "teal" },
  { id: "whale", name: "Whale Tail", job: "checks traders", tone: "purple" },
  { id: "fade", name: "Fade", job: "crowded funding", tone: "pink" },
  { id: "guard", name: "Guard", job: "slip cap · cut at −4%", tone: "red" },
];

const LEADS = [
  { id: "AV", rank: "#1" },
  { id: "LD", rank: "#2" },
  { id: "MX", rank: "#3" },
  { id: "BB", rank: "#4" },
  { id: "SS", rank: "#5" },
  { id: "CW", rank: "#6" },
];

export function createState() {
  return {
    start: START,
    cash: START,
    positions: {},
    record: Object.fromEntries(AGENTS.map((agent) => [agent.id, { w: 0, l: 0, pnl: 0, sparks: [] }])),
    log: [],
    goal: 2,
    leads: LEADS.map((lead) => ({ ...lead, fired: false })),
    lead: 0,
    whaleStreak: 0,
    curve: [START],
    lastPassMs: 0,
    recommendation: null,
    board: [],
    checked: 0,
  };
}

export function money(n) {
  const value = Number.isFinite(n) ? n : 0;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function slipOf(sizeUsd, liquidity) {
  if (!Number.isFinite(liquidity) || liquidity <= 0 || sizeUsd <= 0) return 1;
  return Math.min(0.5, (sizeUsd / liquidity) * 0.5 + 0.0012);
}

function equityOf(state) {
  return Object.values(state.positions).reduce((sum, position) => sum + position.qty * position.mark, state.cash);
}

function pushLog(state, row) {
  state.log.unshift({ t: Date.now(), ...row });
  if (state.log.length > 80) state.log.length = 80;
}

function scoreToken(token, state) {
  const notes = [];
  const buys = {};
  if (token.ageMin < 5 && token.liq >= 8_000 && token.buyShare >= 0.48 && token.buyShare <= 0.88) {
    buys.sniper = `fresh ${Math.max(1, Math.round(token.ageMin))}m · buyers ${Math.round(token.buyShare * 100)}%`;
  } else if (token.ageMin < 5) {
    notes.push({ agent: "sniper", action: "skip", reason: token.liq < 8_000 ? "pool too thin" : "flow not clean" });
  }
  if (token.volX >= 2 && token.chgM5 > 1 && token.chgH1 > 0) {
    buys.momentum = `volume ${token.volX.toFixed(1)}× · m5 ${token.chgM5.toFixed(1)}%`;
  }
  if (token.chgM5 <= -15) {
    buys.dip = `wick ${token.chgM5.toFixed(1)}%`;
  }
  if (token.buyShare >= 0.64 && token.volX >= 1.3 && !state.leads[state.lead].fired) {
    buys.whale = `lead ${state.leads[state.lead].id} · buys ${Math.round(token.buyShare * 100)}% of flow`;
  }
  const crowded = token.chgM5 >= 18 && token.buyShare >= 0.72;
  if (crowded) {
    return [
      { agent: "fade", action: "fade", symbol: token.symbol, address: token.address, reason: `crowded · m5 +${token.chgM5.toFixed(1)}%`, token },
      ...Object.keys(buys).map((agent) => ({
        agent,
        action: "skip",
        symbol: token.symbol,
        address: token.address,
        reason: "fade disagrees · skip the coin",
        token,
      })),
      ...notes.map((note) => ({ ...note, symbol: token.symbol, address: token.address, token })),
    ];
  }
  return [
    ...Object.entries(buys).map(([agent, reason]) => ({
      agent,
      action: "buy",
      symbol: token.symbol,
      address: token.address,
      reason,
      token,
    })),
    ...notes.map((note) => ({ ...note, symbol: token.symbol, address: token.address, token })),
  ];
}

function openPosition(state, signal) {
  const equity = equityOf(state);
  const sizeUsd = Math.min(equity * SIZE, state.cash * 0.92);
  const slip = slipOf(sizeUsd, signal.token.liq);
  if (sizeUsd < 5) {
    return { ok: false, reason: "cash below a ticket" };
  }
  if (slip > SLIP_CAP) {
    return { ok: false, reason: `slip ${(slip * 100).toFixed(1)}% over 2% cap`, slip };
  }
  const fill = signal.token.price * (1 + slip);
  state.cash -= sizeUsd;
  state.positions[signal.agent] = {
    agent: signal.agent,
    symbol: signal.token.symbol,
    address: signal.token.address,
    chain: signal.token.chain,
    pair: signal.token.pair,
    url: signal.token.url,
    fill,
    mark: fill,
    peak: fill,
    qty: sizeUsd / fill,
    sizeUsd,
    slip,
    liq: signal.token.liq,
    reason: signal.reason,
    opened: Date.now(),
  };
  state.record[signal.agent].sparks.push(0);
  return { ok: true, slip, sizeUsd };
}

function closePosition(state, id, reason) {
  const position = state.positions[id];
  if (!position) return null;
  const exitSlip = Math.min(slipOf(position.qty * position.mark, position.liq), 0.05);
  const proceeds = position.qty * position.mark * (1 - exitSlip);
  const pnl = proceeds - position.sizeUsd;
  state.cash += proceeds;
  delete state.positions[id];
  const book = state.record[id];
  book.pnl += pnl;
  if (pnl >= 0) {
    book.w += 1;
    if (id === "whale") state.whaleStreak = 0;
  } else {
    book.l += 1;
    if (id === "whale") state.whaleStreak += 1;
  }
  book.sparks.push(pnl);
  if (book.sparks.length > 16) book.sparks.shift();
  if (id === "whale" && state.whaleStreak >= 2) {
    state.leads[state.lead].fired = true;
    state.lead = (state.lead + 1) % state.leads.length;
    state.whaleStreak = 0;
    pushLog(state, { agent: "whale", action: "fired", symbol: position.symbol, reason: "two losses · switched trader", result: "next lead" });
  }
  pushLog(state, {
    agent: id,
    action: "sell",
    symbol: position.symbol,
    reason,
    result: `${pnl >= 0 ? "+" : ""}${money(pnl)}`,
    pnl,
  });
  return pnl;
}

function markPositions(state, byAddress) {
  for (const position of Object.values(state.positions)) {
    const live = byAddress.get(position.address);
    if (!live) continue;
    position.mark = live.price;
    position.peak = Math.max(position.peak, live.price);
    position.liq = live.liq || position.liq;
    const pnlPct = (position.mark - position.fill) / position.fill;
    state.record[position.agent].sparks.push(pnlPct);
    if (state.record[position.agent].sparks.length > 16) state.record[position.agent].sparks.shift();
    if (pnlPct <= -CUT) {
      closePosition(state, position.agent, "guard cut −4%");
      continue;
    }
    if (position.agent === "momentum" && position.peak > position.fill * 1.08 && position.mark < position.peak * 0.96) {
      closePosition(state, position.agent, "trailing stop");
      continue;
    }
    if ((position.agent === "dip" || position.agent === "sniper") && pnlPct >= 0.12) {
      closePosition(state, position.agent, "target hit");
      continue;
    }
    if (position.agent === "whale" && live.buyShare < 0.45) {
      closePosition(state, position.agent, "volume faded");
    }
  }
}

export function runPass(state, board) {
  const started = process.hrtime.bigint();
  state.board = board;
  const byAddress = new Map(board.map((token) => [token.address, token]));
  markPositions(state, byAddress);
  const equity = equityOf(state);
  const signals = [];
  for (const token of board) {
    if (!token.price) continue;
    state.checked += 1;
    signals.push(...scoreToken(token, state));
  }
  const buys = signals.filter((signal) => signal.action === "buy" && !state.positions[signal.agent]);
  buys.sort((a, b) => (b.token.volX || 0) - (a.token.volX || 0));
  let recommendation = null;
  for (const chosen of buys) {
    const slip = slipOf(equity * SIZE, chosen.token.liq);
    if (slip > SLIP_CAP) {
      recommendation = {
        agent: "guard",
        action: "skip",
        symbol: chosen.symbol,
        reason: `slip ${(slip * 100).toFixed(1)}% over 2% cap`,
        slip,
      };
      continue;
    }
    const opened = openPosition(state, chosen);
    recommendation = {
      agent: opened.ok ? chosen.agent : "guard",
      action: opened.ok ? "buy" : "skip",
      symbol: chosen.symbol,
      reason: opened.ok ? chosen.reason : opened.reason,
      slip: opened.slip ?? slip,
      sizePct: SIZE,
    };
    if (opened.ok) break;
  }
  if (recommendation) {
    pushLog(state, {
      agent: recommendation.agent,
      action: recommendation.action,
      symbol: recommendation.symbol,
      reason: recommendation.reason,
      result: recommendation.action === "buy" ? `size ${Math.round(SIZE * 100)}%` : "no order",
    });
  } else {
    const fade = signals.find((signal) => signal.action === "fade");
    const skip = signals.find((signal) => signal.action === "skip");
    const fallback = fade || skip;
    recommendation = fallback
      ? { agent: fallback.agent, action: fallback.action, symbol: fallback.symbol, reason: fallback.reason, slip: 0, sizePct: 0 }
      : { agent: "sniper", action: "scan", symbol: "—", reason: "board quiet", slip: 0, sizePct: 0 };
    if (fallback) {
      pushLog(state, { agent: fallback.agent, action: fallback.action, symbol: fallback.symbol, reason: fallback.reason, result: "no order" });
    }
  }
  const balance = equityOf(state);
  state.curve.push(balance);
  if (state.curve.length > 80) state.curve.shift();
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  state.lastPassMs = elapsed;
  state.recommendation = { ...recommendation, ms: elapsed, balance };
  return snapshot(state);
}

export function snapshot(state) {
  const mtm = Object.values(state.positions).reduce((sum, position) => sum + position.qty * position.mark, 0);
  const balance = state.cash + mtm;
  const multiple = balance / state.start;
  const trades = AGENTS.reduce((sum, agent) => sum + state.record[agent.id].w + state.record[agent.id].l, 0);
  const wins = AGENTS.reduce((sum, agent) => sum + state.record[agent.id].w, 0);
  return {
    start: state.start,
    balance,
    cash: state.cash,
    multiple,
    goal: state.goal,
    goalHit: multiple >= state.goal,
    pnl: balance - state.start,
    trades,
    wins,
    losses: trades - wins,
    lastPassMs: state.lastPassMs,
    recommendation: state.recommendation,
    curve: state.curve,
    checked: state.checked,
    lead: state.leads[state.lead],
    leads: state.leads,
    agents: AGENTS.map((agent) => {
      const position = state.positions[agent.id];
      const book = state.record[agent.id];
      return {
        ...agent,
        w: book.w,
        l: book.l,
        pnl: book.pnl + (position ? position.qty * position.mark - position.sizeUsd : 0),
        sparks: book.sparks.slice(-12),
        status: position ? "live" : agent.id === "guard" ? "armed" : "idle",
        position: position
          ? {
              symbol: position.symbol,
              pnlPct: ((position.mark - position.fill) / position.fill) * 100,
              url: position.url,
            }
          : null,
      };
    }),
    board: state.board.slice(0, 6).map((token) => ({
      symbol: token.symbol,
      chg: token.chgM5,
    })),
    log: state.log.slice(0, 14),
    openCount: Object.keys(state.positions).length,
    paper: true,
  };
}

export function setGoal(state, goal) {
  const allowed = [1.25, 1.5, 2, 3, 4, 5];
  if (!allowed.includes(goal)) return snapshot(state);
  state.goal = goal;
  pushLog(state, { agent: "you", action: "goal", symbol: `${goal}×`, reason: "goal change needs a tap", result: "set" });
  return snapshot(state);
}

export function flatten(state) {
  for (const id of Object.keys(state.positions)) closePosition(state, id, "flatten");
  return snapshot(state);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function selftest() {
  const state = createState();
  const good = {
    symbol: "WIF",
    address: "wif",
    chain: "solana",
    pair: "p",
    url: "https://dexscreener.com",
    price: 1,
    liq: 80_000,
    ageMin: 2,
    buyShare: 0.66,
    volX: 3,
    chgM5: 4,
    chgH1: 6,
  };
  const thin = { ...good, address: "thin", symbol: "DUST", liq: 400, price: 0.2, volX: 4 };
  const crowded = { ...good, address: "hot", symbol: "HOT", chgM5: 28, buyShare: 0.8, volX: 3 };
  const snap = runPass(state, [thin, crowded, good]);
  assert(snap.lastPassMs < 50, `pass took ${snap.lastPassMs}ms`);
  assert(snap.recommendation, "a recommendation is delivered");
  assert(snap.recommendation.action === "buy" || snap.recommendation.action === "skip" || snap.recommendation.action === "fade", "action is explicit");
  const bought = createState();
  const only = runPass(bought, [good]);
  assert(only.recommendation.action === "buy", "clean fresh pair is a buy");
  assert(only.openCount === 1, "one position");
  assert(Math.abs(only.agents.find((agent) => agent.position).pnl) < only.start, "size is a slice of equity");
  const held = bought.positions.sniper || bought.positions.momentum || bought.positions.whale;
  assert(held, "position stored");
  held.mark = held.fill * 0.95;
  markPositions(bought, new Map());
  // force guard by calling close path through mark with a map
  const addr = held.address;
  markPositions(bought, new Map([[addr, { price: held.fill * 0.95, liq: 80_000, buyShare: 0.6 }]]));
  assert(!bought.positions[held.agent], "guard cuts a −4% position");
  const disagree = createState();
  const faded = runPass(disagree, [crowded]);
  assert(faded.recommendation.action === "fade" || faded.recommendation.action === "skip", "fade blocks a crowded chase");
  console.log("selftest ok", snap.lastPassMs.toFixed(3) + "ms");
}

if (process.argv.includes("--selftest")) {
  try {
    selftest();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
