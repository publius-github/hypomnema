import { useEffect } from "react";
import { useAppStore } from "./store";
import TabBar from "./components/TabBar";
import VaultPicker from "./components/VaultPicker";
import Dashboard from "./sections/Dashboard";
import Upcoming from "./sections/Upcoming";
import Journal from "./sections/Journal";
import KnowledgeBase from "./sections/KnowledgeBase";
import Settings from "./sections/Settings";

export default function App() {
  const { loaded, vaultPath, section, error, init, clearError } =
    useAppStore();

  useEffect(() => {
    void init();
  }, [init]);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-content-muted">
        Loading...
      </div>
    );
  }

  if (!vaultPath) {
    return <VaultPicker />;
  }

  return (
    <div className="flex h-full">
      <TabBar />
      <main className="min-w-0 flex-1 overflow-auto">
        {error && (
          <div className="flex items-center justify-between bg-red-600/90 px-4 py-2 text-sm text-white">
            <span>{error}</span>
            <button className="font-semibold" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        {section === "dashboard" && <Dashboard />}
        {section === "upcoming" && <Upcoming />}
        {section === "journal" && <Journal />}
        {section === "kb" && <KnowledgeBase />}
        {section === "settings" && <Settings />}
      </main>
    </div>
  );
}
