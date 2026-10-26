const grid = document.querySelector("#grid");
const tape = document.querySelector("#tape");
const logEl = document.querySelector("#log");
const leadsEl = document.querySelector("#leads");
const track = document.querySelector("#track");
const spark = document.querySelector("#spark");
const goals = [1.25, 1.5, 2, 3, 4, 5];
const colors = ["#f59e0b", "#3b82f6", "#14b8a6", "#8b5cf6", "#ec4899", "#fb7185", "#22c55e", "#0ea5e9"];

function money(n) {
  const value = Number.isFinite(n) ? n : 0;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function text(id, value) {
  document.getElementById(id).textContent = value;
}

function line(values, stroke) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * 220;
    const y = 58 - ((value - min) / span) * 48;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function paint(state) {
  const up = state.pnl >= 0;
  text("clock", new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()));
  text("multiple", `${state.multiple.toFixed(2)}×`);
  text("balance", money(state.balance));
  const pnl = document.getElementById("pnl");
  pnl.textContent = `${up ? "+" : ""}${money(state.pnl)} (${((state.multiple - 1) * 100).toFixed(1)}%)`;
  pnl.className = up ? "up" : "down";
  text("mult-badge", `${state.multiple.toFixed(2)}×`);
  const winRate = state.trades ? Math.round((state.wins / state.trades) * 100) : 0;
  text("trade-count", `${state.trades} trades · ${winRate}% win`);
  text("wl", `${state.wins} wins · ${state.losses} losses`);
  text("goal-label", `${state.goal}×`);
  text("goal-note", state.goalHit ? `done · ${state.multiple.toFixed(2)}× now` : "tap to raise");
  const reco = state.recommendation;
  const recoEl = document.getElementById("reco");
  recoEl.replaceChildren();
  if (reco) {
    recoEl.append(
      el("strong", "", `${reco.agent} · ${reco.action} ${reco.symbol === "—" ? "" : "$" + reco.symbol}`.trim()),
      el("small", "", `${reco.ms.toFixed(2)} ms · ${reco.reason}`),
    );
  }
  spark.innerHTML = "";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", up ? "#16a34a" : "#e11d48");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("points", line(state.curve.length > 1 ? state.curve : [state.start, state.balance]));
  spark.append(path);

  tape.replaceChildren();
  for (const token of state.board) {
    tape.append(el("span", `chip ${token.chg >= 0 ? "up" : "down"}`, `${token.symbol} ${token.chg >= 0 ? "+" : ""}${token.chg.toFixed(1)}%`));
  }

  grid.replaceChildren();
  for (const agent of state.agents) {
    const card = el("article", "agent");
    const top = el("div", "top");
    top.append(el("span", `dot ${agent.tone}`, agent.name.slice(0, 1)), el("span", "job", agent.status));
    const hold = agent.position
      ? `$${agent.position.symbol} ${agent.position.pnlPct >= 0 ? "+" : ""}${agent.position.pnlPct.toFixed(1)}%`
      : agent.id === "guard"
        ? `${state.openCount} open · armed`
        : agent.id === "fade"
          ? "vetoes a crowded chase"
          : "scanning";
    card.append(top, el("b", "", agent.name), el("div", "job", agent.job), el("div", "hold", hold), el("div", "stat", `${agent.w}W · ${agent.l}L  ${agent.pnl >= 0 ? "+" : ""}${money(agent.pnl)}`));
    grid.append(card);
  }

  logEl.replaceChildren();
  for (const row of state.log.slice(0, 8)) {
    const item = el("li");
    const mark = el("i");
    mark.style.background = colors[row.agent.length % colors.length];
    item.append(mark, el("span", "", `${row.agent} ${row.action} ${row.symbol} · ${row.reason}`), el("b", row.pnl < 0 ? "down" : "up", row.result || ""));
    logEl.append(item);
  }

  leadsEl.replaceChildren();
  state.leads.forEach((lead, index) => {
    const cell = el("div", `lead${lead.fired ? " fired" : ""}${lead.id === state.lead.id ? " now" : ""}`);
    const avatar = el("div", "avatar", lead.id);
    avatar.style.background = colors[index % colors.length];
    cell.append(avatar, el("div", "", lead.fired ? "fired" : lead.id === state.lead.id ? "now" : lead.rank));
    leadsEl.append(cell);
  });
  text("lead-label", `${state.lead.id} ${state.lead.rank}`);

  track.replaceChildren();
  for (const goal of goals) {
    const button = el("button", goal === state.goal ? "on" : "", `${goal}×`);
    button.type = "button";
    button.dataset.goal = String(goal);
    track.append(button);
  }
}

async function control(body) {
  await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
document.getElementById("flatten").addEventListener("click", () => control({ action: "flatten" }));
track.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  control({ action: "goal", goal: Number(button.dataset.goal) });
});
const source = new EventSource("/api/events");
source.onmessage = (event) => paint(JSON.parse(event.data));
