[🇨🇳 简体中文](./README_zh.md) | [🇬🇧 English](./README.md)

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

<br />

<div align="center">
  <img src="./examples/index.png" width="48%" />
  <img src="./examples/dashboard.png" width="48%" />
</div>

<br />

## 🏗️ 项目架构

DataClaw 的架构主要分为三只“大钳子”：

1. **`frontend/`** 🎨: 闪亮的外壳。基于 **React 19**、**Vite**、**TailwindCSS** 和 **Zustand** 构建。拥有类似微信/ChatGPT的对话界面、支持流式思考过程渲染以及交互式图表展示。
2. **`backend/`** ⚙️: 强健的肌肉。一个 **FastAPI** 后端服务，负责管理项目、数据源连接、用户会话持久化以及作为 API 网关。
3. **`nanobot/`** 🧠: 智慧的大脑。核心的 AI Agent 框架，负责处理意图路由、NL2SQL 转换、Schema 缓存管理以及与 LLM 的底层交互。

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

打开浏览器并访问 `http://localhost:5173`。搞定！🎉 你现在可以开始和你的数据愉快的聊天了。

***

## 🤝 参与贡献

有个好点子？发现了一个 Bug？非常欢迎你的加入！随时可以提交 Issue 或 Pull Request。让我们一起让数据分析变得更加有趣！
