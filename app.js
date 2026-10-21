/* ============================================================
   Flood Detection Dashboard – Application Logic
   ============================================================
   Phase 1: front-end only, polls ESP32 directly via fetch().
   No build step, no framework, just vanilla JS + Chart.js.
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────────────────────
// 1. CONSTANTS & THRESHOLDS (edit these as needed)
// ──────────────────────────────────────────────────────────────
const DEFAULT_ESP32_IP     = '10.145.101.27';
const DEFAULT_TANK_HEIGHT  = 15;           // cm
const WARNING_THRESHOLD    = 10;           // cm depth  → WARNING
const CRITICAL_THRESHOLD   = 12;           // cm depth  → CRITICAL
const DEFAULT_POLL_MS      = 1000;         // ms
const MIN_POLL_MS          = 500;          // never faster than this
const REQUEST_TIMEOUT_MS   = 2000;         // AbortController timeout
const OFFLINE_AFTER        = 3;            // consecutive failures
const HISTORY_MINUTES      = 10;           // chart window
const MAX_LOG_ENTRIES      = 100;          // event log cap
const BEEP_FREQ_HZ         = 880;
const BEEP_DURATION_S      = 0.18;

// ──────────────────────────────────────────────────────────────
// 2. APPLICATION STATE
// ──────────────────────────────────────────────────────────────
let config = {
  ip:           DEFAULT_ESP32_IP,
  tankHeight:   DEFAULT_TANK_HEIGHT,
  pollInterval: DEFAULT_POLL_MS,
  demoMode:     false,
};

let lastStatus        = null;   // previous status string for change detection
let consecutiveErrors = 0;
let isOnline          = false;
let soundEnabled      = false;  // requires a user gesture to create AudioContext
let audioCtx          = null;
let pollTimerId       = null;
let polling           = false;  // guard: one request at a time
let history           = [];     // [{ t: timestamp, waterCm, level, status }]
let events            = [];     // [{ t: timestamp, from, to }]
let depthChart        = null;   // Chart.js instance
let demoPhase         = 0;      // internal counter for demo simulation
let manualTheme       = null;   // null = auto, 'light' or 'dark'

// ──────────────────────────────────────────────────────────────
// 3. DOM REFERENCES (cached once on load)
// ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const dom = {};  // populated in init()

// ──────────────────────────────────────────────────────────────
// 4. INITIALISATION
// ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM nodes
  Object.assign(dom, {
    criticalBanner:   $('critical-banner'),
    connectionDot:    $('connection-dot'),
    connectionText:   $('connection-text'),
    demoBadge:        $('demo-badge'),
    btnSound:         $('btn-sound'),
    btnTheme:         $('btn-theme'),
    btnSettings:      $('btn-settings'),
    tankFill:         $('tank-fill'),
    tankLabel:        $('tank-label'),
    thresholdWarning: $('threshold-warning'),
    thresholdCritical:$('threshold-critical'),
    statusBadge:      $('status-badge'),
    readingDepth:     $('reading-depth'),
    readingDistance:   $('reading-distance'),
    readingLevel:     $('reading-level'),
    lastUpdated:      $('last-updated'),
    chartCanvas:      $('depth-chart'),
    eventLog:         $('event-log'),
    btnClearLog:      $('btn-clear-log'),
    settingsOverlay:  $('settings-overlay'),
    settingsPanel:    $('settings-panel'),
    btnCloseSettings: $('btn-close-settings'),
    settingsForm:     $('settings-form'),
    inputIp:          $('input-ip'),
    inputTankHeight:  $('input-tank-height'),
    inputPollInterval:$('input-poll-interval'),
    inputDemoMode:    $('input-demo-mode'),
  });

  loadSettings();
  applyTheme();
  updateThresholdMarkers();
  initChart();
  bindEvents();
  startPolling();
});

// ──────────────────────────────────────────────────────────────
// 5. SETTINGS (localStorage with try/catch)
// ──────────────────────────────────────────────────────────────
function loadSettings() {
  try {
    const raw = localStorage.getItem('flood-dashboard-settings');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.ip)           config.ip           = String(saved.ip);
      if (saved.tankHeight)   config.tankHeight    = clamp(Number(saved.tankHeight), 1, 500);
      if (saved.pollInterval) config.pollInterval  = clamp(Number(saved.pollInterval), MIN_POLL_MS, 30000);
      if (typeof saved.demoMode === 'boolean') config.demoMode = saved.demoMode;
      if (saved.theme) manualTheme = saved.theme;
    }
  } catch (e) {
    console.warn('Could not load settings:', e);
  }
}

function saveSettings() {
  try {
    localStorage.setItem('flood-dashboard-settings', JSON.stringify({
      ip:           config.ip,
      tankHeight:   config.tankHeight,
      pollInterval: config.pollInterval,
      demoMode:     config.demoMode,
      theme:        manualTheme,
    }));
  } catch (e) {
    console.warn('Could not save settings:', e);
  }
}

// ──────────────────────────────────────────────────────────────
// 6. EVENT BINDINGS
// ──────────────────────────────────────────────────────────────
function bindEvents() {
  // Settings panel open/close
  dom.btnSettings.addEventListener('click', openSettings);
  dom.btnCloseSettings.addEventListener('click', closeSettings);
  dom.settingsOverlay.addEventListener('click', closeSettings);

  // Settings form submit
  dom.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    config.ip           = dom.inputIp.value.trim() || DEFAULT_ESP32_IP;
    config.tankHeight   = clamp(Number(dom.inputTankHeight.value) || DEFAULT_TANK_HEIGHT, 1, 500);
    config.pollInterval = clamp(Number(dom.inputPollInterval.value) || DEFAULT_POLL_MS, MIN_POLL_MS, 30000);
    config.demoMode     = dom.inputDemoMode.checked;
    saveSettings();
    updateThresholdMarkers();
    closeSettings();
    restartPolling();
  });

  // Sound toggle
  dom.btnSound.addEventListener('click', toggleSound);

  // Theme toggle
  dom.btnTheme.addEventListener('click', toggleTheme);

  // Clear event log
  dom.btnClearLog.addEventListener('click', () => {
    events = [];
    renderEventLog();
  });
}

function openSettings() {
  dom.inputIp.value           = config.ip;
  dom.inputTankHeight.value   = config.tankHeight;
  dom.inputPollInterval.value = config.pollInterval;
  dom.inputDemoMode.checked   = config.demoMode;
  dom.settingsPanel.hidden    = false;
  dom.settingsOverlay.hidden  = false;
}

function closeSettings() {
  dom.settingsPanel.hidden    = true;
  dom.settingsOverlay.hidden  = true;
}

// ──────────────────────────────────────────────────────────────
// 7. THEME
// ──────────────────────────────────────────────────────────────
function toggleTheme() {
  if (manualTheme === 'dark') manualTheme = 'light';
  else if (manualTheme === 'light') manualTheme = null;  // back to auto
  else manualTheme = 'dark';
  applyTheme();
  saveSettings();
  // Rebuild chart to pick up new colours
  if (depthChart) {
    depthChart.destroy();
    initChart();
    repopulateChart();
  }
}

function applyTheme() {
  if (manualTheme) {
    document.documentElement.setAttribute('data-theme', manualTheme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function isDarkMode() {
  if (manualTheme === 'dark') return true;
  if (manualTheme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ──────────────────────────────────────────────────────────────
// 8. SOUND (Web Audio API)
// ──────────────────────────────────────────────────────────────
function toggleSound() {
  if (!soundEnabled) {
    // Create AudioContext on user gesture (browser requirement)
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      soundEnabled = true;
      dom.btnSound.textContent = '🔊';
      dom.btnSound.title = 'Sound alerts enabled';
    } catch (e) {
      console.warn('Web Audio not available:', e);
    }
    // Also request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } else {
    soundEnabled = false;
    dom.btnSound.textContent = '🔇';
    dom.btnSound.title = 'Enable sound alerts (click to unlock audio)';
  }
}

function playBeep() {
  if (!soundEnabled || !audioCtx) return;
  try {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.value = BEEP_FREQ_HZ;
    gain.gain.value = 0.2;
    osc.start();
    osc.stop(audioCtx.currentTime + BEEP_DURATION_S);
  } catch (e) {
    console.warn('Beep failed:', e);
  }
}

function sendBrowserNotification(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'flood-critical' });
    }
  } catch (e) {
    // Notifications may not work from file://
  }
}

// ──────────────────────────────────────────────────────────────
// 9. POLLING
// ──────────────────────────────────────────────────────────────
function startPolling() {
  updateDemoBadge();
  schedulePoll(0);  // first poll immediately
}

function restartPolling() {
  clearTimeout(pollTimerId);
  polling = false;
  consecutiveErrors = 0;
  lastStatus = null;
  updateDemoBadge();
  schedulePoll(0);
}

function schedulePoll(delayMs) {
  clearTimeout(pollTimerId);
  const delay = delayMs !== undefined ? delayMs : config.pollInterval;
  pollTimerId = setTimeout(executePoll, delay);
}

async function executePoll() {
  if (polling) return;  // never overlap
  polling = true;

  try {
    let data;
    if (config.demoMode) {
      data = generateDemoData();
    } else {
      data = await fetchESP32();
    }

    // Validate
    data = validateData(data);
    if (!data) throw new Error('Invalid data from sensor');

    // Success path
    consecutiveErrors = 0;
    setConnectionState(true);
    processReading(data);

  } catch (err) {
    consecutiveErrors++;
    if (consecutiveErrors >= OFFLINE_AFTER) {
      setConnectionState(false);
    }
    console.warn(`Poll error (${consecutiveErrors}):`, err.message || err);
  } finally {
    polling = false;
    schedulePoll();
  }
}

async function fetchESP32() {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `http://${config.ip}/data`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────
// 10. DATA VALIDATION
// ──────────────────────────────────────────────────────────────
function validateData(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const distance = parseFloat(raw.distance);
  const waterCm  = parseFloat(raw.waterCm);
  const level    = parseInt(raw.level, 10);
  const status   = String(raw.status || '').toUpperCase();

  // Reject if core numbers are NaN
  if (isNaN(distance) || isNaN(waterCm) || isNaN(level)) return null;

  // Clamp level to 0-100
  const clampedLevel = clamp(level, 0, 100);

  // Validate status string
  const validStatuses = ['NORMAL', 'WARNING', 'CRITICAL'];
  const safeStatus = validStatuses.includes(status) ? status : deriveStatus(waterCm);

  return {
    distance: Math.max(0, distance),
    waterCm:  Math.max(0, waterCm),
    level:    clampedLevel,
    status:   safeStatus,
  };
}

/** Derive status from water depth if the API status field is missing/invalid */
function deriveStatus(waterCm) {
  if (waterCm >= CRITICAL_THRESHOLD) return 'CRITICAL';
  if (waterCm >= WARNING_THRESHOLD)  return 'WARNING';
  return 'NORMAL';
}

