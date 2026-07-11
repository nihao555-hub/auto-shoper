import {
  Archive,
  GearSix,
  Headset,
  Package,
  SquaresFour,
  UploadSimple,
} from "@phosphor-icons/react";
import type { PropsWithChildren } from "react";
import type { AppView, CapabilityResponse } from "../types";

type AppShellProps = PropsWithChildren<{
  activeView: AppView;
  capabilities: CapabilityResponse | null;
  onNavigate: (view: AppView) => void;
  onOpenSettings: () => void;
}>;

const navItems: Array<{
  view: AppView;
  label: string;
  icon: typeof SquaresFour;
}> = [
  {
    view: "workbench",
    label: "工作台",
    icon: UploadSimple,
  },
  {
    view: "batches",
    label: "批次",
    icon: Archive,
  },
];

export function AppShell({
  activeView,
  capabilities,
  onNavigate,
  onOpenSettings,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="nav-rail" aria-label="主要导航">
        <button
          type="button"
          className="brand-mark"
          onClick={() => onNavigate("workbench")}
          aria-label="返回上品工作台"
        >
          <span className="brand-glyph">上</span>
          <span className="brand-text">上品台</span>
        </button>

        <nav className="rail-nav">
          {navItems.map(({ view, label, icon: Icon }) => (
            <button
              key={view}
              type="button"
              className={`rail-item ${activeView === view ? "is-active" : ""}`}
              onClick={() => onNavigate(view)}
              aria-current={activeView === view ? "page" : undefined}
            >
              <Icon size={22} weight={activeView === view ? "fill" : "regular"} />
              <span>{label}</span>
            </button>
          ))}
          <button type="button" className="rail-item rail-item-disabled" disabled>
            <Package size={22} />
            <span>商品</span>
          </button>
          <button type="button" className="rail-item rail-item-disabled" disabled>
            <SquaresFour size={22} />
            <span>数据</span>
          </button>
        </nav>

        <div className="rail-bottom">
          <button type="button" className="rail-item" onClick={onOpenSettings}>
            <GearSix size={22} />
            <span>设置</span>
          </button>
          <a className="rail-item" href="https://docs.devin.ai" target="_blank" rel="noreferrer">
            <Headset size={22} />
            <span>帮助</span>
          </a>
        </div>
      </aside>

      <main className="app-main">
        <div className="mobile-topbar">
          <button type="button" className="mobile-brand" onClick={() => onNavigate("workbench")}>
            <span className="brand-glyph">上</span>
            <strong>上品台</strong>
          </button>
          <button type="button" className="icon-button" onClick={onOpenSettings}>
            <GearSix size={20} />
            <span className="sr-only">打开店铺设置</span>
          </button>
        </div>
        {children}
      </main>

      <div className="connection-peek" aria-live="polite">
        <span
          className={`connection-dot ${
            capabilities?.alibaba_credentials_configured ? "is-online" : "is-offline"
          }`}
        />
        {capabilities?.alibaba_credentials_configured ? "Alibaba 已连接" : "演示模式"}
      </div>

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
        <button type="button" onClick={onOpenSettings}>
          <GearSix size={21} />
          <span>设置</span>
        </button>
      </nav>
    </div>
  );
}
