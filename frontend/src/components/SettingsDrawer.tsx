import { FileText, ShieldCheck, Storefront, Truck, Warning, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  findPhotoBankGroups,
  findProductGroups,
  findShippingTemplates,
  listPhotoBankGroups,
  listProductGroups,
  listShippingTemplates,
} from "../api";
import type { StoreLinkedOption } from "../api";
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
  canLoadStoreOptions?: boolean;
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

const uniqueOptions = (options: StoreLinkedOption[]): StoreLinkedOption[] =>
  Array.from(new Map(options.map((option) => [option.id, option])).values());

export function SettingsDrawer({
  open,
  settings,
  onClose,
  onSave,
  onSyncFromStore,
  syncing = false,
  canSyncFromStore = false,
  canLoadStoreOptions = false,
}: SettingsDrawerProps) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<SettingsSection>("trade");
  const [productGroups, setProductGroups] = useState<StoreLinkedOption[]>([]);
  const [photoBankGroups, setPhotoBankGroups] = useState<StoreLinkedOption[]>([]);
  const [shippingTemplates, setShippingTemplates] = useState<StoreLinkedOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");
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
    if (!open || !canLoadStoreOptions) {
      return;
    }
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError("");
    void Promise.allSettled([
      listProductGroups(),
      listPhotoBankGroups(),
      listShippingTemplates(),
    ]).then((results) => {
      if (cancelled) {
        return;
      }
      const [productResult, photoResult, shippingResult] = results;
      const failures: string[] = [];
      if (productResult.status === "fulfilled") {
        setProductGroups(uniqueOptions(findProductGroups(productResult.value)));
      } else {
        failures.push("商品分组");
      }
      if (photoResult.status === "fulfilled") {
        setPhotoBankGroups(uniqueOptions(findPhotoBankGroups(photoResult.value)));
      } else {
        failures.push("图片银行分组");
      }
      if (shippingResult.status === "fulfilled") {
        setShippingTemplates(uniqueOptions(findShippingTemplates(shippingResult.value)));
      } else {
        failures.push("运费模板");
      }
      setOptionsError(failures.length ? `${failures.join("、")}加载失败，请关闭后重试。` : "");
      setOptionsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [canLoadStoreOptions, open]);

  useEffect(() => {
    if (!open || optionsLoading) {
      return;
    }
    setDraft((current) => {
      const productGroup = productGroups.find((option) => option.id === current.productGroupId);
      const photoBankGroup = photoBankGroups.find(
        (option) => option.id === current.photoBankGroupId,
      );
      const shippingTemplate = shippingTemplates.find(
        (option) => option.id === current.shippingTemplateId,
      );
      const next = {
        ...current,
        productGroupLabel: productGroup?.name ?? current.productGroupLabel,
        photoBankGroupLabel: photoBankGroup?.name ?? current.photoBankGroupLabel,
        shippingTemplateLabel: shippingTemplate?.name ?? current.shippingTemplateLabel,
      };
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [open, optionsLoading, photoBankGroups, productGroups, shippingTemplates]);

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

  const updateLinkedOption = (
    idKey: "productGroupId" | "photoBankGroupId" | "shippingTemplateId",
    labelKey: "productGroupLabel" | "photoBankGroupLabel" | "shippingTemplateLabel",
    value: string,
    options: StoreLinkedOption[],
  ) => {
    const selected = options.find((option) => option.id === value);
    setDraft((current) => ({
      ...current,
      [idKey]: value,
      [labelKey]: selected?.name ?? "",
    }));
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
            <h2 id="settings-title">商家资产与批次偏好</h2>
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
            <p>待补齐：{missingRequired.map((field) => field.label).join("、")}</p>
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
                <SettingsHeading title="本批次上次选择" />
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
                  <StoreOptionSelect
                    label="商品分组"
                    id={draft.productGroupId}
                    value={draft.productGroupLabel}
                    options={productGroups}
                    loading={optionsLoading}
                    error={optionsError}
                    onChange={(value) =>
                      updateLinkedOption(
                        "productGroupId",
                        "productGroupLabel",
                        value,
                        productGroups,
                      )
                    }
                  />
                  <StoreOptionSelect
                    label="图片银行分组"
                    id={draft.photoBankGroupId}
                    value={draft.photoBankGroupLabel}
                    options={photoBankGroups}
                    loading={optionsLoading}
                    error={optionsError}
                    onChange={(value) =>
                      updateLinkedOption(
                        "photoBankGroupId",
                        "photoBankGroupLabel",
                        value,
                        photoBankGroups,
                      )
                    }
                  />
                </div>
                <SettingsHeading title="允许带出商家资产" />
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
                <SettingsHeading title="仓储与物流" />
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
                  <StoreOptionSelect
                    label="运费模板"
                    id={draft.shippingTemplateId}
                    value={draft.shippingTemplateLabel}
                    options={shippingTemplates}
                    loading={optionsLoading}
                    error={optionsError}
                    onChange={(value) =>
                      updateLinkedOption(
                        "shippingTemplateId",
                        "shippingTemplateLabel",
                        value,
                        shippingTemplates,
                      )
                    }
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
                <SettingsHeading title="内容模板" />
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
                <SettingsHeading title="品牌与资质库" />
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
                  <strong>暂无资质文件</strong>
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

function SettingsHeading({ title }: { title: string }) {
  return (
    <div className="settings-heading">
      <h3>{title}</h3>
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

function StoreOptionSelect({
  label,
  id,
  value,
  options,
  loading,
  error,
  onChange,
}: {
  label: string;
  id: string;
  value: string;
  options: StoreLinkedOption[];
  loading: boolean;
  error: string;
  onChange: (value: string) => void;
}) {
  const hasCurrentOption = options.some((option) => option.id === id);
  return (
    <label className="field">
      <span>{label}</span>
      <select value={id} onChange={(event) => onChange(event.target.value)} disabled={loading}>
        <option value="">{loading ? "正在读取店铺选项…" : `请选择真实${label}`}</option>
        {id && !hasCurrentOption ? <option value={id}>{value || id}（当前配置）</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      {error ? <small className="field-hint">{error}</small> : null}
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
