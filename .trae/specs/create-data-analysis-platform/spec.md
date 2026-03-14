# Data Analysis Platform Spec

## Why
Currently, users need a unified platform to perform data analysis using natural language across multiple data sources (PostgreSQL, ClickHouse, MinIO, CSV). Existing solutions may lack the specific agentic capabilities, skill extensibility, or the desired user experience (WrenAI-like). Building this platform will democratize data access and analysis for non-technical users through LLM-powered SQL generation and agent-based workflows.

## What Changes
- **Directory Structure**:
    - `frontend/`: React application.
    - `backend/`: FastAPI application.
    - `nanobot/`: Existing nanobot source code (to be integrated/referenced by backend).
- **Backend Architecture**:
    - Implement a FastAPI server in `backend/` to handle API requests.
    - Integrate `nanobot` framework for agent management, session handling, and memory.
    - Implement connectors for PostgreSQL, ClickHouse, MinIO, and CSV file handling.
    - Implement NL2SQL logic using LLM.
    - Implement internal Skills management system.
    - Implement LLM Integration Module for custom model configuration.
- **Frontend Architecture**:
    - Create a React application in `frontend/`.
    - Implement a layout inspired by WrenAI (Sidebar for threads, Main chat area, Visualization pane).
    - **New**: Implement a dynamic Dashboard view with resizable/draggable panels (Grafana-like).
    - Implement a Skills management interface.
    - Implement an LLM Configuration interface (Settings page).
- **Agent System**:
    - Configure `nanobot` to support multiple agents.
    - Allow users to explicitly select skills for an agent to use.
    - Allow users to select which LLM model to use for the agent.

## Impact
- **Affected specs**: N/A (New Project)
- **Affected code**: `backend/`, `frontend/`, and integration with `nanobot`.

## ADDED Requirements

### Requirement: LLM Integration Module
The system SHALL:
- Allow users to configure multiple LLM providers (e.g., OpenAI, Anthropic, Custom/Local via OpenAI-compatible API).
- Allow users to set API Keys, Base URLs, and Model Names.
- Persist these configurations.
- Allow users to select which model/provider to use for the agent/NL2SQL tasks.

### Requirement: Data Source Connectivity
The system SHALL allow users to connect to:
- PostgreSQL databases.
- ClickHouse databases.
- MinIO object storage.
- Upload CSV files directly.

### Requirement: Natural Language to SQL (NL2SQL) & Visualization
The system SHALL:
- Accept natural language queries from users.
- Use an LLM to convert these queries into executable SQL.
- Execute the SQL and return results.
- Visualize the results (charts/tables).
- Provide a "View SQL" button for each chart/result to show the underlying SQL.
- Provide an "Add to Dashboard" button for each chart to pin it to a global Dashboard view.

### Requirement: Interactive Dashboard (Grafana-like)
The system SHALL:
- Provide a Dashboard view where pinned charts are displayed as panels.
- Allow users to resize and drag panels to customize the layout (Grid layout).
- Persist the dashboard layout.

### Requirement: Internal Skills Management
The system SHALL:
- Allow users to define custom skills (name, description, instructions/code).
- Store these skills in the system.
- Allow users to view, edit, and delete skills.
- Allow users to select specific skills to be active for a conversation or agent.

### Requirement: Multi-Agent Support
The system SHALL:
- Support multiple specialized agents (e.g., Data Analyst, SQL Generator).
- Use `nanobot` for orchestrating these agents.

### Requirement: User Interface (WrenAI Style)
The system SHALL:
- Have a sidebar for managing chat threads/history.
- Have a main chat interface.
- Have a dedicated area for displaying data visualizations.
- Have a "Dashboard" page/view with resizable panels.
- Have a "Skills" page/view to manage custom skills.
- Have a "Settings" page/view to manage LLM configurations.

## MODIFIED Requirements
N/A

## REMOVED Requirements
N/A
