export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent007 World Dashboard</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700;800&family=JetBrains+Mono:wght@400;600&display=swap");

    :root {
      --bg-a: #071218;
      --bg-b: #102736;
      --bg-c: #26474c;
      --panel: rgba(15, 33, 44, 0.76);
      --panel-line: #9ff6e230;
      --ink: #ecf8ff;
      --muted: #8eb7c9;
      --accent: #2de2bc;
      --accent-2: #ffd479;
      --accent-3: #68a5ff;
      --danger: #ff7f72;
      --ok: #35df9f;
      --warn: #ff9b54;
      --mono: "JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
      --sans: "Space Grotesk", "Avenir Next", "Trebuchet MS", Verdana, sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: var(--sans);
      background:
        radial-gradient(60% 60% at 14% 9%, #3af0cc35 0%, transparent 45%),
        radial-gradient(56% 64% at 88% 18%, #68a5ff30 0%, transparent 44%),
        radial-gradient(46% 58% at 50% 100%, #ffd4791e 0%, transparent 48%),
        linear-gradient(130deg, var(--bg-a), var(--bg-b) 45%, var(--bg-c));
      min-height: 100vh;
    }

    .wrap {
      max-width: 1220px;
      margin: 0 auto;
      padding: 28px 18px 44px;
    }

    h1 {
      margin: 0;
      letter-spacing: -0.6px;
      font-size: clamp(1.9rem, 3vw, 2.8rem);
      color: #f2ffff;
    }

    .subtitle {
      margin: 5px 0 22px;
      color: var(--muted);
      font-size: 0.96rem;
      max-width: 780px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
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
      background: #0e2a37cf;
      border: 1px solid #78f5db55;
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 0.75rem;
      color: #d6fff3;
      font-family: var(--mono);
      letter-spacing: 0.4px;
    }

    .live-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--ok);
      box-shadow: 0 0 0 4px #36e2a73d;
      animation: pulse 1.4s ease-in-out infinite;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--panel-line);
      border-radius: 16px;
      padding: 14px;
      backdrop-filter: blur(10px);
      box-shadow: 0 14px 35px #02101855;
      position: relative;
      transform: translateY(0);
      opacity: 1;
      animation: rise 420ms ease both;
      overflow: hidden;
    }
    .card::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(140deg, #2de2bc08, #68a5ff08 60%, transparent);
      pointer-events: none;
    }
    .card::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 3px;
      border-top-left-radius: 16px;
      border-top-right-radius: 16px;
      background: linear-gradient(90deg, var(--accent), var(--accent-3), var(--accent-2));
      opacity: 0.7;
    }

    .kpis { grid-column: span 12; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
    .kpi {
      padding: 12px;
      border-radius: 12px;
      background: #0e2634bf;
      border: 1px solid #7de6d026;
      box-shadow: inset 0 1px 0 #ffffff12;
    }
    .kpi .icon { font-size: 0.95rem; margin-right: 6px; }
    .kpi .label { font-size: 0.69rem; color: var(--muted); text-transform: uppercase; letter-spacing: 1.1px; }
    .kpi .value { margin-top: 6px; font-size: 1.22rem; font-weight: 800; color: #f6ffff; }

    .agents { grid-column: span 7; }
    .events { grid-column: span 5; }
    .wallets { grid-column: span 8; }
    .governance { grid-column: span 4; }

    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      position: relative;
      z-index: 1;
    }

    .head strong { color: #effdff; letter-spacing: 0.2px; }

    .status {
      font-size: 0.73rem;
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid #87f7df46;
      font-family: var(--mono);
      letter-spacing: 0.4px;
      background: #112c3999;
      color: #d8fff4;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
      position: relative;
      z-index: 1;
    }

    th, td {
      text-align: left;
      padding: 8px 6px;
      border-bottom: 1px solid #82bad721;
      vertical-align: top;
    }

    th {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.95px;
      color: var(--muted);
      position: sticky;
      top: 0;
      background: #102938f0;
      z-index: 1;
    }

    tbody tr:hover {
      background: #17394b70;
    }

    .energy {
      font-family: var(--mono);
      color: var(--accent-2);
      font-weight: 700;
    }

    .brain-badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 0.66rem;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      border: 1px solid #ffffff2a;
      white-space: nowrap;
    }
    .brain-ai { background: #14316e8f; color: #9ec5ff; }
    .brain-fallback { background: #5f431588; color: #ffd9a1; }
    .brain-rule { background: #1347388a; color: #9effe2; }

    ul.events-list {
      margin: 0;
      padding: 0;
      list-style: none;
      max-height: 430px;
      overflow: auto;
      position: relative;
      z-index: 1;
    }

    ul.events-list li {
      padding: 10px 10px 10px 12px;
      border-radius: 10px;
      margin-bottom: 9px;
      background: #0d2532d7;
      border: 1px solid #6ec9da28;
      border-left: 5px solid #87aab4;
      transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
    }

    ul.events-list li:hover {
      transform: translateX(2px);
      box-shadow: 0 6px 18px #02192599;
      background: #123346dc;
    }

    .event-entry { border-left-color: #6f86ff; }
    .event-move { border-left-color: #66cbff; }
    .event-gather { border-left-color: #4de3ae; }
    .event-trade { border-left-color: #82fff0; }
    .event-attack { border-left-color: #ff8e76; }
    .event-sell { border-left-color: #ffd479; }
    .event-vote { border-left-color: #c58bff; }
    .event-claim { border-left-color: #f6d16e; }
    .event-rest { border-left-color: #9de6f2; }
    .event-faucet { border-left-color: #6ec7ff; }
    .event-ai_reasoning { border-left-color: #86a3ff; }
    .event-ai_call { border-left-color: #a48bff; }
    .event-world_governor { border-left-color: #2de2bc; }

    .event-detail {
      margin-top: 4px;
      line-height: 1.35;
      color: #e8f8ff;
    }

    .reason-tag {
      display: inline-flex;
      align-items: center;
      margin-left: 6px;
      border-radius: 999px;
      padding: 1px 8px;
      font-size: 0.65rem;
      border: 1px solid #ffffff22;
      letter-spacing: 0.3px;
    }
    .reason-ai { background: #1c3d8f8c; color: #c3d8ff; }
    .reason-fallback { background: #6b4a1f8a; color: #ffe3b9; }

    .pulse-update {
      animation: updatePulse 650ms ease;
    }

    .event-time {
      font-size: 0.74rem;
      color: #8cc1d9;
      font-family: var(--mono);
    }

    .event-type {
      color: var(--accent);
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.75px;
      margin-left: 6px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      border: 1px solid #97efe13f;
      background: #133343aa;
      color: #d6fff5;
      padding: 3px 8px;
      font-size: 0.74rem;
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
      font-size: 0.8rem;
      border-radius: 999px;
      padding: 2px 8px;
      background: #16394b;
      border: 1px solid #95e6d033;
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
      border: 1px solid #9dd9f12f;
      background: #102b3a;
      color: #d9f6ff;
      padding: 2px 8px;
      font-size: 0.72rem;
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
      padding: 9px 11px;
      border-radius: 10px;
      background: #123143b5;
      border: 1px solid #8ee8dd39;
      position: relative;
      z-index: 1;
    }

    .votes {
      display: grid;
      gap: 8px;
      position: relative;
      z-index: 1;
    }

    .vote-row {
      display: grid;
      grid-template-columns: 90px 1fr 44px;
      gap: 8px;
      align-items: center;
      font-size: 0.84rem;
      color: #d9f4ff;
    }

    .bar {
      position: relative;
      height: 9px;
      border-radius: 999px;
      background: #183f52;
      overflow: hidden;
    }

    .bar > span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #2de2bc, #66d6ff);
      width: 0;
      transition: width 260ms ease;
    }

    @media (max-width: 1080px) {
      .agents, .events, .wallets, .governance { grid-column: span 12; }
    }

    @media (max-width: 760px) {
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @keyframes rise {
      from { transform: translateY(8px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.1); opacity: 0.72; }
    }

    @keyframes updatePulse {
      0% { box-shadow: 0 0 0 0 #7db6ff38; }
      100% { box-shadow: 0 0 0 14px #7db6ff00; }
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
        <div class="kpi"><div class="label"><span class="icon">🏦</span>Treasury MON</div><div class="value" id="kpi-total-mon">-</div></div>
        <div class="kpi"><div class="label"><span class="icon">⚡</span>Avg Energy</div><div class="value" id="kpi-avg-energy">-</div></div>
      </section>

      <section class="card agents" style="animation-delay: 80ms;">
        <div class="head">
          <strong>Agents</strong>
          <span class="status" id="status">loading</span>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>Brain</th><th>Location</th><th>Energy</th><th>Reputation</th><th>MON</th><th>Inventory</th></tr>
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

    function formatMon(v) {
      // MON values can be tiny in on-chain mode (0.0001 entry fee).
      return formatNum(v, 6);
    }

    function displayAgentId(id) {
      // UI alias only (API ids remain unchanged).
      if (typeof id !== "string") return String(id || "");
      const m = id.match(/_(1|2|3)$/);
      if (!m) return id;
      const n = Number(m[1]);
      if (n >= 1 && n <= 3) return "AI_agent_0" + String(n);
      return id;
    }

    function renderAgents(agents, wallets, events) {
      const body = document.getElementById("agents-body");
      const rows = Object.values(agents).map((agent) => {
        const inventoryEntries = Object.entries(agent.inventory);
        const inventoryHtml = inventoryEntries.length
          ? "<div class=\\"inv-wrap\\">" + inventoryEntries.map(([k, v]) => "<span class=\\"inv-item mono\\">" + k + ":" + v + "</span>").join("") + "</div>"
          : "-";
        const wallet = wallets[agent.walletAddress];
        const mon = wallet ? formatMon(wallet.monBalance) : "-";
        const brain = detectAgentBrain(agent.id, events);
        return "<tr>" +
          "<td class=\\"mono agent-id\\" title=\\"" + agent.id + "\\">" + shortId(displayAgentId(agent.id)) + "</td>" +
          "<td>" + brain.html + "</td>" +
          "<td><span class=\\"loc\\">" + iconForLocation(agent.location) + " " + agent.location + "</span></td>" +
          "<td class=\\"energy\\">" + agent.energy + "</td>" +
          "<td>" + agent.reputation + "</td>" +
          "<td class=\\"mono\\">" + mon + "</td>" +
          "<td>" + inventoryHtml + "</td>" +
          "</tr>";
      });
      body.innerHTML = rows.join("") || "<tr><td colspan=\\"7\\">No agents</td></tr>";
    }

    function renderLeaderboard(agents, wallets) {
      const body = document.getElementById("leaderboard-body");
      const rowsData = Object.values(agents).map((agent) => {
        const mon = wallets[agent.walletAddress]?.monBalance ?? 0;
        return {
          id: agent.id,
          idDisplay: displayAgentId(agent.id),
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
          "<td class=\\"mono\\">" + row.idDisplay + "</td>" +
          "<td class=\\"mono\\">" + formatMon(row.mon) + "</td>" +
          "<td>" + row.reputation + "</td>" +
          "<td class=\\"energy\\">" + row.energy + "</td>" +
        "</tr>"
      );

      body.innerHTML = rows.join("") || "<tr><td colspan=\\"5\\">No agents</td></tr>";
    }

    function renderEvents(events) {
      const list = document.getElementById("events-list");
      const visibleEvents = events.filter((event) => {
        const type = String(event.type || "").toLowerCase();
        const msg = String(event.message || "").toLowerCase();
        // Never show API call status rows in Recent Events.
        if (type === "ai_call") return false;
        if (msg.includes("api call succeeded") || msg.includes("api call failed")) return false;
        return true;
      });
      // Pin entry/admission events so they don't "flash then disappear"
      // during fast action loops.
      const PIN_ENTRY_MS = 60_000;
      window.__pinnedEntryEvents = window.__pinnedEntryEvents || new Map();
      const pinned = window.__pinnedEntryEvents;
      const nowMs = Date.now();

      const entryEvents = visibleEvents.filter((e) => String(e.type || "").toLowerCase() === "entry");
      for (const e of entryEvents.slice(-20)) {
        if (!e || !e.id) continue;
        if (!pinned.has(e.id)) {
          pinned.set(e.id, { event: e, firstSeenMs: nowMs });
        } else {
          // Refresh stored payload in case message formatting changes.
          const prev = pinned.get(e.id);
          pinned.set(e.id, { event: e, firstSeenMs: prev.firstSeenMs });
        }
      }
      // Expire pins after minimum visibility window.
      for (const [id, val] of pinned.entries()) {
        if (!val || !val.firstSeenMs) {
          pinned.delete(id);
          continue;
        }
        if (nowMs - val.firstSeenMs > PIN_ENTRY_MS) {
          pinned.delete(id);
        }
      }

      const pinnedEntries = Array.from(pinned.values()).map((v) => v.event);
      const nonEntryEvents = visibleEvents
        .filter((e) => String(e.type || "").toLowerCase() !== "entry")
        .slice(-32);

      const byId = new Map();
      for (const e of [...pinnedEntries, ...entryEvents.slice(-8), ...nonEntryEvents]) {
        byId.set(e.id, e);
      }
      const merged = Array.from(byId.values()).sort((a, b) => String(a.at).localeCompare(String(b.at)));

      const rows = merged.reverse().map((event) => {
        const aiModeTag = event.type === "ai_reasoning" ? "AI" : "";
        const reasonTag = event.type === "ai_reasoning"
          ? "<span class=\\"reason-tag reason-ai\\">" + aiModeTag + "</span>"
          : "";
        const pinnedTag = String(event.type || "").toLowerCase() === "entry"
          ? "<span class=\\"reason-tag\\" style=\\"background:#214d3f;color:#bdf7d4\\">ENTRY</span>"
          : "";
        return "<li class=\\"event-" + event.type + "\\">" +
          "<div><span class=\\"event-time\\">" + new Date(event.at).toLocaleTimeString() + "</span><span class=\\"pill\\"><span class=\\"event-icon\\">" + iconForEvent(event.type) + "</span><span class=\\"event-type\\">" + event.type + "</span></span>" + pinnedTag + reasonTag + "</div>" +
          "<div class=\\"event-detail\\"><strong>" + event.agentId + "</strong> " + event.message + "</div>" +
        "</li>"
      });
      list.innerHTML = rows.join("") || "<li>No events yet</li>";
    }

    function detectAgentBrain(agentId, events) {
      const recent = events.slice(-80).filter((event) => event.agentId === agentId && event.type === "ai_reasoning");
      // Per request: do not show Rule in the brain column.
      if (recent.length === 0) {
        return { label: "AI", html: "<span class=\\"brain-badge brain-fallback\\">AI</span>" };
      }
      return { label: "AI", html: "<span class=\\"brain-badge brain-fallback\\">AI</span>" };
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
      if (type === "sell") return "🛒";
      if (type === "aid") return "🫱";
      if (type === "vote") return "🗳";
      if (type === "claim") return "🏦";
      if (type === "rest") return "🛌";
      if (type === "faucet") return "💧";
      if (type === "ai_reasoning") return "🤖";
      if (type === "ai_call") return "🧠";
      if (type === "world_governor") return "🏛";
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
      const activeWallets = new Set(agentValues.map((agent) => agent.walletAddress));
      const wallets = Object.entries(state.wallets);
      const treasuryMon = wallets
        .filter(([address]) => !activeWallets.has(address))
        .reduce((sum, [, wallet]) => sum + (Number(wallet.monBalance) || 0), 0);
      const avgEnergy = agentValues.length ? agentValues.reduce((sum, a) => sum + a.energy, 0) / agentValues.length : 0;

      document.getElementById("kpi-tick").textContent = String(state.tick);
      document.getElementById("kpi-agents").textContent = String(Object.keys(state.agents).length);
      document.getElementById("kpi-wallets").textContent = String(activeWallets.size);
      document.getElementById("kpi-events").textContent = String(state.events.length);
      document.getElementById("kpi-total-mon").textContent = formatMon(treasuryMon);
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
      renderAgents(state.agents, state.wallets, state.events);
      renderLeaderboard(state.agents, state.wallets);
      renderEvents(state.events);
      updateGovernance(state.governance);
      flashLiveCards();
      lastPoll = Date.now();
    }

    function flashLiveCards() {
      const cards = document.querySelectorAll(".card");
      cards.forEach((card) => {
        card.classList.remove("pulse-update");
        window.requestAnimationFrame(() => card.classList.add("pulse-update"));
      });
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
