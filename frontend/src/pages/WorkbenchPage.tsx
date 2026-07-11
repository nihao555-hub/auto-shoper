import {
  ArrowRight,
  Check,
  CheckCircle,
  CheckSquare,
  CircleNotch,
  CloudArrowUp,
  FileText,
  GearSix,
  Image,
  Info,
  MagicWand,
  MagnifyingGlass,
  Package,
  PencilSimple,
  Plus,
  Sparkle,
  Trash,
  UploadSimple,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analyzeProductImage,
  createDraftBatch,
  findSchemaData,
  getCategorySchema,
  getListingFieldMatrix,
  publishBatch,
} from "../api";
import { ProductInspector } from "../components/ProductInspector";
import { createEmptyFacts } from "../data";
import type {
  CapabilityResponse,
  DraftField,
  ImageAnalysisResponse,
  ListingFieldGroup,
  ProductRecord,
  StoreSettings,
  ToastMessage,
} from "../types";

type WorkbenchPageProps = {
  capabilities: CapabilityResponse | null;
  products: ProductRecord[];
  settings: StoreSettings;
  onProductsChange: (products: ProductRecord[]) => void;
  onOpenSettings: () => void;
  onNavigateBatches: () => void;
  notify: (tone: ToastMessage["tone"], title: string, detail?: string) => void;
};

const steps = [
  { label: "上传商品", caption: "一图一商品" },
  { label: "AI 生成", caption: "确认内容候选" },
  { label: "补齐资料", caption: "只填真实事实" },
  { label: "创建草稿", caption: "实时 Schema 校验" },
  { label: "预览发布", caption: "确认后正式发布" },
];

const requiredFactKeys: Array<keyof ProductRecord["facts"]> = [
  "categoryId",
  "model",
  "material",
  "price",
  "moq",
  "stock",
  "grossWeight",
];