// ──────────────────────────────────────────────────────────────
// 11. PROCESS A VALID READING
// ──────────────────────────────────────────────────────────────
function processReading(data) {
  const now = Date.now();

  // Add to history (trim to HISTORY_MINUTES window)
  history.push({ t: now, waterCm: data.waterCm, level: data.level, status: data.status });
  const cutoff = now - HISTORY_MINUTES * 60 * 1000;
  history = history.filter((h) => h.t >= cutoff);

  // Detect status change
  if (lastStatus !== null && lastStatus !== data.status) {
    const evt = { t: now, from: lastStatus, to: data.status };
    events.unshift(evt);  // newest first
    if (events.length > MAX_LOG_ENTRIES) events.pop();
    renderEventLog();

    // Critical alerts
    if (data.status === 'CRITICAL') {
      playBeep();
      sendBrowserNotification(
        '🚨 CRITICAL Water Level!',
        `Water depth: ${data.waterCm.toFixed(1)} cm — flooding risk!`
      );
    }
  }
  lastStatus = data.status;

  updateUI(data);
  updateChart(data, now);
}

// ──────────────────────────────────────────────────────────────
// 12. UI UPDATES
// ──────────────────────────────────────────────────────────────
function updateUI(data) {
  const statusLower = data.status.toLowerCase();

  // Status badge
  dom.statusBadge.textContent = data.status;
  dom.statusBadge.className   = 'status-badge ' + statusLower;

  // Readings
  dom.readingDepth.textContent    = data.waterCm.toFixed(1);
  dom.readingDistance.textContent  = data.distance.toFixed(1);
  dom.readingLevel.textContent    = data.level;

  // Last updated
  dom.lastUpdated.textContent = 'Last updated: ' + formatTime(new Date());

  // Tank fill
  const pct = clamp(data.level, 0, 100);
  dom.tankFill.style.height = pct + '%';
  dom.tankFill.className    = 'tank-fill status-' + statusLower;
  dom.tankLabel.textContent = pct + '%';

  // Critical banner
  dom.criticalBanner.hidden = (data.status !== 'CRITICAL');
}

