/**
 * Six narrow agents plus a chief of staff that only routes.
 * Scanner never trades. Rug check gates execution. Sizer uses equity percent.
 * Executor tracks slippage. Logger writes a reason. Equity updates on close.
 * Live mode stops at an approval gate. Nothing is sent to an exchange.
 */

export const START_BALANCE = 44.82;
export const SLIP_CAP = 0.02;
export const RISK = 0.07;

const AGENT_ORDER = ["scanner", "rug", "sizer", "executor", "logger", "equity"];

export function createState() {
  return {
    running: true,
    mode: "paper",
    startBalance: START_BALANCE,
    cash: START_BALANCE,
    position: null,
    pending: null,
    wins: 0,
    losses: 0,
    filtered: 0,
    skipped: 0,
    checked: 0,
    lineNo: 0,
    log: [],
    equityCurve: [{ t: Date.now(), v: START_BALANCE }],
    sparks: [START_BALANCE],
    judged: {},
    board: [],
    boardAt: 0,
    openedAt: Date.now(),
    agents: defaultAgents(),
    route: {
      from: "dexscreener · new pairs + volume",
      via: AGENT_ORDER.join(" → "),
      to: "paper book",
      stage: "idle",
    },
    headline: "DESK · WAITING FOR THE FEED",
    active: "chief",
    lastClose: null,
  };
}

function defaultAgents() {
  return {
    chief: {
      name: "CHIEF",
      role: "routes only, never trades",
      status: "ROUTE",
      tone: "cyan",
      line: "from the feed, to the book",
      detail: "specialists stay on their own job",
    },
    scanner: {
      name: "SCANNER",
      role: "new pairs + volume spikes",
      status: "SCAN",
      tone: "yellow",
      line: "flags only, never trades",
      detail: "waiting on the feed",
    },
    rug: {
      name: "RUG CHECK",
      role: "filters suspicious tokens",
      status: "IDLE",
      tone: "pink",
      line: "nothing executes before a pass",
      detail: "no candidate yet",
    },
    sizer: {
      name: "SIZER",
      role: "sizes from account equity",
      status: "IDLE",
      tone: "purple",
      line: "never trades a fixed ticket",
      detail: "—",
    },
    executor: {
      name: "EXECUTOR",
      role: "opens + closes, tracks slip",
      status: "IDLE",
      tone: "cyan",
      line: `slippage cap ${(SLIP_CAP * 100).toFixed(1)}%`,
      detail: "flat",
    },
    logger: {
      name: "LOGGER",
      role: "writes every decision",
      status: "IDLE",
      tone: "orange",
      line: "no trade without a reason",
      detail: "line #0",
    },
    equity: {
      name: "EQUITY",
      role: "balance + curve",
      status: "IDLE",
      tone: "blue",
      line: "updates on every close",
      detail: `${money(START_BALANCE)} · 0 closes`,
    },
    you: {
      name: "YOU",
      role: "reads the log, approves live",
      status: "READING",
      tone: "white",
      line: "stopped asking, started reading",
      detail: "0 lines to read",
    },
  };
}

export function money(n) {
  const value = Number.isFinite(n) ? n : 0;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPrice(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(4);
}

export function cairoTime(ts = Date.now()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ts));
}

export function cairoClock(ts = Date.now()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ts));
}

function equityOf(state) {
  if (!state.position) return state.cash;
  return state.cash + state.position.qty * state.position.markPrice;
}

export function estimateSlip(sizeUsd, liquidityUsd) {
  if (!Number.isFinite(liquidityUsd) || liquidityUsd <= 0) return 1;
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) return 0;
  const impact = Math.sqrt(sizeUsd / liquidityUsd) * 0.35;
  return Math.min(0.25, impact + 0.0012);
}

export function sizePctFor(token) {
  let pct = 0.24;
  if (token.liq >= 20_000 && token.buyShare >= 0.62) pct = 0.33;
  if (token.liq >= 35_000 && token.volX >= 3 && token.buyShare >= 0.66) pct = 0.37;
  return pct;
}

export function passReason(token) {
  const buys = `${Math.round(token.buyShare * 100)}%`;
  if (token.ageMin < 45) {
    const mins = Math.max(1, Math.round(token.ageMin));
    return `new pair ${mins}m old · buys ${buys} of flow`;
  }
  if (token.volX >= 2) {
    return `vol ${token.volX.toFixed(1)}× · buys ${buys} of flow`;
  }
  return `breakout over 1h · LP ${money(token.liq)} · h1 ${token.chgH1.toFixed(1)}%`;
}

