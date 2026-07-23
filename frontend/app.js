/*
 * Project UDAAN — HP ONE Dashboard frontend logic.
 *
 * Overhauled to support:
 *   - Interactive SVG forecourt map
 *   - Details Inspector Drawer (detailed nozzle, bay, and tank telemetry)
 *   - Real-time Terminal Log Feed (CLI-style logging of system events)
 *   - Simulation Control Center (anomalies injection in online and offline modes)
 */

const API_BASE = "";
const POLL_MS = 4000;

let offlineMode = false;
let forecastChart = null;
let inspectorChart = null;

// Console log state
let consolePaused = false;
const MAX_LOGS = 100;

// Track what is currently being inspected in the drawer
let inspectedComponent = null; // { type: 'bay'|'nozzle'|'tank', id: string }

// ---------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------
function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("en-IN", { hour12: false });
}
setInterval(tickClock, 1000);
tickClock();

// ---------------------------------------------------------------------
// Logging Utility
// ---------------------------------------------------------------------
function logToConsole(message, type = "success") {
  if (consolePaused) return;
  const consoleLog = document.getElementById("consoleLog");
  if (!consoleLog) return;

  const timeStr = new Date().toLocaleTimeString("en-IN", { hour12: false });
  const row = document.createElement("div");
  row.className = `log-line log-${type}`;
  row.innerHTML = `<span class="log-time">[${timeStr}]</span> ${message}`;

  consoleLog.appendChild(row);

  // Keep scroll at bottom
  consoleLog.scrollTop = consoleLog.scrollHeight;

  // Enforce max logs limit
  while (consoleLog.childNodes.length > MAX_LOGS) {
    consoleLog.removeChild(consoleLog.firstChild);
  }
}

function clearConsole() {
  const consoleLog = document.getElementById("consoleLog");
  if (consoleLog) consoleLog.innerHTML = "";
  logToConsole("Console logs cleared.", "info");
}

function toggleConsolePause() {
  consolePaused = !consolePaused;
  const btn = document.getElementById("pauseConsoleBtn");
  if (consolePaused) {
    btn.textContent = "Resume Feed";
    btn.style.borderColor = "var(--orange)";
    btn.style.color = "var(--orange)";
  } else {
    btn.textContent = "Pause Feed";
    btn.style.borderColor = "rgba(255,255,255,0.1)";
    btn.style.color = "var(--ink-soft)";
  }
}

// ---------------------------------------------------------------------
// Fetch helper with graceful fallback
// ---------------------------------------------------------------------
async function apiGet(path) {
  const res = await fetch(API_BASE + path, { cache: "no-store" });
  if (!res.ok) throw new Error("bad response " + res.status);
  return res.json();
}

async function apiPost(path, body = {}) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("bad response " + res.status);
  return res.json();
}

function setConnectionState(isLive) {
  const dot = document.getElementById("liveDot");
  const status = document.getElementById("connStatus");
  
  if (offlineMode && isLive) {
    logToConsole("Backend connected. Switching to Live Mode.", "info");
  } else if (!offlineMode && !isLive) {
    logToConsole("Connection to backend lost. Switching to Offline Simulation Mode.", "warning");
  }
  
  offlineMode = !isLive;
  if (isLive) {
    dot.className = "live-dot on";
    status.textContent = "live · backend connected";
  } else {
    dot.className = "live-dot off";
    status.textContent = "offline demo mode (simulated locally)";
  }
}

// =======================================================================
// MODULE 1 — Smart Bay Allocation
// =======================================================================

let lastSeenDetections = [];

function renderBays(data) {
  const container = document.getElementById("bayForecourt");
  container.innerHTML = "";
  
  // Render cards
  data.bays.forEach((bay) => {
    const cls = bay.status.toLowerCase();
    const el = document.createElement("div");
    el.className = "bay-card " + (cls === "out_of_service" ? "out" : cls);
    el.innerHTML = `
      <div class="bay-id">${bay.bay_id}</div>
      <div class="bay-fuel">${bay.fuel_type}</div>
      <span class="bay-status ${cls === "out_of_service" ? "out" : cls}">${bay.status.replace("_", " ")}</span>
      <div class="bay-plate">${bay.current_vehicle ? bay.current_vehicle : "—"}</div>
    `;
    
    // Add click handler to inspect bay
    el.addEventListener("click", () => inspectComponent("bay", bay.bay_id, data));
    container.appendChild(el);
    
    // Sync to SVG station map
    updateSvgBay(bay);
  });

  // Check for new detections to log
  if (data.recent_detections && data.recent_detections.length) {
    const latest = data.recent_detections[0];
    const isNew = !lastSeenDetections.length || latest.detection_id !== lastSeenDetections[0].detection_id;
    if (isNew) {
      if (latest.violation) {
        logToConsole(`[ANPR] VIOLATION flagged: ${latest.plate_number} (${latest.vehicle_type}) - "${latest.violation}"`, "error");
      } else {
        logToConsole(`[ANPR] Detected ${latest.vehicle_type} (${latest.plate_number}) - confidence: ${(latest.vehicle_confidence*100).toFixed(0)}%`, "info");
        // Log allocation
        const alloc = data.recent_allocations ? data.recent_allocations.find(a => a.plate_number === latest.plate_number) : null;
        if (alloc) {
          logToConsole(`[ALLOCATOR] Guided ${latest.plate_number} to ${alloc.bay_id}`, "success");
        }
      }
      lastSeenDetections = data.recent_detections;
    }
  }

  // Render detections list
  const feed = document.getElementById("detectionFeed");
  feed.innerHTML = "";
  if (!data.recent_detections.length) {
    feed.innerHTML = `<div class="empty-state">No detections yet</div>`;
  }
  data.recent_detections.slice(0, 8).forEach((d) => {
    const row = document.createElement("div");
    row.className = "feed-row" + (d.violation ? " violation" : "");
    row.innerHTML = `
      <span class="plate">${d.plate_number}</span>
      <span class="meta">${d.vehicle_type} · ${(d.vehicle_confidence * 100).toFixed(0)}%</span>
      ${d.violation ? `<span class="meta" style="color:var(--red)">⚠ ${d.violation}</span>` : ""}
    `;
    feed.appendChild(row);
  });
}