function setConnectionState(online) {
  if (isOnline === online) return;
  isOnline = online;

  dom.connectionDot.className  = 'connection-dot ' + (online ? 'online' : 'offline');
  dom.connectionText.textContent = online ? 'ONLINE' : 'OFFLINE';

  if (!online) {
    dom.statusBadge.textContent = 'OFFLINE';
    dom.statusBadge.className   = 'status-badge offline';
    dom.criticalBanner.hidden   = true;
  }
}

function updateDemoBadge() {
  dom.demoBadge.hidden = !config.demoMode;
}

function updateThresholdMarkers() {
  const warnPct = (WARNING_THRESHOLD / config.tankHeight) * 100;
  const critPct = (CRITICAL_THRESHOLD / config.tankHeight) * 100;
  dom.thresholdWarning.style.bottom  = clamp(warnPct, 0, 100) + '%';
  dom.thresholdCritical.style.bottom = clamp(critPct, 0, 100) + '%';
}

// ──────────────────────────────────────────────────────────────
// 13. EVENT LOG RENDERING
// ──────────────────────────────────────────────────────────────
function renderEventLog() {
  if (events.length === 0) {
    dom.eventLog.innerHTML = '<p class="log-empty">No events yet. Waiting for data…</p>';
    return;
  }

  dom.eventLog.innerHTML = events.map((evt) => {
    const time = formatTime(new Date(evt.t));
    const fromClass = evt.from.toLowerCase();
    const toClass   = evt.to.toLowerCase();
    return `
      <div class="log-entry">
        <span class="log-time">${time}</span>
        <span class="log-status ${fromClass}">${evt.from}</span>
        <span class="log-arrow">→</span>
        <span class="log-status ${toClass}">${evt.to}</span>
      </div>`;
  }).join('');
}

