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
- **📚 Smart Knowledge Base (RAG)**: Support uploading Word, PPT, PDF and other document formats. Enhance answers through vector retrieval, making your private documents "speak".
- **📈 Instant Visualizations**: Returns not just raw tables, but auto-generated interactive charts tailored to your data's shape.
- **🗂️ Multi-Source Ready**: Connects seamlessly to PostgreSQL, Supabase, and local CSV/Excel uploads.
- **🧠 Bring Your Own LLM**: Native integration with LiteLLM. Plug in OpenAI, DeepSeek, Zhipu, DashScope, Volcengine, or any compatible provider.
- **🛠️ Extensible Agent Skills**: Built on top of the powerful `nanobot` framework (a lightweight version of `OpenClaw`). Add custom tools and slash commands (`/`) to tailor the agent to your specific business logic.
- **📊 Customizable Dashboards**: Pin your favorite chat-generated charts to a drag-and-drop dashboard for quick access.
- **📦 Intelligent Artifact Management**: Automatically extracts generated files (HTML reports, PDFs, PPTs, images, etc.) from conversations, providing embedded previews and one-click downloads.

***

## 📸 Screenshots

<div align="left">
  <h3>💬 Chat Interface</h3>
  <img src="./docs/index.png" width="80%" />
  <br />
  <br />
  <h3>📊 Customizable Dashboard</h3>
  <img src="./docs/dashboard.png" width="80%" />
  <br />
  <br />
  <h3>📚 Smart Knowledge Base</h3>
  <img src="./docs/kb.png" width="80%" />
  <br />
  <br />
  <h3>📦 Artifact Preview</h3>
  <img src="./docs/artifact.png" width="80%" />
</div>

<br />

## 🏗️ Architecture

DataClaw is divided into three main claws (components):

1. **`frontend/`** 🎨: The shiny shell. Built with **React 19**, **Vite**, **TailwindCSS**, and **Zustand**. It features a chat-like interface, streaming AI responses, and interactive Vega charts.
2. **`backend/`** ⚙️: The muscle. A **FastAPI** application managing projects, data source connections, user sessions, and API gateways.
3. **`nanobot/`** 🧠: The brain. The core AI agent framework handling NL2SQL, schema caching, prompt injection, and LLM routing.
4. **`data/`** 🗄️: Runtime data root. Decoupled from code directories and used for uploads, sessions, workspace skills, reports, and cached configs.

***

## 🚀 Quick Start

Ready to dive in? Let's get DataClaw running on your local machine!

### 1. Configure Environment Variables 🔧

In the root directory of the project, copy and rename the environment template:

```bash
cp .env.example .env
```

Please edit the `.env` file in the root directory and fill in your actual configurations (e.g., QQ Mail SMTP Auth Code).

> **Guide to getting QQ Mail SMTP Auth Code:**
> 1. Log in to QQ Mail web version (mail.qq.com)
> 2. Click "Settings" (设置) at the top of the page -> "Account" (账号) tab
> 3. Scroll down to find the "POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV Service" section
> 4. Ensure "POP3/SMTP Service" is toggled to "On" (开启)
> 5. Click "Generate Authorization Code" (生成授权码) below it, scan the QR code with mobile QQ or send an SMS as prompted
> 6. After verification, you will get a **16-digit random letter combination**. Copy and paste it into the `SMTP_PASSWORD` field in your `.env` file

### 2. Standard Deployment (Recommended, No Node.js Required) 📦

Ensure you have Python 3.11+ installed. The pre-built React frontend is bundled in the Python wheel, so you don't need Node.js for production deployment.

#### Build the wheel (output to `dist/`)

```bash
# First, build the frontend
cd frontend
npm install
npm run build

# Then, build the backend wheel
cd ../backend
uv build --wheel --out-dir ../dist
```

Once built, the wheel is located in the project root `dist/` directory, e.g., `dist/dataclaw-0.1.0-py3-none-any.whl`.

#### Install and Run

```bash
# We recommend creating a virtual environment first
python -m venv .venv
source .venv/bin/activate

# Install DataClaw
pip install ./dist/dataclaw-*.whl

# Start the service (defaults to http://127.0.0.1:8000)
dataclaw start
```

Common service control commands:

```bash
# Check running status
dataclaw status

# Custom host/port
dataclaw start --host 0.0.0.0 --port 8000

# Stop the service
dataclaw stop
```

