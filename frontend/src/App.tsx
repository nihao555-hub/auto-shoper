import { useCallback, useEffect, useState } from "react";
import { getCapabilities } from "./api";
import { AppShell } from "./components/AppShell";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ToastStack } from "./components/ToastStack";
import { defaultSettings, sampleProducts } from "./data";
import { BatchesPage } from "./pages/BatchesPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import type {
  AppView,
  CapabilityResponse,
  ProductRecord,
  StoreSettings,
  ToastMessage,
} from "./types";

const getViewFromHash = (): AppView =>
  window.location.hash === "#/batches" ? "batches" : "workbench";

const loadSettings = (): StoreSettings => {
  const saved = window.localStorage.getItem("auto-shoper-settings");
  if (!saved) {
    return defaultSettings;
  }
  try {
    return { ...defaultSettings, ...(JSON.parse(saved) as Partial<StoreSettings>) };
  } catch {
    return defaultSettings;
  }
};

export default function App() {
  const [activeView, setActiveView] = useState<AppView>(getViewFromHash);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<StoreSettings>(loadSettings);
  const [products, setProducts] = useState<ProductRecord[]>(sampleProducts);
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const onHashChange = () => setActiveView(getViewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    getCapabilities()
      .then(setCapabilities)
      .catch(() =>
        setCapabilities({
          modules: {
            alibaba_listing: true,
            ai_images: true,
            sales_expert: false,
          },
          alibaba_credentials_configured: false,
        }),
      );
  }, []);

  const navigate = (view: AppView) => {
    window.location.hash = view === "batches" ? "#/batches" : "#/workbench";
    setActiveView(view);
  };

  const notify = useCallback((tone: ToastMessage["tone"], title: string, detail?: string) => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts((current) => [...current, { id, tone, title, detail }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((message) => message.id !== id));
    }, 5000);
  }, []);

  const saveSettings = (nextSettings: StoreSettings) => {
    setSettings(nextSettings);
    window.localStorage.setItem("auto-shoper-settings", JSON.stringify(nextSettings));
    setSettingsOpen(false);
    notify("success", "默认配置已保存", "新商品会自动带出允许复用的字段。");
  };

  return (
    <AppShell
      activeView={activeView}
      capabilities={capabilities}
      onNavigate={navigate}
      onOpenSettings={() => setSettingsOpen(true)}
    >
      {activeView === "workbench" ? (
        <WorkbenchPage
          capabilities={capabilities}
          products={products}
          settings={settings}
          onProductsChange={setProducts}
          onOpenSettings={() => setSettingsOpen(true)}
          onNavigateBatches={() => navigate("batches")}
          notify={notify}
        />
      ) : (
        <BatchesPage capabilities={capabilities} onNewBatch={() => navigate("workbench")} />
      )}
      <SettingsDrawer
        open={settingsOpen}
        capabilities={capabilities}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
      />
      <ToastStack
        messages={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((message) => message.id !== id))}
      />
    </AppShell>
  );
}
