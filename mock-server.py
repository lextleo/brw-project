#!/usr/bin/env python3
"""
Mock ESP32 server for testing the Flood Detection Dashboard.

Simulates a water level rising and falling through NORMAL → WARNING → CRITICAL
on a ~60-second sine-wave cycle.  Also serves the dashboard static files from
the current directory so you only need to run one server.

Usage:
    cd flood-dashboard
    python mock-server.py              # starts on port 8080
    python mock-server.py 3000         # custom port

Then open http://localhost:8080 in your browser and set the ESP32 IP to
"localhost:8080" in the Settings panel.
"""

import http.server
import json
import math
import random
import sys
import time

# ── Thresholds (must match app.js) ──────────────────────────
TANK_HEIGHT_CM     = 15
WARNING_THRESHOLD  = 10    # cm
CRITICAL_THRESHOLD = 12    # cm
CYCLE_SECONDS      = 60    # one full rise-and-fall cycle


class MockESP32Handler(http.server.SimpleHTTPRequestHandler):
    """
    Handles GET /data  → mock sensor JSON
    All other paths    → static files (dashboard)
    """

    def do_GET(self):
        # Match /data with or without query string
        if self.path == '/data' or self.path.startswith('/data?'):
            self._serve_sensor_data()
        else:
            # Serve static files (index.html, style.css, app.js, etc.)
            super().do_GET()

    def do_HEAD(self):
        if self.path == '/data' or self.path.startswith('/data?'):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
        else:
            super().do_HEAD()

    def _serve_sensor_data(self):
        t = time.time()

        # Sine wave: 0 → 15 → 0 over CYCLE_SECONDS
        cycle = math.sin(2 * math.pi * t / CYCLE_SECONDS)
        water_cm = 7.5 + 7.5 * cycle

        # Add a little noise for realism
        water_cm += random.uniform(-0.2, 0.2)
        water_cm = max(0.0, min(float(TANK_HEIGHT_CM), water_cm))

        distance = TANK_HEIGHT_CM - water_cm
        level = int(round((water_cm / TANK_HEIGHT_CM) * 100))
        level = max(0, min(100, level))

        if water_cm >= CRITICAL_THRESHOLD:
            status = "CRITICAL"
        elif water_cm >= WARNING_THRESHOLD:
            status = "WARNING"
        else:
            status = "NORMAL"

        payload = {
            "distance": round(distance, 1),
            "waterCm":  round(water_cm, 1),
            "level":    level,
            "status":   status,
        }

        body = json.dumps(payload).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        """Quieter logging – only show /data requests in cyan."""
        msg = fmt % args
        if "/data" in msg:
            print(f"\033[36m[mock] {msg}\033[0m")
        # Suppress noisy static-file logs


def main():
    port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"Usage: {sys.argv[0]} [PORT]")
            sys.exit(1)

    server = http.server.HTTPServer(("0.0.0.0", port), MockESP32Handler)
    print(f"╔══════════════════════════════════════════════════╗")
    print(f"║  Mock ESP32 + Dashboard Server                  ║")
    print(f"║  http://localhost:{port:<5}                        ║")
    print(f"║                                                  ║")
    print(f"║  Set ESP32 IP in Settings to: localhost:{port:<5}   ║")
    print(f"║  Water cycles through all states every {CYCLE_SECONDS}s       ║")
    print(f"║  Press Ctrl+C to stop                            ║")
    print(f"╚══════════════════════════════════════════════════╝")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down mock server.")
        server.server_close()


if __name__ == "__main__":
    main()
