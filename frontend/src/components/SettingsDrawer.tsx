import {
  ArrowsClockwise,
  Buildings,
  CheckCircle,
  FileText,
  LinkSimple,
  Plus,
  ShieldCheck,
  Storefront,
  Swap,
  Truck,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { AlibabaConnectedStore, CapabilityResponse, StoreSettings } from "../types";

type SettingsDrawerProps = {
  open: boolean;
  capabilities: CapabilityResponse | null;
  settings: StoreSettings;
  stores: AlibabaConnectedStore[];
  activeStoreId: string | null;
  onAuthorizeAlibaba: () => void;
  onSwitchStore: (storeId: string) => void;
  onSyncStore: (storeId: string) => void;
  onClose: () => void;
  onSave: (settings: StoreSettings) => void;
};

type SettingsSection = "connection" | "trade" | "logistics" | "content" | "credentials";

const sections: Array<{
  key: SettingsSection;
  label: string;
  icon: typeof LinkSimple;
}> = [
  { key: "connection", label: "店铺与授权", icon: LinkSimple },
  { key: "trade", label: "批次选项", icon: Storefront },
  { key: "logistics", label: "仓储物流", icon: Truck },
  { key: "content", label: "内容模板", icon: FileText },
  { key: "credentials", label: "资质库", icon: ShieldCheck },
];

export function SettingsDrawer({
  open,
  capabilities,
  settings,
  stores,
  activeStoreId,
  onAuthorizeAlibaba,
  onSwitchStore,
  onSyncStore,
  onClose,
  onSave,
}: SettingsDrawerProps) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<SettingsSection>("connection");
  const connectionState = capabilities?.alibaba_connection_state ?? "unconfigured";
  const connectionLabel = {
    unconfigured: "平台未配置",
    configuration_error: "平台配置有误",
    not_connected: "等待商家授权",
    connected: "已连接",
    expired: "授权已过期",
  }[connectionState];

  useEffect(() => {
    if (open) {
      setDraft(settings);
      document.body.classList.add("has-overlay");
    } else {
      document.body.classList.remove("has-overlay");
    }
    return () => document.body.classList.remove("has-overlay");
  }, [open, settings]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const update = <Key extends keyof StoreSettings>(key: Key, value: StoreSettings[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="drawer-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <span className="eyebrow">客户工作区</span>
            <h2 id="settings-title">店铺与商家资产</h2>
            <p>授权、店铺摘要和可复用的真实商家资料。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={22} />
            <span className="sr-only">关闭设置</span>
          </button>
        </header>

        <div className="authorization-card">
          <div className="alibaba-symbol">a</div>
          <div>
            <strong>Alibaba.com 授权状态</strong>
            <span>
              <i
                className={`connection-dot ${
                  connectionState === "connected" ? "is-online" : "is-offline"
                }`}
              />
              {connectionLabel}
            </span>
          </div>
          <button type="button" className="text-button" onClick={() => setSection("connection")}>
            {capabilities?.alibaba_credentials_configured ? "授权说明" : "连接说明"}
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-index" aria-label="设置分类">
            {sections.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className={section === key ? "is-active" : ""}
                onClick={() => setSection(key)}
              >
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {section === "trade" ? (
              <>
                <SettingsHeading
                  title="本批次上次选择"
                  description="仅帮助下次填写；创建批次时仍需明确确认目标店铺与资源。"
                />
                <div className="form-grid">
                  <SelectField
                    label="币种"
                    value={draft.currency}
                    options={["USD", "EUR", "CNY"]}
                    onChange={(value) => update("currency", value)}
                  />
                  <SelectField
                    label="计量单位"
                    value={draft.priceUnit}
                    options={["Sets", "Pieces", "Boxes"]}
                    onChange={(value) => update("priceUnit", value)}
                  />
                  <TextField
                    label="商品分组"
                    value={draft.productGroupLabel}
                    onChange={(value) => update("productGroupLabel", value)}
                  />
                  <TextField
                    label="图片银行分组"
                    value={draft.photoBankGroupLabel}
                    onChange={(value) => update("photoBankGroupLabel", value)}
                  />
                </div>
                <SettingsHeading
                  title="允许带出商家资产"
                  description="仅复用已确认的商家资料，商品事实仍需逐商品确认。"
                />
                <div className="toggle-list">
                  <ToggleRow
                    label="公司介绍"
                    checked={draft.reuseCompanyProfile}
                    onChange={(value) => update("reuseCompanyProfile", value)}
                  />
                  <ToggleRow
                    label="售后说明"
                    checked={draft.reuseAfterSales}
                    onChange={(value) => update("reuseAfterSales", value)}
                  />
                  <ToggleRow
                    label="定制说明"
                    checked={draft.reuseCustomization}
                    onChange={(value) => update("reuseCustomization", value)}
                  />
                  <ToggleRow
                    label="详情页版式"
                    checked={draft.reuseDetailTemplate}
                    onChange={(value) => update("reuseDetailTemplate", value)}
                  />
                  <ToggleRow
                    label="原产国"
                    checked={draft.reuseOrigin}
                    onChange={(value) => update("reuseOrigin", value)}
                  />
                </div>
              </>
            ) : null}

            {section === "connection" ? (
              <>
                <SettingsHeading
                  title="店铺连接"
                  description="通过 Alibaba.com 官方授权连接店铺，平台不会读取店铺登录密码。"
                />
                <div className="status-detail">
                  <Buildings size={30} />
                  <div>
                    <strong>Alibaba.com 国际站</strong>
                    <p>
                      {connectionState === "connected"
                        ? "商品、类目、图片银行和发布能力已可用。"
                        : connectionState === "not_connected"
                          ? "平台已配置，等待商家登录 Alibaba.com 完成授权。"
                          : connectionState === "expired"
                            ? "店铺授权已过期，需要商家重新登录授权。"
                            : "平台 OAuth 尚未正确配置，暂时无法连接真实店铺。"}
                    </p>
                  </div>
                </div>
                <div className="oauth-connect-card">
                  <div>
                    <strong>添加 Alibaba.com 店铺</strong>
                    <p>每次授权都会绑定到当前客户工作区，已有店铺不会被覆盖。</p>
                  </div>
                  <button
                    type="button"
                    className="button button-dark"
                    onClick={onAuthorizeAlibaba}
                    disabled={!capabilities?.alibaba_oauth_configured}
                  >
                    <Plus size={18} />
                    {capabilities?.alibaba_oauth_configured ? "添加店铺" : "等待平台配置"}
                  </button>
                  {capabilities?.alibaba_oauth_configuration_error ? (
                    <small>{capabilities.alibaba_oauth_configuration_error}</small>
                  ) : capabilities?.alibaba_oauth_redirect_uri ? (
                    <small>授权完成后返回：{capabilities.alibaba_oauth_redirect_uri}</small>
                  ) : null}
                </div>
                {stores.length > 0 ? (
                  <div className="connected-stores">
                    <div className="connected-stores-heading">
                      <div>
                        <strong>已连接店铺</strong>
                        <span>{stores.length} 个店铺与当前工作区隔离保存</span>
                      </div>
                    </div>
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
                  </div>
                ) : (
                  <div className="empty-store-state">
                    <Buildings size={28} />
                    <strong>还没有连接店铺</strong>
                    <p>点击“添加店铺”，在 Alibaba 官方弹窗中完成登录和授权。</p>
                  </div>
                )}
              </>
            ) : null}

            {section === "logistics" ? (
              <>
                <SettingsHeading
                  title="仓储与物流"
                  description="只复用真实存在的仓库、库存地点和运费模板。"
                />
                <div className="form-grid">
                  <TextField
                    label="仓库"
                    value={draft.warehouseLabel}
                    onChange={(value) => update("warehouseLabel", value)}
                  />
                  <TextField
                    label="库存地点编码"
                    value={draft.inventoryCode}
                    onChange={(value) => update("inventoryCode", value)}
                  />
                  <TextField
                    label="运费模板"
                    value={draft.shippingTemplateLabel}
                    onChange={(value) => update("shippingTemplateLabel", value)}
                  />
                  <TextField
                    label="常用发货港口"
                    value={draft.port}
                    onChange={(value) => update("port", value)}
                  />
                </div>
              </>
            ) : null}

            {section === "content" ? (
              <>
                <SettingsHeading
                  title="内容模板"
                  description="AI 只能润色这里保存的真实店铺信息。"
                />
                <TextAreaField
                  label="公司介绍"
                  value={draft.companyProfile}
                  onChange={(value) => update("companyProfile", value)}
                />
                <TextAreaField
                  label="售后说明"
                  value={draft.afterSalesPolicy}
                  onChange={(value) => update("afterSalesPolicy", value)}
                />
                <TextAreaField
                  label="定制说明"
                  value={draft.customizationPolicy}
                  onChange={(value) => update("customizationPolicy", value)}
                />
              </>
            ) : null}

            {section === "credentials" ? (
              <>
                <SettingsHeading
                  title="品牌与资质库"
                  description="商品只需选择已验证且适用的资质，不重复上传。"
                />
                <div className="form-grid">
                  <TextField
                    label="常用品牌"
                    value={draft.brand}
                    onChange={(value) => update("brand", value)}
                  />
                  <TextField
                    label="常用原产国"
                    value={draft.origin}
                    onChange={(value) => update("origin", value)}
                  />
                </div>
                <div className="empty-credential">
                  <ShieldCheck size={30} />
                  <strong>资质文件由后端业务系统管理</strong>
                  <p>第一版只展示已验证资质，不在当前前端保存敏感文件。</p>
                </div>
              </>
            ) : null}

            <div className="settings-warning">
              <Warning size={19} weight="fill" />
              <p>价格、SKU、库存、材质、尺寸、重量和认证不能设为全店默认值。</p>
            </div>
          </div>
        </div>

        <footer className="drawer-footer">
          <div className="settings-progress">
            <CheckCircle size={20} weight="fill" />
            <span>按当前工作区与店铺独立保存</span>
          </div>
          <div className="drawer-actions">
            <button type="button" className="button button-secondary" onClick={onClose}>
              取消
            </button>
            <button type="button" className="button button-dark" onClick={() => onSave(draft)}>
              保存店铺资料
            </button>
          </div>
        </footer>
      </section>
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

function SettingsHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="settings-heading">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">创建批次时选择</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea value={value} rows={4} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        className="switch-input"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
