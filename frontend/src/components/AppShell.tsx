import {
  Archive,
  CaretDown,
  CaretRight,
  House,
  Package,
  PlayCircle,
  SignOut,
  Storefront,
  User,
  Vault,
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
  icon: typeof Package;
}> = [
  { view: "overview", label: "总览", icon: House },
  { view: "workbench", label: "批量上品", icon: Package },
  { view: "batches", label: "批次记录", icon: Archive },
  { view: "stores", label: "店铺授权", icon: Storefront },
];

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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  return (
    <div className="ds-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="ds-sidebar" aria-label="主要导航">
        <button
          type="button"
          className="ds-brand"
          onClick={() => {
            setAccountMenuOpen(false);
            onNavigate("overview");
          }}
          aria-label="返回总览"
        >
          <BrandMark size={32} />
          <strong>上品台</strong>
        </button>

        <nav className="ds-nav">
          {navItems.map(({ view, label, icon: Icon }) => (
            <button
              type="button"
              key={view}
              className={`ds-nav-item ${activeView === view ? "is-active" : ""}`}
              onClick={() => {
                setAccountMenuOpen(false);
                onNavigate(view);
              }}
              aria-current={activeView === view ? "page" : undefined}
            >
              <Icon size={20} weight={activeView === view ? "fill" : "regular"} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="ds-sidebar-bottom">
          <button
            type="button"
            className="ds-sidebar-assets"
            onClick={() => {
              setAccountMenuOpen(false);
              onOpenSettings();
            }}
          >
            <Vault size={20} />
            商家资产
            <CaretRight size={14} className="ds-chevron" />
          </button>

          <div className="ds-account">
            {accountMenuOpen ? (
              <div className="ds-account-popover" role="menu">
                <div className="ds-account-popover-heading">
                  <strong>{user.display_name}</strong>
                  <span>{user.email}</span>
                </div>
                {stores.length > 1 ? (
                  <label className="ds-account-store-select">
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
                  </label>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onDataModeChange(dataMode === "demo" ? "live" : "demo");
                  }}
                >
                  <PlayCircle size={16} />
                  {dataMode === "demo" ? "切回真实工作区" : "查看隔离演示"}
                </button>
                <button type="button" className="is-danger" onClick={onLogout}>
                  <SignOut size={16} />
                  退出登录
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="ds-account-trigger"
              onClick={() => setAccountMenuOpen((open) => !open)}
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
            >
              <span className="ds-account-avatar">
                <User size={18} />
              </span>
              <span className="ds-account-copy">
                <strong>{user.display_name}</strong>
                <small>
                  {dataMode === "demo"
                    ? "隔离演示"
                    : backendConnected
                      ? user.workspace_name
                      : "服务暂不可用"}
                </small>
              </span>
              <CaretDown size={14} />
            </button>
          </div>
        </div>
      </aside>

      <main className="ds-main" id="main-content">
        {children}
      </main>
    </div>
  );
}