// ──────────────────────────────────────────────────────────────
// 14. CHART (Chart.js)
// ──────────────────────────────────────────────────────────────

/** Custom plugin: draw horizontal threshold lines */
const thresholdLinesPlugin = {
  id: 'thresholdLines',
  afterDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;
    const yScale = scales.y;

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    // Warning line
    const warnY = yScale.getPixelForValue(WARNING_THRESHOLD);
    if (warnY >= chartArea.top && warnY <= chartArea.bottom) {
      ctx.strokeStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(chartArea.left, warnY);
      ctx.lineTo(chartArea.right, warnY);
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      ctx.font = '10px sans-serif';
      ctx.fillText('Warning', chartArea.right - 50, warnY - 4);
    }

    // Critical line
    const critY = yScale.getPixelForValue(CRITICAL_THRESHOLD);
    if (critY >= chartArea.top && critY <= chartArea.bottom) {
      ctx.strokeStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(chartArea.left, critY);
      ctx.lineTo(chartArea.right, critY);
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.font = '10px sans-serif';
      ctx.fillText('Critical', chartArea.right - 50, critY - 4);
    }

    ctx.restore();
  },
};

function initChart() {
  const dark = isDarkMode();
  const gridColor = dark ? 'rgba(148,163,184,.2)' : 'rgba(0,0,0,.08)';
  const textColor = dark ? '#94a3b8' : '#64748b';

  depthChart = new Chart(dom.chartCanvas, {
    type: 'line',
    plugins: [thresholdLinesPlugin],
    data: {
      datasets: [{
        label: 'Water Depth (cm)',
        data: [],           // [{ x: timestamp, y: waterCm }]
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,.1)',
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 6,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          min: Date.now() - HISTORY_MINUTES * 60 * 1000,
          max: Date.now(),
          ticks: {
            color: textColor,
            maxTicksLimit: 8,
            callback(value) {
              return formatTime(new Date(value));
            },
          },
          grid: { color: gridColor },
        },
        y: {
          min: 0,
          max: Math.max(DEFAULT_TANK_HEIGHT + 2, CRITICAL_THRESHOLD + 3),
          ticks: { color: textColor },
          grid: { color: gridColor },
          title: {
            display: true,
            text: 'cm',
            color: textColor,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) {
              if (!items.length) return '';
              return formatTime(new Date(items[0].parsed.x));
            },
            label(item) {
              return `Depth: ${item.parsed.y.toFixed(1)} cm`;
            },
          },
        },
      },
    },
  });
}

