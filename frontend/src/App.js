import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SpaceProvider, useSpace } from "@/context/SpaceContext";
import { Toaster } from "@/components/ui/sonner";
import Pairing from "@/pages/Pairing";
import AppShell from "@/components/AppShell";
import CalendarPage from "@/pages/CalendarPage";
import ChatPage from "@/pages/ChatPage";
import GalleryPage from "@/pages/GalleryPage";

function Protected({ children }) {
  const { code } = useSpace();
  if (!code) return <Navigate to="/" replace />;
  return children;
}

function Routed() {
  const { code } = useSpace();
  return (
    <Routes>
      <Route path="/" element={code ? <Navigate to="/calendar" replace /> : <Pairing />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  useEffect(() => {
    document.title = "We2gether";
  }, []);
  return (
    <SpaceProvider>
      <BrowserRouter>
        <Routed />
        <Toaster position="top-center" richColors />
      </BrowserRouter>
    </SpaceProvider>
  );
}

export default App;
