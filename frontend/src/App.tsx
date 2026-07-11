import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getCapabilities, startAlibabaOAuth } from "./api";
import { AppShell } from "./components/AppShell";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ToastStack } from "./components/ToastStack";
import { defaultSettings, sampleBatches, sampleProducts } from "./data";
import { BatchesPage } from "./pages/BatchesPage";
import { OverviewPage } from "./pages/OverviewPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import type {
  AppView,
  BatchRecord,
  CapabilityResponse,
  DataMode,
  ProductRecord,
  StoreSettings,
  ToastMessage,
} from "./types";

const getViewFromHash = (): AppView => {
  if (window.location.hash === "#/workbench") {
    return "workbench";
  }
  if (window.location.hash === "#/batches") {
    return "batches";
  }
  return "overview";
};

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

const cloneDemoProducts = () =>
  sampleProducts.map((product) => ({
    ...product,
    facts: { ...product.facts, certifications: [...product.facts.certifications] },
    keywords: [...product.keywords],
    sellingPoints: [...product.sellingPoints],
    visibleTraits: [...product.visibleTraits],
    errors: [...product.errors],
  }));

const formatTimestamp = () =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

const buildLiveBatch = (products: ProductRecord[], batchId: string): BatchRecord | null => {
  if (!products.length) {
    return null;
  }
  const drafted = products.filter(
    (product) => product.stage === "drafted" || product.stage === "published",
  ).length;
  const published = products.filter((product) => product.stage === "published").length;
  const failed = products.some((product) => product.stage === "error");
  const status: BatchRecord["status"] = failed
    ? "failed"
    : published === products.length
      ? "complete"
      : drafted === products.length
        ? "ready"
        : "processing";
  return {
    id: batchId,
    name: products[0]?.title || "新商品批次",
    createdAt: formatTimestamp(),
    updatedAt: "刚刚",
    productCount: products.length,
    completion: Math.round(
      products.reduce((total, product) => {
        if (product.stage === "published") return total + 100;
        if (product.stage === "drafted") return total + 82;
        if (product.stage === "ready") return total + 64;
        if (product.aiConfirmed) return total + 46;
        return total + 18;
      }, 0) / products.length,
    ),
    draftCount: drafted,
    publishedCount: published,
    reviewStatus: failed ? "failed" : published ? "passed" : "pending",
    reviewLabel: failed ? "需要处理" : published ? "已通过" : "等待发布",
    status,
    images: products.slice(0, 3).map((product) => product.imageUrl),
  };
};

export default function App() {
  const [activeView, setActiveView] = useState<AppView>(getViewFromHash);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<StoreSettings>(loadSettings);
  const [dataMode, setDataMode] = useState<DataMode>("live");
  const [liveProducts, setLiveProducts] = useState<ProductRecord[]>([]);
  const [demoProducts, setDemoProducts] = useState<ProductRecord[]>(cloneDemoProducts);
  const [batchId] = useState(
    () => `B${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-001`,
  );
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const products = dataMode === "demo" ? demoProducts : liveProducts;
  const liveBatch = useMemo(() => buildLiveBatch(liveProducts, batchId), [liveProducts, batchId]);
  const batches = dataMode === "demo" ? sampleBatches : liveBatch ? [liveBatch] : [];

  useEffect(() => {
    const onHashChange = () => setActiveView(getViewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    getCapabilities()
      .then((response) => {
        setCapabilities(response);
        setBackendConnected(true);
      })
      .catch(() => {
        setCapabilities(null);
        setBackendConnected(false);
      });
  }, []);

  const navigate = (view: AppView) => {
    window.location.hash = view === "overview" ? "#/overview" : `#/${view}`;
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

  const authorizeAlibaba = async () => {
    try {
      const response = await startAlibabaOAuth();
      window.location.assign(response.authorization_url);
    } catch (error) {
      notify(
        "error",
        "无法开始店铺授权",
        error instanceof ApiError ? error.message : "请检查后端服务和 OAuth 配置。",
      );
    }
  };

  const changeDataMode = (mode: DataMode) => {
    setDataMode(mode);
    if (mode === "demo" && demoProducts.length === 0) {
      setDemoProducts(cloneDemoProducts());
    }
    notify(
      "info",
      mode === "demo" ? "已进入演示空间" : "已切回真实工作区",
      mode === "demo" ? "演示操作不会调用真实 Alibaba 账户。" : "示例数据已隐藏。",
    );
  };

  const updateProducts = (nextProducts: ProductRecord[]) => {
    if (dataMode === "demo" && nextProducts.some((product) => !product.isDemo)) {
      setLiveProducts(nextProducts.filter((product) => !product.isDemo));
      setDataMode("live");
    } else if (dataMode === "demo") {
      setDemoProducts(nextProducts);
    } else {
      setLiveProducts(nextProducts);
    }
  };

  return (
    <AppShell
      activeView={activeView}
      backendConnected={backendConnected}
      dataMode={dataMode}
      onDataModeChange={changeDataMode}
      onNavigate={navigate}
      onOpenSettings={() => setSettingsOpen(true)}
    >
      {activeView === "overview" ? (
        <OverviewPage
          batches={batches}
          products={products}
          capabilities={capabilities}
          backendConnected={backendConnected}
          dataMode={dataMode}
          onNavigateWorkbench={() => navigate("workbench")}
          onNavigateBatches={() => navigate("batches")}
        />
      ) : activeView === "workbench" ? (
        <WorkbenchPage
          capabilities={capabilities}
          backendConnected={backendConnected}
          dataMode={dataMode}
          products={products}
          settings={settings}
          onProductsChange={updateProducts}
          onDataModeChange={changeDataMode}
          onOpenSettings={() => setSettingsOpen(true)}
          notify={notify}
        />
      ) : (
        <BatchesPage
          batches={batches}
          capabilities={capabilities}
          dataMode={dataMode}
          onNewBatch={() => navigate("workbench")}
        />
      )}
      <SettingsDrawer
        open={settingsOpen}
        capabilities={capabilities}
        settings={settings}
        onAuthorizeAlibaba={() => void authorizeAlibaba()}
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
