import {
  ArrowRight,
  Bell,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  CheckSquare,
  CircleNotch,
  CloudArrowUp,
  FileText,
  Funnel,
  GearSix,
  Image,
  MagicWand,
  MagnifyingGlass,
  Plus,
  Question,
  Sparkle,
  Trash,
  UploadSimple,
  Warning,
  WarningCircle,
  X,
  XCircle,
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
  analyzeProductImages,
  createDraftBatch,
  findPhotoBankUrl,
  findSchemaData,
  generateProductImages,
  getCategorySchema,
  getListingFieldMatrix,
  publishBatch,
  uploadPhotoBankImage,
} from "../api";
import { createEmptyFacts, getMainProductImage } from "../data";
import type {
  AlibabaConnectedStore,
  CapabilityResponse,
  DataMode,
  DraftField,
  ImageAnalysisResponse,
  ListingFieldGroup,
  ProductImageCandidate,
  ProductRecord,
  StoreSettings,
  ToastMessage,
} from "../types";

type WorkbenchPageProps = {
  batchId: string;
  capabilities: CapabilityResponse | null;
  backendConnected: boolean;
  dataMode: DataMode;
  activeStore: AlibabaConnectedStore | null;
  products: ProductRecord[];
  settings: StoreSettings;
  onProductsChange: (products: ProductRecord[]) => void;
  onDataModeChange: (mode: DataMode) => void;
  onOpenSettings: () => void;
  notify: (tone: ToastMessage["tone"], title: string, detail?: string) => void;
};