function updateSvgBay(bay) {
  const g = document.getElementById(`svg-${bay.bay_id}`);
  if (!g) return;

  // Clear previous classes
  g.setAttribute("class", "svg-bay " + bay.status.toLowerCase());
  
  // Update status text
  const statusText = g.querySelector(".bay-text-status");
  if (statusText) {
    statusText.textContent = bay.status === "OUT_OF_SERVICE" ? "OUT" : bay.status;
  }
}

// =======================================================================
// MODULE 2 — The Invisible Auditor
// =======================================================================

let lastSeenAlerts = new Set();

function renderAuditor(alertsData) {
  document.getElementById("kpiHealth").textContent = alertsData.health_score.toFixed(0) + "%";

  const grid = document.getElementById("nozzleGrid");
  grid.innerHTML = "";
  const nozzles = Array.from({ length: 8 }, (_, i) => `N-${String(i + 1).padStart(2, "0")}`);
  const anomalousNow = new Set(alertsData.new_alerts.map((a) => a.nozzle_id));

  // Log anomalies
  alertsData.new_alerts.forEach((alert) => {
    const alertKey = `${alert.nozzle_id}-${alert.label}-${alert.timestamp}`;
    if (!lastSeenAlerts.has(alertKey)) {
      logToConsole(`[AUDITOR] ALARM: Anomaly detected on nozzle ${alert.nozzle_id}: "${alert.label}" (Score: ${alert.anomaly_score})`, "error");
      lastSeenAlerts.add(alertKey);
    }
  });

  // Cleanup old alert keys to avoid memory leaks
  if (lastSeenAlerts.size > 200) {
    lastSeenAlerts = new Set(Array.from(lastSeenAlerts).slice(100));
  }

  nozzles.forEach((nid) => {
    const cell = document.createElement("div");
    const anomalous = anomalousNow.has(nid);
    cell.className = "nozzle-cell" + (anomalous ? " anomaly" : "");
    cell.innerHTML = `
      <div class="nozzle-id">${nid}</div>
      <div class="nozzle-flag">${anomalous ? "⚠️" : "✅"}</div>
    `;
    
    // Clicking inspects nozzle
    cell.addEventListener("click", () => inspectComponent("nozzle", nid, alertsData));
    grid.appendChild(cell);
  });

  const feed = document.getElementById("alertFeed");
  feed.innerHTML = "";
  if (!alertsData.recent_alerts.length) {
    feed.innerHTML = `<div class="empty-state">No anomalies detected — all nozzles nominal</div>`;
  }
  alertsData.recent_alerts.slice(0, 8).forEach((a) => {
    const row = document.createElement("div");
    row.className = "alert-row";
    row.innerHTML = `
      <span class="alert-title">${a.label} — ${a.nozzle_id}</span>
      <span class="alert-meta">score ${a.anomaly_score} · flow ${a.reading.flow_rate} L/min · pulse ${a.reading.pulse_rate}/s</span>
    `;
    row.addEventListener("click", () => inspectComponent("nozzle", a.nozzle_id, alertsData));
    feed.appendChild(row);
  });
}

// =======================================================================
// MODULE 3 — Predictive Tank Monitoring
// =======================================================================

let lastSeenTankAlerts = new Set();

function fillClass(pct) {
  if (pct < 20) return "low";
  if (pct < 40) return "mid";
  return "";
}

function renderTanks(data) {
  const row = document.getElementById("tankRow");
  row.innerHTML = "";

  const tankAlertFeed = document.getElementById("tankAlertFeed");
  tankAlertFeed.innerHTML = "";
  let anyAlert = false;

  data.tanks.forEach((t) => {
    const card = document.createElement("div");
    card.className = "tank-card";
    card.innerHTML = `
      <div class="tank-card-inner">
        <div class="tank-cylinder-wrapper">
          <div class="tank-cylinder">
            <div class="tank-cylinder-fill ${fillClass(t.fill_percent)}" style="height: ${t.fill_percent}%">
              <div class="tank-cylinder-ripple"></div>
            </div>
            <div class="tank-cylinder-water" style="height: ${Math.min(45, t.water_level_mm * 1.8)}%"></div>
          </div>
        </div>
        <div class="tank-info">
          <div class="tank-name">${t.tank_id}</div>
          <div class="tank-product">${t.product}</div>
          <div class="tank-stats">
            <span>Vol:</span>
            <span>${t.volume_litres.toLocaleString(undefined, {maximumFractionDigits:0})} L</span>
          </div>
          <div class="tank-stats">
            <span>Level:</span>
            <span>${t.fill_percent}%</span>
          </div>
          <div class="tank-stats">
            <span>Water:</span>
            <span>${t.water_level_mm.toFixed(1)} mm</span>
          </div>
          <div class="tank-stats">
            <span>Temp:</span>
            <span>${t.temperature_c.toFixed(1)}°C</span>
          </div>
        </div>
      </div>
    `;
    
    // Click card to inspect
    card.addEventListener("click", () => inspectComponent("tank", t.tank_id, data));
    row.appendChild(card);

    t.alerts.forEach((a) => {
      anyAlert = true;
      const alertKey = `${t.tank_id}-${a.type}`;
      if (!lastSeenTankAlerts.has(alertKey)) {
        logToConsole(`[ATG] ALERT: ${t.tank_id} (${t.product}) - ${a.type.replace("_", " ")}: "${a.message}"`, "warning");
        lastSeenTankAlerts.add(alertKey);
      }

      const r = document.createElement("div");
      r.className = "alert-row";
      r.style.background = a.type === "CONTAMINATION_ALERT" ? "rgba(0,194,255,0.05)" : "rgba(255,0,85,0.05)";
      r.style.borderColor = a.type === "CONTAMINATION_ALERT" ? "rgba(0,194,255,0.2)" : "rgba(255,0,85,0.2)";
      r.innerHTML = `<span class="alert-title" style="color:${a.type === "CONTAMINATION_ALERT" ? "var(--blue)" : "var(--red)"}">${t.tank_id} · ${a.type.replace("_", " ")}</span><span class="alert-meta">${a.message}</span>`;
      r.addEventListener("click", () => inspectComponent("tank", t.tank_id, data));
      tankAlertFeed.appendChild(r);
    });
  });

  if (!anyAlert) {
    tankAlertFeed.innerHTML = `<div class="empty-state">All tanks within safe operating range</div>`;
  }

  updateForecastChart(data.tanks);
}

