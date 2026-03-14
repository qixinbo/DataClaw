import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { ChatInterface } from "./components/ChatInterface";
import { Dashboard } from "./pages/Dashboard";
import { Skills } from "./pages/Skills";
import { Settings } from "./pages/Settings";

function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden h-screen relative">
          <Routes>
            <Route path="/" element={
              <div className="h-full overflow-hidden bg-white">
                <ChatInterface />
              </div>
            } />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
