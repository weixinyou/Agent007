export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent007 World Dashboard</title>
  <style>
    :root {
      --bg-a: #f4efe6;
      --bg-b: #c7d9d2;
      --panel: rgba(255, 255, 255, 0.9);
      --panel-line: #1f3f3f22;
      --ink: #1f2f2f;
      --accent: #0b7d77;
      --accent-2: #b8612f;
      --ok: #1f7a37;
      --warn: #8d2f2f;
      --mono: "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: "Avenir Next", "Trebuchet MS", Verdana, sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: var(--sans);
      background:
        radial-gradient(circle at 10% 20%, #ffffffbb 0, transparent 30%),
        radial-gradient(circle at 85% 8%, #ffffffa1 0, transparent 34%),
        linear-gradient(135deg, var(--bg-a), var(--bg-b));
      min-height: 100vh;
    }

    .wrap {
      max-width: 1180px;
      margin: 0 auto;
      padding: 24px 16px 40px;
    }

    h1 {
      margin: 0;
      letter-spacing: 0.5px;
      font-size: clamp(1.6rem, 2.6vw, 2.4rem);
      color: #173333;
    }

    .subtitle {
      margin: 4px 0 20px;
      opacity: 0.8;
      font-size: 0.95rem;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 14px;
    }

    .title-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .live-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #ffffffd6;
      border: 1px solid #00000018;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 0.78rem;
      font-family: var(--mono);
    }

    .live-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #28a745;
      box-shadow: 0 0 0 3px #28a74533;
      animation: pulse 1.4s ease-in-out infinite;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--panel-line);
      border-radius: 14px;
      padding: 14px;
      backdrop-filter: blur(2px);
      box-shadow: 0 8px 20px #0f2f2f11;
      transform: translateY(6px);
      opacity: 0;
      animation: rise 380ms ease forwards;
    }

    .kpis { grid-column: span 12; display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
    .kpi { padding: 10px; border-radius: 10px; background: #ffffffcc; border: 1px solid #00000010; }
    .kpi .icon { font-size: 0.95rem; margin-right: 6px; }
    .kpi .label { font-size: 0.72rem; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.8px; }
    .kpi .value { margin-top: 4px; font-size: 1.16rem; font-weight: 700; }

    .agents { grid-column: span 7; }
    .events { grid-column: span 5; }
    .wallets { grid-column: span 8; }
    .governance { grid-column: span 4; }

    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .status {
      font-size: 0.8rem;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid #00000019;
      font-family: var(--mono);
      background: #fff;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }

    th, td {
      text-align: left;
      padding: 8px 6px;
      border-bottom: 1px solid #00000012;
      vertical-align: top;
    }

    th {
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      opacity: 0.75;
      position: sticky;
      top: 0;
      background: #f8fbfa;
      z-index: 1;
    }

    tbody tr:hover {
      background: #ffffffaa;
    }

    .energy {
      font-family: var(--mono);
      color: var(--accent-2);
      font-weight: 700;
    }

    ul.events-list {
      margin: 0;
      padding: 0;
      list-style: none;
      max-height: 410px;
      overflow: auto;
    }

    ul.events-list li {
      padding: 8px;
      border-radius: 8px;
      margin-bottom: 8px;
      background: #ffffffcf;
      border: 1px solid #00000010;
    }

    .event-time {
      font-size: 0.74rem;
      color: #234f4f;
      font-family: var(--mono);
    }

    .event-type {
      color: var(--accent);
      font-size: 0.77rem;
      text-transform: uppercase;
      letter-spacing: 0.7px;
      margin-left: 6px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      border: 1px solid #0000001b;
      background: #ffffffd7;
      padding: 3px 8px;
      font-size: 0.76rem;
      line-height: 1;
    }

    .event-icon {
      font-size: 0.9rem;
      margin-right: 4px;
    }

    .loc {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.82rem;
      border-radius: 999px;
      padding: 2px 8px;
      background: #e8f3ef;
      border: 1px solid #00000014;
    }

    .agent-id {
      font-size: 0.82rem;
    }

    .inv-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-width: 420px;
    }

    .inv-item {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      border: 1px solid #0000001f;
      background: #f5faf8;
      padding: 2px 8px;
      font-size: 0.74rem;
      line-height: 1.25;
      white-space: nowrap;
    }

    .leader-crown {
      font-size: 1rem;
      margin-right: 4px;
    }

    .mono { font-family: var(--mono); }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }

    .gov-active {
      margin-bottom: 10px;
      font-weight: 700;
      padding: 8px 10px;
      border-radius: 8px;
      background: #ffffffd1;
      border: 1px solid #00000012;
    }

    .votes {
      display: grid;
      gap: 8px;
    }

    .vote-row {
      display: grid;
      grid-template-columns: 86px 1fr 44px;
      gap: 8px;
      align-items: center;
      font-size: 0.85rem;
    }

    .bar {
      position: relative;
      height: 9px;
      border-radius: 999px;
      background: #dfe8e6;
      overflow: hidden;
    }

    .bar > span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #0b7d77, #5ac3a2);
      width: 0;
      transition: width 260ms ease;
    }

    @media (max-width: 980px) {
      .agents, .events, .wallets, .governance { grid-column: span 12; }
      .kpis { grid-template-columns: repeat(3, 1fr); }
    }

    @media (max-width: 620px) {
      .kpis { grid-template-columns: repeat(2, 1fr); }
    }

    @keyframes rise {
      to { transform: translateY(0); opacity: 1; }
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.1); opacity: 0.72; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title-row">
      <h1>Agent007 World Dashboard</h1>
      <div class="live-pill"><span class="live-dot"></span><span id="live-pill-text">syncing...</span></div>
    </div>
    <p class="subtitle">Live state monitor for economy, politics, combat, and agent activity.</p>

    <div class="grid">
      <section class="card kpis" style="animation-delay: 20ms;">
        <div class="kpi"><div class="label"><span class="icon">⏱</span>Tick</div><div class="value" id="kpi-tick">-</div></div>
        <div class="kpi"><div class="label"><span class="icon">🧠</span>Agents</div><div class="value" id="kpi-agents">-</div></div>
        <div class="kpi"><div class="label"><span class="icon">👛</span>Wallets</div><div class="value" id="kpi-wallets">-</div></div>
        <div class="kpi"><div class="label"><span class="icon">📜</span>Events</div><div class="value" id="kpi-events">-</div></div>
        <div class="kpi"><div class="label"><span class="icon">🪙</span>Total MON</div><div class="value" id="kpi-total-mon">-</div></div>
        <div class="kpi"><div class="label"><span class="icon">⚡</span>Avg Energy</div><div class="value" id="kpi-avg-energy">-</div></div>
      </section>

      <section class="card agents" style="animation-delay: 80ms;">
        <div class="head">
          <strong>Agents</strong>
          <span class="status" id="status">loading</span>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>Location</th><th>Energy</th><th>Reputation</th><th>MON</th><th>Inventory</th></tr>
          </thead>
          <tbody id="agents-body"></tbody>
        </table>
      </section>

      <section class="card events" style="animation-delay: 120ms;">
        <div class="head"><strong>Recent Events</strong></div>
        <ul class="events-list" id="events-list"></ul>
      </section>

      <section class="card wallets" style="animation-delay: 160ms;">
        <div class="head"><strong>Leaderboard (MON)</strong></div>
        <table>
          <thead>
            <tr><th>Rank</th><th>Agent</th><th>MON</th><th>Reputation</th><th>Energy</th></tr>
          </thead>
          <tbody id="leaderboard-body"></tbody>
        </table>
      </section>

      <section class="card governance" style="animation-delay: 200ms;">
        <div class="head"><strong>Governance</strong></div>
        <div class="gov-active" id="gov-active">Active policy: -</div>
        <div class="votes">
          <div class="vote-row"><span>neutral</span><div class="bar"><span id="bar-neutral"></span></div><span id="vote-neutral">0</span></div>
          <div class="vote-row"><span>cooperative</span><div class="bar"><span id="bar-cooperative"></span></div><span id="vote-cooperative">0</span></div>
          <div class="vote-row"><span>aggressive</span><div class="bar"><span id="bar-aggressive"></span></div><span id="vote-aggressive">0</span></div>
        </div>
      </section>
    </div>
  </div>

  <script>
    let lastPoll = 0;
    let eventSource = null;
    let fallbackTimer = null;
    const FALLBACK_POLL_MS = 3000;

    function formatNum(v, digits = 2) {
      if (typeof v !== "number" || Number.isNaN(v)) return "-";
      return Number(v.toFixed(digits)).toString();
    }

    function renderAgents(agents, wallets) {
      const body = document.getElementById("agents-body");
      const rows = Object.values(agents).map((agent) => {
        const inventoryEntries = Object.entries(agent.inventory);
        const inventoryHtml = inventoryEntries.length
          ? "<div class=\\"inv-wrap\\">" + inventoryEntries.map(([k, v]) => "<span class=\\"inv-item mono\\">" + k + ":" + v + "</span>").join("") + "</div>"
          : "-";
        const wallet = wallets[agent.walletAddress];
        const mon = wallet ? formatNum(wallet.monBalance, 4) : "-";
        return "<tr>" +
          "<td class=\\"mono agent-id\\" title=\\"" + agent.id + "\\">" + shortId(agent.id) + "</td>" +
          "<td><span class=\\"loc\\">" + iconForLocation(agent.location) + " " + agent.location + "</span></td>" +
          "<td class=\\"energy\\">" + agent.energy + "</td>" +
          "<td>" + agent.reputation + "</td>" +
          "<td class=\\"mono\\">" + mon + "</td>" +
          "<td>" + inventoryHtml + "</td>" +
          "</tr>";
      });
      body.innerHTML = rows.join("") || "<tr><td colspan=\\"6\\">No agents</td></tr>";
    }

    function renderLeaderboard(agents, wallets) {
      const body = document.getElementById("leaderboard-body");
      const rowsData = Object.values(agents).map((agent) => {
        const mon = wallets[agent.walletAddress]?.monBalance ?? 0;
        return {
          id: agent.id,
          mon,
          reputation: agent.reputation,
          energy: agent.energy
        };
      });

      rowsData.sort((a, b) => {
        if (b.mon !== a.mon) return b.mon - a.mon;
        if (b.reputation !== a.reputation) return b.reputation - a.reputation;
        return a.id.localeCompare(b.id);
      });

      const rows = rowsData.map((row, idx) =>
        "<tr>" +
          "<td class=\\"mono\\">" + (idx === 0 ? "<span class=\\"leader-crown\\">👑</span>" : "") + "#" + (idx + 1) + "</td>" +
          "<td class=\\"mono\\">" + row.id + "</td>" +
          "<td class=\\"mono\\">" + formatNum(row.mon, 4) + "</td>" +
          "<td>" + row.reputation + "</td>" +
          "<td class=\\"energy\\">" + row.energy + "</td>" +
        "</tr>"
      );

      body.innerHTML = rows.join("") || "<tr><td colspan=\\"5\\">No agents</td></tr>";
    }

    function renderEvents(events) {
      const list = document.getElementById("events-list");
      const rows = events.slice(-20).reverse().map((event) =>
        "<li>" +
          "<div><span class=\\"event-time\\">" + new Date(event.at).toLocaleTimeString() + "</span><span class=\\"pill\\"><span class=\\"event-icon\\">" + iconForEvent(event.type) + "</span><span class=\\"event-type\\">" + event.type + "</span></span></div>" +
          "<div><strong>" + event.agentId + "</strong> " + event.message + "</div>" +
        "</li>"
      );
      list.innerHTML = rows.join("") || "<li>No events yet</li>";
    }

    function iconForLocation(location) {
      if (location === "town") return "🏘";
      if (location === "forest") return "🌲";
      if (location === "cavern") return "🪨";
      return "📍";
    }

    function iconForEvent(type) {
      if (type === "entry") return "🚪";
      if (type === "move") return "🧭";
      if (type === "gather") return "⛏";
      if (type === "trade") return "🤝";
      if (type === "attack") return "⚔";
      if (type === "vote") return "🗳";
      if (type === "claim") return "🏦";
      if (type === "rest") return "🛌";
      if (type === "faucet") return "💧";
      if (type === "ai_reasoning") return "🤖";
      return "•";
    }

    function shortId(id) {
      if (typeof id !== "string") return "-";
      if (id.length <= 20) return id;
      return id.slice(0, 8) + "..." + id.slice(-6);
    }

    function updateGovernance(governance) {
      const active = governance?.activePolicy || "neutral";
      const votes = governance?.votes || { neutral: 0, cooperative: 0, aggressive: 0 };
      const total = Math.max(1, (votes.neutral || 0) + (votes.cooperative || 0) + (votes.aggressive || 0));

      document.getElementById("gov-active").textContent = "Active policy: " + active;
      document.getElementById("vote-neutral").textContent = String(votes.neutral || 0);
      document.getElementById("vote-cooperative").textContent = String(votes.cooperative || 0);
      document.getElementById("vote-aggressive").textContent = String(votes.aggressive || 0);

      document.getElementById("bar-neutral").style.width = String(Math.round(((votes.neutral || 0) / total) * 100)) + "%";
      document.getElementById("bar-cooperative").style.width = String(Math.round(((votes.cooperative || 0) / total) * 100)) + "%";
      document.getElementById("bar-aggressive").style.width = String(Math.round(((votes.aggressive || 0) / total) * 100)) + "%";
    }

    function updateKpis(state) {
      const agentValues = Object.values(state.agents);
      const wallets = Object.values(state.wallets);
      const totalMon = wallets.reduce((sum, w) => sum + (Number(w.monBalance) || 0), 0);
      const avgEnergy = agentValues.length ? agentValues.reduce((sum, a) => sum + a.energy, 0) / agentValues.length : 0;

      document.getElementById("kpi-tick").textContent = String(state.tick);
      document.getElementById("kpi-agents").textContent = String(Object.keys(state.agents).length);
      document.getElementById("kpi-wallets").textContent = String(Object.keys(state.wallets).length);
      document.getElementById("kpi-events").textContent = String(state.events.length);
      document.getElementById("kpi-total-mon").textContent = formatNum(totalMon, 4);
      document.getElementById("kpi-avg-energy").textContent = formatNum(avgEnergy, 2);
    }

    function normalizeStatePayload(payload) {
      const state = payload && typeof payload === "object" && payload.state && typeof payload.state === "object"
        ? payload.state
        : payload;
      const safeState = state && typeof state === "object" ? state : {};
      return {
        tick: Number(safeState.tick ?? 0),
        agents: safeState.agents && typeof safeState.agents === "object" ? safeState.agents : {},
        wallets: safeState.wallets && typeof safeState.wallets === "object" ? safeState.wallets : {},
        events: Array.isArray(safeState.events) ? safeState.events : [],
        governance: safeState.governance && typeof safeState.governance === "object" ? safeState.governance : {
          activePolicy: "neutral",
          votes: { neutral: 0, cooperative: 0, aggressive: 0 }
        }
      };
    }

    function renderState(statePayload) {
      const state = normalizeStatePayload(statePayload);
      updateKpis(state);
      renderAgents(state.agents, state.wallets);
      renderLeaderboard(state.agents, state.wallets);
      renderEvents(state.events);
      updateGovernance(state.governance);
      lastPoll = Date.now();
    }

    async function poll(reason = "poll") {
      const status = document.getElementById("status");
      const livePillText = document.getElementById("live-pill-text");
      try {
        const res = await fetch("/state", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const state = await res.json();
        renderState(state);
        status.textContent = reason === "sse" ? "live (stream)" : "live (poll)";
        status.className = "status ok";
        livePillText.textContent = reason === "sse" ? "Realtime stream" : "Polling mode";
      } catch (error) {
        status.textContent = "disconnected";
        status.className = "status warn";
        livePillText.textContent = "Disconnected";
      }
    }

    function ensureFallbackPolling() {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => {
        poll("poll");
      }, FALLBACK_POLL_MS);
    }

    function connectStream() {
      const status = document.getElementById("status");
      const livePillText = document.getElementById("live-pill-text");
      try {
        eventSource = new EventSource("/events");
      } catch {
        ensureFallbackPolling();
        poll("poll");
        return;
      }

      eventSource.addEventListener("state", (event) => {
        try {
          const state = JSON.parse(event.data);
          renderState(state);
          status.textContent = "live (stream)";
          status.className = "status ok";
          livePillText.textContent = "Realtime stream";
        } catch {
          // Ignore malformed events and keep connection alive.
        }
      });

      eventSource.onopen = () => {
        status.textContent = "live (stream)";
        status.className = "status ok";
        livePillText.textContent = "Realtime stream";
      };

      eventSource.onerror = () => {
        status.textContent = "reconnecting";
        status.className = "status warn";
        livePillText.textContent = "Reconnecting...";
        ensureFallbackPolling();
        poll("poll");
      };
    }

    connectStream();
    poll("poll");
  </script>
</body>
</html>`;
}
