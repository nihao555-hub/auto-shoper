import {
  ArrowsClockwise,
  CheckCircle,
  Copy,
  LinkBreak,
  MagnifyingGlass,
  Plus,
  ShieldWarning,
  Warning,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { AlibabaConnectedStore, CapabilityResponse } from "../types";

type StoresPageProps = {
  capabilities: CapabilityResponse | null;
  stores: AlibabaConnectedStore[];
  activeStoreId: string | null;
  onAuthorize: () => void;
  onSwitchStore: (storeId: string) => void;
  onSyncStore: (storeId: string) => void;
  onDisconnectStore: (storeId: string) => Promise<boolean>;
  disconnectEnabled: boolean;
};

type StatusFilter = "all" | "current" | "idle" | "expired";

function storeName(store: AlibabaConnectedStore) {
  return store.login_id ?? store.account ?? store.user_id ?? "未知 Alibaba 店铺";
}

function formatDate(value: string | null) {
  if (!value) return "平台未返回";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(value))
    .replaceAll("/", "-");
}

function formatDateTime(value: string | null) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(value))
    .replaceAll("/", "-");
}

function remainingDays(value: string | null) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

export function StoresPage({
  capabilities,
  stores,
  activeStoreId,
  onAuthorize,
  onSwitchStore,
  onSyncStore,
  onDisconnectStore,
  disconnectEnabled,
}: StoresPageProps) {
  const authorizationEnabled = capabilities?.alibaba_oauth_configured === true;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [disconnectTarget, setDisconnectTarget] = useState<AlibabaConnectedStore | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const activeStore = stores.find((store) => store.id === activeStoreId) ?? null;

  const filteredStores = useMemo(() => {
    return stores.filter((store) => {
      if (statusFilter === "current" && store.id !== activeStoreId) return false;
      if (statusFilter === "idle" && (store.id === activeStoreId || store.expired)) return false;
      if (statusFilter === "expired" && !store.expired) return false;
      if (keyword.trim()) {
        const haystack = `${store.login_id ?? ""} ${store.account ?? ""} ${store.user_id ?? ""}`;
        if (!haystack.toLowerCase().includes(keyword.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [stores, statusFilter, keyword, activeStoreId]);

  return (
    <div className="ds-page st-page">
      <header className="ds-page-header">
        <div>
          <h1>店铺授权</h1>
        </div>
        <button
          type="button"
          className="ds-button-primary"
          onClick={onAuthorize}
          disabled={!authorizationEnabled}
        >
          <Plus size={16} weight="bold" />
          {authorizationEnabled ? "添加 Alibaba 店铺" : "暂不可用"}
        </button>
      </header>

      {capabilities?.alibaba_oauth_configuration_error ? (
        <section className="st-config-error" aria-label="配置错误">
          <ShieldWarning size={18} />
          店铺授权服务暂不可用
        </section>
      ) : null}

      <section className="st-current" aria-label="当前使用店铺">
        <header className="st-current-heading">
          <h2>当前店铺</h2>
          <span className="st-tag is-current">当前店铺</span>
        </header>
        {activeStore ? (
          <>
            <div className="st-current-body">
              <div className="st-current-identity">
                <span className="st-avatar">阿</span>
                <div>
                  <strong>{storeName(activeStore)}</strong>
                  <small>账号：{activeStore.account ?? activeStore.login_id ?? "待返回"}</small>
                  <small>店铺 ID：{activeStore.user_id ?? "待返回"}</small>
                </div>
              </div>
              <dl className="st-current-facts">
                <div>
                  <dt>授权到期</dt>
                  <dd className={activeStore.expired ? "is-danger" : "is-success"}>
                    {formatDate(activeStore.expires_at)}
                  </dd>
                  <span>
                    {(() => {
                      const days = remainingDays(activeStore.expires_at);
                      if (days === null) return "有效期待返回";
                      return days >= 0 ? `（还有 ${days} 天）` : `（已过期 ${-days} 天）`;
                    })()}
                  </span>
                </div>
                <div>
                  <dt>资料更新</dt>
                  <dd>{formatDateTime(activeStore.last_sync_at)}</dd>
                </div>
                <div>
                  <dt>上品状态</dt>
                  <dd>
                    {activeStore.ready_to_create_draft ? (
                      <span className="st-check is-success">
                        <CheckCircle size={15} weight="fill" /> 可创建草稿
                      </span>
                    ) : (
                      <span className="st-check is-warning">
                        <Warning size={15} weight="fill" /> 暂不可创建草稿
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="ds-button-secondary"
                onClick={() => onSyncStore(activeStore.id)}
              >
                店铺设置
              </button>
            </div>
          </>
        ) : (
          <div className="st-current-empty">
            <span className="st-avatar">阿</span>
            <div>
              <strong>尚未选择店铺</strong>
              <small>连接并授权 Alibaba 店铺后，新建任务将默认使用该店铺。</small>
            </div>
            <button
              type="button"
              className="ds-button-primary"
              onClick={onAuthorize}
              disabled={!authorizationEnabled}
            >
              <Plus size={16} weight="bold" />
              添加 Alibaba 店铺
            </button>
          </div>
        )}
      </section>

      <section className="st-directory" aria-label="已连接店铺">
        <header className="st-directory-heading">
          <h2>已连接店铺（{stores.length}）</h2>
          <div className="st-directory-tools">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              aria-label="按状态筛选"
            >
              <option value="all">全部状态</option>
              <option value="current">当前使用</option>
              <option value="idle">未使用</option>
              <option value="expired">已过期</option>
            </select>
            <label className="st-search">
              <MagnifyingGlass size={15} />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="按店铺名称 / 账号 / ID 搜索"
              />
            </label>
            <button
              type="button"
              className="st-refresh"
              aria-label="刷新店铺摘要"
              onClick={() => {
                for (const store of stores) {
                  if (!store.expired) onSyncStore(store.id);
                }
              }}
            >
              <ArrowsClockwise size={16} />
            </button>
          </div>
        </header>

        {filteredStores.length > 0 ? (
          <div className="st-grid">
            {filteredStores.map((store, index) => (
              <StoreCard
                key={store.id}
                index={index + 1}
                store={store}
                active={store.id === activeStoreId}
                onActivate={() => onSwitchStore(store.id)}
                onSync={() => onSyncStore(store.id)}
                onReauthorize={onAuthorize}
                onDisconnect={() => setDisconnectTarget(store)}
                disconnectEnabled={disconnectEnabled}
              />
            ))}
          </div>
        ) : (
          <div className="st-empty">
            {stores.length === 0
              ? "还没有连接店铺，点击右上角「添加 Alibaba 店铺」开始授权。"
              : "没有符合筛选条件的店铺。"}
          </div>
        )}
      </section>
      {disconnectTarget ? (
        <DisconnectStoreDialog
          store={disconnectTarget}
          busy={disconnecting}
          onClose={() => {
            if (!disconnecting) setDisconnectTarget(null);
          }}
          onConfirm={async () => {
            setDisconnecting(true);
            const disconnected = await onDisconnectStore(disconnectTarget.id);
            setDisconnecting(false);
            if (disconnected) setDisconnectTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function StoreCard({
  index,
  store,
  active,
  onActivate,
  onSync,
  onReauthorize,
  onDisconnect,
  disconnectEnabled,
}: {
  index: number;
  store: AlibabaConnectedStore;
  active: boolean;
  onActivate: () => void;
  onSync: () => void;
  onReauthorize: () => void;
  onDisconnect: () => void;
  disconnectEnabled: boolean;
}) {
  const days = remainingDays(store.expires_at);
  const copyAccount = () => {
    const value = store.account ?? store.login_id ?? "";
    if (value) void navigator.clipboard?.writeText(value);
  };

  return (
    <article className={`st-card ${store.expired ? "is-expired" : ""}`}>
      <header className="st-card-heading">
        <strong>
          {index}. {storeName(store)}
          <em>{store.expired ? "（已过期）" : active ? "（当前使用）" : ""}</em>
        </strong>
        <span
          className={`st-tag ${store.expired ? "is-danger" : active ? "is-current" : "is-idle"}`}
        >
          {store.expired ? "已过期" : active ? "当前店铺" : "未使用"}
        </span>
        <span className={`st-state-icon ${store.expired ? "is-danger" : "is-success"}`}>
          {store.expired ? (
            <XCircle size={17} weight="fill" />
          ) : (
            <CheckCircle size={17} weight="fill" />
          )}
        </span>
      </header>

      <dl className="st-card-rows">
        <div>
          <dt>登录账号</dt>
          <dd>
            {store.account ?? store.login_id ?? "待返回"}
            <button type="button" className="st-copy" aria-label="复制账号" onClick={copyAccount}>
              <Copy size={13} />
            </button>
          </dd>
        </div>
        <div>
          <dt>授权到期</dt>
          <dd className={store.expired ? "is-danger" : "is-warning"}>
            {formatDate(store.expires_at)}{" "}
            {days === null ? "" : days >= 0 ? `（还有 ${days} 天）` : `（已过期 ${-days} 天）`}
          </dd>
        </div>
        <div>
          <dt>商品数量</dt>
          <dd>
            {store.product_count === null
              ? "待同步"
              : `${store.product_count.toLocaleString()} 个商品`}
          </dd>
        </div>
        <div>
          <dt>图册分组</dt>
          <dd>
            {store.photobank_group_count === null
              ? "待同步"
              : `${store.photobank_group_count} 个分组`}
          </dd>
        </div>
        <div>
          <dt>资料更新</dt>
          <dd>{formatDateTime(store.last_sync_at)}</dd>
        </div>
        <div>
          <dt>上品状态</dt>
          <dd>
            {store.ready_to_create_draft ? (
              <span className="st-check is-success">
                <CheckCircle size={15} weight="fill" /> 可创建草稿
              </span>
            ) : (
              <span className="st-check is-danger">
                <XCircle size={15} weight="fill" /> 暂不可创建草稿
              </span>
            )}
          </dd>
        </div>
      </dl>

      <footer className="st-card-actions">
        <button
          type="button"
          className="ds-button-secondary"
          onClick={onSync}
          disabled={store.expired}
        >
          同步摘要
        </button>
        {store.expired ? (
          <button type="button" className="ds-button-outline-brand" onClick={onReauthorize}>
            重新授权
          </button>
        ) : (
          <>
            {!active ? (
              <button type="button" className="ds-button-outline-brand" onClick={onActivate}>
                切换到此店
              </button>
            ) : null}
            <button type="button" className="ds-button-secondary" onClick={onReauthorize}>
              重新授权
            </button>
          </>
        )}
        <button
          type="button"
          className="ds-button-danger"
          onClick={onDisconnect}
          disabled={!disconnectEnabled}
          title={disconnectEnabled ? undefined : "演示模式不会改动真实店铺"}
        >
          <LinkBreak size={14} />
          解绑店铺
        </button>
      </footer>
    </article>
  );
}

function DisconnectStoreDialog({
  store,
  busy,
  onClose,
  onConfirm,
}: {
  store: AlibabaConnectedStore;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="st-disconnect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-store-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="st-dialog-close"
          aria-label="关闭解绑确认"
          onClick={onClose}
          disabled={busy}
        >
          <X size={18} />
        </button>
        <div className="st-disconnect-icon">
          <LinkBreak size={24} />
        </div>
        <h2 id="disconnect-store-title">确认解绑 {storeName(store)}？</h2>
        <p>
          这会从上品台移除该店铺的本地授权令牌和已同步商家资料，不会删除 Alibaba
          店铺。再次使用时需要重新授权。
        </p>
        <div className="st-disconnect-actions">
          <button type="button" className="ds-button-secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="ds-button-danger-solid"
            onClick={onConfirm}
            disabled={busy}
          >
            <LinkBreak size={15} />
            {busy ? "正在解绑…" : "确认解绑"}
          </button>
        </div>
      </section>
    </div>
  );
}