Optional environment variable:

```bash
export DATA_ROOT=/absolute/path/to/data
```

If not set, DataClaw uses the repository-level `data/` directory by default. Service state files and logs are located in `DATA_ROOT/run/`.

### 3. Development Mode (Requires Node.js) 🧪

If you want to debug the frontend code or rebuild the frontend artifacts, use the separate development mode:

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

```bash
cd frontend
# Install dependencies
npm install

# Start the Vite development server
npm run dev
```

*Note: Ensure your* *`nanobot`* *is properly linked or installed in editable mode as per the project workspace.*

### 4. Optional Voice Service 🎙️

If you want to use voice input in chat, run the standalone `whisper` service:

```bash
cd whisper
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Default service URL: `http://localhost:8001`  
Health endpoint: `GET /health`

Frontend setup:
1. Click the username in the bottom-left to open the user menu;
2. Open `Voice Input Settings`;
3. Fill in the service URL (e.g. `http://localhost:8001`);
4. Click `Test Connection`, then `Save`.

### 4. Initial Account Setup 👤
The first user to register in the system will automatically be granted admin privileges. You can simply click the "Register" button on the login page to create your admin account (e.g., Username: `admin`, Password: `admin`), and then log in to manage projects, data sources, and users.

***

## 🔌 Data Source Configuration Guide

DataClaw supports connecting to various types of data sources to meet different analysis needs. You can click **+** in the **Data Sources** menu to create and configure them. Here are detailed connection guides for common data sources:

<details>
<summary><b>▶ PostgreSQL (pgsql)</b></summary>

Connects to standard relational databases. You can either fill in the individual parameters through the form or paste a complete Connection String directly.

- **Host**: The host address of the database. If you are running the database on your local machine (e.g., using pgAdmin), please enter `127.0.0.1` (do not enter `localhost` to avoid Unix Socket resolution errors).
- **Port**: Typically defaults to `5432`.
- **Database**: The specific name of the database you want to connect to.
- **Username / Password**: Database authentication credentials (the default user is usually `postgres`).
- **Connection String (Optional)**: You can also directly input a string like `postgresql://postgres:your_password@127.0.0.1:5432/your_database_name`, which will override the individual input fields above.
</details>

<details>
<summary><b>▶ Supabase</b></summary>

A connection method specifically optimized for Supabase cloud PostgreSQL databases, enforcing SSL and using connection pools by default to improve stability.

- We recommend using the **Connection String** configuration directly:
  Go to your Supabase project console -> `Project Settings` -> `Database` -> `Connection string` -> Select the `URI` tab.
  Copy the link that looks like `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require` and paste it in.
- *Note*: Supabase enables Transaction Pooler by default (Port 6543). If you want a Direct connection, change the port to `5432` and ensure the URL includes `sslmode=require`.
</details>

<details>
<summary><b>▶ SQLite</b></summary>

A lightweight local file-based database, perfect for quick testing or analyzing single-machine application data.

- **File Upload**: You can directly click the button to upload a `.db`, `.sqlite`, or `.sqlite3` database file from your local machine. The file will be securely saved in the server's upload directory for analysis.
- **File Path (Advanced)**: If the service is deployed on a server and the SQLite file already exists at an absolute path on the server, you can also enter the absolute path directly in the input box (e.g., `/data/my_app.db`).
</details>

<details>
<summary><b>▶ CSV</b></summary>

The most common data exchange format, plug-and-play, no complex database configuration required.

- **File Upload**: Similar to SQLite, click the button to select and upload a local `.csv` file. The system will use engines like DuckDB or Pandas in the background to virtualize it into an SQL-queryable table.
- Once uploaded successfully, you can query this CSV file directly as if it were a database table in the chat interface!
</details>

***

## 🤝 Contributing

Got a cool idea? Found a bug? We'd love your help! Feel free to open an issue or submit a pull request. Let's make data analysis fun again!

***

## 💖 Acknowledgements

The development of DataClaw was deeply inspired by the following excellent open-source projects. Special thanks to:

- [WrenAI](https://github.com/Canner/WrenAI): A powerful Text-to-SQL solution whose architecture and concepts provided great inspiration.
- [Aix-DB](https://github.com/apconw/Aix-DB): Provided an excellent reference for intelligent data analysis and interactive user experience.

<br />
