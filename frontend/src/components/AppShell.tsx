import {
  Archive,
  CaretDoubleLeft,
  CaretDoubleRight,
  ChartBar,
  GearSix,
  PlayCircle,
  UploadSimple,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { PropsWithChildren } from "react";
import type { AppView, DataMode } from "../types";
import { BrandMark } from "./BrandMark";

type AppShellProps = PropsWithChildren<{
  activeView: AppView;
  backendConnected: boolean;
  dataMode: DataMode;
  onDataModeChange: (mode: DataMode) => void;
  onNavigate: (view: AppView) => void;
  onOpenSettings: () => void;
}>;

const navItems: Array<{
  view: AppView;
  label: string;
  description: string;
  icon: typeof UploadSimple;
}> = [
  { view: "overview", label: "总览", description: "状态与待办", icon: ChartBar },
  { view: "workbench", label: "批量上品", description: "创建与发布", icon: UploadSimple },
  { view: "batches", label: "批次记录", description: "结果与重试", icon: Archive },
];

const loadCollapsed = () => window.localStorage.getItem("auto-shoper-sidebar") === "collapsed";

export function AppShell({
  activeView,
  backendConnected,
  dataMode,
  onDataModeChange,
  onNavigate,
  onOpenSettings,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);

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
            onClick={() => onNavigate("overview")}
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
          {navItems.map(({ view, label, description, icon: Icon }) => (
            <button
              type="button"
              key={view}
              className={`rail-item ${activeView === view ? "is-active" : ""}`}
              onClick={() => onNavigate(view)}
              title={collapsed ? label : undefined}
            >
              <Icon size={20} weight={activeView === view ? "fill" : "regular"} />
              <span className="rail-item-copy">
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="rail-bottom">
          <button
            type="button"
            className={`demo-mode-control ${dataMode === "demo" ? "is-active" : ""}`}
            onClick={() => onDataModeChange(dataMode === "demo" ? "live" : "demo")}
            title={collapsed ? (dataMode === "demo" ? "退出演示" : "查看演示") : undefined}
          >
            <PlayCircle size={20} weight={dataMode === "demo" ? "fill" : "regular"} />
            <span className="rail-item-copy">
              <strong>{dataMode === "demo" ? "退出演示" : "查看演示"}</strong>
              <small>{dataMode === "demo" ? "切回真实工作区" : "使用隔离示例数据"}</small>
            </span>
          </button>

          <button
            type="button"
            className="rail-item settings-item"
            onClick={onOpenSettings}
            title={collapsed ? "店铺设置" : undefined}
          >
            <GearSix size={20} />
            <span className="rail-item-copy">
              <strong>店铺设置</strong>
              <small>默认值与授权</small>
            </span>
          </button>
        </div>
      </aside>

      <main className="app-main" id="main-content">
        <div className="mobile-topbar">
          <button type="button" className="mobile-brand" onClick={() => onNavigate("overview")}>
            <BrandMark size={30} />
            <strong>上品台</strong>
          </button>
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
          >
            <Icon size={21} weight={activeView === view ? "fill" : "regular"} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
