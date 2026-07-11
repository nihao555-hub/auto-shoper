import {
  Archive,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  ChartBar,
  DotsThree,
  GearSix,
  PlayCircle,
  SignOut,
  Storefront,
  UploadSimple,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { PropsWithChildren } from "react";
import type { AlibabaConnectedStore, AppView, AuthUser, DataMode } from "../types";
import { BrandMark } from "./BrandMark";

type AppShellProps = PropsWithChildren<{
  activeView: AppView;
  backendConnected: boolean;
  dataMode: DataMode;
  onDataModeChange: (mode: DataMode) => void;
  onNavigate: (view: AppView) => void;
  onOpenSettings: () => void;
  user: AuthUser;
  stores: AlibabaConnectedStore[];
  activeStoreId: string | null;
  onStoreChange: (storeId: string) => void;
  onLogout: () => void;
}>;

const navItems: Array<{
  view: AppView;
  label: string;
  icon: typeof UploadSimple;
}> = [
  { view: "overview", label: "总览", icon: ChartBar },
  { view: "stores", label: "店铺授权", icon: Storefront },
  { view: "workbench", label: "批量上品", icon: UploadSimple },
  { view: "batches", label: "批次记录", icon: Archive },
];

const loadCollapsed = () => window.localStorage.getItem("auto-shoper-sidebar") === "collapsed";

export function AppShell({
  activeView,
  backendConnected,
  dataMode,
  onDataModeChange,
  onNavigate,
  onOpenSettings,
  user,
  stores,
  activeStoreId,
  onStoreChange,
  onLogout,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem("auto-shoper-sidebar", next ? "collapsed" : "expanded");
  };

  return (
    <div className={`app-shell ${collapsed ? "is-sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="nav-rail" aria-label="主要导航">
        <div className="brand-block">
          <button
            type="button"
            className="brand-mark"
            onClick={() => {
              setAccountMenuOpen(false);
              onNavigate("overview");
            }}
            aria-label="返回总览"
          >
            <BrandMark />
            <span className="brand-copy">
              <strong>上品台</strong>
              <small>跨境商品发布</small>
            </span>
          </button>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {collapsed ? <CaretDoubleRight size={15} /> : <CaretDoubleLeft size={15} />}
          </button>
        </div>

        <nav className="rail-nav">
          <span className="rail-section-label">工作区</span>
          <div className="workspace-switcher">
            <span className="workspace-avatar">{user.workspace_name.slice(0, 1)}</span>
            <div className="workspace-switcher-copy">
              <strong>{user.workspace_name}</strong>
              {stores.length ? (
                <label>
                  <span className="sr-only">当前 Alibaba 店铺</span>
                  <select
                    value={activeStoreId ?? ""}
                    onChange={(event) => onStoreChange(event.target.value)}
                  >
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.login_id ?? store.account ?? store.user_id ?? "Alibaba 店铺"}
                      </option>
                    ))}
                  </select>
                  <CaretDown size={13} />
                </label>
              ) : (
                <button type="button" onClick={() => onNavigate("stores")}>
                  添加 Alibaba 店铺
                </button>
              )}
            </div>
          </div>
          {navItems.map(({ view, label, icon: Icon }) => (
            <button
              type="button"
              key={view}
              className={`rail-item ${activeView === view ? "is-active" : ""}`}
              onClick={() => {
                setAccountMenuOpen(false);
                onNavigate(view);
              }}
              aria-current={activeView === view ? "page" : undefined}
              title={collapsed ? label : undefined}
            >
              <Icon size={20} weight={activeView === view ? "fill" : "regular"} />
              <span className="rail-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="rail-bottom">
          <div className={`rail-account-menu ${accountMenuOpen ? "is-open" : ""}`}>
            {accountMenuOpen ? (
              <div className="account-popover">
                <div className="account-popover-heading">
                  <strong>{user.display_name}</strong>
                  <span>{user.email}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onOpenSettings();
                  }}
                >
                  <GearSix size={17} />
                  商家资产
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onDataModeChange(dataMode === "demo" ? "live" : "demo");
                  }}
                >
                  <PlayCircle size={17} />
                  {dataMode === "demo" ? "切回真实工作区" : "查看隔离演示"}
                </button>
                <button type="button" className="is-danger" onClick={onLogout}>
                  <SignOut size={17} />
                  退出登录
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="rail-account-trigger"
              onClick={() => setAccountMenuOpen((open) => !open)}
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              title={collapsed ? user.display_name : undefined}
            >
              <span className="account-avatar">{user.display_name.slice(0, 1)}</span>
              <span className="rail-account-copy">
                <strong>{user.display_name}</strong>
                <small>{dataMode === "demo" ? "隔离演示" : "真实工作区"}</small>
              </span>
              <DotsThree size={20} weight="bold" />
            </button>
          </div>
        </div>
      </aside>

      <main className="app-main" id="main-content">
        <div className="mobile-topbar">
          <button type="button" className="mobile-brand" onClick={() => onNavigate("overview")}>
            <BrandMark size={30} />
            <strong>上品台</strong>
          </button>
          <strong className="mobile-workspace-name">{user.workspace_name}</strong>
          <div className="mobile-status">
            <i className={`connection-dot ${backendConnected ? "is-online" : "is-offline"}`} />
            {dataMode === "demo" ? "演示空间" : "真实工作区"}
          </div>
          <button type="button" className="icon-button" onClick={onOpenSettings}>
            <GearSix size={20} />
            <span className="sr-only">打开店铺设置</span>
          </button>
        </div>
        {children}
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {navItems.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            type="button"
            className={activeView === view ? "is-active" : ""}
            onClick={() => onNavigate(view)}
            aria-current={activeView === view ? "page" : undefined}
          >
            <Icon size={21} weight={activeView === view ? "fill" : "regular"} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
