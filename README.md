[🇨🇳 简体中文](./README.md) | [🇬🇧 English](./README_en.md)

# 🦞 龙虾问数 (DataClaw)

> **释放你的数据潜能，让分析像养龙虾一样简单爽快！** 🌊📊
> 龙虾问数 (DataClaw) 是一个智能的、AI 驱动的数据分析平台。通过自然语言与你的数据对话，瞬间生成可视化图表，轻松搭建仪表盘——从此告别繁琐的 SQL 语句！

***

## ✨ 为什么选择龙虾问数？

受够了为了画个简单的柱状图而写半天复杂的 SQL 语句吗？龙虾问数就是你的私人数据科学家。借助强大的大语言模型 (LLM) 和智能 Agent 工作流，它能将你的自然语言提问精准转化为数据库查询，提取数据，并即时渲染出美观的可视化图表。

无论你是要查询庞大的 Supabase/PostgreSQL 数据库，还是随手丢进一个 CSV 文件，龙虾问数都能轻松拿捏！🚀

## 🌟 核心特性

- **🗣️ 自然语言转 SQL**: 用大白话提问！它能理解你的数据表结构，生成准确的 SQL，甚至在报错时进行自我纠正 (Self-correction)。
- **📈 即时数据可视化**: 拒绝枯燥的生肉表格，根据数据特征自动生成交互式图表。
- **🗂️ 动态多数据源**: 无缝连接 PostgreSQL、Supabase，以及本地 CSV/Excel 文件上传解析。
- **🧠 灵活的模型接入**: 原生集成 LiteLLM，支持随插随用 OpenAI、DeepSeek、智谱、通义千问 (DashScope)、火山引擎或任何兼容的 LLM 提供商。
- **🛠️ 强大的 Agent 技能拓展**: 基于核心 `nanobot`框架（`OpenClaw`的精简版）构建。支持通过斜杠命令 (`/`) 快速调用自定义工具 (Skills)，完美贴合特定业务逻辑。
- **📊 可定制仪表盘 (Dashboard)**: 一键将对话中生成的图表固定到看板，拖拽布局，随时查看核心指标。
- **📦 智能产物管理 (Artifact)**: 自动提取对话中生成的各种文件（网页报告、PDF、PPT、图片等），提供一键内嵌预览与下载功能，让成果触手可及。

***

## 📸 界面预览

<div align="center">
  <h3>对话式分析界面</h3>
  <img src="./examples/index.png" width="80%" />
  <br />
  <br />
  <h3>可定制仪表盘</h3>
  <img src="./examples/dashboard.png" width="80%" />
  <br />
  <br />
  <h3>智能产物预览 (Artifact)</h3>
  <img src="./examples/artifact.png" width="80%" />
</div>

<br />

## 🏗️ 项目架构

DataClaw 的架构主要分为三只“大钳子”：

1. **`frontend/`** 🎨: 闪亮的外壳。基于 **React 19**、**Vite**、**TailwindCSS** 和 **Zustand** 构建。拥有类似微信/ChatGPT的对话界面、支持流式思考过程渲染以及交互式图表展示。
2. **`backend/`** ⚙️: 强健的肌肉。一个 **FastAPI** 后端服务，负责管理项目、数据源连接、用户会话持久化以及作为 API 网关。
3. **`nanobot/`** 🧠: 智慧的大脑。核心的 AI Agent 框架，负责处理意图路由、NL2SQL 转换、Schema 缓存管理以及与 LLM 的底层交互。
4. **`data/`** 🗄️: 运行时数据目录。与代码目录解耦，存放上传文件、会话、技能工作区、报告与配置缓存。

***

## 🚀 快速开始

准备好大显身手了吗？让我们把龙虾问数在你的本地跑起来！

### 1. 后端服务启动 🐍

请确保你已安装 Python 3.10 或以上版本。

```bash
cd backend
# 创建虚拟环境（可选但强烈建议）
python -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动 FastAPI 服务器
uvicorn app.main:app --reload --port 8000
```

可选环境变量：

```bash
export DATA_ROOT=/absolute/path/to/data
```

若未设置，默认使用仓库根目录下的 `data/`。

*提示：请确保* *`nanobot`* *核心库已根据项目工作区的要求正确链接或以可编辑模式 (editable mode) 安装。*

### 2. 前端服务启动 ⚛️

