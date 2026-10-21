# 🌊 ESP32 Flood Detection Dashboard

A real-time web dashboard for monitoring water levels from an ESP32 + HC-SR04 ultrasonic sensor flood-detection system.

![Phase 1 – Front-end only](https://img.shields.io/badge/Phase-1-blue)
![No build step](https://img.shields.io/badge/Build-None-green)
![Plain HTML+CSS+JS](https://img.shields.io/badge/Stack-HTML%2BCSS%2BJS-orange)

---

## Features

- **Animated tank visualisation** – fill level, colour-coded by status (green / yellow / red)
- **Live readings** – water depth, sensor distance, fill percentage, last-updated time
- **10-minute history chart** with warning & critical threshold lines (Chart.js)
- **Event log** – timestamped status transitions (e.g. `12:03:11 NORMAL → WARNING`)
- **Connection monitoring** – goes OFFLINE after 3 failed polls, auto-recovers
- **Critical alerts** – flashing banner, Web Audio beep, browser notification
- **Settings panel** – configurable ESP32 IP, tank height, poll interval, demo mode
- **Dark / light mode** – auto-detects system preference, manual toggle
- **Responsive** – works on phone and laptop
- **Demo mode** – simulated data, no hardware needed
- **Mock server** – Python script simulating the ESP32 for full-stack testing

---

## File Structure

```
flood-dashboard/
├── index.html        # Dashboard page
├── style.css         # All styles (light/dark, responsive)
├── app.js            # Application logic (polling, chart, alerts)
├── mock-server.py    # Mock ESP32 + static file server (Python 3)
└── README.md         # This file
```

---

## Quick Start

### Option A: With the real ESP32

1. Connect your laptop / phone to the **same Wi-Fi hotspot** as the ESP32 (must be 2.4 GHz).
2. Open `index.html` directly in your browser (`file://` protocol works).
   - Or serve it locally:
     ```bash
     cd flood-dashboard
     python -m http.server 8000
     # Then open http://localhost:8000
     ```
3. Click ⚙️ **Settings** and enter the ESP32's IP address (default: `10.145.101.27`).
4. The dashboard starts polling immediately.

### Option B: With the mock server (no hardware)

```bash
cd flood-dashboard
python mock-server.py
```

Then open **http://localhost:8080** in your browser.

In the Settings panel, set the ESP32 IP to `localhost:8080`. The mock server simulates water rising and falling through all three states every 60 seconds.

### Option C: Demo mode (no server at all)

1. Open `index.html` in your browser.
2. Click ⚙️ **Settings** → check **Demo Mode** → **Save**.
3. The dashboard generates simulated data in-browser.

---

## Changing the ESP32 IP Address

The ESP32 gets its IP from DHCP, so it may change after a reboot.

1. Click the ⚙️ button in the top-right.
2. Enter the new IP (e.g. `192.168.43.55`).
3. Click **Save Settings**.
4. Settings are persisted in `localStorage`.

**Tip:** On Android, you can usually see connected device IPs in *Settings → Hotspot → Connected devices*.

---

## Configuration Constants

At the top of `app.js`, you can adjust:

| Constant             | Default | Description                            |
|----------------------|---------|----------------------------------------|
| `DEFAULT_ESP32_IP`   | `10.145.101.27` | Default IP on first load        |
| `DEFAULT_TANK_HEIGHT`| `15`    | Tank height in cm                      |
| `WARNING_THRESHOLD`  | `10`    | Water depth (cm) for WARNING status    |
| `CRITICAL_THRESHOLD` | `12`    | Water depth (cm) for CRITICAL status   |
| `DEFAULT_POLL_MS`    | `1000`  | Polling interval in ms                 |
| `MIN_POLL_MS`        | `500`   | Minimum allowed poll interval          |
| `REQUEST_TIMEOUT_MS` | `2000`  | Fetch timeout (AbortController)        |
| `OFFLINE_AFTER`      | `3`     | Consecutive failures before OFFLINE    |

---

## Troubleshooting

### Dashboard shows OFFLINE

| Cause | Fix |
|-------|-----|
| Wrong IP address | Open Settings and verify the ESP32 IP. Check your hotspot's connected-devices list. |
| ESP32 not powered or not connected to Wi-Fi | Check the ESP32's serial output or LED indicators. |
| Different networks | Both devices must be on the **same** Wi-Fi network / hotspot. |
| Firewall blocking | Ensure your OS firewall allows outbound HTTP on port 80. |

### Hotspot on 5 GHz

The ESP32 only supports **2.4 GHz** Wi-Fi. If your phone hotspot defaults to 5 GHz:

- **Android**: Settings → Hotspot → Band → select 2.4 GHz (or "Extend compatibility")
- **iPhone**: Settings → Personal Hotspot → "Maximize Compatibility" → ON

### Mixed-content error (HTTPS → HTTP blocked)

Browsers block `https://` pages from fetching `http://` resources. This dashboard uses plain HTTP.

**Do NOT deploy this to:** Netlify, Vercel, GitHub Pages, or any HTTPS-only host.

**Correct usage:**
- Open `index.html` as a **local file** (`file:///...`)
- Or serve via `python -m http.server 8000` → open `http://localhost:8000`
- Or use the mock server → `http://localhost:8080`

If you see `Mixed Content` or `net::ERR_BLOCKED_BY_CLIENT` in the console, you are loading the page over HTTPS. Switch to HTTP or file://.

### Chart not loading

Chart.js is loaded from a CDN (`cdn.jsdelivr.net`). If you have no internet:

1. Download Chart.js 4.4.4 manually:
   ```
   https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js
   ```
2. Save it as `chart.umd.min.js` in the `flood-dashboard/` folder.
3. Edit `index.html` line 8: change the `<script src="...">` to:
   ```html
   <script src="chart.umd.min.js"></script>
   ```

### Sound alerts not working

- You must **click the 🔇 button** at least once to enable sound (browser policy requires a user gesture to create an AudioContext).
- The button changes to 🔊 when sound is enabled.
- Beeps only play on CRITICAL status transitions.

---

## API Contract

The ESP32 exposes:

```
GET http://<ESP32_IP>/data
```

Response:
```json
{
  "distance": 4.9,
  "waterCm": 10.1,
  "level": 67,
  "status": "WARNING"
}
```

| Field      | Type    | Description                          |
|------------|---------|--------------------------------------|
| `distance` | float   | cm from sensor to water surface      |
| `waterCm`  | float   | water depth in cm                    |
| `level`    | integer | tank fill percentage (0–100)         |
| `status`   | string  | `"NORMAL"`, `"WARNING"`, `"CRITICAL"` |

CORS is enabled (`Access-Control-Allow-Origin: *`).

---

## Phase 2 (Not yet implemented)

A backend service for persistent history, Server-Sent Events, and Telegram alerts. Will be built after Phase 1 is validated with real hardware.

---

## License

MIT – use freely for your flood-detection project.