const stepLabels = ["上传图片", "确认 AI 候选", "补齐事实", "创建草稿", "回读发布"];

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
  batchId,
  capabilities,
  backendConnected,
  dataMode,
  activeStore,
  products,
  settings,
  onProductsChange,
  onDataModeChange,
  onOpenSettings,
  notify,
}: WorkbenchPageProps) {
  const [step, setStep] = useState(() => {
    if (products.length === 0) {
      return 0;
    }
    if (dataMode === "demo") {
      return 2;
    }
    return products.some((product) => !product.aiConfirmed) ? 1 : 2;
  });
  const [activeProductId, setActiveProductId] = useState(
    () => (dataMode === "demo" ? products[2]?.id : undefined) ?? products[0]?.id ?? "",
  );
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 1080);
  const [selected, setSelected] = useState<Set<string>>(() =>
    dataMode === "demo" && products[2] ? new Set([products[2].id]) : new Set(),
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [fieldGroups, setFieldGroups] = useState<ListingFieldGroup[]>([]);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
  const [imageCandidates, setImageCandidates] = useState<ProductImageCandidate[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousActiveProductId = useRef(activeProductId);

  useEffect(() => {
    getListingFieldMatrix()
      .then(setFieldGroups)
      .catch(() => setFieldGroups([]));
  }, []);

  useEffect(() => {
    if (!products.some((product) => product.id === activeProductId)) {
      setActiveProductId(products[0]?.id ?? "");
    }
    if (products.length === 0) {
      setStep(0);
    }
  }, [activeProductId, products]);

  useEffect(() => {
    if (previousActiveProductId.current !== activeProductId) {
      previousActiveProductId.current = activeProductId;
      setImageCandidates([]);
    }
  }, [activeProductId]);

  useEffect(() => {
    if (!publishDialogOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [publishDialogOpen]);

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
  const draftedProducts = products.filter(
    (product) => product.stage === "drafted" || product.stage === "published",
  );
  const publishedProducts = products.filter((product) => product.stage === "published");
  const publishTargets = getActionProducts(products, selected).filter(
    (product) => product.stage === "drafted",
  );
  const completedSteps = [
    products.length > 0,
    products.length > 0 && products.every((product) => product.aiConfirmed),
    products.length > 0 && products.every((product) => getProductErrors(product).length === 0),
    draftedProducts.length > 0,
    publishedProducts.length > 0,
  ];

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
    const images = imageFiles.map((file, index) => ({
      id: `uploaded-${now}-image-${index}`,
      url: URL.createObjectURL(file),
      name: file.name,
      sourceFile: file,
    }));
    const newProduct: ProductRecord = {
      id: `uploaded-${now}`,
      reference: `AUTO-${String(now).slice(-6)}-01`,
      images,
      mainImageId: images[0].id,
      title: "",
      keywords: [],
      sellingPoints: [],
      description: "",
      visibleTraits: [],
      aiConfirmed: false,
      stage: "uploaded",
      facts: createEmptyFacts(settings),
      errors: ["等待 AI 分析"],
    };

    const shouldReplaceDemo = dataMode === "demo";
    const nextProducts = shouldReplaceDemo ? [newProduct] : [...products, newProduct];
    if (shouldReplaceDemo) {
      onDataModeChange("live");
    }
    onProductsChange(nextProducts);
    setActiveProductId(newProduct.id);
    setStep(0);
    setInspectorOpen(false);
    notify(
      "success",
      `已加入 1 个商品 · ${images.length} 张图片`,
      "第一张默认为主图，可在下一步更换；AI 会综合分析整组图片。",
    );
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
    if (!product.isDemo && (!backendConnected || !capabilities?.model_credentials_configured)) {
      notify(
        "error",
        !backendConnected ? "后端服务未连接" : "AI 服务尚未配置",
        !backendConnected ? "请稍后重试或联系管理员。" : "智能生成服务尚未开通。",
      );
      return;
    }
    replaceProduct(product.id, (current) => ({
      ...current,
      stage: "analyzing",
      errors: [],
    }));

    const sourceFiles = product.images.flatMap((image) =>
      image.sourceFile ? [image.sourceFile] : [],
    );
    if (product.isDemo || !sourceFiles.length) {
      await delay(650);
      replaceProduct(product.id, (current) => ({
        ...current,
        stage: "ai_ready",
        errors: current.aiConfirmed ? [] : ["AI 内容尚未确认"],
      }));
      return;
    }

    try {
      const mainImage = getMainProductImage(product);
      const orderedFiles = [
        ...(mainImage.sourceFile ? [mainImage.sourceFile] : []),
        ...product.images.flatMap((image) =>
          image.id !== mainImage.id && image.sourceFile ? [image.sourceFile] : [],
        ),
      ];
      let schemaData = product.schemaData;
      if (!schemaData && product.facts.categoryId) {
        try {
          const payload = await getCategorySchema(product.facts.categoryId);
          schemaData = findSchemaData(payload) ?? undefined;
        } catch {
          schemaData = undefined;
        }
      }
      const response = await analyzeProductImages(orderedFiles, schemaData);
      replaceProduct(product.id, (current) =>
        applyAnalysis(schemaData ? { ...current, schemaData } : current, response),
      );
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
    if (dataMode === "live" && (!backendConnected || !capabilities?.model_credentials_configured)) {
      notify(
        "error",
        !backendConnected ? "后端服务未连接" : "AI 服务尚未配置",
        !backendConnected ? "请稍后重试或联系管理员。" : "智能生成服务尚未开通。",
      );
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

  const generateImagesForProduct = async () => {
    if (!activeProduct || activeProduct.isDemo) {
      notify("info", "演示商品不调用生图", "切换到真实商品后再生成候选图片。");
      return;
    }
    const referenceFile = getMainProductImage(activeProduct).sourceFile;
    if (!referenceFile) {
      notify("warning", "缺少参考图", "生图采用图生图，需要先上传真实商品主图作为参考。");
      return;
    }
    setImageGenerationBusy(true);
    setImageCandidates([]);
    try {
      const response = await generateProductImages(activeProduct, referenceFile);
      setImageCandidates(response.candidates);
      const successCount = response.candidates.filter((candidate) => candidate.image_url).length;
      notify(
        successCount ? "success" : "error",
        successCount ? "候选图片已生成" : "生图未返回图片",
        successCount
          ? `${successCount} 个图位返回候选，可逐个加入商品图库。`
          : "请检查失败图位的原因后重试。",
      );
    } catch (error) {
      notify("error", "生图请求失败", error instanceof Error ? error.message : "请稍后重试。");
    } finally {
      setImageGenerationBusy(false);
    }
  };

  const addGeneratedImage = (candidate: ProductImageCandidate) => {
    if (!activeProduct || !candidate.image_url) {
      return;
    }
    if (activeProduct.images.some((image) => image.url === candidate.image_url)) {
      notify("info", "图片已在图库中", "无需重复添加。");
      return;
    }
    updateProduct({
      ...activeProduct,
      images: [
        ...activeProduct.images,
        {
          id: `generated-${candidate.slot}-${Date.now()}`,
          url: candidate.image_url,
          name: `${candidate.label}候选`,
        },
      ],
    });
    notify("success", "已加入商品图库", `${candidate.label}可继续确认或设为主图。`);
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
    if (
      targets.some((product) => !product.isDemo) &&
      (!backendConnected || !capabilities?.alibaba_credentials_configured)
    ) {
      notify(
        "error",
        !backendConnected ? "后端服务未连接" : "Alibaba 店铺尚未授权",
        !backendConnected ? "请稍后重试或联系管理员。" : "请先在设置中连接真实店铺。",
      );
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
        setActiveProductId(targets[0].id);
        setStep(4);
        return;
      }

      const prepared = await Promise.all(
        targets.map(async (product) => {
          const images = await Promise.all(
            product.images.map(async (image) => {
              if (image.photoBankUrl || !image.sourceFile) {
                return image;
              }
              const upload = await uploadPhotoBankImage(
                image.sourceFile,
                settings.photoBankGroupId,
              );
              const photoBankUrl = findPhotoBankUrl(upload);
              if (!photoBankUrl) {
                throw new Error(`${product.reference} 的 ${image.name} 未返回图片银行地址`);
              }
              return { ...image, photoBankUrl };
            }),
          );
          if (product.schemaData) {
            return { ...product, images };
          }
          const payload = await getCategorySchema(product.facts.categoryId);
          const schemaData = findSchemaData(payload);
          if (!schemaData) {
            throw new Error(`${product.reference} 未从 Alibaba 响应中找到 Schema`);
          }
          return { ...product, images, schemaData };
        }),
      );
      const results = await createDraftBatch(batchId, prepared, settings);
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
      const firstSucceeded = results.find((result) => result.success);
      if (firstSucceeded) {
        const product = products.find((item) => item.reference === firstSucceeded.reference);
        if (product) {
          setActiveProductId(product.id);
        }
      }
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
      const results = await publishBatch(batchId, targets, settings);
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
    if (product) {
      for (const image of product.images) {
        if (image.sourceFile) {
          URL.revokeObjectURL(image.url);
        }
      }
    }
    onProductsChange(products.filter((item) => item.id !== id));
  };

  const setMainImage = (productId: string, imageId: string) => {
    replaceProduct(productId, (product) => ({
      ...product,
      mainImageId: imageId,
    }));
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

  const confirmedCount = products.filter((product) => product.aiConfirmed).length;
  const failedCount = products.filter((product) => product.stage === "error").length;
  const missingCount = products.filter(
    (product) => product.stage !== "error" && getFactErrors(product).length > 0,
  ).length;
  const draftReadyCount = products.filter(
    (product) =>
      product.aiConfirmed && product.stage !== "error" && getFactErrors(product).length === 0,
  ).length;
  const stepCaptions = [
    `已上传 ${products.length}`,
    `已确认 ${confirmedCount}`,
    `缺失事实 ${missingCount}`,
    `可建草稿 ${draftReadyCount}`,
    `待发布 ${publishedProducts.length}`,
  ];
  const backendHealthy = dataMode === "live" && backendConnected && failedCount === 0;

  return (
    <div
      className={`wb-page ${step === 2 && activeProduct && inspectorOpen ? "has-inspector" : ""}`}
    >
      <header className="wb-topbar">
        <div className="wb-topbar-meta">
          <span>
            当前店铺：
            <strong>{activeStore?.login_id ?? activeStore?.account ?? "未连接店铺"}</strong>
          </span>
          <span>
            批次 ID：<strong>{batchId}</strong>
          </span>
          <span>
            数据模式：<strong>AI 候选 + 用户补齐</strong>
          </span>
          <span>
            后台状态：
            {backendHealthy ? (
              <strong className="wb-health is-ok">
                <CheckCircle size={14} weight="fill" />
                运行正常
              </strong>
            ) : (
              <strong className="wb-health is-warn">
                <Warning size={14} weight="fill" />
                部分异常
              </strong>
            )}
          </span>
        </div>
        <div className="wb-topbar-tools">
          <button type="button" className="wb-bell" aria-label="通知">
            <Bell size={19} />
            <i>12</i>
          </button>
          <button type="button" className="wb-help">
            <Question size={17} />
            帮助中心
          </button>
        </div>
      </header>

      <div className="wb-body">
        <section className="wb-content">
          <nav className="wb-steps" aria-label="上品流程">
            {stepLabels.map((label, index) => (
              <button
                key={label}
                type="button"
                className={`wb-step ${step === index ? "is-active" : ""} ${
                  completedSteps[index] ? "is-complete" : ""
                }`}
                onClick={() => setStep(index)}
              >
                <span className="wb-step-number">{index + 1}</span>
                <span className="wb-step-copy">
                  <strong>{label}</strong>
                  <small>{stepCaptions[index]}</small>
                </span>
              </button>
            ))}
          </nav>
          {step === 0 ? (
            <UploadStep
              products={products}
              dragActive={dragActive}
              onDragActive={setDragActive}
              onDrop={onDrop}
              onPickFiles={() => fileInputRef.current?.click()}
              onRemove={removeProduct}
              onMainImageChange={setMainImage}
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
              onMainImageChange={setMainImage}
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
              onOpenSettings={onOpenSettings}
            />
          ) : null}

          {step === 3 ? (
            <DraftStep
              products={products}
              busy={busy}
              selected={selected}
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
              publishCount={publishTargets.length}
              onSelect={toggleSelected}
              onActiveChange={setActiveProductId}
              onPublish={() => setPublishDialogOpen(true)}
            />
          ) : null}
        </section>

        {step === 2 && activeProduct && inspectorOpen ? (
          <WbInspector
            product={activeProduct}
            imageCandidates={imageCandidates}
            imageGenerationBusy={imageGenerationBusy}
            onClose={() => setInspectorOpen(false)}
            onSwitch={() => {
              const next = products[(activeIndex + 1) % products.length];
              if (next) {
                setActiveProductId(next.id);
              }
            }}
            onChange={updateProduct}
            onGenerateImages={() => void generateImagesForProduct()}
            onAddGeneratedImage={addGeneratedImage}
          />
        ) : null}
      </div>

      <footer className="wb-footer">
        <div className="wb-footer-stats">
          <div className="wb-footer-stat is-ok">
            <CheckCircle size={20} weight="fill" />
            <span>
              <small>已确认</small>
              <strong>{confirmedCount}</strong>
            </span>
          </div>
          <i className="wb-footer-sep" />
          <div className="wb-footer-stat is-warn">
            <WarningCircle size={20} weight="fill" />
            <span>
              <small>缺失事实</small>
              <strong>{missingCount}</strong>
            </span>
          </div>
          <i className="wb-footer-sep" />
          <div className="wb-footer-stat is-info">
            <FileText size={20} weight="fill" />
            <span>
              <small>可建草稿</small>
              <strong>{draftReadyCount}</strong>
            </span>
          </div>
          <i className="wb-footer-sep" />
          <div className="wb-footer-stat is-danger">
            <XCircle size={20} weight="fill" />
            <span>
              <small>校验失败</small>
              <strong>{failedCount}</strong>
            </span>
          </div>
        </div>
        <div className="wb-footer-actions">
          <span className="wb-footer-total">共 {products.length} 条</span>
          <button
            type="button"
            className="wb-button-primary"
            onClick={goNext}
            disabled={busy || !products.length || (step === 4 && publishTargets.length === 0)}
          >
            {busy ? <CircleNotch size={17} className="spin" /> : null}
            {actionLabel(step, aiPending)}
          </button>
          <button
            type="button"
            className="wb-button-secondary"
            onClick={saveInspector}
            disabled={busy || !activeProduct}
          >
            保存草稿
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
          productCount={publishTargets.length}
          isDemo={publishTargets.every((product) => product.isDemo)}
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
  onMainImageChange,
  fieldGroups,
}: {
  products: ProductRecord[];
  dragActive: boolean;
  onDragActive: (active: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPickFiles: () => void;
  onRemove: (id: string) => void;
  onMainImageChange: (productId: string, imageId: string) => void;
  fieldGroups: ListingFieldGroup[];
}) {
  return (
    <div className="step-page upload-step">
      <div className="step-heading">
        <div>
          <span className="eyebrow">开始一个批次</span>
          <h2>一组图片，建立一个商品</h2>
          <p>第一张默认为主图，AI 会综合识别主图、细节、规格和包装信息。</p>
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
        <h3>拖入同一个商品的全部图片</h3>
        <p>多张图片只建立一个商品，支持 JPG、PNG、WebP，单张不超过 10 MB。</p>
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
                <div className="upload-card-gallery">
                  <img src={getMainProductImage(product).url} alt="" />
                  <div className="gallery-thumbnail-row">
                    {product.images.map((image) => (
                      <button
                        key={image.id}
                        type="button"
                        className={image.id === product.mainImageId ? "is-main" : ""}
                        onClick={() => onMainImageChange(product.id, image.id)}
                        aria-label={`设为主图：${image.name}`}
                      >
                        <img src={image.url} alt="" />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="upload-card-copy">
                  <strong>{product.reference}</strong>
                  <span>
                    {product.title || `${product.images.length} 张商品图片 · 等待 AI 分析`}
                  </span>
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
  onMainImageChange,
}: {
  products: ProductRecord[];
  busy: boolean;
  onAnalyze: (product: ProductRecord) => Promise<void>;
  onConfirm: (id: string) => void;
  onConfirmAll: () => void;
  onChange: (product: ProductRecord) => void;
  onMainImageChange: (productId: string, imageId: string) => void;
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
              <img src={getMainProductImage(product).url} alt="" />
              <span className="image-count">图库 {product.images.length}</span>
              <div className="ai-gallery-thumbnails">
                {product.images.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    className={image.id === product.mainImageId ? "is-main" : ""}
                    onClick={() => onMainImageChange(product.id, image.id)}
                    aria-label={`设为主图：${image.name}`}
                  >
                    <img src={image.url} alt="" />
                  </button>
                ))}
              </div>
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

type SourceFilter = "all" | "user_confirmed" | "ai_candidate";
type CheckFilter = "all" | "passed" | "missing" | "failed";

function getCheckState(product: ProductRecord): "passed" | "missing" | "failed" {
  if (product.stage === "error") {
    return "failed";
  }
  return getFactErrors(product).length ? "missing" : "passed";
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
  onOpenSettings: () => void;
}) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [checkFilter, setCheckFilter] = useState<CheckFilter>("all");
  const visibleProducts = products.filter((product) => {
    if (sourceFilter !== "all") {
      const source = product.aiConfirmed ? "user_confirmed" : "ai_candidate";
      if (source !== sourceFilter) {
        return false;
      }
    }
    return checkFilter === "all" || getCheckState(product) === checkFilter;
  });

  return (
    <div className="wb-facts">
      <div className="wb-toolbar">
        <label className="wb-select">
          <span className="sr-only">来源状态</span>
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
          >
            <option value="all">全部来源状态</option>
            <option value="user_confirmed">user_confirmed</option>
            <option value="ai_candidate">ai_candidate</option>
          </select>
        </label>
        <label className="wb-select">
          <span className="sr-only">校验状态</span>
          <select
            value={checkFilter}
            onChange={(event) => setCheckFilter(event.target.value as CheckFilter)}
          >
            <option value="all">全部校验状态</option>
            <option value="passed">已通过</option>
            <option value="missing">缺失事实</option>
            <option value="failed">校验失败</option>
          </select>
        </label>
        <label className="wb-search">
          <span className="sr-only">搜索商品</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="请输入商品标题 / SKU"
          />
          <MagnifyingGlass size={16} />
        </label>
        <button type="button" className="wb-filter-button">
          <Funnel size={16} />
          筛选
        </button>
        <button
          type="button"
          className="wb-gear-button"
          onClick={onOpenSettings}
          aria-label="批量默认配置"
        >
          <GearSix size={17} />
        </button>
      </div>

      <div className="wb-table-shell">
        <table className="wb-table">
          <thead>
            <tr>
              <th className="wb-col-check">
                <input
                  type="checkbox"
                  aria-label="选择全部商品"
                  checked={visibleProducts.length > 0 && selected.size === visibleProducts.length}
                  onChange={onToggleAll}
                />
              </th>
              <th className="wb-col-index">#</th>
              <th>图片</th>
              <th>商品标题</th>
              <th>类目</th>
              <th>SKU</th>
              <th>价格（USD）</th>
              <th>MOQ</th>
              <th>来源状态</th>
              <th>校验状态</th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product, index) => {
              const checkState = getCheckState(product);
              return (
                <tr
                  key={product.id}
                  className={`${checkState === "failed" ? "is-failed" : ""} ${
                    activeProductId === product.id ? "is-active" : ""
                  }`}
                  onClick={() => onOpenProduct(product.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenProduct(product.id);
                    }
                  }}
                  tabIndex={0}
                >
                  <td className="wb-col-check">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${product.reference}`}
                      checked={selected.has(product.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => onToggleSelected(product.id)}
                    />
                  </td>
                  <td className="wb-col-index">{index + 1}</td>
                  <td>
                    <img className="wb-thumb" src={getMainProductImage(product).url} alt="" />
                  </td>
                  <td className="wb-col-title">
                    <span>{product.title || "等待 AI 生成"}</span>
                  </td>
                  <td className="wb-col-category">
                    {product.facts.categoryLabel
                      ? product.facts.categoryLabel
                          .split(">")
                          .map((part) => part.trim())
                          .join(" > ")
                          .replace(/ > ([^>]*)$/, " >\n$1")
                      : "待确认"}
                  </td>
                  <td className="wb-col-sku">{product.reference}</td>
                  <td className="wb-col-price">
                    {product.facts.price ? product.facts.price : "—"}
                  </td>
                  <td className="wb-col-moq">{product.facts.moq ? product.facts.moq : "—"}</td>
                  <td>
                    <span
                      className={`wb-source ${product.aiConfirmed ? "is-confirmed" : "is-candidate"}`}
                    >
                      {product.aiConfirmed ? "user_confirmed" : "ai_candidate"}
                    </span>
                  </td>
                  <td>
                    {checkState === "failed" ? (
                      <span className="wb-check is-failed">
                        <XCircle size={14} weight="fill" />
                        校验失败
                        <small>{product.errors[0] ?? "价格、库存必填"}</small>
                      </span>
                    ) : checkState === "missing" ? (
                      <span className="wb-check is-missing">缺失事实</span>
                    ) : (
                      <span className="wb-check is-passed">已通过</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="wb-table-footer">
          <span>共 {allProducts.length} 条</span>
          <div className="wb-pagination">
            <button type="button" aria-label="上一页" disabled>
              <CaretLeft size={13} />
            </button>
            <button type="button" className="is-current">
              1
            </button>
            <button type="button" aria-label="下一页" disabled>
              <CaretRight size={13} />
            </button>
            <label className="wb-select wb-page-size">
              <span className="sr-only">每页条数</span>
              <select defaultValue="20">
                <option value="20">20 条/页</option>
                <option value="50">50 条/页</option>
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function WbInspector({
  product,
  imageCandidates,
  imageGenerationBusy,
  onClose,
  onSwitch,
  onChange,
  onGenerateImages,
  onAddGeneratedImage,
}: {
  product: ProductRecord;
  imageCandidates: ProductImageCandidate[];
  imageGenerationBusy: boolean;
  onClose: () => void;
  onSwitch: () => void;
  onChange: (product: ProductRecord) => void;
  onGenerateImages: () => void;
  onAddGeneratedImage: (candidate: ProductImageCandidate) => void;
}) {
  const setFact = (key: keyof ProductRecord["facts"], value: string) => {
    onChange({ ...product, facts: { ...product.facts, [key]: value } });
  };
  const sourceBadge = (confirmed: boolean) => (
    <span className={`wb-source ${confirmed ? "is-confirmed" : "is-candidate"}`}>
      {confirmed ? "user_confirmed" : "ai_candidate"}
    </span>
  );
  const complianceNote = product.facts.certifications[0] ?? "";

  return (
    <aside className="wb-inspector" aria-label="商品资料">
      <header className="wb-inspector-header">
        <strong>已选择 1 条商品</strong>
        <div className="wb-inspector-header-actions">
          <button type="button" className="wb-link" onClick={onSwitch}>
            切换商品
          </button>
          <button type="button" className="wb-inspector-close" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="wb-inspector-scroll">
        <section className="wb-inspector-section wb-image-generation">
          <div className="wb-image-generation-heading">
            <div>
              <h3>生图候选（图生图）</h3>
              <p>
                以商品主图为参考图生成主图 / 详情图 /
                场景图，保留商品本体，候选需人工确认后加入图库。
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary wb-image-generation-button"
              onClick={onGenerateImages}
              disabled={imageGenerationBusy || product.isDemo}
            >
              {imageGenerationBusy ? (
                <CircleNotch size={15} className="spin" />
              ) : (
                <MagicWand size={15} />
              )}
              {imageGenerationBusy ? "生成中" : "按图位生成"}
            </button>
          </div>
          {product.isDemo ? (
            <p className="wb-image-generation-empty">演示商品不调用真实生图服务。</p>
          ) : null}
          {imageCandidates.length ? (
            <div className="wb-image-candidate-list">
              {imageCandidates.map((candidate) => (
                <article key={candidate.slot} className="wb-image-candidate">
                  {candidate.image_url ? (
                    <img src={candidate.image_url} alt={`${candidate.label}候选`} />
                  ) : (
                    <div className="wb-image-candidate-error">
                      <WarningCircle size={17} />
                      <span>{candidate.error ?? "未返回图片"}</span>
                    </div>
                  )}
                  <div>
                    <strong>{candidate.label}</strong>
                    {candidate.image_url ? (
                      <button
                        type="button"
                        className="wb-link"
                        onClick={() => onAddGeneratedImage(candidate)}
                      >
                        加入图库
                      </button>
                    ) : (
                      <small>{candidate.error ?? "生成失败，可单独重试全部图位"}</small>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
        <section className="wb-inspector-section">
          <h3>基础信息</h3>
          <div className="wb-field">
            <span className="wb-field-label">商品标题</span>
            <div className="wb-field-control">
              <div className="wb-input wb-input-counter">
                <input
                  value={product.title}
                  onChange={(event) => onChange({ ...product, title: event.target.value })}
                />
                <small>{product.title.length}/128</small>
              </div>
            </div>
          </div>
          <div className="wb-field">
            <span className="wb-field-label">类目</span>
            <div className="wb-field-control">
              {sourceBadge(true)}
              <div className="wb-input wb-input-select">
                <select
                  value={product.facts.categoryLabel}
                  onChange={(event) => setFact("categoryLabel", event.target.value)}
                >
                  <option value={product.facts.categoryLabel || "工具 > 涂装工具 > 刷子"}>
                    {product.facts.categoryLabel || "工具 > 涂装工具 > 刷子"}
                  </option>
                </select>
              </div>
            </div>
          </div>
          <div className="wb-field">
            <span className="wb-field-label">品牌</span>
            <div className="wb-field-control">
              {sourceBadge(product.aiConfirmed)}
              <div className="wb-input">
                <input
                  value={product.facts.brand}
                  onChange={(event) => setFact("brand", event.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="wb-field">
            <span className="wb-field-label">商品描述</span>
            <div className="wb-field-control">
              {sourceBadge(product.aiConfirmed)}
              <div className="wb-input wb-input-counter wb-input-area">
                <textarea
                  rows={2}
                  value={product.description}
                  onChange={(event) => onChange({ ...product, description: event.target.value })}
                />
                <small>{product.description.length}/500</small>
              </div>
            </div>
          </div>
        </section>

        <section className="wb-inspector-section">
          <h3>SKU 与价格</h3>
          <div className="wb-field">
            <span className="wb-field-label">SKU</span>
            <div className="wb-field-control">
              {sourceBadge(true)}
              <div className="wb-input wb-input-counter">
                <input
                  value={product.reference}
                  onChange={(event) => onChange({ ...product, reference: event.target.value })}
                />
                <small>{product.reference.length}/64</small>
              </div>
            </div>
          </div>
          <div className="wb-field wb-field-split">
            <div>
              <span className="wb-field-label">价格（USD）</span>
              <div className="wb-input">
                <input
                  value={product.facts.price}
                  onChange={(event) => setFact("price", event.target.value)}
                />
              </div>
            </div>
            <div>
              <span className="wb-field-label">库存（可售）</span>
              <div className="wb-input">
                <input
                  value={product.facts.stock}
                  onChange={(event) => setFact("stock", event.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="wb-field">
            <span className="wb-field-label">单位</span>
            <div className="wb-field-control">
              {sourceBadge(true)}
              <div className="wb-input wb-input-select">
                <select defaultValue="套">
                  <option value="套">套</option>
                  <option value="件">件</option>
                  <option value="个">个</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <section className="wb-inspector-section">
          <h3>包装物流</h3>
          <div className="wb-field wb-field-split">
            <div>
              <span className="wb-field-label">包装尺寸（cm）</span>
              <div className="wb-dimension-row">
                <input
                  aria-label="包装长度（cm）"
                  inputMode="decimal"
                  value={product.facts.packageLength}
                  onChange={(event) => setFact("packageLength", event.target.value)}
                />
                <span>×</span>
                <input
                  aria-label="包装宽度（cm）"
                  inputMode="decimal"
                  value={product.facts.packageWidth}
                  onChange={(event) => setFact("packageWidth", event.target.value)}
                />
                <span>×</span>
                <input
                  aria-label="包装高度（cm）"
                  inputMode="decimal"
                  value={product.facts.packageHeight}
                  onChange={(event) => setFact("packageHeight", event.target.value)}
                />
              </div>
            </div>
            <div>
              <span className="wb-field-label">包装重量（kg）</span>
              <div className="wb-input">
                <input
                  value={product.facts.grossWeight}
                  onChange={(event) => setFact("grossWeight", event.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="wb-field">
            <span className="wb-field-label">运费模版</span>
            <div className="wb-field-control">
              {sourceBadge(true)}
              <div className="wb-input wb-input-select">
                <select defaultValue="标准物流">
                  <option value="标准物流">标准物流</option>
                  <option value="快速物流">快速物流</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <section className="wb-inspector-section">
          <h3>合规资料</h3>
          <div className="wb-field">
            <span className="wb-field-label">材质</span>
            <div className="wb-field-control">
              {sourceBadge(true)}
              <div className="wb-input">
                <input
                  value={product.facts.material}
                  onChange={(event) => setFact("material", event.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="wb-field">
            <span className="wb-field-label">合规说明</span>
            <div className="wb-field-control">
              {sourceBadge(true)}
              <div className="wb-input wb-input-counter wb-input-area">
                <textarea
                  rows={2}
                  value={complianceNote}
                  onChange={(event) =>
                    onChange({
                      ...product,
                      facts: { ...product.facts, certifications: [event.target.value] },
                    })
                  }
                />
                <small>{complianceNote.length}/200</small>
              </div>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}

function DraftStep({
  products,
  busy,
  selected,
  onOpenProduct,
  onCreateDrafts,
}: {
  products: ProductRecord[];
  busy: boolean;
  selected: Set<string>;
  onOpenProduct: (id: string) => void;
  onCreateDrafts: () => void;
}) {
  const scopedProducts = selected.size
    ? products.filter((product) => selected.has(product.id))
    : products;
  const ready = scopedProducts.filter((product) => getProductErrors(product).length === 0);
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
          {ready.length} 个{selected.size ? "所选" : ""}商品创建草稿
        </button>
      </div>

      <div className="draft-overview">
        <div className="draft-score">
          <span>可创建草稿</span>
          <strong>
            {ready.length}
            <small> / {scopedProducts.length}</small>
          </strong>
          <p>只有来源和 Schema 校验同时通过的商品会写入。</p>
        </div>
        <div className="draft-checks">
          <CheckLine
            label="AI 内容已人工确认"
            passed={scopedProducts.every((p) => p.aiConfirmed)}
          />
          <CheckLine
            label="交易和库存来自可信数据"
            passed={scopedProducts.every((p) => p.facts.price && p.facts.stock)}
          />
          <CheckLine
            label="尺寸、重量和包装完整"
            passed={scopedProducts.every((p) => p.facts.grossWeight)}
          />
          <CheckLine
            label="实时 Alibaba Schema"
            passed={scopedProducts.every((p) => p.isDemo || Boolean(p.schemaData))}
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
              <img src={getMainProductImage(product).url} alt="" />
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
  publishCount,
  onSelect,
  onActiveChange,
  onPublish,
}: {
  products: ProductRecord[];
  activeProductId: string;
  selected: Set<string>;
  publishCount: number;
  onSelect: (id: string) => void;
  onActiveChange: (id: string) => void;
  onPublish: () => void;
}) {
  const drafted = products.filter(
    (product) => product.stage === "drafted" || product.stage === "published",
  );
  const activeProduct =
    drafted.find((product) => product.id === activeProductId) ?? drafted[0] ?? null;

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
        {drafted.map((product) => {
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
              <img src={getMainProductImage(product).url} alt="" />
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
              <img src={getMainProductImage(activeProduct).url} alt={activeProduct.title} />
              <div className="preview-thumbnails">
                {activeProduct.images.map((image) => (
                  <img
                    key={image.id}
                    src={image.url}
                    alt=""
                    className={image.id === activeProduct.mainImageId ? "is-main" : ""}
                  />
                ))}
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
              <button type="button" className="preview-inquiry-button" disabled>
                Contact supplier · preview
              </button>
            </div>
          </div>
          <div className="preview-review-strip">
            <CheckCircle size={19} weight="fill" />
            <p>请检查图片、标题、属性、SKU、价格、MOQ、库存、包装物流和认证。</p>
            <button
              type="button"
              className="button button-primary"
              onClick={onPublish}
              disabled={publishCount === 0}
            >
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
  isDemo,
  confirmed,
  busy,
  onConfirmedChange,
  onClose,
  onConfirm,
}: {
  productCount: number;
  isDemo: boolean;
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
        <span className="eyebrow">{isDemo ? "演示发布检查" : "正式写入 Alibaba.com"}</span>
        <h2 id="publish-title">确认发布 {productCount} 个商品</h2>
        <p>
          {isDemo
            ? "演示商品只会更新当前页面状态，不会联系或改动真实 Alibaba 账户。"
            : "正式发布会写入真实商家账户，并进入 Alibaba 审核流程。失败商品会单独返回。"}
        </p>
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
            {isDemo ? "确认演示发布" : "确认正式发布"}
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

function actionLabel(step: number, aiPending: number) {
  if (step === 0) {
    return "开始 AI 分析";
  }
  if (step === 1) {
    return aiPending ? `确认剩余 ${aiPending} 项` : "进入资料填写";
  }
  if (step === 2) {
    return "校验并继续";
  }
  if (step === 3) {
    return "校验并创建草稿";
  }
  return "确认正式发布";
}

function getProductErrors(product: ProductRecord): string[] {
  const errors: string[] = [];
  if (!product.aiConfirmed) {
    errors.push("AI 内容尚未确认");
  }
  errors.push(...getFactErrors(product));
  return errors;
}

function getFactErrors(product: ProductRecord): string[] {
  const errors: string[] = [];
  for (const key of requiredFactKeys) {
    if (!String(product.facts[key] ?? "").trim()) {
      errors.push(factErrorLabel(key));
    }
  }
  if (!product.title.trim()) {
    errors.push("商品标题缺失");
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
