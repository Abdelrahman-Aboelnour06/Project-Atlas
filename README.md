# Atlas — Agentic Accessibility Layer

> Turn any website into a fully voice-driven, accessible experience with a single line of JavaScript.

---

## What Is Atlas?

Atlas embeds an AI agent directly into any website. Users speak a command — the agent reads the page, maps the intent, and performs the action on their behalf. No redesign required for the website owner.

```html
<script src="https://api.atlas-saas.com/v1/agent.js" apiKey="atlas_..."></script>
```

**Built for:** CU AI Nexus Hackathon — Inclusive AI & Accessibility Track

---

## Project Structure

```
atlas/
├── backend/                  # FastAPI server (Backend Team B)
│   ├── app/
│   │   ├── routes/           # REST + WebSocket endpoints
│   │   ├── agent/            # LLM client, prompt engine, action parser
│   │   ├── db/               # Database connection + queries
│   │   └── models/           # Pydantic models + DB schema
│   ├── tests/
│   ├── main.py               # FastAPI entrypoint
│   ├── requirements.txt
│   └── .env.example
│
├── client-script/            # Injectable JS snippet (Frontend Team)
│   ├── atlas.js              # Main snippet entry
│   ├── dom-serializer.js     # DOM → JSON map
│   ├── speech.js             # Web Speech API (STT + TTS)
│   ├── websocket-client.js   # WS connection handler
│   └── executor.js           # Action executor
│
├── dashboard/                # Next.js B2B portal (Frontend Team)
│   ├── pages/
│   ├── components/
│   ├── styles/
│   └── package.json
│
├── demo-site/                # Fake e-commerce site for demo (Frontend Team)
│   ├── index.html
│   ├── style.css
│   └── atlas-embedded.js     # Snippet embedded here
│
├── docs/
│   ├── contracts.md          # ← SHARED CONTRACTS (read this first)
│   └── setup.md              # Local dev setup guide
│
└── README.md
```

---

## Team Structure

| Team | Members | Owns |
|------|---------|------|
| **Backend A** | 💪 Strong · 💪 Strong · 🔹 Weak | `/backend/db`, `/backend/app/models`, REST endpoints |
| **Backend B** | 💪 Strong · 💪 Strong · 🔹 Weak | `/backend/app/agent`, `/backend/app/routes`, WebSocket |
| **Frontend** | 💪 Strong · 🔹 Weak · 🔹 Weak | `/client-script`, `/dashboard`, `/demo-site` |

---

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # fill in your values
uvicorn main:app --reload
```

### Dashboard
```bash
cd dashboard
npm install
npm run dev
```

### Demo Site
Open `demo-site/index.html` in a browser directly — no server needed.

---

## Environment Variables

Create `backend/.env` from `.env.example`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/atlas
LLM_API_KEY=your_llm_api_key
LLM_MODEL=llama3
SECRET_KEY=your_secret_key
```

---

## Key Docs

- [`/docs/contracts.md`](./docs/contracts.md) — WebSocket schema, action format, DOM map spec ← **Read before coding**
- [`/docs/setup.md`](./docs/setup.md) — Full local dev setup

---

## MVP Checklist

- [ ] Snippet embedded on demo site activates Atlas widget
- [ ] Voice command → correct element clicked, zero manual interaction
- [ ] Dashboard shows API key and session count
- [ ] No PII appears in backend logs
- [ ] Backend handles ≥ 2 concurrent WebSocket sessions
