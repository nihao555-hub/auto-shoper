import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  activateAlibabaStore,
  disconnectAlibabaStore,
  getAlibabaStores,
  getCapabilities,
  getCurrentUser,
  logout,
  startAlibabaOAuth,
  syncAlibabaStore,
} from "./api";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./components/AuthPage";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ToastStack } from "./components/ToastStack";
import {
  defaultSettings,
  demoActiveStoreId,
  demoStores,
  getMainProductImage,
  sampleBatches,
  sampleProducts,
} from "./data";
import { BatchesPage } from "./pages/BatchesPage";
import { OverviewPage } from "./pages/OverviewPage";
import { StoresPage } from "./pages/StoresPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import type {
  AlibabaConnectedStore,
  AppView,
  AuthUser,
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
  if (window.location.hash === "#/stores") {
    return "stores";
  }
  return "overview";
};

const settingsStorageKey = (workspaceId: string, storeId: string | null) =>
  `auto-shoper-settings:${workspaceId}:${storeId ?? "no-store"}`;

const loadSettings = (workspaceId: string, storeId: string | null): StoreSettings => {
  const saved = window.localStorage.getItem(settingsStorageKey(workspaceId, storeId));
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
    images: product.images.map((image) => ({ ...image })),
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

const createBatchId = () =>
  `B${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

type AlibabaOAuthMessage = {
  type: "alibaba-oauth-result";
  result: "connected" | "error";
  reason: string | null;
};

const isAlibabaOAuthMessage = (value: unknown): value is AlibabaOAuthMessage => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Partial<AlibabaOAuthMessage>;
  return (
    message.type === "alibaba-oauth-result" &&
    (message.result === "connected" || message.result === "error")
  );
};

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
    images: products.slice(0, 3).map((product) => getMainProductImage(product).url),
  };
};

export default function App() {
  const [authState, setAuthState] = useState<"checking" | "signed-out" | "signed-in">("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeView, setActiveView] = useState<AppView>(getViewFromHash);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSyncing, setSettingsSyncing] = useState(false);
  const [settings, setSettings] = useState<StoreSettings>(defaultSettings);
  const [dataMode, setDataMode] = useState<DataMode>(() =>
    window.localStorage.getItem("auto-shoper-data-mode") === "demo" ? "demo" : "live",
  );
  const [liveProducts, setLiveProducts] = useState<ProductRecord[]>([]);
  const [demoProducts, setDemoProducts] = useState<ProductRecord[]>(cloneDemoProducts);
  const [batchId, setBatchId] = useState(createBatchId);
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [stores, setStores] = useState<AlibabaConnectedStore[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const oauthPopup = useRef<Window | null>(null);
  const [demoStoreId, setDemoStoreId] = useState<string>(demoActiveStoreId);

  const products = dataMode === "demo" ? demoProducts : liveProducts;
  const visibleStores = dataMode === "demo" ? demoStores : stores;
  const visibleActiveStoreId = dataMode === "demo" ? demoStoreId : activeStoreId;
  const liveBatch = useMemo(() => buildLiveBatch(liveProducts, batchId), [liveProducts, batchId]);
  const batches = dataMode === "demo" ? sampleBatches : liveBatch ? [liveBatch] : [];

  useEffect(() => {
    getCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
        setAuthState("signed-in");
      })
      .catch(() => {
        setUser(null);
        setAuthState("signed-out");
      });
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveView(getViewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!user) {
      return;
    }
    try {
      const [capabilityResponse, storeDirectory] = await Promise.all([
        getCapabilities(),
        getAlibabaStores(),
      ]);
      setCapabilities(capabilityResponse);
      setStores(storeDirectory.stores);
      setActiveStoreId(storeDirectory.active_store_id);
      setBackendConnected(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setAuthState("signed-out");
      }
      setCapabilities(null);
      setStores([]);
      setActiveStoreId(null);
      setBackendConnected(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const savedSettings = loadSettings(user.workspace_id, activeStoreId);
    const storeAssets = stores.find((store) => store.id === activeStoreId)?.merchant_assets;
    setSettings({
      ...savedSettings,
      companyProfile: savedSettings.companyProfile || storeAssets?.company_profile || "",
      afterSalesPolicy: savedSettings.afterSalesPolicy || storeAssets?.after_sales_policy || "",
      customizationPolicy:
        savedSettings.customizationPolicy || storeAssets?.customization_policy || "",
      detailTemplate: savedSettings.detailTemplate || storeAssets?.detail_template || "",
      origin: savedSettings.origin || storeAssets?.origin || "",
      brand: savedSettings.brand || storeAssets?.brand || "",
    });
    setLiveProducts([]);
    setBatchId(createBatchId());
  }, [activeStoreId, stores, user]);

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

  const handleAlibabaOAuthResult = useCallback(
    (result: AlibabaOAuthMessage["result"], reason: string | null) => {
      if (result === "connected") {
        notify("success", "Alibaba 店铺已连接", "已刷新商家授权状态。");
        refreshWorkspace();
        return;
      }
      notify(
        "error",
        "Alibaba 店铺授权未完成",
        reason === "denied" ? "商家取消或拒绝了授权。" : "请重新发起授权或联系管理员。",
      );
    },
    [notify, refreshWorkspace],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || !isAlibabaOAuthMessage(event.data)) {
        return;
      }
      oauthPopup.current?.close();
      oauthPopup.current = null;
      handleAlibabaOAuthResult(event.data.result, event.data.reason);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleAlibabaOAuthResult]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const oauthResult = params.get("alibaba");
    if (!oauthResult) {
      return;
    }
    const result = oauthResult === "connected" ? "connected" : "error";
    const reason = params.get("reason");
    if (window.opener && !window.opener.closed) {
      const message: AlibabaOAuthMessage = {
        type: "alibaba-oauth-result",
        result,
        reason,
      };
      window.opener.postMessage(message, window.location.origin);
      window.close();
      return;
    }
    handleAlibabaOAuthResult(result, reason);
    window.history.replaceState(null, "", `${window.location.pathname}#/overview`);
  }, [handleAlibabaOAuthResult]);

  const saveSettings = (nextSettings: StoreSettings) => {
    if (!user) {
      return;
    }
    setSettings(nextSettings);
    window.localStorage.setItem(
      settingsStorageKey(user.workspace_id, activeStoreId),
      JSON.stringify(nextSettings),
    );
    setSettingsOpen(false);
    notify("success", "商家资料已保存", "新批次可带出已确认的复用字段。");
  };

  const authorizeAlibaba = async () => {
    const popup = window.open(
      "",
      "auto-shoper-alibaba-oauth",
      "popup=yes,width=560,height=720,menubar=no,toolbar=no,location=yes,status=no",
    );
    oauthPopup.current = popup;
    try {
      const response = await startAlibabaOAuth();
      if (popup && !popup.closed) {
        popup.location.replace(response.authorization_url);
        popup.focus();
      } else {
        window.location.assign(response.authorization_url);
      }
    } catch {
      popup?.close();
      oauthPopup.current = null;
      notify("error", "无法开始店铺授权", "授权服务暂不可用，请稍后重试。");
    }
  };

  const switchStore = async (storeId: string) => {
    if (!storeId || storeId === visibleActiveStoreId) {
      return;
    }
    if (dataMode === "demo") {
      setDemoStoreId(storeId);
      notify("success", "已切换 Alibaba 店铺", "新批次将使用该示例店铺。");
      return;
    }
    try {
      await activateAlibabaStore(storeId);
      setActiveStoreId(storeId);
      await refreshWorkspace();
      notify("success", "已切换 Alibaba 店铺", "新批次将使用该店铺。");
    } catch (error) {
      notify("error", "无法切换店铺", error instanceof ApiError ? error.message : undefined);
    }
  };

  const syncStore = async (storeId: string) => {
    if (dataMode === "demo") {
      notify("success", "店铺摘要已同步", "当前为演示数据。");
      return;
    }
    setSettingsSyncing(true);
    try {
      const syncedStore = await syncAlibabaStore(storeId);
      const imported = Object.entries(syncedStore.template_defaults ?? {}).filter(
        ([key, value]) =>
          typeof value === "string" &&
          value.trim() &&
          typeof settings[key as keyof StoreSettings] === "string" &&
          !(settings[key as keyof StoreSettings] as string).trim(),
      ) as Array<[keyof StoreSettings, string]>;
      if (imported.length) {
        const nextSettings = { ...settings };
        for (const [key, value] of imported) {
          Object.assign(nextSettings, { [key]: value });
        }
        setSettings(nextSettings);
        if (user) {
          window.localStorage.setItem(
            settingsStorageKey(user.workspace_id, storeId),
            JSON.stringify(nextSettings),
          );
        }
      }
      await refreshWorkspace();
      notify(
        "success",
        "店铺摘要已同步",
        imported.length
          ? `已自动填充 ${imported.length} 个模板字段。`
          : "未找到可自动填充的模板字段。",
      );
    } catch (error) {
      notify("error", "店铺摘要同步失败", error instanceof ApiError ? error.message : undefined);
    } finally {
      setSettingsSyncing(false);
    }
  };

  const disconnectStore = async (storeId: string): Promise<boolean> => {
    if (dataMode === "demo") {
      notify("info", "演示店铺不会被解绑", "请切换到真实工作区后再操作。");
      return false;
    }
    try {
      await disconnectAlibabaStore(storeId);
      if (user) {
        window.localStorage.removeItem(settingsStorageKey(user.workspace_id, storeId));
      }
      await refreshWorkspace();
      notify("success", "店铺已解绑", "本地授权令牌已移除，可随时重新授权。");
      return true;
    } catch (error) {
      notify("error", "无法解绑店铺", error instanceof ApiError ? error.message : undefined);
      return false;
    }
  };

  const signOut = async () => {
    try {
      await logout();
    } finally {
      setUser(null);
      setAuthState("signed-out");
      setCapabilities(null);
      setStores([]);
      setActiveStoreId(null);
      setLiveProducts([]);
      setSettingsOpen(false);
    }
  };

  const completeAuthentication = (authenticatedUser: AuthUser) => {
    setUser(authenticatedUser);
    setAuthState("signed-in");
    window.location.hash = "#/overview";
  };

  const changeDataMode = (mode: DataMode) => {
    setDataMode(mode);
    window.localStorage.setItem("auto-shoper-data-mode", mode);
    if (mode === "demo" && demoProducts.length === 0) {
      setDemoProducts(cloneDemoProducts());
    }
    notify(
      "info",
      mode === "demo" ? "已进入演示空间" : "已切回真实工作区",
      mode === "demo" ? "演示操作不会影响真实店铺。" : "示例数据已隐藏。",
    );
  };

  const resetDemo = () => {
    setDemoProducts(cloneDemoProducts());
    setBatchId(createBatchId());
    notify("info", "演示流程已重置", "已回到第 1 步，不会写入真实 Alibaba 店铺。");
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

  if (authState === "checking") {
    return (
      <div className="auth-loading" role="status">
        <span />
        <strong>正在打开安全工作区</strong>
      </div>
    );
  }

  if (authState === "signed-out" || !user) {
    return <AuthPage onAuthenticated={completeAuthentication} />;
  }

  return (
    <AppShell
      activeView={activeView}
      backendConnected={backendConnected}
      dataMode={dataMode}
      onDataModeChange={changeDataMode}
      onNavigate={navigate}
      onOpenSettings={() => setSettingsOpen(true)}
      user={user}
      stores={visibleStores}
      activeStoreId={visibleActiveStoreId}
      onStoreChange={(storeId) => void switchStore(storeId)}
      onLogout={() => void signOut()}
    >
      {activeView === "overview" ? (
        <OverviewPage
          batches={batches}
          products={products}
          capabilities={capabilities}
          backendConnected={backendConnected}
          dataMode={dataMode}
          activeStore={visibleStores.find((store) => store.id === visibleActiveStoreId) ?? null}
          onNavigateWorkbench={() => navigate("workbench")}
          onNavigateBatches={() => navigate("batches")}
          onNavigateStores={() => navigate("stores")}
        />
      ) : activeView === "stores" ? (
        <StoresPage
          capabilities={capabilities}
          stores={visibleStores}
          activeStoreId={visibleActiveStoreId}
          onAuthorize={() => void authorizeAlibaba()}
          onSwitchStore={(storeId) => void switchStore(storeId)}
          onSyncStore={(storeId) => void syncStore(storeId)}
          onDisconnectStore={disconnectStore}
          disconnectEnabled={dataMode === "live"}
        />
      ) : activeView === "workbench" ? (
        <WorkbenchPage
          key={dataMode}
          batchId={batchId}
          activeStore={visibleStores.find((store) => store.id === visibleActiveStoreId) ?? null}
          capabilities={capabilities}
          backendConnected={backendConnected}
          dataMode={dataMode}
          products={products}
          settings={settings}
          onProductsChange={updateProducts}
          onDataModeChange={changeDataMode}
          onResetDemo={resetDemo}
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
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onSyncFromStore={activeStoreId ? () => syncStore(activeStoreId) : undefined}
        syncing={settingsSyncing}
        canSyncFromStore={Boolean(activeStoreId)}
      />
      <ToastStack
        messages={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((message) => message.id !== id))}
      />
    </AppShell>
  );
}
