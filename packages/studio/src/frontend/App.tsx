import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import Dashboard from "./pages/Dashboard";
import AgentList from "./pages/AgentList";
import AgentDetail from "./pages/AgentDetail";
import GraphList from "./pages/GraphList";
import GraphDetail from "./pages/GraphDetail";
import { SessionList } from "./pages/SessionList";
import { SessionDetail } from "./pages/SessionDetail";
import Chat from "./pages/Chat";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="agents" element={<AgentList />} />
          <Route path="agents/:name" element={<AgentDetail />} />
          <Route path="graphs" element={<GraphList />} />
          <Route path="graphs/:id" element={<GraphDetail />} />
          <Route path="sessions" element={<SessionList />} />
          <Route path="sessions/:id" element={<SessionDetail />} />
          <Route path="chat" element={<Chat />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
