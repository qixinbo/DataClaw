import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { ProjectSwitcher } from "./components/ProjectSwitcher";
import { ChatInterface } from "./components/ChatInterface";
import { Dashboard } from "./pages/Dashboard";
import { Skills } from "./pages/Skills";
import { Settings } from "./pages/Settings";
import { Users } from "./pages/Users";
import { Projects } from "./pages/Projects";
import { Login } from "./pages/Login";
import { ModelConfigs } from "./pages/ModelConfigs";
import { EmbeddingModels } from "./pages/EmbeddingModels";
import { KnowledgeBases } from "./pages/KnowledgeBases";
import { DataSources } from "./pages/DataSources";
import { Modeling } from "./pages/Modeling";
import { Subagents } from "./pages/Subagents";
import { VerifyEmail } from "./pages/VerifyEmail";
import { useAuthStore } from "./store/authStore";

import { ThemeToggle } from "./components/ThemeToggle";

// Protected Route Component
function ProtectedRoute({ children, requireAdmin = false }: { children: React.ReactNode, requireAdmin?: boolean }) {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && !user?.is_admin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden h-screen">
        <div className="h-14 shrink-0 flex items-center justify-between z-30 px-4">
          <div className="flex-1">
            {/* Left side empty for balance */}
          </div>
          <div className="flex-1 flex justify-center">
            <ProjectSwitcher />
          </div>
          <div className="flex-1 flex justify-end">
            <ThemeToggle />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {children}
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        
        {/* Protected Routes */}
        <Route path="/" element={
          <ProtectedRoute>
            <MainLayout>
              <div className="h-full overflow-hidden bg-background">
                <ChatInterface />
              </div>
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <MainLayout>
              <Dashboard />
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="/skills" element={
          <ProtectedRoute>
            <MainLayout>
              <Skills />
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="/settings" element={
          <ProtectedRoute>
            <MainLayout>
              <Settings />
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="/projects" element={
          <ProtectedRoute>
            <MainLayout>
              <Projects />
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="/projects/:projectId/subagents" element={
          <ProtectedRoute>
            <MainLayout>
              <Subagents />
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="/users" element={
          <ProtectedRoute requireAdmin={true}>
            <MainLayout>
              <Users />
            </MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/model-configs" element={
          <ProtectedRoute>
            <MainLayout>
              <ModelConfigs />
            </MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/embedding-models" element={
          <ProtectedRoute>
            <MainLayout>
              <EmbeddingModels />
            </MainLayout>
          </ProtectedRoute>
        } />

        <Route path="/knowledge-bases" element={
          <ProtectedRoute>
            <MainLayout>
              <KnowledgeBases />
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="/datasources" element={
          <ProtectedRoute requireAdmin={true}>
            <MainLayout>
              <DataSources />
            </MainLayout>
          </ProtectedRoute>
        } />
        
        <Route path="/modeling/:id" element={
          <ProtectedRoute requireAdmin={true}>
            <MainLayout>
              <Modeling />
            </MainLayout>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