function updateForecastChart(tanks) {
  const ctx = document.getElementById("forecastChart").getContext("2d");
  const labels = Array.from({ length: 12 }, (_, i) => `+${i + 1}h`);
  const palette = ["#00F294", "#FF7A00", "#00C2FF"];

  const datasets = tanks.map((t, i) => ({
    label: `${t.tank_id} (${t.product})`,
    data: t.forecast_next_12h,
    borderColor: palette[i % palette.length],
    backgroundColor: palette[i % palette.length] + "05",
    tension: 0.35,
    pointRadius: 2,
    borderWidth: 2,
  }));

  if (forecastChart) {
    forecastChart.data.labels = labels;
    forecastChart.data.datasets = datasets;
    forecastChart.update();
    return;
  }

  forecastChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          position: "bottom", 
          labels: { 
            boxWidth: 8,
            boxHeight: 8,
            font: { family: "Inter", size: 10 }, 
            color: "#94A3B8" 
          } 
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.03)" },
          ticks: { color: "#94A3B8", font: { family: "IBM Plex Mono", size: 9 } }
        },
        y: { 
          title: { display: false },
          grid: { color: "rgba(255,255,255,0.03)" },
          ticks: { color: "#94A3B8", font: { family: "IBM Plex Mono", size: 9 } }
        },
      },
    },
  });
}

// =======================================================================
// KPI Strip
// =======================================================================

function renderKpis(summary) {
  document.getElementById("kpiBays").textContent = `${summary.bays_busy}/${summary.bays_total}`;
  document.getElementById("kpiAlerts").textContent = summary.active_alerts;
  document.getElementById("kpiTanks").textContent = summary.tanks_monitored;
}

// =======================================================================
// DETAILS INSPECTOR PANEL (Drawer)
// =======================================================================

