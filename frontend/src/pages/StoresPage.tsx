import {
  ArrowsClockwise,
  Buildings,
  LockKey,
  Plus,
  ShieldCheck,
  Swap,
} from "@phosphor-icons/react";
import type { AlibabaConnectedStore, CapabilityResponse } from "../types";

type StoresPageProps = {
  capabilities: CapabilityResponse | null;
  stores: AlibabaConnectedStore[];
  activeStoreId: string | null;
  onAuthorize: () => void;
  onSwitchStore: (storeId: string) => void;
  onSyncStore: (storeId: string) => void;
};

export function StoresPage({
  capabilities,
  stores,
  activeStoreId,
  onAuthorize,
  onSwitchStore,
  onSyncStore,
}: StoresPageProps) {
  const connectionState = capabilities?.alibaba_connection_state ?? "unconfigured";
  const connectionLabel = {
    unconfigured: "平台未配置",
    configuration_error: "平台配置有误",
    not_connected: "等待商家授权",
    connected: "已连接",
    expired: "授权已过期",
  }[connectionState];
  const authorizationEnabled = capabilities?.alibaba_oauth_configured === true;

  return (
    <div className="page stores-page">
      <header className="page-header stores-header refined-page-header">
        <div>
          <div className="page-context">
            <span>Alibaba.com 国际站</span>
            <i />
            <span>{connectionLabel}</span>
          </div>
          <h1>店铺授权</h1>
          <p>连接、同步和切换 Alibaba 店铺；每个店铺的数据与批次独立保存。</p>
        </div>
        <button
          type="button"
          className="button button-primary button-large"
          onClick={onAuthorize}
          disabled={!authorizationEnabled}
        >
          <Plus size={18} weight="bold" />
          {authorizationEnabled ? "添加店铺" : "等待平台配置"}
        </button>
      </header>

      <div className="stores-page-content">
        <section className="store-access-card" aria-label="Alibaba 店铺连接">
          <div className="store-access-heading">
            <span className="alibaba-symbol">a</span>
            <div>
              <span className="eyebrow">官方 OAuth 授权</span>
              <h2>连接 Alibaba.com 店铺</h2>
              <p>平台不会读取店铺登录密码；授权完成后仅保存业务接口所需凭证。</p>
            </div>
            <span
              className={`store-connection-state ${
                connectionState === "connected" ? "is-connected" : ""
              }`}
            >
              <i
                className={`connection-dot ${
                  connectionState === "connected" ? "is-online" : "is-offline"
                }`}
              />
              {connectionLabel}
            </span>
          </div>
          <div className="store-access-policies">
            <span>
              <ShieldCheck size={18} /> 当前客户工作区隔离
            </span>
            <span>
              <LockKey size={18} /> Token 加密持久化
            </span>
            <span>
              <Buildings size={18} /> 支持连接多个店铺
            </span>
          </div>
          {capabilities?.alibaba_oauth_configuration_error ? (
            <p className="store-access-error">{capabilities.alibaba_oauth_configuration_error}</p>
          ) : (
            <p className="store-access-note">
              新授权不会覆盖已有店铺；创建批次时仍需明确确认目标店铺。
            </p>
          )}
        </section>

        <section className="stores-directory" aria-labelledby="connected-stores-title">
          <div className="connected-stores-heading">
            <div>
              <h2 id="connected-stores-title">已连接店铺</h2>
              <span>{stores.length} 个店铺与当前工作区隔离保存</span>
            </div>
          </div>

          {stores.length > 0 ? (
            <div className="store-summary-list">
              {stores.map((store) => (
                <StoreSummaryCard
                  key={store.id}
                  store={store}
                  active={store.id === activeStoreId}
                  onActivate={() => onSwitchStore(store.id)}
                  onSync={() => onSyncStore(store.id)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-store-state">
              <Buildings size={30} />
              <strong>还没有连接店铺</strong>
              <p>在 Alibaba 官方弹窗中完成登录和授权后，店铺摘要会显示在这里。</p>
              <button
                type="button"
                className="button button-dark"
                onClick={onAuthorize}
                disabled={!authorizationEnabled}
              >
                <Plus size={18} />
                {authorizationEnabled ? "添加 Alibaba 店铺" : "等待平台配置"}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StoreSummaryCard({
  store,
  active,
  onActivate,
  onSync,
}: {
  store: AlibabaConnectedStore;
  active: boolean;
  onActivate: () => void;
  onSync: () => void;
}) {
  const name = store.login_id ?? store.account ?? store.user_id ?? "未知 Alibaba 店铺";
  const healthLabel = {
    pending: "待验证",
    healthy: "权限正常",
    attention: "需要处理",
    expired: "授权过期",
  }[store.permission_health];
  const readinessLabel = {
    ready: "可创建草稿",
    verification_required: "草稿权限待验证",
    blocked: "暂不可创建草稿",
  }[store.draft_readiness];
  const lastSync = store.last_sync_at
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(store.last_sync_at))
    : "尚未同步";

  return (
    <article className={`store-summary-card ${active ? "is-active" : ""}`}>
      <header>
        <div className="store-summary-identity">
          <span className="alibaba-symbol">a</span>
          <div>
            <strong>{name}</strong>
            <small>{store.account ?? `User ID ${store.user_id ?? "待返回"}`}</small>
          </div>
        </div>
        <span className={`store-badge ${store.expired ? "is-expired" : active ? "is-active" : ""}`}>
          {store.expired ? "已过期" : active ? "当前店铺" : "已连接"}
        </span>
      </header>
      <div className="store-summary-metrics">
        <div>
          <span>商品</span>
          <strong>{store.product_count ?? "—"}</strong>
          <small>{store.product_sync_state === "synced" ? "已同步" : "待同步"}</small>
        </div>
        <div>
          <span>图片分组</span>
          <strong>{store.photobank_group_count ?? "—"}</strong>
          <small>{store.photobank_sync_state === "synced" ? "已同步" : "待同步"}</small>
        </div>
        <div>
          <span>商品分组</span>
          <strong>{store.product_group_count ?? "—"}</strong>
          <small>
            {store.product_group_sync_state === "not_available" ? "接口待开放" : "待同步"}
          </small>
        </div>
      </div>
      <div className="store-health-row">
        <span>
          <i className={`health-dot is-${store.permission_health}`} />
          {healthLabel} · {store.permission_verified_count}/{store.permission_total_count}
        </span>
        <span className={`readiness is-${store.draft_readiness}`}>{readinessLabel}</span>
      </div>
      <footer>
        <span>最近同步：{lastSync}</span>
        <div>
          <button type="button" className="text-button" onClick={onSync} disabled={store.expired}>
            <ArrowsClockwise size={16} />
            同步摘要
          </button>
          {!active ? (
            <button type="button" className="text-button" onClick={onActivate}>
              <Swap size={16} />
              切换到此店
            </button>
          ) : null}
        </div>
      </footer>
      {store.sync_error ? <p className="store-sync-error">{store.sync_error}</p> : null}
    </article>
  );
}