function updateChart(data, now) {
  if (!depthChart) return;

  const ds = depthChart.data.datasets[0];
  ds.data.push({ x: now, y: data.waterCm });

  // Trim old points
  const cutoff = now - HISTORY_MINUTES * 60 * 1000;
  ds.data = ds.data.filter((pt) => pt.x >= cutoff);

  // Update x-axis range
  depthChart.options.scales.x.min = cutoff;
  depthChart.options.scales.x.max = now;

  // Update y-axis max if tank height changed
  depthChart.options.scales.y.max = Math.max(config.tankHeight + 2, CRITICAL_THRESHOLD + 3);

  depthChart.update('none');  // skip animation for perf
}

/** Re-populate chart from history (used after theme change) */
function repopulateChart() {
  if (!depthChart || !history.length) return;
  const ds = depthChart.data.datasets[0];
  ds.data = history.map((h) => ({ x: h.t, y: h.waterCm }));
  const now = Date.now();
  depthChart.options.scales.x.min = now - HISTORY_MINUTES * 60 * 1000;
  depthChart.options.scales.x.max = now;
  depthChart.update('none');
}

// ──────────────────────────────────────────────────────────────
// 15. DEMO MODE – Simulated data
// ──────────────────────────────────────────────────────────────
function generateDemoData() {
  // Sine wave cycling through all three states over ~60 seconds
  const t       = Date.now() / 1000;
  const cycle   = Math.sin((2 * Math.PI * t) / 60);     // -1 to 1
  const waterCm = 7.5 + 7.5 * cycle;                    // 0 to 15
  const clamped = clamp(waterCm, 0, config.tankHeight);
  const distance = config.tankHeight - clamped;
  const level    = Math.round((clamped / config.tankHeight) * 100);

  // Add a tiny bit of noise for realism
  const noise = (Math.random() - 0.5) * 0.3;
  const noisyWater = clamp(clamped + noise, 0, config.tankHeight);

  return {
    distance: parseFloat(Math.max(0, config.tankHeight - noisyWater).toFixed(1)),
    waterCm:  parseFloat(noisyWater.toFixed(1)),
    level:    clamp(Math.round((noisyWater / config.tankHeight) * 100), 0, 100),
    status:   deriveStatus(noisyWater),
  };
}

// ──────────────────────────────────────────────────────────────
// 16. UTILITY FUNCTIONS
// ──────────────────────────────────────────────────────────────
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
