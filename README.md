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