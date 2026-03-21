[🇨🇳 简体中文](./README.md) | [🇬🇧 English](./README_en.md)

# 🦞 DataClaw

> **Unleash the claws on your data, making analysis as easy and refreshing as raising lobsters!** 🌊📊
> DataClaw is your intelligent, AI-powered Data Analysis Platform. Chat with your data, visualize insights instantly, and build dashboards—all through natural language. No SQL degree required!

***

## ✨ Why DataClaw?

Tired of writing complex SQL queries just to get a simple bar chart? DataClaw acts as your personal data scientist. Powered by advanced LLMs and an intelligent agentic workflow, it translates your questions into database queries, fetches the data, and renders beautiful visualizations on the fly.

Whether you're querying a massive Supabase/PostgreSQL database or just tossing in a CSV file, DataClaw's got you covered! 🚀

## 🌟 Key Features

- **🗣️ Chat to SQL**: Ask questions in plain English (or Chinese!). DataClaw understands your schema, generates accurate SQL, and self-corrects if things go sideways.
- **📈 Instant Visualizations**: Returns not just raw tables, but auto-generated interactive charts tailored to your data's shape.
- **🗂️ Multi-Source Ready**: Connects seamlessly to PostgreSQL, Supabase, and local CSV/Excel uploads.
- **🧠 Bring Your Own LLM**: Native integration with LiteLLM. Plug in OpenAI, DeepSeek, Zhipu, DashScope, Volcengine, or any compatible provider.
- **🛠️ Extensible Agent Skills**: Built on top of the powerful `nanobot` framework (a lightweight version of `OpenClaw`). Add custom tools and slash commands (`/`) to tailor the agent to your specific business logic.
- **📊 Customizable Dashboards**: Pin your favorite chat-generated charts to a drag-and-drop dashboard for quick access.

<br />

<div align="center">
  <img src="./examples/index.png" width="48%" />
  <img src="./examples/dashboard.png" width="48%" />
</div>

<br />

## 🏗️ Architecture

DataClaw is divided into three main claws (components):

1. **`frontend/`** 🎨: The shiny shell. Built with **React 19**, **Vite**, **TailwindCSS**, and **Zustand**. It features a chat-like interface, streaming AI responses, and interactive Vega charts.
2. **`backend/`** ⚙️: The muscle. A **FastAPI** application managing projects, data source connections, user sessions, and API gateways.
3. **`nanobot/`** 🧠: The brain. The core AI agent framework handling NL2SQL, schema caching, prompt injection, and LLM routing.

***

## 🚀 Quick Start

Ready to dive in? Let's get DataClaw running on your local machine!

### 1. Backend Setup 🐍

Ensure you have Python 3.10+ installed.

```bash
cd backend
# Create a virtual environment (optional but recommended)
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the FastAPI server
uvicorn app.main:app --reload --port 8000
```

*Note: Ensure your* *`nanobot`* *is properly linked or installed in editable mode as per the project workspace.*

### 2. Frontend Setup ⚛️

Ensure you have Node.js 18+ installed.

```bash
cd frontend
# Install dependencies
npm install

# Start the Vite development server
npm run dev
```

Open your browser and navigate to `http://localhost:5173`. Boom! 🎉 You're ready to chat with your data.

***

## 🤝 Contributing

Got a cool idea? Found a bug? We'd love your help! Feel free to open an issue or submit a pull request. Let's make data analysis fun again!

***

## 💖 Acknowledgements

The development of DataClaw was deeply inspired by the following excellent open-source projects. Special thanks to:

- [WrenAI](https://github.com/Canner/WrenAI): A powerful Text-to-SQL solution whose architecture and concepts provided great inspiration.
- [Aix-DB](https://github.com/aix-db/Aix-DB): Provided an excellent reference for intelligent data analysis and interactive user experience.

<br />

