# Tasks

- [x] Task 1: Project Initialization & Structure
    - [x] SubTask 1.1: Verify/Create `backend` and `frontend` directories.
    - [x] SubTask 1.2: Ensure `nanobot` source code is correctly placed/linked.
    - [x] SubTask 1.3: Set up FastAPI in `backend/` and React in `frontend/`.

- [x] Task 2: Backend - Core & Data Sources
    - [x] SubTask 2.1: Configure `nanobot` integration within FastAPI.
    - [x] SubTask 2.2: Implement PostgreSQL connector.
    - [x] SubTask 2.3: Implement ClickHouse connector.
    - [x] SubTask 2.4: Implement MinIO connector.
    - [x] SubTask 2.5: Implement CSV upload handling.

- [x] Task 3: Backend - Agent, Skills & LLM
    - [x] SubTask 3.1: Implement LLM Configuration API (CRUD for providers/models).
    - [x] SubTask 3.2: Implement NL2SQL agent logic using `nanobot` (using configured LLM).
    - [x] SubTask 3.3: Implement Internal Skills CRUD API.
    - [x] SubTask 3.4: Implement Skill Selection logic.

- [x] Task 4: Frontend - Core & UI Components
    - [x] SubTask 4.1: Setup React project with Tailwind/Shadcn.
    - [x] SubTask 4.2: Implement Sidebar (Threads/History).
    - [x] SubTask 4.3: Implement Main Chat Interface.
    - [x] SubTask 4.4: Implement Visualization Component (Charts/Tables).
    - [x] SubTask 4.5: Implement "View SQL" button and modal/popover.

- [x] Task 5: Frontend - Dashboard & Management
    - [x] SubTask 5.1: Implement Dashboard Page with Grid Layout (using `react-grid-layout` or similar).
    - [x] SubTask 5.2: Implement "Add to Dashboard" functionality (persist chart config to dashboard state).
    - [x] SubTask 5.3: Implement Skills Management UI (List/Edit).
    - [x] SubTask 5.4: Implement LLM Settings UI (Configure providers/keys).
    - [x] SubTask 5.5: Implement Skill Selection selector in Chat interface.

- [x] Task 6: Integration & Polish
    - [x] SubTask 6.1: Connect Frontend to Backend.
    - [x] SubTask 6.2: Test LLM Configuration (add provider -> use in chat).
    - [x] SubTask 6.3: Test NL2SQL flow with SQL view and Dashboard pinning.
    - [x] SubTask 6.4: Test Dashboard interactivity (resize/drag panels).
    - [x] SubTask 6.5: Test Skill creation and usage.
    - [x] SubTask 6.6: Verify multi-agent coordination.

# Task Dependencies
- Task 3 depends on Task 1 and Task 2.
- Task 4 depends on Task 1.
- Task 5 depends on Task 3 and Task 4.
- Task 6 depends on all previous tasks.