function inspectComponent(type, id, data) {
  inspectedComponent = { type, id };
  const drawer = document.getElementById("inspectorDrawer");
  const titleEl = document.getElementById("inspectorTitle");
  const bodyEl = document.getElementById("inspectorBody");
  
  drawer.classList.add("active");
  
  if (type === "bay") {
    titleEl.textContent = `Dispenser Bay Inspector — ${id}`;
    
    // Find bay data
    let bays = [];
    if (offlineMode) {
      bays = offlineState.bays;
    } else {
      bays = data.bays || [];
    }
    const bay = bays.find(b => b.bay_id === id);
    if (!bay) return;

    // Load recent allocations for this bay
    const bayAllocations = (offlineMode ? offlineState.detections : (data.recent_allocations || []))
      .filter(a => a.bay_id === id || a.plate_number === bay.current_vehicle)
      .slice(0, 5);

    let queueVisual = "";
    for (let i = 0; i < 4; i++) {
      if (i < bay.queue_length) {
        queueVisual += `<span style="color:var(--amber); margin-right:4px; font-size:16px;">🚗</span>`;
      } else {
        queueVisual += `<span style="color:rgba(255,255,255,0.05); margin-right:4px; font-size:16px;">🚗</span>`;
      }
    }

    bodyEl.innerHTML = `
      <div class="inspector-section">
        <h4>Operational Status</h4>
        <table class="stat-table">
          <tr><td class="label">Bay ID</td><td class="value">${bay.bay_id}</td></tr>
          <tr><td class="label">Fuel Product</td><td class="value">${bay.fuel_type}</td></tr>
          <tr><td class="label">Current Status</td><td class="value"><span class="bay-status ${bay.status.toLowerCase()}">${bay.status}</span></td></tr>
          <tr><td class="label">Current Vehicle</td><td class="value">${bay.current_vehicle || "None"}</td></tr>
          <tr><td class="label">Queue Length</td><td class="value">${bay.queue_length} vehicles</td></tr>
        </table>
      </div>
      
      <div class="inspector-section">
        <h4>Visual Queue Lane</h4>
        <div style="background:rgba(3,7,18,0.5); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:space-between;">
          <span style="font-size:10px; color:var(--ink-soft); font-family:var(--mono);">[Dispenser]</span>
          <div style="display:flex;">${queueVisual}</div>
          <span style="font-size:10px; color:var(--ink-soft); font-family:var(--mono);">[Lane Entry]</span>
        </div>
      </div>

      <div class="inspector-section">
        <h4>Recent Vehicles in Bay</h4>
        <div class="detection-feed">
          ${bayAllocations.length ? bayAllocations.map(a => `
            <div class="feed-row">
              <span class="plate">${a.plate_number}</span>
              <span class="meta">${a.vehicle_type || "Car"} · guid: ${a.bay_id}</span>
            </div>
          `).join('') : '<div class="empty-state">No allocation logs for this bay</div>'}
        </div>
      </div>
    `;
    
    // Clear any previous chart in inspector
    if (inspectorChart) {
      inspectorChart.destroy();
      inspectorChart = null;
    }
  } 
  
  else if (type === "nozzle") {
    titleEl.textContent = `Nozzle Auditor Inspector — ${id}`;
    
    // Retrieve nozzle readings
    let reading = null;
    let anomalous = false;
    let score = 0.0;
    let label = "Normal";

    if (offlineMode) {
      const nozzle = offlineState.nozzles.find(n => n.nozzle_id === id);
      if (nozzle) {
        reading = nozzle;
        anomalous = nozzle.air_fraud || nozzle.drift > 5;
        score = anomalous ? (nozzle.air_fraud ? -0.15 : -0.11) : 0.08;
        label = nozzle.air_fraud ? "Air Delivery Fraud" : (nozzle.drift > 5 ? "Mechanical Pre-Failure Drift" : "Normal");
      }
    } else {
      // Find inside recent alerts or simulate values
      const recent = data.recent_alerts ? data.recent_alerts.find(a => a.nozzle_id === id) : null;
      if (recent) {
        reading = recent.reading;
        anomalous = recent.is_anomaly;
        score = recent.anomaly_score;
        label = recent.label;
      } else {
        // Mock reading from template
        reading = { flow_rate: 22.5, pulse_rate: 450, k_factor: 100.0, voltage: 24.0 };
        anomalous = false;
        score = 0.12;
        label = "Normal";
      }
    }

    if (!reading) return;

    bodyEl.innerHTML = `
      <div class="inspector-section">
        <h4>Telemetry Reading</h4>
        <table class="stat-table">
          <tr><td class="label">Pulse Rate</td><td class="value">${reading.pulse_rate} pulses/sec</td></tr>
          <tr><td class="label">Flow Rate</td><td class="value">${reading.flow_rate} L/min</td></tr>
          <tr><td class="label">Calibration (K-Factor)</td><td class="value">${reading.k_factor} pulses/L</td></tr>
          <tr><td class="label">Solenoid Voltage</td><td class="value">${reading.voltage} V</td></tr>
        </table>
      </div>

      <div class="inspector-section">
        <h4>Unsupervised AI Analysis</h4>
        <table class="stat-table">
          <tr><td class="label">Classification</td><td class="value"><span class="bay-status" style="background:${anomalous?'rgba(255,0,85,0.1)':'rgba(0,242,148,0.1)'}; color:${anomalous?'var(--red)':'var(--green)'}">${label}</span></td></tr>
          <tr><td class="label">Anomaly Score</td><td class="value">${score}</td></tr>
          <tr><td class="label">Audit Decision</td><td class="value">${anomalous ? "🚨 DISPENSER HALT SUGGESTED" : "✅ NOMINAL OPERATION"}</td></tr>
        </table>
      </div>

      <div class="inspector-section">
        <h4>Flow Rate vs Pulse Rate Scatter</h4>
        <div class="drawer-chart-box">
          <canvas id="nozzleScatterChart" height="120"></canvas>
        </div>
        <p style="font-size:9.5px; color:var(--ink-soft); margin-top:4px; font-style:italic; line-height:1.2;">
          Air delivery fraud is flagged when flow rate registers higher than pulse rate would calibrationally justify (points falling in top left quadrant).
        </p>
      </div>
    `;

    // Render the scatter plot comparing flow rate vs pulse rate
    setTimeout(() => {
      const scatterCtx = document.getElementById("nozzleScatterChart").getContext("2d");
      if (inspectorChart) inspectorChart.destroy();

      // Normal base line: flow_rate = pulse_rate / 20
      const normalPoints = Array.from({length: 10}, (_, i) => ({x: 10 + i * 5, y: (10 + i * 5) / 20}));
      const currentPoint = { x: parseFloat(reading.pulse_rate), y: parseFloat(reading.flow_rate) };

      inspectorChart = new Chart(scatterCtx, {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "Normal Calibration",
              data: normalPoints,
              borderColor: "rgba(0, 242, 148, 0.4)",
              backgroundColor: "rgba(0, 242, 148, 0.4)",
              showLine: true,
              borderWidth: 1,
              pointRadius: 0
            },
            {
              label: "Current Reading",
              data: [currentPoint],
              borderColor: anomalous ? "var(--red)" : "var(--green)",
              backgroundColor: anomalous ? "var(--red)" : "var(--green)",
              pointRadius: 6,
              pointHoverRadius: 8
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { 
              title: { display: true, text: "Pulse Rate (pulses/sec)", color: "var(--ink-soft)", font: { size: 9 } },
              grid: { color: "rgba(255,255,255,0.02)" },
              ticks: { color: "#94A3B8", font: { size: 8 } }
            },
            y: { 
              title: { display: true, text: "Flow Rate (L/min)", color: "var(--ink-soft)", font: { size: 9 } },
              grid: { color: "rgba(255,255,255,0.02)" },
              ticks: { color: "#94A3B8", font: { size: 8 } }
            }
          }
        }
      });
    }, 50);
  } 
  
  else if (type === "tank") {
    titleEl.textContent = `Tank ATG Inspector — ${id}`;
    
    // Find tank data
    let tank = null;
    if (offlineMode) {
      tank = offlineState.tanks.find(t => t.tank_id === id);
    } else {
      tank = data.tanks ? data.tanks.find(t => t.tank_id === id) : null;
    }

    if (!tank) return;

    bodyEl.innerHTML = `
      <div class="inspector-section">
        <h4>Tank Telemetry & Status</h4>
        <table class="stat-table">
          <tr><td class="label">Tank ID</td><td class="value">${tank.tank_id}</td></tr>
          <tr><td class="label">Product</td><td class="value">${tank.product}</td></tr>
          <tr><td class="label">Capacity</td><td class="value">${tank.capacity.toLocaleString()} Litres</td></tr>
          <tr><td class="label">Current Volume</td><td class="value">${tank.volume_litres.toLocaleString(undefined, {maximumFractionDigits:1})} L</td></tr>
          <tr><td class="label">Water Contamination</td><td class="value">${tank.water_level_mm.toFixed(2)} mm</td></tr>
          <tr><td class="label">Product Temperature</td><td class="value">${tank.temperature_c.toFixed(1)} °C</td></tr>
        </table>
      </div>

      <div class="inspector-section" style="text-align:center;">
        <h4>Cylinder Levels Graphic</h4>
        <div class="drawer-visual-tank">
          <!-- Fuel Level -->
          <div class="drawer-visual-fill ${fillClass(tank.fill_percent)}" style="height: ${tank.fill_percent}%">
            <!-- Simulated waves ripple overlay inside fill -->
            <div style="position:absolute; top:0; left:0; width:100%; height:4px; background:rgba(255,255,255,0.25);"></div>
          </div>
          <!-- Water level at the bottom -->
          <div class="drawer-visual-water" style="height: ${Math.min(30, tank.water_level_mm * 1.5)}%"></div>
        </div>
        <p style="font-size:9.5px; color:var(--ink-soft); margin-top:2px;">
          Note water layer (blue band) at bottom of cylinder. Ingress triggers a contamination alert.
        </p>
      </div>

      <div class="inspector-section">
        <h4>Arima Volume Forecast Trend</h4>
        <div class="drawer-chart-box">
          <canvas id="tankForecastTrend" height="120"></canvas>
        </div>
      </div>
    `;

    // Render single tank forecast trend
    setTimeout(() => {
      const forecastCtx = document.getElementById("tankForecastTrend").getContext("2d");
      if (inspectorChart) inspectorChart.destroy();

      const labels = Array.from({ length: 12 }, (_, i) => `+${i + 1}h`);
      inspectorChart = new Chart(forecastCtx, {
        type: "line",
        data: {
          labels: labels,
          datasets: [{
            label: "Forecast Volume (L)",
            data: tank.forecast_next_12h || [],
            borderColor: "var(--blue)",
            backgroundColor: "rgba(0, 194, 255, 0.05)",
            borderWidth: 2,
            tension: 0.3,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: "rgba(255,255,255,0.02)" }, ticks: { color: "#94A3B8", font: { size: 8 } } },
            y: { grid: { color: "rgba(255,255,255,0.02)" }, ticks: { color: "#94A3B8", font: { size: 8 } } }
          }
        }
      });
    }, 50);
  }
}

