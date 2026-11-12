# RoadWatch AI

Road damage reporting, AI pothole detection and repair tracking for Chennai.

- **Staff web app** — dashboard with a live map, case management, a repair workflow with photo verification, vehicles, analytics, teams and user management.
- **Citizen page** (`/report`) — anyone can upload a pothole photo and drop a pin on the map, then track the repair with a reference number.
- **AI detector** — a YOLOv8 model trained on pothole images checks every uploaded photo, draws boxes around the damage and suggests a severity.
- **Real roads** — road overlays follow OpenStreetMap centre-lines, and new reports snap to the nearest road.
- **Exports** — filtered case lists as CSV and a summary report as PDF.

---

## 1. Install (one time)

You need:

| Software | Version | Get it |
|---|---|---|
| Node.js | **24 LTS** (22.13 or newer works) | https://nodejs.org |
| Python | **3.11 or 3.12** (for the AI) | https://www.python.org/downloads/ — on Windows tick **“Add python.exe to PATH”** |

Then, with an internet connection:

**Windows:** double-click **`setup.bat`**

**macOS / Linux:** open a terminal in this folder and run `./setup.sh`

Setup takes 5–15 minutes the first time (the AI packages are large, about 1 GB). It:

1. installs the web app packages,
2. creates a Python environment in `detector/.venv` and installs the detector,
3. downloads the pretrained pothole model to `detector/models/pothole.pt` and tests it on `public/reference_pothole.jpg`,
4. downloads real road geometry for 24 Chennai roads from OpenStreetMap,
5. creates the database with demo data.

If a step fails (no Python, no internet), setup says so and the app still runs: without AI, photos are stored and can be analysed later, and without the road download the map uses drawn (dashed) road lines.

## 2. Run

**Windows:** double-click **`start.bat`**  ·  **macOS / Linux:** `./start.sh`

This starts the AI detector and the web server, then opens **http://localhost:8000** in your browser. Keep the window open; press **Ctrl+C** to stop.

| Page | Address |
|---|---|
| Staff app | http://localhost:8000 |
| Citizen report page | http://localhost:8000/report |

To open the citizen page **on your phone**, connect it to the same Wi-Fi and visit `http://<your-laptop-IP>:8000/report` (find the IP with `ipconfig` on Windows). Note: phones only share GPS location with `https://` or `localhost` pages, so on a phone, tap the map to place the pin.

## 3. Demo accounts

All use the password **`demo123`** (click an email on the sign-in screen to fill it in).

| Email | Role | What they can do |
|---|---|---|
| admin@roadwatch.demo | Administrator | Everything, including users, deleting cases and system settings |
| officer@roadwatch.demo | Municipal Officer | Create and edit cases, assign teams, verify repairs, manage teams and vehicles, export |
| team@roadwatch.demo | Repair Team (Velachery) | Update repairs on cases assigned to their team, with after-repair photos |
| auditor@roadwatch.demo | Read-Only Auditor | View everything, export CSV/PDF, change nothing |

Change these passwords (account menu → Change password) before showing the app to anyone outside your team.

## 4. A 3-minute demo script

1. Open **/report** and submit the pothole photo `public/reference_pothole.jpg` with a pin on Anna Salai. The AI draws boxes around the damage and returns a reference number such as `RW-1502`.
2. Sign in as the **officer**. The bell shows the new citizen report. Open it, check the AI result, and set the status to **Assigned → Velachery Road Maintenance**.
3. Sign in as **team**, tick **My team**, open the case, and use **Add repair update** with an after-repair photo → *Awaiting Verification*.
4. Sign in as the **officer** again and mark it **Resolved**. Go back to **/report → Track a report** with the reference number to show the citizen's view.
5. On **Analytics**, download the PDF report.

## 5. How the workflow works

```
Reported → Under Review → Confirmed → Assigned (team) → In Repair → Awaiting Verification → Resolved
                                                         ↘ Needs Rework ↗          (any time) → Rejected
```