export function rugCheck(token) {
  if (!token || !token.price || token.price <= 0) {
    return { pass: false, reason: "no price · feed incomplete" };
  }
  if (token.liq < 2_500) {
    return { pass: false, reason: `LP ${money(token.liq)} thin · not locked` };
  }
  if (token.fdv > 0 && token.liq > 0 && token.fdv / token.liq > 80) {
    return {
      pass: false,
      reason: `fdv/lp ${(token.fdv / token.liq).toFixed(0)}× · extended`,
    };
  }
  if (token.buyShare < 0.38 && token.chgM5 < 0) {
    return {
      pass: false,
      reason: `sell pressure · buys ${Math.round(token.buyShare * 100)}% of flow`,
    };
  }
  if (token.chgM5 <= -12) {
    return { pass: false, reason: `spike faded · m5 ${token.chgM5.toFixed(1)}%` };
  }
  if (token.ageMin < 1 && token.liq < 15_000) {
    return { pass: false, reason: `pair ${token.ageMin.toFixed(1)}m old · lp not seated` };
  }
  if (token.buyShare > 0.92 && token.chgM5 > 40) {
    return {
      pass: false,
      reason: `one-sided flow · buys ${Math.round(token.buyShare * 100)}% · sell side thin`,
    };
  }
  return { pass: true, reason: passReason(token) };
}

export function checkExit(position, mark) {
  const peak = Math.max(position.peakPrice, mark);
  const pnlPct = (mark - position.fillPrice) / position.fillPrice;
  const trailArmed = position.trailArmed || pnlPct >= 0.08;
  if (mark <= position.fillPrice * (1 - RISK)) {
    return { exit: true, reason: "stop 7% hit", peak, trailArmed };
  }
  if (mark >= position.fillPrice * (1 + RISK * 3)) {
    return { exit: true, reason: "take-profit 3R", peak, trailArmed };
  }
  if (trailArmed && mark <= peak * 0.95) {
    return { exit: true, reason: "trailing stop hit", peak, trailArmed };
  }
  return { exit: false, peak, trailArmed };
}

function touch(state, id, patch, quiet = false) {
  state.agents[id] = { ...state.agents[id], ...patch };
  if (!quiet) state.active = id;
}

function pushLog(state, entry) {
  state.lineNo += 1;
  const row = {
    id: state.lineNo,
    ts: Date.now(),
    time: cairoClock(),
    ...entry,
  };
  state.log.unshift(row);
  if (state.log.length > 200) state.log.length = 200;
  touch(state, "logger", {
    status: "WRITE",
    line: "no trade without a reason",
    detail: `line #${state.lineNo} · ${entry.action.toLowerCase()} $${entry.symbol}`,
  });
  touch(
    state,
    "you",
    {
      status: "READING",
      detail: `${state.lineNo} lines to read`,
    },
    true,
  );
  return row;
}

function setRoute(state, { from, to, stage }) {
  state.route = {
    from,
    via: "chief → " + AGENT_ORDER.join(" → "),
    to,
    stage,
  };
}

function destination(state) {
  return state.mode === "live" ? "approval gate" : "paper book";
}

function originOf(token) {
  return `dexscreener · ${token.chain} · $${token.symbol}`;
}