function closeInspector() {
  document.getElementById("inspectorDrawer").classList.remove("active");
  inspectedComponent = null;
  if (inspectorChart) {
    inspectorChart.destroy();
    inspectorChart = null;
  }
}

// ---------------------------------------------------------------------
// Simulation Control Drawer
// ---------------------------------------------------------------------
function toggleSimDrawer() {
  document.getElementById("simControlDrawer").classList.toggle("active");
}

async function triggerReset() {
  logToConsole("Issuing reset command...", "info");
  if (offlineMode) {
    // Reset local offline state
    offlineState.bays.forEach(b => {
      b.status = "OPEN";
      b.queue_length = 0;
      b.current_vehicle = null;
    });
    offlineState.detections = [];
    offlineState.alerts = [];
    offlineState.nextViolation = null;
    offlineState.nozzles.forEach(n => {
      n.air_fraud = false;
      n.drift = 0.0;
      n.flow_rate = 0.0;
      n.pulse_rate = 0.0;
      n.k_factor = 100.0;
      n.voltage = 24.0;
    });
    offlineState.tanks.forEach(t => {
      t.leak_active = false;
      t.water_ingress_active = false;
      t.water_level_mm = 4.0;
      t.alerts = [];
      offlineState.tankHistory[t.tank_id] = Array(40).fill(t.capacity * 0.7);
      offlineState.tankWaterHistory[t.tank_id] = Array(40).fill(4.0);
    });
    logToConsole("Offline simulator states reset successfully.", "success");
    
    // Refresh UI immediately
    runOfflineTick();
  } else {
    try {
      const res = await apiPost("/api/simulator/reset");
      if (res.status === "reset") {
        logToConsole("Backend simulation state reset successfully.", "success");
        await refreshAll();
      }
    } catch (err) {
      logToConsole("Reset command failed: " + err.message, "error");
    }
  }
}

async function injectBayViolation() {
  const violation = document.getElementById("simBayViolation").value;
  logToConsole(`Flagged next vehicle for violation: "${violation}"`, "info");
  
  if (offlineMode) {
    offlineState.nextViolation = violation;
  } else {
    try {
      await apiPost("/api/simulator/trigger", {
        module: "smart_bay",
        type: "violation",
        target_id: violation
      });
    } catch (err) {
      logToConsole("Failed to inject violation: " + err.message, "error");
    }
  }
}