- Each case gets a deadline from its severity: Critical 2 days, High 7, Medium 14, Low 30.
- **Resolved** is only allowed after a repair update with a photo (*Awaiting Verification*), so every closed case has evidence.
- Repair teams can only touch cases assigned to their own team.
- Everything is logged in the case history with who did it and when.

## 6. About the AI

- Model: `keremberke/yolov8n-pothole-segmentation` (YOLOv8 nano, segmentation, one class “pothole”), downloaded from Hugging Face during setup.
- The detector (`detector/app.py`) runs separately on `127.0.0.1:8001`; the web server sends it each uploaded photo.
- **Suggested severity** comes from how much of the photo the damage covers and how many regions are found (≥15% or 4+ regions → Critical, ≥6% or 3 → High, ≥2% → Medium, otherwise Low). It is a triage aid — officers confirm or change it.
- It detects potholes only. Cracks, manhole covers and other damage types are classified by the person reporting.
- Real-world size and depth can't be measured from one photo; enter measurements on site in **Edit details**.
- To use your own trained model, save it as `detector/models/pothole.pt` (any Ultralytics YOLO `.pt` file works).
- If the detector is off, the sidebar says **AI detector offline**. Photos are still saved; use **Run AI again** on the case later.

## 7. Demo data vs real data

The database starts with **1,500 synthetic cases** (marked *demo*) spread over the last 90 days so the dashboard and charts have something to show. Vehicle coverage figures are also synthetic.

- Hide them in the case list with **Hide demo data**.
- Remove them permanently: **User Management → System → Remove demo cases**.
- Start completely fresh: `npm run reset-db`, then start the app again. To start with no demo cases, create a `.env` file containing `SEED_DEMO=false` before starting.

## 8. Useful commands

| Command | What it does |
|---|---|
| `npm run start:all` | Same as start.bat / start.sh |
| `npm start` | Web server only (no AI) |
| `npm run fetch-roads` | Re-download OpenStreetMap road geometry |
| `npm run reset-db` | Delete the database and uploaded photos |
| `detector/.venv/Scripts/python detector/selftest.py` | Test the AI model (Windows path; on macOS/Linux use `.venv/bin/python`) |

Settings (port, upload size, etc.) can go in a `.env` file. See `.env.example`.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| “needs Node.js 22.13 or newer” | Install Node 24 LTS from nodejs.org, then run setup again |
| “Python not found” during setup | Install Python 3.12, tick *Add to PATH*, reopen the window, run setup again |
| AI packages fail to install | Use Python 3.11 or 3.12; delete `detector/.venv` and run setup again |
| Model download failed | Download `best.pt` from https://huggingface.co/keremberke/yolov8n-pothole-segmentation/tree/main and save it as `detector/models/pothole.pt` |
| Port 8000 already in use | Create `.env` with `PORT=8080` |
| Map shows no streets | The background map needs internet (OpenStreetMap tiles). Cases and road lines still show. |
| Road lines are dashed | Run `npm run fetch-roads` with internet, then **User Management → System → Reload road geometry** |

## 10. Project structure

```
server/            Express API (Node.js)
  index.js         server entry, security headers, static files
  db.js            SQLite (Node's built-in node:sqlite) and schema
  seed.js          demo data + road geometry refresh
  routes/          cases, stats/map, users/auth, teams/vehicles, reports, public
  lib/             auth, detector client, uploads, geometry, road snapping
detector/          Python FastAPI + Ultralytics YOLO pothole detector
public/            Frontend: index.html + app.js (staff), report.html + report.js (citizen)
scripts/           setup, start-all, fetch-roads, reset-db
data/              created at runtime: roadwatch.db, uploads/, roads.osm.json
```

## 11. Limitations

- Vehicle sources (buses, garbage trucks) are records you manage by hand. There is no live GPS or camera feed from vehicles.
- No email/SMS notifications; staff see alerts in the bell menu.
- No integration with government permit or contractor databases. Permit status is recorded manually.
- Built to run on one machine for demos and pilots. For a real deployment, put it behind HTTPS, set `JWT_SECRET`, and use managed hosting with backups.

Map data © OpenStreetMap contributors (ODbL). The pothole model is a community model trained on a public Roboflow pothole dataset; check its licence before any commercial use.