export function judgeToken(state, token) {
  state.checked += 1;
  state.judged[token.address] = Date.now();
  const from = originOf(token);
  const flag =
    token.ageMin < 45
      ? `new ${Math.max(1, Math.round(token.ageMin))}m`
      : `vol ${token.volX.toFixed(1)}×`;
  touch(state, "scanner", {
    status: "SCAN",
    line: "flags only, never trades",
    detail: `next $${token.symbol} · ${flag}`,
  });
  touch(state, "chief", {
    status: "ROUTE",
    line: "routes only, never trades",
    detail: `${from} → rug check`,
  });
  setRoute(state, { from, to: "rug check", stage: "check" });

  const rug = rugCheck(token);
  if (!rug.pass) {
    state.filtered += 1;
    touch(state, "rug", {
      status: "FILTER",
      line: "nothing executes before a pass",
      detail: `held $${token.symbol}`,
    });
    touch(state, "sizer", {
      status: "IDLE",
      detail: "not called · check failed",
    });
    touch(state, "executor", {
      status: "IDLE",
      detail: "flat · nothing reached execution",
    });
    setRoute(state, { from, to: "log only", stage: "filtered" });
    pushLog(state, {
      action: "FILTERED",
      symbol: token.symbol,
      reason: rug.reason,
      result: "not traded",
      tone: "pink",
      chain: token.chain,
    });
    state.headline = `RUG CHECK · HELD $${token.symbol}`;
    state.active = "rug";
    return;
  }

  touch(state, "rug", {
    status: "PASS",
    line: "nothing executes before a pass",
    detail: `passed $${token.symbol}`,
  });

  const equity = equityOf(state);
  let pct = sizePctFor(token);
  let sizeUsd = equity * pct;
  if (sizeUsd > state.cash * 0.92) {
    sizeUsd = state.cash * 0.92;
    pct = equity > 0 ? sizeUsd / equity : 0;
  }
  touch(state, "sizer", {
    status: "SIZE",
    line: "never trades a fixed ticket",
    detail: `${Math.round(pct * 100)}% of ${money(equity)} · ${money(sizeUsd)}`,
  });
  setRoute(state, { from, to: "sizer", stage: "size" });

  if (sizeUsd < 1 || pct <= 0) {
    state.skipped += 1;
    setRoute(state, { from, to: "log only", stage: "skip" });
    pushLog(state, {
      action: "SKIP",
      symbol: token.symbol,
      reason: "cash below a tradable size",
      result: "no order",
      tone: "purple",
      chain: token.chain,
    });
    state.headline = `SIZER · SKIPPED $${token.symbol}`;
    return;
  }

  const slip = estimateSlip(sizeUsd, token.liq);
  if (slip > SLIP_CAP) {
    state.skipped += 1;
    touch(state, "executor", {
      status: "SKIP",
      line: `slippage cap ${(SLIP_CAP * 100).toFixed(1)}%`,
      detail: `est. slip ${(slip * 100).toFixed(1)}%`,
    });
    setRoute(state, { from, to: "log only", stage: "skip" });
    pushLog(state, {
      action: "SKIP",
      symbol: token.symbol,
      reason: `est. slip ${(slip * 100).toFixed(1)}% > ${(SLIP_CAP * 100).toFixed(1)}% cap`,
      result: "no order",
      tone: "purple",
      chain: token.chain,
    });
    state.headline = `EXECUTOR · SKIPPED $${token.symbol}`;
    return;
  }

  if (state.mode === "live") {
    state.pending = {
      token,
      pct,
      sizeUsd,
      slip,
      reason: rug.reason,
      from,
    };
    touch(state, "executor", {
      status: "HOLD",
      line: "waiting for your yes",
      detail: `$${token.symbol} · slip ${(slip * 100).toFixed(2)}%`,
    });
    touch(state, "chief", {
      status: "HOLD",
      line: "nothing leaves until you approve",
      detail: `${from} → approval gate`,
    });
    setRoute(state, { from, to: "approval gate", stage: "hold" });
    pushLog(state, {
      action: "HOLD",
      symbol: token.symbol,
      reason: `${rug.reason} · waiting for approval`,
      result: "no order yet",
      tone: "orange",
      chain: token.chain,
    });
    state.headline = `CHIEF · HOLDING $${token.symbol}`;
    state.active = "chief";
    return;
  }

  openPosition(state, { token, pct, sizeUsd, slip, reason: rug.reason, from });
}

export function openPosition(state, order) {
  const { token, pct, sizeUsd, slip, reason, from } = order;
  const fillPrice = token.price * (1 + slip);
  const qty = sizeUsd / fillPrice;
  state.cash -= sizeUsd;
  state.position = {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    chain: token.chain,
    dex: token.dex,
    pair: token.pair,
    url: token.url,
    quote: token.quote,
    signalPrice: token.price,
    fillPrice,
    markPrice: fillPrice,
    peakPrice: fillPrice,
    qty,
    sizeUsd,
    sizePct: pct,
    slip,
    liq: token.liq,
    reason,
    from,
    openedAt: Date.now(),
    trailArmed: false,
  };
  state.pending = null;
  state.sparks.push(equityOf(state));
  if (state.sparks.length > 40) state.sparks.shift();
  touch(state, "executor", {
    status: "LIVE",
    line: `slippage cap ${(SLIP_CAP * 100).toFixed(1)}%`,
    detail: `LONG $${token.symbol} · slip ${(slip * 100).toFixed(2)}%`,
  });
  touch(state, "equity", {
    status: "IDLE",
    detail: `${money(equityOf(state))} · open`,
  });
  touch(state, "chief", {
    status: "ROUTE",
    line: "routes only, never trades",
    detail: `${from} → paper book`,
  });
  setRoute(state, { from, to: "paper book", stage: "open" });
  pushLog(state, {
    action: "ENTER",
    symbol: token.symbol,
    reason,
    result: `size ${Math.round(pct * 100)}%`,
    tone: "cyan",
    chain: token.chain,
  });
  state.headline = `EXECUTOR · ENTERED $${token.symbol}`;
  state.active = "executor";
}