请确保你已安装 Node.js 18 或以上版本。

```bash
cd frontend
# 安装依赖
npm install

# 启动 Vite 开发服务器
npm run dev
```


### 3. 语音识别服务（可选）🎙️

若你希望使用聊天输入框中的语音输入能力，请单独启动 `whisper` 服务：

```bash
cd whisper
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

默认服务地址：`http://localhost:8001`  
健康检查接口：`GET /health`

前端配置方式：
1. 点击左下角用户名，打开菜单；
2. 进入「语音输入配置」；
3. 填写服务地址（例如 `http://localhost:8001`）；
4. 点击「测试连接」通过后保存。

### 4. 初始账号配置 👤
系统首次注册的用户将自动成为管理员。您可以在登录页面直接点击“注册”按钮创建您的管理员账号（例如：用户名 `admin`，密码 `admin`），随后即可登录并管理项目、数据源和用户。

***

## 🔌 数据源配置说明

DataClaw 支持连接多种类型的数据源，以满足不同场景的分析需求。你可以在界面的 **Data Sources** 菜单中点击 **+** 新建并配置它们。以下是常见数据源的详细接入指南：

<details>
<summary><b>▶ PostgreSQL (pgsql)</b></summary>

连接标准的关系型数据库。你既可以通过表单填充分散的参数，也可以直接粘贴完整的 Connection String。

- **Host**: 数据库的主机地址。如果你是在本地电脑运行了数据库（如使用 pgAdmin），请填入 `127.0.0.1`（不要填 `localhost`，以避免 Unix Socket 解析错误）。
- **Port**: 默认一般为 `5432`。
- **Database**: 你要连接的具体数据库名称。
- **Username / Password**: 数据库的认证凭据（默认用户通常是 `postgres`）。
- **Connection String (可选)**: 也可以直接输入类似 `postgresql://postgres:你的密码@127.0.0.1:5432/你的数据库名` 的字符串，它将覆盖上述单独的输入框配置。
</details>

<details>
<summary><b>▶ Supabase</b></summary>

专门针对 Supabase 云端 PostgreSQL 数据库优化的连接方式，强制开启 SSL 且默认使用连接池以提高稳定性。

- 推荐直接使用 **Connection String** 配置：
  进入你的 Supabase 项目控制台 -> `Project Settings` -> `Database` -> `Connection string` -> 选择 `URI` 选项卡。
  复制那串类似 `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require` 的链接并填入。
- *注意*: Supabase 默认开启了 Transaction Pooler（端口 6543）。如果想要直连（Direct connection），请将端口改为 `5432`，并确保 URL 中包含 `sslmode=require`。
</details>

<details>
<summary><b>▶ SQLite</b></summary>

轻量级的本地文件型数据库，非常适合快速测试或分析单机应用数据。

- **File Upload**: 你可以直接点击按钮，从本地上传 `.db`、`.sqlite` 或 `.sqlite3` 后缀的数据库文件。文件会被安全地保存在服务端的上传目录中供分析使用。
- **File Path (进阶)**: 如果服务部署在服务器上，且 SQLite 文件已存在于服务器的某个绝对路径中，你也可以直接在输入框中填入该文件的绝对路径（如 `/data/my_app.db`）。
</details>

<details>
<summary><b>▶ CSV</b></summary>

最常见的数据交换格式，即插即用，无需复杂的数据库配置。

- **File Upload**: 与 SQLite 类似，点击按钮选择本地的 `.csv` 文件上传即可。系统会在后台利用 DuckDB 或 Pandas 等引擎将其虚拟化为一个可供 SQL 查询的表。
- 上传成功后，在对话界面中，你可以直接把这个 CSV 文件当作一张数据库表来“提问”！
</details>

***

## 🤝 参与贡献

有个好点子？发现了一个 Bug？非常欢迎你的加入！随时可以提交 Issue 或 Pull Request。让我们一起让数据分析变得更加有趣！

***

## 💖 特别鸣谢

DataClaw 的开发深受以下优秀开源项目的启发，特此致谢：

- [WrenAI](https://github.com/Canner/WrenAI): 强大的 Text-to-SQL 解决方案，其架构和思路给了我们很大的启发。
- [Aix-DB](https://github.com/apconw/Aix-DB): 在智能数据分析和交互式体验方面提供了极好的参考。

<br />
