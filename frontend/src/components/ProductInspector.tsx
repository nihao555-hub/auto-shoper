import {
  CaretDown,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Info,
  Warning,
  X,
} from "@phosphor-icons/react";
import type { ProductFacts, ProductRecord } from "../types";

type ProductInspectorProps = {
  product: ProductRecord;
  productIndex: number;
  total: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onChange: (product: ProductRecord) => void;
  onSave: () => void;
};

export function ProductInspector({
  product,
  productIndex,
  total,
  onClose,
  onPrevious,
  onNext,
  onChange,
  onSave,
}: ProductInspectorProps) {
  const changeFact = <Key extends keyof ProductFacts>(key: Key, value: ProductFacts[Key]) => {
    onChange({
      ...product,
      facts: {
        ...product.facts,
        [key]: value,
      },
    });
  };

  return (
    <aside className="product-inspector" aria-label="当前商品资料">
      <header className="inspector-header">
        <div>
          <span className="eyebrow">
            商品 {productIndex + 1} / {total}
          </span>
          <h2>{product.title || "未命名商品"}</h2>
          <p>内部参考 / Ref: {product.reference}</p>
        </div>
        <div className="inspector-controls">
          <div className="button-group">
            <button
              type="button"
              className="icon-button"
              onClick={onPrevious}
              disabled={productIndex === 0}
            >
              <CaretLeft size={18} />
              <span className="sr-only">上一个商品</span>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onNext}
              disabled={productIndex === total - 1}
            >
              <CaretRight size={18} />
              <span className="sr-only">下一个商品</span>
            </button>
          </div>
          <button type="button" className="icon-button inspector-close" onClick={onClose}>
            <X size={19} />
            <span className="sr-only">关闭商品详情</span>
          </button>
        </div>
      </header>

      <div className="inspector-status">
        {product.aiConfirmed ? (
          <span className="source-badge source-confirmed">
            <CheckCircle size={14} weight="fill" />
            AI 内容已确认
          </span>
        ) : (
          <span className="source-badge source-ai">
            <Info size={14} weight="fill" />
            AI 候选待确认
          </span>
        )}
        <span className="source-badge source-default">店铺默认 5 项</span>
      </div>

      <div className="inspector-scroll">
        <details className="inspector-section" open>
          <summary>
            <span>基础信息</span>
            <CaretDown size={17} />
          </summary>
          <div className="inspector-fields">
            <label className="field field-wide">
              <span>
                英文标题 <em>AI 已确认</em>
              </span>
              <textarea
                rows={3}
                value={product.title}
                onChange={(event) => onChange({ ...product, title: event.target.value })}
              />
              <small>{product.title.length}/128</small>
            </label>
            <label className="field field-wide">
              <span>
                最终叶子类目 <em>用户确认</em>
              </span>
              <input
                value={product.facts.categoryLabel}
                onChange={(event) => changeFact("categoryLabel", event.target.value)}
              />
            </label>
            <div className="form-grid">
              <InspectorInput
                label="品牌"
                value={product.facts.brand}
                onChange={(value) => changeFact("brand", value)}
              />
              <InspectorInput
                label="型号"
                value={product.facts.model}
                required
                onChange={(value) => changeFact("model", value)}
              />
              <InspectorInput
                label="材质"
                value={product.facts.material}
                required
                onChange={(value) => changeFact("material", value)}
              />
              <InspectorInput
                label="原产国"
                value={product.facts.origin}
                note="店铺默认"
                onChange={(value) => changeFact("origin", value)}
              />
            </div>
          </div>
        </details>

        <details className="inspector-section" open>
          <summary>
            <span>SKU 与定价</span>
            <CaretDown size={17} />
          </summary>
          <div className="inspector-fields">
            <div className="form-grid form-grid-three">
              <InspectorInput
                label="价格 (USD)"
                value={product.facts.price}
                required
                inputMode="decimal"
                onChange={(value) => changeFact("price", value)}
              />
              <InspectorInput
                label="MOQ"
                value={product.facts.moq}
                required
                inputMode="numeric"
                onChange={(value) => changeFact("moq", value)}
              />
              <InspectorInput
                label="库存"
                value={product.facts.stock}
                required
                inputMode="numeric"
                onChange={(value) => changeFact("stock", value)}
              />
            </div>
            <div className="inline-defaults">
              <span>计量单位: Sets</span>
              <span>币种: USD</span>
              <button type="button">修改店铺默认</button>
            </div>
          </div>
        </details>

        <details className="inspector-section" open>
          <summary>
            <span>商品与包装</span>
            <CaretDown size={17} />
          </summary>
          <div className="inspector-fields">
            <FieldLabel text="商品尺寸 (cm)" />
            <div className="dimension-row">
              <InspectorInput
                label="长"
                hideLabel
                value={product.facts.productLength}
                inputMode="decimal"
                onChange={(value) => changeFact("productLength", value)}
              />
              <span>×</span>
              <InspectorInput
                label="宽"
                hideLabel
                value={product.facts.productWidth}
                inputMode="decimal"
                onChange={(value) => changeFact("productWidth", value)}
              />
              <span>×</span>
              <InspectorInput
                label="高"
                hideLabel
                value={product.facts.productHeight}
                inputMode="decimal"
                onChange={(value) => changeFact("productHeight", value)}
              />
              <InspectorInput
                label="净重 (kg)"
                value={product.facts.netWeight}
                inputMode="decimal"
                onChange={(value) => changeFact("netWeight", value)}
              />
            </div>
            <FieldLabel text="包装尺寸 (cm)" />
            <div className="dimension-row">
              <InspectorInput
                label="长"
                hideLabel
                value={product.facts.packageLength}
                inputMode="decimal"
                onChange={(value) => changeFact("packageLength", value)}
              />
              <span>×</span>
              <InspectorInput
                label="宽"
                hideLabel
                value={product.facts.packageWidth}
                inputMode="decimal"
                onChange={(value) => changeFact("packageWidth", value)}
              />
              <span>×</span>
              <InspectorInput
                label="高"
                hideLabel
                value={product.facts.packageHeight}
                inputMode="decimal"
                onChange={(value) => changeFact("packageHeight", value)}
              />
              <InspectorInput
                label="毛重 (kg)"
                value={product.facts.grossWeight}
                invalid={!product.facts.grossWeight}
                inputMode="decimal"
                onChange={(value) => changeFact("grossWeight", value)}
              />
            </div>
            {!product.facts.grossWeight ? (
              <p className="field-error">
                <Warning size={15} weight="fill" />
                包装毛重必须大于 0
              </p>
            ) : null}
            <div className="form-grid">
              <InspectorInput
                label="每箱数量"
                value={product.facts.unitsPerCarton}
                inputMode="numeric"
                onChange={(value) => changeFact("unitsPerCarton", value)}
              />
              <InspectorInput
                label="交期 (天)"
                value={product.facts.leadTime}
                inputMode="numeric"
                onChange={(value) => changeFact("leadTime", value)}
              />
            </div>
          </div>
        </details>

        <details className="inspector-section">
          <summary>
            <span>合规与认证</span>
            <CaretDown size={17} />
          </summary>
          <div className="inspector-fields">
            <InspectorInput
              label="HS Code"
              value={product.facts.hsCode}
              onChange={(value) => changeFact("hsCode", value)}
            />
            <div className="credential-note">
              <ShieldRow text="当前商品未选择认证" />
              <button type="button" className="text-button">
                从资质库选择
              </button>
            </div>
          </div>
        </details>
      </div>

      <footer className="inspector-footer">
        <button type="button" className="button button-dark button-block" onClick={onSave}>
          保存并继续
        </button>
      </footer>
    </aside>
  );
}

function InspectorInput({
  label,
  value,
  onChange,
  required,
  invalid,
  note,
  hideLabel,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  invalid?: boolean;
  note?: string;
  hideLabel?: boolean;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <label className={`field ${invalid ? "is-invalid" : ""}`}>
      <span className={hideLabel ? "sr-only" : ""}>
        {label}
        {required ? <b>*</b> : null}
        {note ? <em>{note}</em> : null}
      </span>
      <input
        aria-label={hideLabel ? label : undefined}
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <p className="field-label">{text}</p>;
}

function ShieldRow({ text }: { text: string }) {
  return (
    <span>
      <Info size={16} />
      {text}
    </span>
  );
}