export function closePosition(state, mark, reason) {
  const position = state.position;
  if (!position) return;
  const exitSlip = estimateSlip(position.qty * mark, position.liq);
  const fill = mark * (1 - Math.min(exitSlip, 0.05));
  const proceeds = position.qty * fill;
  const pnl = proceeds - position.sizeUsd;
  state.cash += proceeds;
  state.position = null;
  if (pnl >= 0) state.wins += 1;
  else state.losses += 1;
  const balance = state.cash;
  state.equityCurve.push({ t: Date.now(), v: balance });
  if (state.equityCurve.length > 80) state.equityCurve.shift();
  state.sparks.push(balance);
  if (state.sparks.length > 40) state.sparks.shift();
  state.lastClose = { symbol: position.symbol, pnl, reason };
  touch(state, "executor", {
    status: "LIVE",
    detail: `closed $${position.symbol} · slip ${(exitSlip * 100).toFixed(2)}%`,
  });
  touch(state, "equity", {
    status: "UPDATE",
    line: "updates on every close",
    detail: `${money(balance)} · ${state.wins + state.losses} closes`,
  });
  setRoute(state, {
    from: position.from,
    to: "equity curve",
    stage: "close",
  });
  pushLog(state, {
    action: "EXIT",
    symbol: position.symbol,
    reason: `${reason} · slip ${(exitSlip * 100).toFixed(2)}%`,
    result: `${pnl >= 0 ? "+" : ""}${money(pnl)}`,
    tone: pnl >= 0 ? "green" : "pink",
    chain: position.chain,
  });
  state.headline = `EQUITY · CLOSED $${position.symbol}`;
  state.active = "equity";
}

function markPosition(state, mark) {
  const exit = checkExit(state.position, mark);
  state.position.markPrice = mark;
  state.position.peakPrice = exit.peak;
  state.position.trailArmed = exit.trailArmed;
  state.sparks.push(equityOf(state));
  if (state.sparks.length > 40) state.sparks.shift();
  const live = ((mark - state.position.fillPrice) / state.position.fillPrice) * 100;
  touch(state, "executor", {
    status: "LIVE",
    detail: `LONG $${state.position.symbol} · slip ${(state.position.slip * 100).toFixed(2)}%`,
  });
  touch(state, "equity", {
    status: "IDLE",
    detail: `${live >= 0 ? "+" : ""}${live.toFixed(1)}% live`,
  });
  state.headline = `EXECUTOR · IN $${state.position.symbol}`;
  return exit;
}

function nextToken(state) {
  const now = Date.now();
  for (const token of state.board) {
    const seen = state.judged[token.address];
    if (seen && now - seen < 20 * 60 * 1000) continue;
    if (state.position && state.position.address === token.address) continue;
    if (state.pending && state.pending.token.address === token.address) continue;
    return token;
  }
  return null;
}

function noteScanner(state) {
  const nxt = state.board.find((token) => token.address !== state.position?.address);
  if (!nxt) {
    touch(state, "scanner", {
      status: "SCAN",
      detail: state.board.length ? "board is warm" : "waiting on dexscreener",
    });
    return;
  }
  const flag = nxt.ageMin < 45 ? `new ${Math.max(1, Math.round(nxt.ageMin))}m` : `vol ${nxt.volX.toFixed(1)}×`;
  touch(state, "scanner", {
    status: "SCAN",
    line: "flags only, never trades",
    detail: `next $${nxt.symbol} · ${flag}`,
  });
}