async function triggerBayAction(action) {
  const bayId = document.getElementById("simBayId").value;
  logToConsole(`Triggered bay action "${action}" on ${bayId}`, "info");

  if (offlineMode) {
    const bay = offlineState.bays.find(b => b.bay_id === bayId);
    if (bay) {
      if (action === "suspend_bay") {
        bay.status = "SUSPENDED";
        logToConsole(`[BAY] VIOLATION: Bay ${bayId} suspended manually.`, "error");
      } else if (action === "clear_bay") {
        bay.status = "OPEN";
        bay.queue_length = 0;
        bay.current_vehicle = null;
        logToConsole(`[BAY] Operational clearance issued for ${bayId}.`, "success");
      }
    }
    runOfflineTick();
  } else {
    try {
      await apiPost("/api/simulator/trigger", {
        module: "smart_bay",
        type: action,
        target_id: bayId
      });
      await refreshAll();
    } catch (err) {
      logToConsole("Failed to trigger bay action: " + err.message, "error");
    }
  }
}

async function triggerNozzleAction(action) {
  const nozzleId = document.getElementById("simNozzleId").value;
  logToConsole(`Triggered nozzle action "${action}" on ${nozzleId}`, "info");

  if (offlineMode) {
    const nozzle = offlineState.nozzles.find(n => n.nozzle_id === nozzleId);
    if (nozzle) {
      if (action === "air_fraud") {
        nozzle.air_fraud = true;
        nozzle.drift = 0.0;
        logToConsole(`[AUDITOR] Injected Pulse/Air Fraud on ${nozzleId}.`, "warning");
      } else if (action === "mechanical_drift") {
        nozzle.drift = 6.0;
        nozzle.air_fraud = false;
        logToConsole(`[AUDITOR] Injected calibration drift on ${nozzleId}.`, "warning");
      } else if (action === "clear_nozzle") {
        nozzle.air_fraud = false;
        nozzle.drift = 0.0;
        logToConsole(`[AUDITOR] Nozzle ${nozzleId} calibrated back to nominal.`, "success");
      }
    }
    runOfflineTick();
  } else {
    try {
      await apiPost("/api/simulator/trigger", {
        module: "auditor",
        type: action,
        target_id: nozzleId
      });
      await refreshAll();
    } catch (err) {
      logToConsole("Failed to trigger nozzle action: " + err.message, "error");
    }
  }
}

async function triggerTankAction(action) {
  const tankId = document.getElementById("simTankId").value;
  logToConsole(`Triggered tank action "${action}" on ${tankId}`, "info");

  if (offlineMode) {
    const tank = offlineState.tanks.find(t => t.tank_id === tankId);
    if (tank) {
      if (action === "leak") {
        tank.leak_active = true;
        tank.water_ingress_active = false;
        logToConsole(`[ATG] Fuel leak simulation activated on ${tankId}.`, "warning");
      } else if (action === "water_ingress") {
        tank.water_ingress_active = true;
        tank.leak_active = false;
        logToConsole(`[ATG] Rainwater water ingress activated on ${tankId}.`, "warning");
      } else if (action === "refill") {
        tank.leak_active = false;
        tank.water_ingress_active = false;
        tank.volume_litres = tank.capacity * 0.85;
        tank.water_level_mm = 3.0;
        tank.fill_percent = 85.0;
        tank.alerts = [];
        offlineState.tankHistory[tankId] = Array(40).fill(tank.capacity * 0.85);
        offlineState.tankWaterHistory[tankId] = Array(40).fill(3.0);
        logToConsole(`[ATG] Refilled tank ${tankId} to 85% capacity. Water levels flushed.`, "success");
      }
    }
    runOfflineTick();
  } else {
    try {
      await apiPost("/api/simulator/trigger", {
        module: "tank_monitoring",
        type: action,
        target_id: tankId
      });
      await refreshAll();
    } catch (err) {
      logToConsole("Failed to trigger tank action: " + err.message, "error");
    }
  }
}

// =======================================================================
// Polling loop
// =======================================================================

async function refreshAll() {
  try {
    const [bays, alerts, tanks, summary] = await Promise.all([
      apiGet("/api/bays"),
      apiGet("/api/auditor/alerts"),
      apiGet("/api/tanks"),
      apiGet("/api/summary"),
    ]);
    setConnectionState(true);
    renderBays(bays);
    renderAuditor(alerts);
    renderTanks(tanks);
    renderKpis(summary);
    
    // Live update open drawer if applicable
    if (inspectedComponent) {
      if (inspectedComponent.type === "bay") inspectComponent("bay", inspectedComponent.id, bays);
      else if (inspectedComponent.type === "nozzle") inspectComponent("nozzle", inspectedComponent.id, alerts);
      else if (inspectedComponent.type === "tank") inspectComponent("tank", inspectedComponent.id, tanks);
    }
  } catch (err) {
    setConnectionState(false);
    runOfflineTick();
  }
}

// =======================================================================
// Offline demo-mode simulation (used only if the backend isn't reachable)
// =======================================================================