export function WorkbenchPage({
  capabilities,
  products,
  settings,
  onProductsChange,
  onOpenSettings,
  onNavigateBatches,
  notify,
}: WorkbenchPageProps) {
  const [step, setStep] = useState(2);
  const [activeProductId, setActiveProductId] = useState(products[0]?.id ?? "");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [fieldGroups, setFieldGroups] = useState<ListingFieldGroup[]>([]);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getListingFieldMatrix()
      .then(setFieldGroups)
      .catch(() => setFieldGroups([]));
  }, []);

  useEffect(() => {
    if (!products.some((product) => product.id === activeProductId)) {
      setActiveProductId(products[0]?.id ?? "");
    }
  }, [activeProductId, products]);

  const activeProduct =
    products.find((product) => product.id === activeProductId) ?? products[0] ?? null;
  const activeIndex = activeProduct
    ? products.findIndex((product) => product.id === activeProduct.id)
    : -1;

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return products;
    }
    return products.filter(
      (product) =>
        product.title.toLowerCase().includes(normalized) ||
        product.reference.toLowerCase().includes(normalized) ||
        product.facts.model.toLowerCase().includes(normalized),
    );
  }, [products, query]);

  const aiPending = products.filter((product) => !product.aiConfirmed).length;
  const incompleteProducts = products.filter((product) => getProductErrors(product).length > 0);
  const draftedProducts = products.filter(
    (product) => product.stage === "drafted" || product.stage === "published",
  );
  const publishedProducts = products.filter((product) => product.stage === "published");

  const updateProduct = (nextProduct: ProductRecord) => {
    onProductsChange(
      products.map((product) => (product.id === nextProduct.id ? nextProduct : product)),
    );
  };

  const replaceProduct = (id: string, updater: (product: ProductRecord) => ProductRecord) => {
    onProductsChange(products.map((product) => (product.id === id ? updater(product) : product)));
  };

  const handleFiles = (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      notify("warning", "没有可用图片", "请选择 JPG、PNG 或 WebP 商品图片。");
      return;
    }

    const now = Date.now();
    const newProducts = imageFiles.map<ProductRecord>((file, index) => ({
      id: `uploaded-${now}-${index}`,
      reference: `AUTO-${String(now).slice(-6)}-${String(index + 1).padStart(2, "0")}`,
      imageUrl: URL.createObjectURL(file),
      sourceFile: file,
      title: "",
      keywords: [],
      sellingPoints: [],
      description: "",
      visibleTraits: [],
      aiConfirmed: false,
      stage: "uploaded",
      facts: createEmptyFacts(settings),
      errors: ["等待 AI 分析"],
    }));

    const shouldReplaceDemo = products.length > 0 && products.every((product) => product.isDemo);
    const nextProducts = shouldReplaceDemo ? newProducts : [...products, ...newProducts];
    onProductsChange(nextProducts);
    setActiveProductId(newProducts[0].id);
    setStep(0);
    setInspectorOpen(false);
    notify("success", `已加入 ${newProducts.length} 个商品`, "每张图片已建立一条商品记录。");
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      handleFiles(event.target.files);
      event.target.value = "";
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const analyzeOne = async (product: ProductRecord) => {
    replaceProduct(product.id, (current) => ({
      ...current,
      stage: "analyzing",
      errors: [],
    }));

    if (product.isDemo || !product.sourceFile) {
      await delay(650);
      replaceProduct(product.id, (current) => ({
        ...current,
        stage: "ai_ready",
        errors: current.aiConfirmed ? [] : ["AI 内容尚未确认"],
      }));
      return;
    }

    try {
      const response = await analyzeProductImage(product.sourceFile);
      replaceProduct(product.id, (current) => applyAnalysis(current, response));
    } catch (error) {
      replaceProduct(product.id, (current) => ({
        ...current,
        stage: "error",
        errors: [error instanceof Error ? error.message : "AI 分析失败"],
      }));
    }
  };

  const analyzeAll = async () => {
    if (!products.length) {
      notify("warning", "请先上传商品图片");
      return;
    }
    setBusy(true);
    await Promise.all(
      products
        .filter((product) => product.stage === "uploaded" || product.stage === "error")
        .map(analyzeOne),
    );
    setBusy(false);
    setStep(1);
    notify("success", "AI 分析已完成", "请确认标题、类目建议和图片可见属性。");
  };

  const confirmAi = (id: string) => {
    replaceProduct(id, (product) => ({
      ...product,
      aiConfirmed: true,
      stage: "facts_needed",
      errors: getProductErrors({ ...product, aiConfirmed: true }),
    }));
  };

  const confirmAllAi = () => {
    onProductsChange(
      products.map((product) => ({
        ...product,
        aiConfirmed: true,
        stage:
          getProductErrors({ ...product, aiConfirmed: true }).length === 0
            ? "ready"
            : "facts_needed",
        errors: getProductErrors({ ...product, aiConfirmed: true }),
      })),
    );
    notify("success", "已确认全部 AI 内容", "交易、履约和合规事实仍需可信数据。");
  };

  const saveInspector = () => {
    if (!activeProduct) {
      return;
    }
    const errors = getProductErrors(activeProduct);
    updateProduct({
      ...activeProduct,
      errors,
      stage: errors.length ? "facts_needed" : "ready",
    });
    if (errors.length) {
      notify("warning", "商品资料尚未完整", `还需处理 ${errors.length} 项。`);
    } else {
      notify("success", "商品资料已完整", "可以继续校验并创建草稿。");
    }
  };

  const validateAll = () => {
    const nextProducts = products.map((product) => {
      const errors = getProductErrors(product);
      return {
        ...product,
        errors,
        stage: errors.length ? ("facts_needed" as const) : ("ready" as const),
      };
    });
    onProductsChange(nextProducts);
    const failures = nextProducts.filter((product) => product.errors.length).length;
    if (failures) {
      notify("warning", `${failures} 个商品仍需补充资料`, "打开商品详情可直接定位缺失项。");
    } else {
      notify("success", "全部商品通过前端预检", "下一步将获取实时 Alibaba Schema。");
    }
  };

  const createDrafts = async () => {
    const targets = getActionProducts(products, selected).filter(
      (product) => getProductErrors(product).length === 0,
    );
    if (!targets.length) {
      notify("warning", "没有可创建草稿的商品", "请先确认 AI 内容并补齐真实资料。");
      return;
    }

    setBusy(true);
    setStep(3);
    markProducts(targets, "drafting");
    try {
      if (targets.every((product) => product.isDemo)) {
        await delay(950);
        const targetIds = new Set(targets.map((product) => product.id));
        onProductsChange(
          products.map((product) =>
            targetIds.has(product.id)
              ? {
                  ...product,
                  stage: "drafted",
                  draftProductId: `DRAFT-${product.reference}`,
                  errors: [],
                }
              : product,
          ),
        );
        notify("success", `已创建 ${targets.length} 个演示草稿`, "没有联系或改动真实账户。");
        setStep(4);
        return;
      }

      const prepared = await Promise.all(
        targets.map(async (product) => {
          if (product.schemaData) {
            return product;
          }
          const payload = await getCategorySchema(product.facts.categoryId);
          const schemaData = findSchemaData(payload);
          if (!schemaData) {
            throw new Error(`${product.reference} 未从 Alibaba 响应中找到 Schema`);
          }
          return { ...product, schemaData };
        }),
      );
      const results = await createDraftBatch(prepared, settings);
      const preparedByReference = new Map(prepared.map((product) => [product.reference, product]));
      const resultByReference = new Map(results.map((result) => [result.reference, result]));
      onProductsChange(
        products.map((product) => {
          const result = resultByReference.get(product.reference);
          const preparedProduct = preparedByReference.get(product.reference);
          if (!result || !preparedProduct) {
            return product;
          }
          return {
            ...preparedProduct,
            stage: result.success ? "drafted" : "error",
            errors: result.success ? [] : [result.error ?? "草稿创建失败"],
            draftProductId: result.success ? getProductId(result.response) : undefined,
          };
        }),
      );
      const succeeded = results.filter((result) => result.success).length;
      notify(
        succeeded === results.length ? "success" : "warning",
        `草稿创建完成: ${succeeded}/${results.length}`,
        "失败商品已隔离，不影响其他商品。",
      );
      setStep(4);
    } catch (error) {
      markProducts(targets, "error", error instanceof Error ? error.message : "草稿创建失败");
      notify("error", "草稿创建失败", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const confirmPublish = async () => {
    const targets = getActionProducts(products, selected).filter(
      (product) => product.stage === "drafted",
    );
    if (!publishConfirmed || !targets.length) {
      return;
    }
    setBusy(true);
    setPublishDialogOpen(false);
    markProducts(targets, "publishing");
    try {
      if (targets.every((product) => product.isDemo)) {
        await delay(900);
        const targetIds = new Set(targets.map((product) => product.id));
        onProductsChange(
          products.map((product) =>
            targetIds.has(product.id) ? { ...product, stage: "published" } : product,
          ),
        );
        notify("success", "演示发布流程已完成", "演示商品不会写入真实 Alibaba 账户。");
        return;
      }
      const results = await publishBatch(targets, settings);
      const resultByReference = new Map(results.map((result) => [result.reference, result]));
      onProductsChange(
        products.map((product) => {
          const result = resultByReference.get(product.reference);
          if (!result) {
            return product;
          }
          return {
            ...product,
            stage: result.success ? "published" : "error",
            errors: result.success ? [] : [result.error ?? "正式发布失败"],
          };
        }),
      );
      const succeeded = results.filter((result) => result.success).length;
      notify(
        succeeded === results.length ? "success" : "warning",
        `发布请求完成: ${succeeded}/${results.length}`,
        "请继续关注 Alibaba 审核状态。",
      );
    } catch (error) {
      markProducts(targets, "error", error instanceof Error ? error.message : "发布失败");
      notify("error", "正式发布失败", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
      setPublishConfirmed(false);
    }
  };

  const markProducts = (
    targets: ProductRecord[],
    stage: ProductRecord["stage"],
    error?: string,
  ) => {
    const targetIds = new Set(targets.map((product) => product.id));
    onProductsChange(
      products.map((product) =>
        targetIds.has(product.id)
          ? { ...product, stage, errors: error ? [error] : product.errors }
          : product,
      ),
    );
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((current) =>
      current.size === filteredProducts.length
        ? new Set()
        : new Set(filteredProducts.map((product) => product.id)),
    );
  };

  const removeProduct = (id: string) => {
    const product = products.find((item) => item.id === id);
    if (product?.sourceFile) {
      URL.revokeObjectURL(product.imageUrl);
    }
    onProductsChange(products.filter((item) => item.id !== id));
  };

  const goNext = () => {
    if (step === 0) {
      void analyzeAll();
      return;
    }
    if (step === 1 && aiPending > 0) {
      notify("warning", "还有 AI 内容未确认", "确认后才能进入可信资料填写。");
      return;
    }
    if (step === 2) {
      validateAll();
      setStep(3);
      return;
    }
    if (step === 3) {
      void createDrafts();
      return;
    }
    if (step === 4) {
      setPublishDialogOpen(true);
    }
  };

  return (
    <div className={`page workbench-page ${inspectorOpen ? "has-inspector" : ""}`}>
      <header className="page-header workbench-header">
        <div>
          <span className="eyebrow">批次 B250521-001</span>
          <h1>批量上品工作台</h1>
          <p>上传商品图，补齐真实资料，通过草稿回读后再发布。</p>
        </div>
        <div className="header-actions">
          <div className="account-status">
            <span className="alibaba-symbol small">a</span>
            <div>
              <strong>Alibaba.com</strong>
              <span>
                <i
                  className={`connection-dot ${
                    capabilities?.alibaba_credentials_configured ? "is-online" : "is-offline"
                  }`}
                />
                {capabilities?.alibaba_credentials_configured ? "已连接" : "演示模式"}
              </span>
            </div>
          </div>
          <button type="button" className="button button-secondary" onClick={onNavigateBatches}>
            <FileText size={18} />
            批次记录
          </button>
          <button type="button" className="button button-secondary" onClick={onOpenSettings}>
            <GearSix size={18} />
            工作台设置
          </button>
        </div>
      </header>

      <nav className="workflow-steps" aria-label="上品流程">
        {steps.map((item, index) => (
          <button
            key={item.label}
            type="button"
            className={`${step === index ? "is-active" : ""} ${step > index ? "is-complete" : ""}`}
            onClick={() => setStep(index)}
          >
            <span className="step-number">{step > index ? <Check size={15} /> : index + 1}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.caption}</small>
            </span>
          </button>
        ))}
      </nav>

      <div className="workbench-body">
        <section className="workbench-content">
          {products.some((product) => product.isDemo) ? (
            <div className="demo-banner">
              <Info size={18} weight="fill" />
              <p>当前展示示例批次。上传自己的图片后会自动清空示例，真实发布仍需明确确认。</p>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                上传我的商品
              </button>
            </div>
          ) : null}

          {step === 0 ? (
            <UploadStep
              products={products}
              dragActive={dragActive}
              onDragActive={setDragActive}
              onDrop={onDrop}
              onPickFiles={() => fileInputRef.current?.click()}
              onRemove={removeProduct}
              fieldGroups={fieldGroups}
            />
          ) : null}

          {step === 1 ? (
            <AiStep
              products={products}
              busy={busy}
              onAnalyze={analyzeOne}
              onConfirm={confirmAi}
              onConfirmAll={confirmAllAi}
              onChange={updateProduct}
            />
          ) : null}

          {step === 2 ? (
            <FactsStep
              products={filteredProducts}
              allProducts={products}
              selected={selected}
              query={query}
              activeProductId={activeProduct?.id ?? ""}
              onQueryChange={setQuery}
              onToggleSelected={toggleSelected}
              onToggleAll={toggleAll}
              onOpenProduct={(id) => {
                setActiveProductId(id);
                setInspectorOpen(true);
              }}
              onBulkConfirmAi={confirmAllAi}
              onOpenSettings={onOpenSettings}
            />
          ) : null}

          {step === 3 ? (
            <DraftStep
              products={products}
              busy={busy}
              onOpenProduct={(id) => {
                setActiveProductId(id);
                setInspectorOpen(true);
                setStep(2);
              }}
              onCreateDrafts={() => void createDrafts()}
            />
          ) : null}

          {step === 4 ? (
            <PreviewStep
              products={products}
              activeProductId={activeProduct?.id ?? ""}
              selected={selected}
              onSelect={toggleSelected}
              onActiveChange={setActiveProductId}
              onPublish={() => setPublishDialogOpen(true)}
            />
          ) : null}
        </section>

        {step === 2 && activeProduct && inspectorOpen ? (
          <ProductInspector
            product={activeProduct}
            productIndex={activeIndex}
            total={products.length}
            onClose={() => setInspectorOpen(false)}
            onPrevious={() => {
              const previous = products[activeIndex - 1];
              if (previous) {
                setActiveProductId(previous.id);
              }
            }}
            onNext={() => {
              const next = products[activeIndex + 1];
              if (next) {
                setActiveProductId(next.id);
              }
            }}
            onChange={updateProduct}
            onSave={saveInspector}
          />
        ) : null}
      </div>

      <footer className="workbench-footer">
        <div className="batch-identity">
          <strong>扇形画笔系列</strong>
          <span>{products.length} 个商品 · 刚刚自动保存</span>
        </div>
        <div className="footer-metrics">
          <Metric value={products.length - aiPending} label="AI 已确认" tone="ink" />
          <Metric value={aiPending} label="待确认" tone="violet" />
          <Metric value={incompleteProducts.length} label="待补资料" tone="orange" />
          <Metric value={draftedProducts.length} label="草稿" tone="blue" />
          <Metric value={publishedProducts.length} label="已发布" tone="green" />
        </div>
        <div className="footer-actions">
          {step > 0 ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={busy}
            >
              上一步
            </button>
          ) : (
            <button type="button" className="button button-secondary">
              保存批次
            </button>
          )}
          <button
            type="button"
            className={`button button-primary button-large ${step === 4 ? "button-publish" : ""}`}
            onClick={goNext}
            disabled={busy || !products.length}
          >
            {busy ? <CircleNotch size={19} className="spin" /> : actionIcon(step)}
            {actionLabel(step, aiPending)}
          </button>
        </div>
      </footer>

      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={onFileInput}
      />

      {publishDialogOpen ? (
        <PublishDialog
          productCount={
            getActionProducts(products, selected).filter((product) => product.stage === "drafted")
              .length
          }
          confirmed={publishConfirmed}
          busy={busy}
          onConfirmedChange={setPublishConfirmed}
          onClose={() => {
            setPublishDialogOpen(false);
            setPublishConfirmed(false);
          }}
          onConfirm={() => void confirmPublish()}
        />
      ) : null}
    </div>
  );
}

function UploadStep({
  products,
  dragActive,
  onDragActive,
  onDrop,
  onPickFiles,
  onRemove,
  fieldGroups,
}: {
  products: ProductRecord[];
  dragActive: boolean;
  onDragActive: (active: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPickFiles: () => void;
  onRemove: (id: string) => void;
  fieldGroups: ListingFieldGroup[];
}) {
  return (
    <div className="step-page upload-step">
      <div className="step-heading">
        <div>
          <span className="eyebrow">开始一个批次</span>
          <h2>一张主图，建立一个商品</h2>
          <p>AI 会处理可见内容。价格、库存和真实规格稍后统一补充。</p>
        </div>
        <span className="quiet-stat">最多 100 个商品 / 批次</span>
      </div>

      <div
        className={`upload-dropzone ${dragActive ? "is-active" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          onDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => onDragActive(false)}
        onDrop={onDrop}
      >
        <div className="upload-icon">
          <CloudArrowUp size={30} />
        </div>
        <h3>拖入商品主图</h3>
        <p>每张图片自动建立一行商品，支持 JPG、PNG、WebP，单张不超过 10 MB。</p>
        <button type="button" className="button button-dark" onClick={onPickFiles}>
          <Plus size={18} />
          选择商品图片
        </button>
      </div>

      {products.length ? (
        <div className="uploaded-products">
          <div className="section-bar">
            <div>
              <h3>已加入 {products.length} 个商品</h3>
              <p>拖动排序会成为批次处理顺序。</p>
            </div>
            <button type="button" className="text-button" onClick={onPickFiles}>
              继续添加
            </button>
          </div>
          <div className="upload-grid">
            {products.map((product, index) => (
              <article key={product.id} className="upload-card">
                <span className="upload-order">{String(index + 1).padStart(2, "0")}</span>
                <img src={product.imageUrl} alt="" />
                <div>
                  <strong>{product.reference}</strong>
                  <span>{product.title || product.sourceFile?.name || "等待 AI 分析"}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => onRemove(product.id)}>
                  <Trash size={17} />
                  <span className="sr-only">移除商品</span>
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="policy-summary">
        <PolicyColumn
          title="AI 会完成"
          icon={<Sparkle size={20} />}
          items={
            fieldGroups
              .find((group) => group.key === "product_ai_assisted")
              ?.fields.slice(0, 5)
              .map((field) => field.label) ?? [
              "类目建议",
              "英文标题与关键词",
              "卖点和详情文案",
              "可见颜色与外形",
              "白底图和场景图",
            ]
          }
        />
        <PolicyColumn
          title="用户或 ERP 提供"
          icon={<CheckSquare size={20} />}
          items={
            fieldGroups
              .find((group) => group.key === "product_trusted_facts")
              ?.fields.slice(0, 5)
              .map((field) => field.label) ?? [
              "最终类目和品牌型号",
              "价格、MOQ 与库存",
              "材质、尺寸和重量",
              "包装与交期",
              "认证、HS Code 与授权",
            ]
          }
        />
      </div>
    </div>
  );
}

function AiStep({
  products,
  busy,
  onAnalyze,
  onConfirm,
  onConfirmAll,
  onChange,
}: {
  products: ProductRecord[];
  busy: boolean;
  onAnalyze: (product: ProductRecord) => Promise<void>;
  onConfirm: (id: string) => void;
  onConfirmAll: () => void;
  onChange: (product: ProductRecord) => void;
}) {
  const pending = products.filter((product) => !product.aiConfirmed);
  return (
    <div className="step-page ai-step">
      <div className="step-heading">
        <div>
          <span className="eyebrow">AI 内容候选</span>
          <h2>先确认商品身份，再继续</h2>
          <p>看不清的事实会留空，AI 不会推断价格、材质、库存或认证。</p>
        </div>
        <button
          type="button"
          className="button button-dark"
          onClick={onConfirmAll}
          disabled={!pending.length || busy}
        >
          <CheckSquare size={18} />
          确认全部 AI 内容
        </button>
      </div>

      <div className="ai-review-list">
        {products.map((product) => (
          <article key={product.id} className="ai-review-card">
            <div className="ai-image-frame">
              <img src={product.imageUrl} alt="" />
              <span className="image-count">原图 1</span>
            </div>
            <div className="ai-review-content">
              <div className="review-title-row">
                <div>
                  <span className="source-badge source-ai">
                    <Sparkle size={13} weight="fill" />
                    AI 候选
                  </span>
                  <strong>{product.reference}</strong>
                </div>
                {product.stage === "analyzing" ? (
                  <span className="analysis-state">
                    <CircleNotch size={16} className="spin" />
                    正在分析
                  </span>
                ) : null}
              </div>
              <label className="field field-wide">
                <span>英文标题</span>
                <textarea
                  rows={2}
                  value={product.title}
                  placeholder="等待 AI 生成"
                  onChange={(event) => onChange({ ...product, title: event.target.value })}
                />
              </label>
              <div className="ai-facts-row">
                <div>
                  <span>类目建议</span>
                  <strong>{product.facts.categoryLabel || "等待分析"}</strong>
                </div>
                <div>
                  <span>图片可见</span>
                  <div className="trait-list">
                    {product.visibleTraits.length ? (
                      product.visibleTraits.map((trait) => <i key={trait}>{trait}</i>)
                    ) : (
                      <i>等待分析</i>
                    )}
                  </div>
                </div>
              </div>
              <div className="keyword-row">
                <span>关键词</span>
                {product.keywords.map((keyword) => (
                  <i key={keyword}>{keyword}</i>
                ))}
              </div>
            </div>
            <div className="ai-review-actions">
              {product.stage === "uploaded" || product.stage === "error" ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void onAnalyze(product)}
                >
                  <MagicWand size={17} />
                  开始分析
                </button>
              ) : null}
              <button
                type="button"
                className={`button ${product.aiConfirmed ? "button-success" : "button-dark"}`}
                onClick={() => onConfirm(product.id)}
                disabled={product.stage === "analyzing" || product.stage === "uploaded"}
              >
                {product.aiConfirmed ? (
                  <CheckCircle size={18} weight="fill" />
                ) : (
                  <Check size={18} />
                )}
                {product.aiConfirmed ? "已确认" : "确认内容"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function FactsStep({
  products,
  allProducts,
  selected,
  query,
  activeProductId,
  onQueryChange,
  onToggleSelected,
  onToggleAll,
  onOpenProduct,
  onBulkConfirmAi,
  onOpenSettings,
}: {
  products: ProductRecord[];
  allProducts: ProductRecord[];
  selected: Set<string>;
  query: string;
  activeProductId: string;
  onQueryChange: (query: string) => void;
  onToggleSelected: (id: string) => void;
  onToggleAll: () => void;
  onOpenProduct: (id: string) => void;
  onBulkConfirmAi: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="facts-step">
      <div className="facts-summary">
        <p>
          <strong>AI 已完成 {allProducts.length * 4 + 2} 项</strong>
          <span>待确认 {allProducts.filter((product) => !product.aiConfirmed).length} 项</span>
          <span>
            待填写{" "}
            {allProducts.reduce((count, product) => count + getProductErrors(product).length, 0)} 项
          </span>
        </p>
        <div className="facts-summary-actions">
          <label className="search-field">
            <MagnifyingGlass size={17} />
            <span className="sr-only">搜索商品</span>
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索商品 / Ref / SKU"
            />
          </label>
        </div>
      </div>

      <div className="bulk-toolbar">
        <strong>已选择 {selected.size} 项</strong>
        <button type="button" onClick={onBulkConfirmAi}>
          <CheckSquare size={17} />
          批量确认 AI
        </button>
        <button type="button" onClick={onOpenSettings}>
          <Package size={17} />
          批量使用默认配置
        </button>
        <button type="button">
          <PencilSimple size={17} />
          批量编辑事实
        </button>
      </div>

      <div className="product-table-scroll">
        <table className="product-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="选择全部商品"
                  checked={products.length > 0 && selected.size === products.length}
                  onChange={onToggleAll}
                />
              </th>
              <th>商品</th>
              <th>来源</th>
              <th>内部参考 / Ref</th>
              <th>AI 英文标题</th>
              <th>类目</th>
              <th>材质</th>
              <th>价格</th>
              <th>MOQ</th>
              <th>库存</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const errors = getProductErrors(product);
              return (
                <tr
                  key={product.id}
                  className={activeProductId === product.id ? "is-active-row" : ""}
                  onClick={() => onOpenProduct(product.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenProduct(product.id);
                    }
                  }}
                  tabIndex={0}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${product.reference}`}
                      checked={selected.has(product.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => onToggleSelected(product.id)}
                    />
                  </td>
                  <td>
                    <img className="product-thumbnail" src={product.imageUrl} alt="" />
                  </td>
                  <td>
                    <SourceBadge
                      source={product.aiConfirmed ? "confirmed" : "ai"}
                      label={product.aiConfirmed ? "用户确认" : "AI 候选"}
                    />
                  </td>
                  <td>
                    <strong className="reference-cell">{product.reference}</strong>
                    <span className="model-cell">{product.facts.model || "型号待填"}</span>
                  </td>
                  <td>
                    <span className="title-cell">{product.title || "等待 AI 生成"}</span>
                  </td>
                  <td>
                    <span className="category-cell">
                      {product.facts.categoryLabel
                        ? product.facts.categoryLabel.split(">").at(-1)?.trim()
                        : "待确认"}
                    </span>
                  </td>
                  <td>{product.facts.material || <MissingValue />}</td>
                  <td>{product.facts.price ? `$${product.facts.price}` : <MissingValue />}</td>
                  <td>{product.facts.moq || <MissingValue />}</td>
                  <td>{product.facts.stock || <MissingValue />}</td>
                  <td>
                    {errors.length ? (
                      <SourceBadge source="missing" label={`缺 ${errors.length} 项`} />
                    ) : (
                      <SourceBadge source="trusted" label="资料完整" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer compact">
        <span>共 {products.length} 条</span>
        <span>点击商品行，在右侧补充精确资料</span>
      </div>
    </div>
  );
}

function DraftStep({
  products,
  busy,
  onOpenProduct,
  onCreateDrafts,
}: {
  products: ProductRecord[];
  busy: boolean;
  onOpenProduct: (id: string) => void;
  onCreateDrafts: () => void;
}) {
  const ready = products.filter((product) => getProductErrors(product).length === 0);
  return (
    <div className="step-page draft-step">
      <div className="step-heading">
        <div>
          <span className="eyebrow">安全草稿</span>
          <h2>实时 Schema 校验后逐商品建草稿</h2>
          <p>失败商品会单独返回原因，不阻止同批次其他商品。</p>
        </div>
        <button
          type="button"
          className="button button-primary button-large"
          onClick={onCreateDrafts}
          disabled={!ready.length || busy}
        >
          {busy ? <CircleNotch size={19} className="spin" /> : <FileText size={19} />}为{" "}
          {ready.length} 个商品创建草稿
        </button>
      </div>

      <div className="draft-overview">
        <div className="draft-score">
          <span>可创建草稿</span>
          <strong>
            {ready.length}
            <small> / {products.length}</small>
          </strong>
          <p>只有来源和 Schema 校验同时通过的商品会写入。</p>
        </div>
        <div className="draft-checks">
          <CheckLine label="AI 内容已人工确认" passed={products.every((p) => p.aiConfirmed)} />
          <CheckLine
            label="交易和库存来自可信数据"
            passed={products.every((p) => p.facts.price && p.facts.stock)}
          />
          <CheckLine
            label="尺寸、重量和包装完整"
            passed={products.every((p) => p.facts.grossWeight)}
          />
          <CheckLine
            label="实时 Alibaba Schema"
            passed={products.every((p) => p.isDemo || Boolean(p.schemaData))}
            pendingLabel="创建草稿时获取"
          />
        </div>
      </div>

      <div className="draft-product-list">
        {products.map((product) => {
          const errors = getProductErrors(product);
          const isDrafted = product.stage === "drafted" || product.stage === "published";
          return (
            <article key={product.id} className="draft-product-row">
              <img src={product.imageUrl} alt="" />
              <div className="draft-product-name">
                <strong>{product.title || product.reference}</strong>
                <span>{product.reference}</span>
              </div>
              <div className="draft-source-checks">
                <SourceBadge
                  source={product.aiConfirmed ? "confirmed" : "ai"}
                  label={product.aiConfirmed ? "AI 已确认" : "AI 待确认"}
                />
                <SourceBadge source="default" label="店铺默认 5 项" />
                <SourceBadge
                  source={errors.length ? "missing" : "trusted"}
                  label={errors.length ? `缺 ${errors.length} 项` : "可信事实完整"}
                />
              </div>
              <div className="draft-row-status">
                {isDrafted ? (
                  <SourceBadge source="trusted" label="草稿已创建" />
                ) : product.stage === "drafting" ? (
                  <span className="working-label">
                    <CircleNotch size={16} className="spin" />
                    创建中
                  </span>
                ) : errors.length ? (
                  <button
                    type="button"
                    className="row-action is-danger"
                    onClick={() => onOpenProduct(product.id)}
                  >
                    补齐资料
                    <ArrowRight size={15} />
                  </button>
                ) : (
                  <SourceBadge source="trusted" label="准备完成" />
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function PreviewStep({
  products,
  activeProductId,
  selected,
  onSelect,
  onActiveChange,
  onPublish,
}: {
  products: ProductRecord[];
  activeProductId: string;
  selected: Set<string>;
  onSelect: (id: string) => void;
  onActiveChange: (id: string) => void;
  onPublish: () => void;
}) {
  const activeProduct =
    products.find((product) => product.id === activeProductId) ?? products[0] ?? null;
  const drafted = products.filter(
    (product) => product.stage === "drafted" || product.stage === "published",
  );

  return (
    <div className="preview-step">
      <div className="preview-list">
        <div className="preview-list-header">
          <div>
            <span className="eyebrow">草稿回读</span>
            <h2>确认后发布</h2>
          </div>
          <span>{drafted.length} 个草稿</span>
        </div>
        {products.map((product) => {
          const canPublish = product.stage === "drafted";
          return (
            <button
              key={product.id}
              type="button"
              className={`preview-product-button ${
                activeProduct?.id === product.id ? "is-active" : ""
              }`}
              onClick={() => onActiveChange(product.id)}
            >
              <input
                type="checkbox"
                aria-label={`选择发布 ${product.reference}`}
                checked={selected.has(product.id)}
                disabled={!canPublish}
                onClick={(event) => event.stopPropagation()}
                onChange={() => onSelect(product.id)}
              />
              <img src={product.imageUrl} alt="" />
              <span>
                <strong>{product.reference}</strong>
                <small>
                  {product.stage === "published"
                    ? "已发布"
                    : canPublish
                      ? "草稿可发布"
                      : "尚无草稿"}
                </small>
              </span>
            </button>
          );
        })}
      </div>

      {activeProduct ? (
        <article className="listing-preview">
          <div className="preview-browser-bar">
            <span />
            <span />
            <span />
            <p>Alibaba.com 商品草稿预览</p>
          </div>
          <div className="preview-content">
            <div className="preview-gallery">
              <img src={activeProduct.imageUrl} alt={activeProduct.title} />
              <div className="preview-thumbnails">
                <img src={activeProduct.imageUrl} alt="" />
                <span>
                  <Image size={19} />
                  AI 白底图
                </span>
                <span>
                  <Image size={19} />
                  场景图
                </span>
              </div>
            </div>
            <div className="preview-copy">
              <span className="preview-category">{activeProduct.facts.categoryLabel}</span>
              <h2>{activeProduct.title}</h2>
              <div className="preview-price">
                <strong>US ${activeProduct.facts.price}</strong>
                <span>/{settingsUnit(activeProduct)}</span>
              </div>
              <dl className="preview-specs">
                <div>
                  <dt>Minimum order</dt>
                  <dd>
                    {activeProduct.facts.moq} {settingsUnit(activeProduct)}
                  </dd>
                </div>
                <div>
                  <dt>Model number</dt>
                  <dd>{activeProduct.facts.model}</dd>
                </div>
                <div>
                  <dt>Material</dt>
                  <dd>{activeProduct.facts.material}</dd>
                </div>
                <div>
                  <dt>Lead time</dt>
                  <dd>{activeProduct.facts.leadTime} days</dd>
                </div>
              </dl>
              <div className="preview-points">
                {activeProduct.sellingPoints.map((point) => (
                  <p key={point}>
                    <CheckCircle size={17} weight="fill" />
                    {point}
                  </p>
                ))}
              </div>
              <button type="button" className="preview-inquiry-button">
                Contact supplier
              </button>
            </div>
          </div>
          <div className="preview-review-strip">
            <CheckCircle size={19} weight="fill" />
            <p>请检查图片、标题、属性、SKU、价格、MOQ、库存、包装物流和认证。</p>
            <button type="button" className="button button-primary" onClick={onPublish}>
              确认并发布所选商品
            </button>
          </div>
        </article>
      ) : (
        <div className="preview-empty">还没有可预览的商品。</div>
      )}
    </div>
  );
}

function PublishDialog({
  productCount,
  confirmed,
  busy,
  onConfirmedChange,
  onClose,
  onConfirm,
}: {
  productCount: number;
  confirmed: boolean;
  busy: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="icon-button modal-close" onClick={onClose}>
          <X size={19} />
          <span className="sr-only">关闭发布确认</span>
        </button>
        <div className="publish-dialog-icon">
          <UploadSimple size={26} />
        </div>
        <span className="eyebrow">正式写入 Alibaba.com</span>
        <h2 id="publish-title">确认发布 {productCount} 个商品</h2>
        <p>正式发布会写入真实商家账户，并进入 Alibaba 审核流程。失败商品会单独返回。</p>
        <label className="confirmation-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => onConfirmedChange(event.target.checked)}
          />
          <span>我已回读并核对图片、价格、库存、包装、物流和合规资料。</span>
        </label>
        <div className="publish-dialog-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            返回检查
          </button>
          <button
            type="button"
            className="button button-publish"
            disabled={!confirmed || !productCount || busy}
            onClick={onConfirm}
          >
            {busy ? <CircleNotch size={18} className="spin" /> : <UploadSimple size={18} />}
            确认正式发布
          </button>
        </div>
      </section>
    </div>
  );
}

function PolicyColumn({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: string[];
}) {
  return (
    <div>
      <h3>
        {icon}
        {title}
      </h3>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <Check size={15} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckLine({
  label,
  passed,
  pendingLabel,
}: {
  label: string;
  passed: boolean;
  pendingLabel?: string;
}) {
  return (
    <div className={passed ? "is-passed" : ""}>
      {passed ? <CheckCircle size={20} weight="fill" /> : <Warning size={20} weight="fill" />}
      <span>
        <strong>{label}</strong>
        <small>{passed ? "已通过" : (pendingLabel ?? "仍需处理")}</small>
      </span>
    </div>
  );
}

function SourceBadge({
  source,
  label,
}: {
  source: "ai" | "confirmed" | "default" | "trusted" | "missing";
  label: string;
}) {
  return <span className={`source-badge source-${source}`}>{label}</span>;
}

function MissingValue() {
  return <span className="missing-value">待填写</span>;
}

function Metric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "ink" | "violet" | "orange" | "blue" | "green";
}) {
  return (
    <div className={`footer-metric metric-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function actionLabel(step: number, aiPending: number) {
  if (step === 0) {
    return "开始 AI 分析";
  }
  if (step === 1) {
    return aiPending ? `确认剩余 ${aiPending} 项` : "进入资料填写";
  }
  if (step === 2) {
    return "校验商品资料";
  }
  if (step === 3) {
    return "校验并创建草稿";
  }
  return "确认正式发布";
}

function actionIcon(step: number) {
  if (step === 0 || step === 1) {
    return <MagicWand size={19} />;
  }
  if (step === 2) {
    return <CheckSquare size={19} />;
  }
  if (step === 3) {
    return <FileText size={19} />;
  }
  return <UploadSimple size={19} />;
}

function getProductErrors(product: ProductRecord): string[] {
  const errors: string[] = [];
  if (!product.aiConfirmed) {
    errors.push("AI 内容尚未确认");
  }
  for (const key of requiredFactKeys) {
    if (!String(product.facts[key] ?? "").trim()) {
      errors.push(factErrorLabel(key));
    }
  }
  if (!product.title.trim()) {
    errors.push("英文标题缺失");
  }
  return errors;
}

function factErrorLabel(key: keyof ProductRecord["facts"]): string {
  const labels: Partial<Record<keyof ProductRecord["facts"], string>> = {
    categoryId: "最终叶子类目缺失",
    model: "型号缺失",
    material: "材质缺失",
    price: "价格缺失",
    moq: "MOQ 缺失",
    stock: "库存缺失",
    grossWeight: "包装毛重缺失",
  };
  return labels[key] ?? `${key} 缺失`;
}

function applyAnalysis(product: ProductRecord, response: ImageAnalysisResponse): ProductRecord {
  const generated = response.generated_fields;
  const observed = response.observed_fields;
  const title = getFieldString(generated, ["title", "subject", "english_title"]) || product.title;
  const description =
    getFieldString(generated, ["description", "detail", "product_description"]) ||
    product.description;
  const keywords = getFieldList(generated, ["keywords", "keyword"]) || product.keywords;
  const sellingPoints =
    getFieldList(generated, ["selling_points", "sellingPoints", "highlights"]) ||
    product.sellingPoints;
  const visibleTraits = Object.values(observed)
    .map((field) => normalizeFieldValue(field))
    .flatMap((value) => (Array.isArray(value) ? value.map(String) : [String(value)]))
    .filter(Boolean)
    .slice(0, 5);
  const category = normalizeFieldValue(response.category_suggestions[0]);
  const categoryLabel =
    typeof category === "string"
      ? category
      : category && typeof category === "object"
        ? String((category as Record<string, unknown>).name ?? "")
        : product.facts.categoryLabel;
  const categoryId =
    category && typeof category === "object"
      ? String((category as Record<string, unknown>).id ?? "")
      : product.facts.categoryId;

  return {
    ...product,
    title,
    description,
    keywords,
    sellingPoints,
    visibleTraits,
    aiConfirmed: false,
    stage: "ai_ready",
    facts: {
      ...product.facts,
      categoryId,
      categoryLabel,
    },
    errors: [...response.warnings, "AI 内容尚未确认"],
  };
}

function getFieldString(fields: Record<string, DraftField>, keys: string[]): string {
  for (const key of keys) {
    const field = fields[key];
    const value = normalizeFieldValue(field);
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function getFieldList(fields: Record<string, DraftField>, keys: string[]): string[] | null {
  for (const key of keys) {
    const field = fields[key];
    const value = normalizeFieldValue(field);
    if (Array.isArray(value)) {
      return value.map(String).filter(Boolean);
    }
    if (typeof value === "string" && value) {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return null;
}

function normalizeFieldValue(field?: DraftField): unknown {
  return field?.value;
}

function getActionProducts(products: ProductRecord[], selected: Set<string>): ProductRecord[] {
  if (!selected.size) {
    return products;
  }
  return products.filter((product) => selected.has(product.id));
}

function getProductId(response?: Record<string, unknown>): string | undefined {
  if (!response) {
    return undefined;
  }
  for (const key of ["product_id", "productId", "id"]) {
    const value = response[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  for (const value of Object.values(response)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = getProductId(value as Record<string, unknown>);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function settingsUnit(_product: ProductRecord) {
  return "Set";
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