export async function runStep(state, market) {
  if (state.position) {
    const mark = await market.price(state.position);
    if (Number.isFinite(mark) && mark > 0) {
      const exit = markPosition(state, mark);
      if (exit.exit) {
        closePosition(state, mark, exit.reason);
        noteScanner(state);
        return snapshot(state);
      }
    }
  }

  if (typeof market.board === "function" && market.boardDue(state)) {
    const board = await market.board();
    if (Array.isArray(board) && board.length) {
      state.board = board;
      state.boardAt = Date.now();
    }
  }

  if (state.pending) {
    const token = state.pending.token;
    touch(state, "chief", {
      status: "HOLD",
      line: "nothing leaves until you approve",
      detail: `${originOf(token)} → approval gate`,
    });
    setRoute(state, {
      from: originOf(token),
      to: "approval gate",
      stage: "hold",
    });
    noteScanner(state);
    return snapshot(state);
  }

  if (!state.position) {
    const token = nextToken(state);
    if (token) judgeToken(state, token);
    else {
      noteScanner(state);
      touch(state, "chief", {
        status: "ROUTE",
        detail: "feed is quiet · still routing",
      });
      setRoute(state, {
        from: "dexscreener · new pairs + volume",
        to: destination(state),
        stage: "idle",
      });
    }
  } else {
    noteScanner(state);
    setRoute(state, {
      from: state.position.from,
      to: "paper book",
      stage: "open",
    });
  }

  return snapshot(state);
}

export function approvePending(state) {
  const pending = state.pending;
  if (!pending) return { ok: false, error: "nothing is waiting" };
  const slip = estimateSlip(pending.sizeUsd, pending.token.liq);
  if (slip > SLIP_CAP) {
    state.pending = null;
    state.skipped += 1;
    pushLog(state, {
      action: "SKIP",
      symbol: pending.token.symbol,
      reason: `approved, then slip ${(slip * 100).toFixed(1)}% exceeded the cap`,
      result: "no order",
      tone: "purple",
      chain: pending.token.chain,
    });
    return { ok: false, error: "slippage moved through the cap" };
  }
  openPosition(state, { ...pending, slip });
  return { ok: true };
}

export function rejectPending(state) {
  const pending = state.pending;
  if (!pending) return { ok: false, error: "nothing is waiting" };
  state.pending = null;
  state.skipped += 1;
  pushLog(state, {
    action: "SKIP",
    symbol: pending.token.symbol,
    reason: "you declined the order",
    result: "no order",
    tone: "purple",
    chain: pending.token.chain,
  });
  touch(state, "chief", {
    status: "ROUTE",
    line: "routes only, never trades",
    detail: "held order declined",
  });
  setRoute(state, {
    from: pending.from,
    to: "log only",
    stage: "skip",
  });
  state.headline = `YOU · DECLINED $${pending.token.symbol}`;
  return { ok: true };
}

export function snapshot(state) {
  const markValue = state.position ? state.position.qty * state.position.markPrice : 0;
  const balance = state.cash + markValue;
  const trades = state.wins + state.losses;
  const livePct = state.position
    ? ((state.position.markPrice - state.position.fillPrice) / state.position.fillPrice) * 100
    : 0;
  return {
    running: state.running,
    mode: state.mode,
    startBalance: state.startBalance,
    cash: state.cash,
    balance,
    wins: state.wins,
    losses: state.losses,
    trades,
    filtered: state.filtered,
    skipped: state.skipped,
    checked: state.checked,
    lineNo: state.lineNo,
    headline: state.headline,
    active: state.active,
    route: state.route,
    agents: state.agents,
    board: state.board.slice(0, 4).map(publicToken),
    position: state.position
      ? {
          symbol: state.position.symbol,
          name: state.position.name,
          chain: state.position.chain,
          dex: state.position.dex,
          url: state.position.url,
          fillPrice: state.position.fillPrice,
          markPrice: state.position.markPrice,
          sizeUsd: state.position.sizeUsd,
          sizePct: state.position.sizePct,
          slip: state.position.slip,
          reason: state.position.reason,
          from: state.position.from,
          livePct,
        }
      : null,
    pending: state.pending
      ? {
          symbol: state.pending.token.symbol,
          chain: state.pending.token.chain,
          sizePct: state.pending.pct,
          sizeUsd: state.pending.sizeUsd,
          slip: state.pending.slip,
          reason: state.pending.reason,
          from: state.pending.from,
          price: state.pending.token.price,
        }
      : null,
    log: state.log.slice(0, 40),
    equityCurve: state.equityCurve,
    sparks: state.sparks,
    lastClose: state.lastClose,
    clock: cairoTime(),
    exchangeRouted: false,
  };
}

