import {
  Buildings,
  CheckCircle,
  FileText,
  LinkSimple,
  ShieldCheck,
  Storefront,
  Truck,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { CapabilityResponse, StoreSettings } from "../types";

type SettingsDrawerProps = {
  open: boolean;
  capabilities: CapabilityResponse | null;
  settings: StoreSettings;
  onClose: () => void;
  onSave: (settings: StoreSettings) => void;
};

type SettingsSection = "connection" | "trade" | "logistics" | "content" | "credentials";

const sections: Array<{
  key: SettingsSection;
  label: string;
  icon: typeof LinkSimple;
}> = [
  { key: "connection", label: "店铺连接", icon: LinkSimple },
  { key: "trade", label: "交易默认", icon: Storefront },
  { key: "logistics", label: "仓储物流", icon: Truck },
  { key: "content", label: "内容模板", icon: FileText },
  { key: "credentials", label: "资质库", icon: ShieldCheck },
];

export function SettingsDrawer({
  open,
  capabilities,
  settings,
  onClose,
  onSave,
}: SettingsDrawerProps) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<SettingsSection>("trade");

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
            <span className="eyebrow">店铺配置</span>
            <h2 id="settings-title">店铺与默认配置</h2>
            <p>只设置一次，新商品自动复用。</p>
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
                  capabilities?.alibaba_credentials_configured ? "is-online" : "is-offline"
                }`}
              />
              {capabilities?.alibaba_credentials_configured ? "已连接" : "尚未连接"}
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
                  title="交易默认设置"
                  description="这些字段适用于全店，可在单个商品中覆盖。"
                />
                <div className="form-grid">
                  <SelectField
                    label="默认币种"
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
                  title="允许自动复用"
                  description="新商品会带出这些已确认内容，仍可逐商品修改。"
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
                  description="凭据保存在服务端，前端不会读取 App Secret 或 Access Token。"
                />
                <div className="status-detail">
                  <Buildings size={30} />
                  <div>
                    <strong>Alibaba.com 国际站</strong>
                    <p>
                      {capabilities?.alibaba_credentials_configured
                        ? "商品、类目、图片银行和发布能力已可用。"
                        : "当前为演示模式，配置服务端凭据后可调用真实账户。"}
                    </p>
                  </div>
                </div>
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
                    label="默认发货港口"
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
                    label="默认品牌"
                    value={draft.brand}
                    onChange={(value) => update("brand", value)}
                  />
                  <TextField
                    label="默认原产国"
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
            <span>已配置 12 / 15 项</span>
          </div>
          <div className="drawer-actions">
            <button type="button" className="button button-secondary" onClick={onClose}>
              取消
            </button>
            <button type="button" className="button button-dark" onClick={() => onSave(draft)}>
              保存默认配置
            </button>
          </div>
        </footer>
      </section>
    </div>
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
        {options.map((option) => (
          <option key={option}>{option}</option>
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
