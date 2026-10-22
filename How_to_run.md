  ### 📋 Prerequisites

  Before starting, make sure you have:

  1. Python 3.11+ installed (python3 --version).
  2. Docker installed & running (for PostgreSQL, or have a local PostgreSQL instance on port 5432).
  3. A Chromium browser (Google Chrome, Brave, Edge, etc.).
  ──────
  ### 🚀 Option 1: 1-Command Quick Start (Recommended)

  From the project root directory, run:

    ./run_atlas.sh

  #### What this script does automatically:

  1. Starts the PostgreSQL container (atlas-pg) on port 5432.
  2. Activates the Python virtual environment and checks all dependencies.
  3. Applies database migrations (001_init.sql, 003_security_events.sql).
  4. Seeds the demo tenant and API key: atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.
  5. Starts the Backend API at http://localhost:8000 http://localhost:8000 (Swagger docs at /docs http://localhost:8000/docs).
  6. Starts the Demo Site at http://localhost:5500 http://localhost:5500.

  │ To stop everything later:
  │
  │   ./run_atlas.sh stop
  ──────
  ### 🧩 Step 2: Load the Chrome Extension

  Because browser extensions cannot be installed purely via CLI, load it once into your browser:

  1. Open your browser and navigate to:
      • Chrome: chrome://extensions
      • Brave: brave://extensions
      • Edge: edge://extensions
  2. Enable Developer mode (toggle in the top-right corner).
  3. Click "Load unpacked" (top-left).
  4. Select the client-script folder from this repository:
    /media/abdelrahman-abdelrahman/Acer/Users/abdel/OneDrive/Desktop/Hackthon/shit2/client-script

  5. You will see "Atlas — AI Web Accessibility Agent" in your extensions list.
  ──────
  ### ⚙ Step 3: Configure the Extension (First-Run Wizard)

  1. Open the demo site at:
    http://localhost:5500

  2. Click the Atlas extension icon in your browser toolbar (pin it for easy access), or right-click the extension → Options.
  3. The 3-Step Setup Wizard will appear:
      • Step 1 (Backend URL): Leave as http://localhost:8000 and click "Test Connection" (verifies green ✓ Connected).
      • Step 2 (API Key): Paste the pre-seeded demo key:
        atlas_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
      Click "Validate Key" (verifies green ✓ Key Validated).
      • Step 3 (Finish): Click "Complete Setup".

  ──────
  ### 🎯 Step 4: Use Atlas on Any Website

  1. Go to any webpage (e.g. http://localhost:5500/healthcare-intake.html http://localhost:5500/healthcare-intake.html, http://localhost:5500/checkout.html http://localhost:5500/checkout.
  html, Wikipedia, or any real website).
  2. Press Alt+A (or click the floating Atlas notch on the right edge) to open the sidebar.
  3. Features you can try:
      • Simplified Navigation: Atlas highlights and numbers all interactive elements.
      • Voice Input: Click the mic or press Alt+V (supports English & Arabic auto-detection).
      • Multi-step Goals: Type Fill out intake form or Order medical supplies and watch the real-time milestone progress bar.
      • Stop Control: Click the red Stop button at any time to instantly cancel execution.

  ──────
  ### 🛠 Optional: Manual Multi-Terminal Startup

  If you prefer running components in separate terminals instead of run_atlas.sh:

  #### Terminal 1 — Database

    docker run --name atlas-pg -e POSTGRES_USER=atlas -e POSTGRES_PASSWORD=atlas -e POSTGRES_DB=atlas_db -p 5432:5432 -d postgres:16

  #### Terminal 2 — Backend Server

    cd backend
    source venv_linux/bin/activate
    # Apply migrations & seed (only needed on first run)
    docker exec -i atlas-pg psql -U atlas -d atlas_db < app/migrations/001_init.sql
    docker exec -i atlas-pg psql -U atlas -d atlas_db < app/migrations/003_security_events.sql
    python -m app.migrations.seed

    # Start backend
    uvicorn app.main:app --port 8000 --reload

  #### Terminal 3 — Demo Site

    cd demo-site
    python3 -m http.server 5500
  ──────
  ### 🧪 Running Tests & Verification

  To verify that all 1,516+ tests pass on your machine:

    # 1. Full CI Gatekeeper verification across all 67 test files
    python3 ci/verify_all_tests_run.py

    # 2. Automated axe-core accessibility audit across 19 operational states
    node ci/e2e/a11y_axe.js

    # 3. Production extension packager
    ./package_extension.sh