const offlineState = {
  bays: ["Bay-1", "Bay-2", "Bay-3", "Bay-4", "Bay-5", "Bay-6"].map((id, i) => ({
    bay_id: id,
    fuel_type: i < 2 ? "Petrol" : i < 4 ? "Diesel" : "Both",
    status: "OPEN",
    queue_length: 0,
    current_vehicle: null,
  })),
  detections: [],
  alerts: [],
  nozzles: Array.from({ length: 8 }, (_, i) => ({
    nozzle_id: `N-${String(i + 1).padStart(2, "0")}`,
    status: "Normal",
    drift: 0.0,
    air_fraud: false,
    flow_rate: 0,
    pulse_rate: 0,
    k_factor: 100,
    voltage: 24
  })),
  tanks: [
    { tank_id: "T-1", product: "Petrol", capacity: 20000, volume_litres: 14000, temperature_c: 27.5, water_level_mm: 4.2, leak_active: false, water_ingress_active: false, fill_percent: 70, alerts: [] },
    { tank_id: "T-2", product: "Diesel", capacity: 25000, volume_litres: 17500, temperature_c: 28.1, water_level_mm: 3.8, leak_active: false, water_ingress_active: false, fill_percent: 70, alerts: [] },
    { tank_id: "T-3", product: "Premium Petrol", capacity: 12000, volume_litres: 8400, temperature_c: 26.8, water_level_mm: 5.1, leak_active: false, water_ingress_active: false, fill_percent: 70, alerts: [] },
  ],
  tankHistory: { "T-1": Array(40).fill(14000), "T-2": Array(40).fill(17500), "T-3": Array(40).fill(8400) },
  tankWaterHistory: { "T-1": Array(40).fill(4.2), "T-2": Array(40).fill(3.8), "T-3": Array(40).fill(5.1) },
  nextViolation: null,
};

function randPlate() {
  const states = ["KA", "MH", "TN", "KL", "TS"];
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const s = states[Math.floor(Math.random() * states.length)];
  const l = () => letters[Math.floor(Math.random() * letters.length)];
  return `${s}${Math.floor(Math.random() * 60)
    .toString()
    .padStart(2, "0")}${l()}${l()}${Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, "0")}`;
}

function classifyAnomalyLocal(reading) {
  if (reading.flow_rate > 2.0 && reading.pulse_rate < 10) {
    return "Air Delivery Fraud";
  }
  if (Math.abs(reading.k_factor - 100) > 5 || Math.abs(reading.voltage - 24) > 2) {
    return "Mechanical Pre-Failure Drift";
  }
  return "Normal";
}

