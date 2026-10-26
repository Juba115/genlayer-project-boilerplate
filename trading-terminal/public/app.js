const app = document.querySelector("#app");
const agentsEl = document.querySelector("#agents");
const chipsEl = document.querySelector("#chips");
const miniEl = document.querySelector("#mini");
const tradeEl = document.querySelector("#trade");
const tailEl = document.querySelector("#tail");
const logEl = document.querySelector("#log");
const sparkEl = document.querySelector("#spark");
const dockEl = document.querySelector("#dock");

const AGENT_IDS = ["chief", "scanner", "rug", "sizer", "executor", "logger", "equity", "you"];

function money(n) {
  const value = Number.isFinite(n) ? n : 0;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function price(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return Number(n).toPrecision(4);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function bind(name, text) {
  const node = document.querySelector(`[data-bind="${name}"]`);
  if (node) node.textContent = text;
}

function paintAgents(state) {
  agentsEl.replaceChildren();
  for (const id of AGENT_IDS) {
    const agent = state.agents[id];
    if (!agent) continue;
    const card = el("article", `agent${state.active === id ? " active" : ""}${id === "chief" ? " chief" : ""}`);
    const head = el("header");
    head.append(el("b", "", agent.name), el("span", `badge tone-${agent.tone}`, agent.status));
    card.append(head, el("p", "role", agent.role), el("p", `line tone-${agent.tone}`, agent.line), el("p", "detail", agent.detail));
    agentsEl.append(card);
  }
}

function paintChips(state) {
  chipsEl.replaceChildren();
  const board = state.board?.length ? state.board : [];
  if (!board.length) {
    chipsEl.append(el("div", "chip", "scanner is waiting on dexscreener"));
    return;
  }
  for (const token of board) {
    const chip = el("div", "chip");
    const link = el("a");
    link.href = token.url || "#";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.append(el("b", "", `$${token.symbol}`));
    chip.append(link, el("span", "", token.flag), el("span", "", `${token.chain} · ${token.meta}`));
    chipsEl.append(chip);
  }
}

function paintSpark(state) {
  const values = state.sparks?.length ? state.sparks : [state.startBalance, state.balance];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * 280;
    const y = 62 - ((value - min) / span) * 50;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  sparkEl.innerHTML = `<path d="M ${points.join(" L ")}" fill="none" stroke="#3de7ff" stroke-width="2" />`;
  const last = points[points.length - 1].split(",");
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", last[0]);
  dot.setAttribute("cy", last[1]);
  dot.setAttribute("r", "3.5");
  dot.setAttribute("fill", "#3dffb0");
  sparkEl.append(dot);
}

function paintMini(state) {
  const sizer = state.position
    ? `${Math.round(state.position.sizePct * 100)}% eq`
    : state.pending
      ? `${Math.round(state.pending.sizePct * 100)}% eq`
      : "—";
  const sizerUsd = state.position
    ? money(state.position.sizeUsd)
    : state.pending
      ? money(state.pending.sizeUsd)
      : "idle";
  const items = [
    ["FILTERED", String(state.filtered), `+ ${state.skipped} skipped`, "tone-pink"],
    ["SIZER", sizer, sizerUsd, "tone-purple"],
    ["LOGGER", `line #${state.lineNo}`, "each with a reason", "tone-orange"],
    ["EQUITY", state.lastClose ? money(state.lastClose.pnl) : "—", state.lastClose ? state.lastClose.reason : "no close yet", "tone-blue"],
  ];
  miniEl.replaceChildren();
  for (const [k, v, s, tone] of items) {
    const card = el("article");
    card.append(el("span", "", k), el("b", tone, v), el("span", "", s));
    miniEl.append(card);
  }
}

function paintTrade(state) {
  tradeEl.replaceChildren(el("header"));
  tradeEl.querySelector("header").append(el("span", "", "TRADE · ENTRY vs EXIT"), el("span", "", state.position ? "OPEN" : "FLAT"));
  if (!state.position) {
    tradeEl.append(el("p", "flat-copy", "No open trade. The scanner can flag, and nothing reaches the book until rug check, size, and slippage all pass."));
    return;
  }
  const pos = state.position;
  const head = el("div");
  const title = el("p", "sym");
  title.append(el("span", "", `$${pos.symbol}`), el("span", "side", "LONG"));
  const live = el("span", `live${pos.livePct < 0 ? " down" : ""}`, `${pos.livePct >= 0 ? "+" : ""}${pos.livePct.toFixed(1)}% live`);
  head.append(title, live);
  const table = document.createElement("table");
  table.className = "rows";
  for (const [label, value] of [
    ["entry", price(pos.fillPrice)],
    ["mark", price(pos.markPrice)],
    ["slip", `${(pos.slip * 100).toFixed(2)}%`],
    ["size", `${Math.round(pos.sizePct * 100)}% of equity`],
  ]) {
    const row = document.createElement("tr");
    row.append(el("th", "", label), el("td", "", value));
    table.append(row);
  }
  const reason = el("p", "reason");
  reason.append(el("span", "", "reason: "), document.createTextNode(pos.reason));
  const from = el("p", "reason");
  from.append(el("span", "", "from: "), document.createTextNode(pos.from));
  tradeEl.append(head, table, reason, from);
  if (pos.url) {
    const link = el("a", "link", "open the pair");
    link.href = pos.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    tradeEl.append(link);
  }
}

function logRow(entry, wide) {
  const row = el(wide ? "div" : "li", wide ? "log-row" : "");
  row.append(
    el("span", "", entry.time),
    el("span", `tag ${entry.tone === "cyan" ? "cyan" : entry.tone === "green" ? "green" : entry.tone === "orange" ? "orange" : entry.tone === "purple" ? "purple" : "pink"}`, entry.action),
  );
  if (wide) row.append(el("b", "", `$${entry.symbol}`));
  const reason = el("span", "", wide ? entry.reason : `$${entry.symbol}  ${entry.reason}`);
  row.append(reason);
  if (wide) {
    const result = el("span", `result-cell ${String(entry.result).startsWith("+") ? "pnl-pos" : String(entry.result).startsWith("-") ? "pnl-neg" : ""}`, entry.result);
    row.append(result);
  }
  return row;
}

function paintLogs(state) {
  tailEl.replaceChildren();
  logEl.replaceChildren();
  for (const entry of (state.log || []).slice(0, 6)) tailEl.append(logRow(entry, false));
  for (const entry of (state.log || []).slice(0, 12)) logEl.append(logRow(entry, true));
}

function paint(state) {
  app.dataset.running = String(state.running);
  app.dataset.mode = state.mode;
  bind("runline", `${state.running ? "running" : "paused"} · ${state.clock} cairo`);
  bind("headline", state.headline);
  bind("balance", money(state.balance));
  bind("trades", String(state.trades));
  bind("wins", String(state.wins));
  bind("losses", String(state.losses));
  bind("from", state.route.from);
  bind("via", state.route.via);
  bind("to", state.route.to);
  bind("checked", `checked ${state.checked}`);
  bind("rug-node", state.agents.rug.detail);
  bind("exec-node", state.agents.executor.detail);
  bind("lines", `${state.lineNo} lines`);
  bind("start", money(state.startBalance));
  bind("now", money(state.balance));
  bind("wl", `${state.wins} W / ${state.losses} L`);
  const delta = state.balance - state.startBalance;
  bind("record", `${delta >= 0 ? "+" : ""}${money(delta)} since the open`);
  const mode = document.querySelector(".mode");
  mode.textContent = state.mode === "live" ? "paper off · live" : "paper · on";
  const ratio = state.startBalance > 0 ? state.balance / state.startBalance : 1;
  const clamped = Math.max(0.04, Math.min(0.96, ratio / 2));
  document.querySelector("#bar-dot").style.left = `${clamped * 100}%`;
  dockEl.hidden = !state.pending;
  if (state.pending) {
    bind("hold-title", `Chief is holding $${state.pending.symbol}`);
    bind(
      "hold-copy",
      `${state.pending.from} → approval gate · ${Math.round(state.pending.sizePct * 100)}% · slip ${(state.pending.slip * 100).toFixed(2)}% · ${state.pending.reason}`,
    );
  }
  paintAgents(state);
  paintChips(state);
  paintSpark(state);
  paintMini(state);
  paintTrade(state);
  paintLogs(state);
}

async function control(action) {
  await fetch("/api/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  control(button.dataset.action);
});

const source = new EventSource("/api/events");
source.onmessage = (event) => {
  paint(JSON.parse(event.data));
};
source.onerror = () => {
  bind("headline", "DESK · RECONNECTING");
};