function publicToken(token) {
  const flag =
    token.ageMin < 45
      ? `new ${Math.max(1, Math.round(token.ageMin))}m`
      : `vol ${token.volX.toFixed(1)}×`;
  return {
    symbol: token.symbol,
    name: token.name,
    chain: token.chain,
    dex: token.dex,
    url: token.url,
    flag,
    meta: token.liq >= 15_000 ? `LP ${money(token.liq)}` : `buys ${Math.round(token.buyShare * 100)}%`,
    price: token.price,
    chgM5: token.chgM5,
  };
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function selftest() {
  const good = {
    symbol: "TOF",
    name: "Tofu",
    address: "good",
    chain: "solana",
    dex: "raydium",
    pair: "pair",
    url: "https://dexscreener.com/solana/pair",
    quote: "SOL",
    price: 0.1426,
    liq: 48_000,
    fdv: 120_000,
    ageMin: 3,
    buyShare: 0.71,
    volX: 4.1,
    chgM5: 6,
    chgH1: 12,
  };
  const thin = { ...good, address: "thin", symbol: "CHIP", liq: 1200, fdv: 9000 };
  const wide = {
    ...good,
    address: "wide",
    symbol: "DOZY",
    liq: 3_000,
    fdv: 20_000,
    price: 0.05,
    volX: 1.2,
    buyShare: 0.6,
  };

  const paper = createState();
  paper.board = [thin, good];
  const market = {
    boardDue: () => false,
    board: async () => [],
    price: async () => null,
  };
  return runStep(paper, market).then((snap) => {
    assert(snap.log[0].action === "FILTERED", "thin liquidity should be filtered");
    assert(snap.cash === START_BALANCE, "a filter must not spend cash");
    assert(snap.agents.scanner.line.includes("never trades"), "scanner must not trade");

    return runStep(paper, market).then((entered) => {
      assert(entered.position, "a clean pair should open on paper");
      assert(entered.log[0].action === "ENTER", "enter should be logged");
      assert(entered.log[0].reason.includes("buys"), "enter needs a reason");
      const pct = entered.position.sizePct;
      const usd = entered.position.sizeUsd;
      assert(Math.abs(usd - START_BALANCE * pct) < 0.02, "size is a percent of equity");
      assert(usd !== 10, "size is not a fixed ticket");
      assert(entered.route.to === "paper book", "paper destination is the book");
      assert(entered.route.from.includes("dexscreener"), "origin is the dex feed");
      assert(entered.exchangeRouted === false, "no exchange route");

      const otherEquity = createState();
      otherEquity.cash = 180;
      otherEquity.startBalance = 180;
      otherEquity.board = [{ ...good, address: "other" }];
      return runStep(otherEquity, market).then((bigger) => {
        assert(bigger.position.sizeUsd > usd, "a larger account sizes a larger ticket");

        const live = createState();
        live.mode = "live";
        live.board = [{ ...good, address: "live" }];
        return runStep(live, market).then((held) => {
          assert(held.pending, "live mode holds for approval");
          assert(!held.position, "live mode must not fill before a yes");
          assert(held.route.to === "approval gate", "live destination is the gate");
          assert(held.cash === START_BALANCE, "a hold must not spend cash");
          const approved = approvePending(live);
          assert(approved.ok && live.position, "approve fills the paper book");

          const declined = createState();
          declined.mode = "live";
          declined.board = [{ ...good, address: "no" }];
          return runStep(declined, market).then(() => {
            assert(rejectPending(declined).ok, "reject should clear the hold");
            assert(!declined.position, "a declined order does not open");

            const slipState = createState();
            slipState.board = [wide];
            return runStep(slipState, market).then((skipped) => {
              assert(skipped.log[0].action === "SKIP", "shallow depth should skip on the slip cap");
              assert(skipped.cash === START_BALANCE, "a skip must not spend cash");
              const pos = {
                fillPrice: 1,
                peakPrice: 1,
                trailArmed: false,
              };
              assert(checkExit(pos, 1.22).reason === "take-profit 3R", "3R take profit");
              assert(checkExit(pos, 0.92).reason === "stop 7% hit", "7% stop");
              const armed = checkExit(pos, 1.1);
              assert(armed.trailArmed && !armed.exit, "trail arms without exiting");
              assert(checkExit({ ...pos, peakPrice: 1.1, trailArmed: true }, 1.04).reason === "trailing stop hit", "trail stop");
              console.log("selftest ok");
            });
          });
        });
      });
    });
  });
}

if (process.argv.includes("--selftest")) {
  selftest().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