function runOfflineTick() {
  // 1. ANPR Detections & Allocations
  const vehicleTypes = ["Car", "Bike", "Auto", "Truck", "Bus"];
  const vt = vehicleTypes[Math.floor(Math.random() * vehicleTypes.length)];
  const plate = randPlate();
  
  // Apply manual next violation override if set
  let violation = null;
  if (offlineState.nextViolation) {
    violation = offlineState.nextViolation;
    offlineState.nextViolation = null;
  } else {
    violation = Math.random() < 0.05 ? "Mobile phone use at dispenser" : null;
  }
  
  const detectionEvent = {
    plate_number: plate,
    vehicle_type: vt,
    vehicle_confidence: 0.6 + Math.random() * 0.38,
    violation,
    detection_id: Math.random().toString(36).substring(7)
  };
  
  offlineState.detections.unshift(detectionEvent);
  offlineState.detections = offlineState.detections.slice(0, 10);

  // Trigger console logs for detections
  if (violation) {
    logToConsole(`[ANPR] VIOLATION flagged: ${plate} (${vt}) - "${violation}"`, "error");
  } else {
    logToConsole(`[ANPR] Detected ${vt} (${plate}) - confidence: ${(detectionEvent.vehicle_confidence*100).toFixed(0)}%`, "info");
    
    // allocate bay
    const eligibleBays = offlineState.bays.filter(b => b.status !== "OUT_OF_SERVICE" && b.status !== "SUSPENDED");
    if (eligibleBays.length) {
      // greedy: shortest queue
      const chosen = eligibleBays.reduce((prev, curr) => prev.queue_length <= curr.queue_length ? prev : curr);
      chosen.queue_length += 1;
      chosen.status = "BUSY";
      chosen.current_vehicle = plate;
      logToConsole(`[ALLOCATOR] Guided ${plate} to ${chosen.bay_id} (queue: ${chosen.queue_length})`, "success");
    }
  }

  // occasionally free up a busy bay
  offlineState.bays.forEach((b) => {
    if (b.status === "BUSY" && b.queue_length > 0 && Math.random() < 0.25) {
      b.queue_length -= 1;
      if (b.queue_length === 0) {
        b.status = "OPEN";
        b.current_vehicle = null;
        logToConsole(`[BAY] Vehicle completed service at ${b.bay_id}. Bay is now OPEN.`, "success");
      } else {
        b.current_vehicle = randPlate();
        logToConsole(`[BAY] Next vehicle queued in ${b.bay_id} pulls up.`, "info");
      }
    }
  });

  renderBays({ bays: offlineState.bays, recent_detections: offlineState.detections });

  // 2. FCC Nozzles & Auditor alerts
  const localNewAlerts = [];
  offlineState.nozzles.forEach((nozzle) => {
    // Generate simulated reading
    let drift = nozzle.drift;
    
    // Randomly increase drift if not manual
    if (drift === 0.0 && Math.random() < 0.02) {
      drift = Math.random() < 0.5 ? 0.0 : Math.random() * 2.0;
    }
    
    let pulse_rate = 40 + Math.random() * 20;
    let flow_rate = pulse_rate / 20 + (Math.random() * 0.4 - 0.2);
    let k_factor = 100.0 + drift;
    let voltage = 24.0 + drift * 0.3;

    // Apply manual flags
    if (nozzle.air_fraud) {
      flow_rate = 4.8 + Math.random() * 0.3;
      pulse_rate = 1.5 + Math.random() * 0.5;
    }

    nozzle.flow_rate = flow_rate;
    nozzle.pulse_rate = pulse_rate;
    nozzle.k_factor = k_factor;
    nozzle.voltage = voltage;

    const label = classifyAnomalyLocal(nozzle);
    const isAnomaly = label !== "Normal";
    
    if (isAnomaly) {
      const alert = {
        nozzle_id: nozzle.nozzle_id,
        label,
        anomaly_score: isAnomaly ? (-0.12 - Math.random() * 0.1).toFixed(3) : 0.1,
        timestamp: Date.now() / 1000,
        is_anomaly: true,
        reading: {
          flow_rate: flow_rate.toFixed(2),
          pulse_rate: pulse_rate.toFixed(2),
          k_factor: k_factor.toFixed(2),
          voltage: voltage.toFixed(2)
        }
      };
      
      localNewAlerts.push(alert);
      
      // Inject to console logs
      const alertKey = `${nozzle.nozzle_id}-${label}`;
      if (!lastSeenAlerts.has(alertKey)) {
        logToConsole(`[AUDITOR] ALARM: Anomaly detected on ${nozzle.nozzle_id}: "${label}"`, "error");
        lastSeenAlerts.add(alertKey);
      }
    }
  });

  // Prepend to alerts list
  if (localNewAlerts.length) {
    offlineState.alerts = [...localNewAlerts, ...offlineState.alerts].slice(0, 15);
  }

  renderAuditor({
    health_score: Math.max(60, 100 - offlineState.alerts.length * 6.5),
    new_alerts: localNewAlerts,
    recent_alerts: offlineState.alerts,
  });

  // 3. ATG Tanks
  const tanks = offlineState.tanks.map((t) => {
    let vol = t.volume_litres;
    let water = t.water_level_mm;

    // Simulate standard fuel drawdown
    const demand = 120 + Math.random() * 100;
    vol -= demand;

    // Apply manual triggers
    if (t.leak_active) {
      vol -= 750; // fast leak
    }
    if (t.water_ingress_active) {
      water += 0.8; // fast water rise
    } else {
      water += (Math.random() * 0.04 - 0.02);
      water = Math.max(1.5, water);
    }

    // Tank refills
    if (vol < t.capacity * 0.15 && !t.leak_active && Math.random() < 0.25) {
      vol = t.capacity * 0.85;
      water = 3.0;
      logToConsole(`[ATG] Fuel tanker arrived. Refilled ${t.tank_id} to 85%.`, "success");
    }
    
    vol = Math.max(0, Math.min(t.capacity, vol));
    t.volume_litres = vol;
    t.water_level_mm = water;
    t.fill_percent = Math.round((100 * vol / t.capacity) * 10) / 10;

    // Track history
    const hist = offlineState.tankHistory[t.tank_id];
    hist.push(vol);
    if (hist.length > 40) hist.shift();

    const wHist = offlineState.tankWaterHistory[t.tank_id];
    wHist.push(water);
    if (wHist.length > 40) wHist.shift();

    // Alerts
    const alerts = [];
    const fill = (100 * vol) / t.capacity;
    
    // Check volume threshold forecast (linear approximation)
    const slope = (hist[hist.length - 1] - hist[0]) / hist.length;
    const forecast = Array.from({ length: 12 }, (_, i) => Math.max(0, vol + slope * (i + 1)));

    if (forecast.some(v => v < t.capacity * 0.15)) {
      const hrs = forecast.findIndex(v => v < t.capacity * 0.15) + 1;
      alerts.push({
        type: "REORDER_ALERT",
        message: `Volume projected to drop below 15% threshold in ${hrs} hours. Reorder recommended.`
      });
    }

    // Check water ingress rate
    const waterRate = (wHist[wHist.length - 1] - wHist[0]) / Math.max(1, wHist.length - 1);
    if (waterRate > 0.15) {
      alerts.push({
        type: "CONTAMINATION_ALERT",
        message: `Water levels rising at ${waterRate.toFixed(2)} mm/hr. Water ingress inspection suggested.`
      });
    }

    t.forecast_next_12h = forecast;
    t.alerts = alerts;

    return t;
  });

  renderTanks({ tanks });

  renderKpis({
    bays_busy: offlineState.bays.filter((b) => b.status === "BUSY").length,
    bays_total: offlineState.bays.length,
    active_alerts: offlineState.alerts.length + tanks.reduce((acc, t) => acc + t.alerts.length, 0),
    tanks_monitored: tanks.length,
  });

  // Keep open inspector updated
  if (inspectedComponent) {
    if (inspectedComponent.type === "bay") inspectComponent("bay", inspectedComponent.id);
    else if (inspectedComponent.type === "nozzle") inspectComponent("nozzle", inspectedComponent.id);
    else if (inspectedComponent.type === "tank") inspectComponent("tank", inspectedComponent.id);
  }
}

// ---------------------------------------------------------------------
// Boot initialization
// ---------------------------------------------------------------------
function init() {
  logToConsole("HP ONE command system loading...", "info");
  
  // Attach listeners to SVG elements for clicking and inspection
  const svgBays = document.querySelectorAll(".svg-bay");
  svgBays.forEach(g => {
    const id = g.id.replace("svg-", "");
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      inspectComponent("bay", id);
    });
  });

  // Load live data
  refreshAll();
  setInterval(refreshAll, POLL_MS);
  logToConsole("HP ONE Dashboard initialized successfully.", "success");
}

// Initialize on DOM load
window.addEventListener("DOMContentLoaded", init);
