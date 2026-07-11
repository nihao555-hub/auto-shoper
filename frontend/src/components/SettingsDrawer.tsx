import {
  CheckCircle,
  FileText,
  ShieldCheck,
  Storefront,
  Truck,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { getMissingStoreTemplateFields } from "../data";
import type { StoreSettings } from "../types";

type SettingsDrawerProps = {
  open: boolean;
  settings: StoreSettings;
  onClose: () => void;
  onSave: (settings: StoreSettings) => void;
  onSyncFromStore?: () => void | Promise<void>;
  syncing?: boolean;
  canSyncFromStore?: boolean;
};

type SettingsSection = "trade" | "logistics" | "content" | "credentials";

const sections: Array<{
  key: SettingsSection;
  label: string;
  icon: typeof Storefront;
}> = [
  { key: "trade", label: "批次选项", icon: Storefront },
  { key: "logistics", label: "仓储物流", icon: Truck },
  { key: "content", label: "内容模板", icon: FileText },
  { key: "credentials", label: "资质库", icon: ShieldCheck },
];

export function SettingsDrawer({
  open,
  settings,
  onClose,
  onSave,
  onSyncFromStore,
  syncing = false,
  canSyncFromStore = false,
}: SettingsDrawerProps) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<SettingsSection>("trade");
  const missingRequired = getMissingStoreTemplateFields(draft);

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
            <h2 id="settings-title">商家资产与批次偏好</h2>
            <p>维护可复用的真实资料；店铺连接与切换请前往“店铺授权”。</p>
          </div>
          <div className="drawer-header-actions">
            {onSyncFromStore ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void onSyncFromStore()}
                disabled={syncing || !canSyncFromStore}
                title={canSyncFromStore ? undefined : "请先连接并选择店铺"}
              >
                {syncing ? "同步中…" : "从店铺同步"}
              </button>
            ) : null}
            <button type="button" className="icon-button" onClick={onClose}>
              <X size={22} />
              <span className="sr-only">关闭设置</span>
            </button>
          </div>
        </header>

        {missingRequired.length ? (
          <div className="settings-required-banner" role="status">
            <Warning size={18} weight="fill" />
            <p>
              批量上品前需完成通用模板，还差：
              {missingRequired.map((field) => field.label).join("、")}
              。可先“从店铺同步”，剩余项手动填写。
            </p>
          </div>
        ) : null}

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
                  emptyPrompt="未从店铺获取到，请填写"
                  onChange={(value) => update("companyProfile", value)}
                />
                <TextAreaField
                  label="售后说明"
                  value={draft.afterSalesPolicy}
                  emptyPrompt="未从店铺获取到，请填写"
                  onChange={(value) => update("afterSalesPolicy", value)}
                />
                <TextAreaField
                  label="定制说明"
                  value={draft.customizationPolicy}
                  emptyPrompt="未从店铺获取到，请填写"
                  onChange={(value) => update("customizationPolicy", value)}
                />
                <TextAreaField
                  label="详情页版式"
                  value={draft.detailTemplate}
                  emptyPrompt="未从店铺获取到，请填写"
                  onChange={(value) => update("detailTemplate", value)}
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
                    emptyPrompt="未从店铺获取到，请填写"
                    onChange={(value) => update("brand", value)}
                  />
                  <TextField
                    label="常用原产国"
                    value={draft.origin}
                    emptyPrompt="未从店铺获取到，请填写"
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
              保存商家资料
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
  emptyPrompt,
  onChange,
}: {
  label: string;
  value: string;
  emptyPrompt?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
      {!value && emptyPrompt ? <small className="field-hint">{emptyPrompt}</small> : null}
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
  emptyPrompt,
  onChange,
}: {
  label: string;
  value: string;
  emptyPrompt?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea value={value} rows={4} onChange={(event) => onChange(event.target.value)} />
      {!value && emptyPrompt ? <small className="field-hint">{emptyPrompt}</small> : null}
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
