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
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type PhotoBankGroup,
  type PhotoBankImage,
  analyzeProductImages,
  createDraftBatch,
  findPhotoBankGroups,
  findPhotoBankImages,
  findPhotoBankUrl,
  findSchemaData,
  generateProductImages,
  getCategorySchema,
  listPhotoBankGroups,
  listPhotoBankImages,
  planProductImages,
  publishBatch,
  uploadPhotoBankImage,
} from "../api";
import { createEmptyFacts, getMainProductImage, getMissingStoreTemplateFields } from "../data";
import type {
  AlibabaConnectedStore,
  CapabilityResponse,
  DataMode,
  DraftField,
  ImageAnalysisResponse,
  ImageSlot,
  ImageSlotPlan,
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

// 把后端/AI 供应商返回的错误信息翻译成用户可读的中文提示，区分"未配置/余额不足/模型未注册/结构非法"等。
const describeAiFailure = (message: string | undefined): string => {
  const raw = message ?? "";
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient credits") || lower.includes("insufficient_quota")) {
    return "AI 服务额度不足，请联系管理员。";
  }
  if (lower.includes("not register") || lower.includes("model_not_found")) {
    return "AI 服务暂不可用，请联系管理员。";
  }
  if (lower.includes("is not configured") || lower.includes("api_key")) {
    return "AI 服务尚未开通，请联系管理员。";
  }
  if (lower.includes("invalid structured response") || lower.includes("invalid response")) {
    return "AI 返回异常，请重试。";
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("403")) {
    return "AI 服务暂不可用，请联系管理员。";
  }
  return raw || "AI 分析失败，请重试。";
};

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
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
  const [imageCandidates, setImageCandidates] = useState<ProductImageCandidate[]>([]);
  const [imagePlan, setImagePlan] = useState<ImageSlotPlan[]>([]);
  const [imagePlanBusy, setImagePlanBusy] = useState(false);
  const [providedImageInputs, setProvidedImageInputs] = useState<Record<string, string>>({});
  const [addedImageSlots, setAddedImageSlots] = useState<ImageSlot[]>([]);
  const [photoGroups, setPhotoGroups] = useState<PhotoBankGroup[]>([]);
  const [photoGroupId, setPhotoGroupId] = useState("");
  const [photoImages, setPhotoImages] = useState<PhotoBankImage[]>([]);
  const [photoBankLoading, setPhotoBankLoading] = useState(false);
  const [photoBankError, setPhotoBankError] = useState("");
  const [photoSelection, setPhotoSelection] = useState<string[]>([]);
  const photoBankAvailable =
    dataMode === "live" &&
    backendConnected &&
    Boolean(capabilities?.alibaba_credentials_configured);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousActiveProductId = useRef(activeProductId);

  const missingTemplateFields = useMemo(
    () => (dataMode === "live" ? getMissingStoreTemplateFields(settings) : []),
    [dataMode, settings],
  );
  const templateComplete = missingTemplateFields.length === 0;

  const blockForTemplate = () => {
    if (templateComplete) {
      return false;
    }
    notify(
      "error",
      "请先完成通用模板",
      `批量上品前需在店铺设置中补齐：${missingTemplateFields
        .map((field) => field.label)
        .join("、")}。`,
    );
    onOpenSettings();
    return true;
  };

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
      setImagePlan([]);
      setProvidedImageInputs({});
      setAddedImageSlots([]);
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

  useEffect(() => {
    if (step !== 0 || !photoBankAvailable || photoGroups.length) {
      return;
    }
    let cancelled = false;
    setPhotoBankLoading(true);
    setPhotoBankError("");
    listPhotoBankGroups()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const groups = findPhotoBankGroups(payload);
        setPhotoGroups(groups);
        setPhotoGroupId((current) => current || groups[0]?.id || "");
      })
      .catch((error) => {
        if (!cancelled) {
          setPhotoBankError(error instanceof Error ? error.message : "图片银行分组加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPhotoBankLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [step, photoBankAvailable, photoGroups.length]);

  useEffect(() => {
    if (!photoGroupId || !photoBankAvailable) {
      return;
    }
    let cancelled = false;
    setPhotoBankLoading(true);
    setPhotoBankError("");
    setPhotoSelection([]);
    listPhotoBankImages(photoGroupId)
      .then((payload) => {
        if (!cancelled) {
          setPhotoImages(findPhotoBankImages(payload));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPhotoBankError(error instanceof Error ? error.message : "图片银行图片加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPhotoBankLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [photoGroupId, photoBankAvailable]);

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
      source: "upload" as const,
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

  const togglePhotoSelection = (imageId: string) => {
    setPhotoSelection((current) =>
      current.includes(imageId) ? current.filter((id) => id !== imageId) : [...current, imageId],
    );
  };

  const createProductFromPhotoBank = async () => {
    const chosen = photoSelection.flatMap((id) => {
      const image = photoImages.find((item) => item.id === id);
      return image ? [image] : [];
    });
    if (!chosen.length) {
      notify("warning", "请先在图片银行中选择图片");
      return;
    }
    setBusy(true);
    try {
      const now = Date.now();
      const images = await Promise.all(
        chosen.map(async (image, index) => {
          let sourceFile: File | undefined;
          try {
            const response = await fetch(image.url);
            if (response.ok) {
              const blob = await response.blob();
              sourceFile = new File([blob], image.name || `photobank-${index}.jpg`, {
                type: blob.type || "image/jpeg",
              });
            }
          } catch {
            sourceFile = undefined;
          }
          return {
            id: `photobank-${now}-${index}`,
            url: image.url,
            name: image.name || `图片银行图片 ${index + 1}`,
            sourceFile,
            photoBankUrl: image.url,
            source: "photobank" as const,
          };
        }),
      );
      const newProduct: ProductRecord = {
        id: `photobank-${now}`,
        reference: `BANK-${String(now).slice(-6)}-01`,
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
      onProductsChange(shouldReplaceDemo ? [newProduct] : [...products, newProduct]);
      if (shouldReplaceDemo) {
        onDataModeChange("live");
      }
      setActiveProductId(newProduct.id);
      setPhotoSelection([]);
      const missingFiles = images.filter((image) => !image.sourceFile).length;
      notify(
        "success",
        `已从图片银行加入 1 个商品 · ${images.length} 张图片`,
        missingFiles
          ? `${missingFiles} 张图片无法下载原图，AI 分析将跳过这些图片。`
          : "第一张默认为主图，可随时更换；AI 会综合分析整组图片。",
      );
    } finally {
      setBusy(false);
    }
  };

  const analyzeOne = async (product: ProductRecord) => {
    if (!product.isDemo && (!backendConnected || !capabilities?.model_credentials_configured)) {
      notify(
        "error",
        !backendConnected ? "服务暂不可用" : "AI 服务尚未开通",
        "请稍后重试或联系管理员。",
      );
      return { success: false as const, error: "AI 服务尚未配置" };
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
      return { success: true as const };
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
      const scenario = getFieldString(response.generated_fields, [
        "use_scenario",
        "useScenario",
        "usage_scenario",
      ]);
      if (scenario) {
        setProvidedImageInputs((current) =>
          current.use_scenario?.trim() ? current : { ...current, use_scenario: scenario },
        );
      }
      return { success: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 分析失败";
      replaceProduct(product.id, (current) => ({
        ...current,
        stage: "error",
        errors: [message],
      }));
      return { success: false as const, error: message };
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
        !backendConnected ? "服务暂不可用" : "AI 服务尚未开通",
        "请稍后重试或联系管理员。",
      );
      return;
    }
    setBusy(true);
    const results = await Promise.all(
      products
        .filter((product) => product.stage === "uploaded" || product.stage === "error")
        .map(analyzeOne),
    );
    setBusy(false);
    setStep(1);
    const failures = results.filter((result) => !result.success);
    if (!results.length) {
      notify("info", "没有需要分析的商品", "所有商品都已完成 AI 分析。");
      return;
    }
    if (!failures.length) {
      notify("success", "AI 分析已完成", "请确认标题、类目建议和图片可见属性。");
      return;
    }
    notify(
      failures.length === results.length ? "error" : "warning",
      `AI 分析完成：成功 ${results.length - failures.length}/${results.length}`,
      describeAiFailure(failures[0].error),
    );
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

  const refreshImagePlan = async () => {
    if (!activeProduct || activeProduct.isDemo) {
      return;
    }
    setImagePlanBusy(true);
    try {
      const response = await planProductImages(activeProduct, {
        existingSlots: addedImageSlots,
        userInputs: providedImageInputs,
      });
      setImagePlan(response.slots);
      if (!response.slots.length) {
        notify("success", "商品图已补齐", "五类商品图均已加入当前商品图库。");
      }
    } catch (error) {
      notify("error", "无法检查缺失图种", error instanceof Error ? error.message : "请稍后重试。");
    } finally {
      setImagePlanBusy(false);
    }
  };

  const updateImageInput = (key: string, value: string) => {
    setProvidedImageInputs((current) => ({ ...current, [key]: value }));
  };

  const generateImagesForProduct = async (slots?: ImageSlot[]) => {
    if (!activeProduct || activeProduct.isDemo) {
      notify("info", "演示商品不调用生图", "切换到真实商品后再生成候选图片。");
      return;
    }
    const mainImage = getMainProductImage(activeProduct);
    const referenceFiles = [
      ...(mainImage.sourceFile ? [mainImage.sourceFile] : []),
      ...activeProduct.images.flatMap((image) =>
        image.id !== mainImage.id && image.sourceFile ? [image.sourceFile] : [],
      ),
    ];
    if (!referenceFiles.length) {
      notify("warning", "缺少参考图", "生图采用图生图，需要先上传真实商品主图作为参考。");
      return;
    }
    const requestedSlots =
      slots ?? imagePlan.filter((slot) => slot.can_generate).map((slot) => slot.slot);
    if (!requestedSlots.length) {
      notify("warning", "暂无可生成图种", "请先补齐提示的信息，再重新检查缺失图种。");
      return;
    }
    setImageGenerationBusy(true);
    setImageCandidates([]);
    try {
      const response = await generateProductImages(activeProduct, referenceFiles, {
        slots: requestedSlots,
        existingSlots: addedImageSlots,
        userInputs: providedImageInputs,
      });
      setImageCandidates(response.candidates);
      const successCount = response.candidates.filter((candidate) => candidate.image_url).length;
      notify(
        successCount ? "success" : "error",
        successCount ? "候选图片已生成" : "生图未返回图片",
        successCount
          ? `${successCount} 个图种返回候选，确认后可逐个加入图库。`
          : "请检查失败图种的原因后重试。",
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
          source: "generated" as const,
        },
      ],
    });
    setAddedImageSlots((current) =>
      current.includes(candidate.slot) ? current : [...current, candidate.slot],
    );
    setImagePlan((current) => current.filter((slot) => slot.slot !== candidate.slot));
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
      notify("success", "全部商品校验通过", "可以继续创建草稿。");
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
        !backendConnected ? "服务暂不可用" : "Alibaba 店铺尚未连接",
        !backendConnected ? "请稍后重试或联系管理员。" : "请先前往店铺授权。",
      );
      return;
    }
    if (targets.some((product) => !product.isDemo) && blockForTemplate()) {
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
            throw new Error(`${product.reference} 未获取到平台类目规则`);
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
    if (targets.some((product) => !product.isDemo) && blockForTemplate()) {
      setPublishDialogOpen(false);
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

  const bulkFillFacts = (
    values: Partial<Pick<ProductRecord["facts"], "price" | "moq" | "stock" | "grossWeight">>,
  ) => {
    const entries = Object.entries(values).filter(([, value]) => String(value ?? "").trim());
    if (!entries.length) {
      notify("warning", "请先填写要批量套用的值");
      return;
    }
    const targetIds = new Set(
      (selected.size ? products.filter((product) => selected.has(product.id)) : products).map(
        (product) => product.id,
      ),
    );
    let filled = 0;
    onProductsChange(
      products.map((product) => {
        if (!targetIds.has(product.id)) {
          return product;
        }
        const facts = { ...product.facts };
        let changed = false;
        for (const [key, value] of entries) {
          const factKey = key as keyof ProductRecord["facts"];
          if (!String(facts[factKey] ?? "").trim()) {
            (facts as Record<string, unknown>)[factKey] = String(value).trim();
            changed = true;
          }
        }
        if (!changed) {
          return product;
        }
        filled += 1;
        const next = { ...product, facts };
        const errors = getProductErrors(next);
        return { ...next, errors, stage: errors.length ? next.stage : "ready" };
      }),
    );
    notify(
      filled ? "success" : "info",
      filled ? `已批量填充 ${filled} 个商品的空缺字段` : "没有需要填充的空缺字段",
      "只填充空缺项，不覆盖已填写的值；请逐个核对后再创建草稿。",
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
    `待发布 ${draftedProducts.length}`,
  ];
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
          {!templateComplete ? (
            <div className="wb-template-gate" role="alert">
              <Warning size={20} weight="fill" />
              <div className="wb-template-gate-copy">
                <strong>批量上品前请先完成通用模板</strong>
                <p>待补齐：{missingTemplateFields.map((field) => field.label).join("、")}</p>
              </div>
              <button type="button" className="button button-dark" onClick={onOpenSettings}>
                完善通用模板
              </button>
            </div>
          ) : null}
          {step === 0 ? (
            <UploadStep
              products={products}
              dragActive={dragActive}
              busy={busy}
              photoBankAvailable={photoBankAvailable}
              photoBankLoading={photoBankLoading}
              photoBankError={photoBankError}
              photoGroups={photoGroups}
              photoGroupId={photoGroupId}
              photoImages={photoImages}
              photoSelection={photoSelection}
              onPhotoGroupChange={setPhotoGroupId}
              onTogglePhoto={togglePhotoSelection}
              onCreateFromPhotoBank={() => void createProductFromPhotoBank()}
              onDragActive={setDragActive}
              onDrop={onDrop}
              onPickFiles={() => fileInputRef.current?.click()}
              onRemove={removeProduct}
              onMainImageChange={setMainImage}
            />
          ) : null}

          {step === 1 ? (
            <AiStep
              products={products}
              busy={busy}
              activeProductId={activeProduct?.id ?? ""}
              onActiveChange={setActiveProductId}
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
              onBulkFill={bulkFillFacts}
              selectedCount={selected.size}
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
              selected={selected}
              publishCount={publishTargets.length}
              storeName={activeStore?.login_id ?? activeStore?.account ?? ""}
              unit={settings.priceUnit}
              currency={settings.currency}
              onSelect={toggleSelected}
              onPublish={() => setPublishDialogOpen(true)}
              onFix={(id) => {
                setActiveProductId(id);
                setInspectorOpen(true);
                setStep(2);
              }}
            />
          ) : null}
        </section>

        {step === 2 && activeProduct && inspectorOpen ? (
          <WbInspector
            product={activeProduct}
            settings={settings}
            onOpenSettings={onOpenSettings}
            imageCandidates={imageCandidates}
            imagePlan={imagePlan}
            imagePlanBusy={imagePlanBusy}
            providedImageInputs={providedImageInputs}
            imageGenerationBusy={imageGenerationBusy}
            onClose={() => setInspectorOpen(false)}
            onSwitch={() => {
              const next = products[(activeIndex + 1) % products.length];
              if (next) {
                setActiveProductId(next.id);
              }
            }}
            onChange={updateProduct}
            onRefreshImagePlan={() => void refreshImagePlan()}
            onChangeImageInput={updateImageInput}
            onGenerateImages={(slots) => void generateImagesForProduct(slots)}
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
  busy,
  photoBankAvailable,
  photoBankLoading,
  photoBankError,
  photoGroups,
  photoGroupId,
  photoImages,
  photoSelection,
  onPhotoGroupChange,
  onTogglePhoto,
  onCreateFromPhotoBank,
  onDragActive,
  onDrop,
  onPickFiles,
  onRemove,
  onMainImageChange,
}: {
  products: ProductRecord[];
  dragActive: boolean;
  busy: boolean;
  photoBankAvailable: boolean;
  photoBankLoading: boolean;
  photoBankError: string;
  photoGroups: PhotoBankGroup[];
  photoGroupId: string;
  photoImages: PhotoBankImage[];
  photoSelection: string[];
  onPhotoGroupChange: (groupId: string) => void;
  onTogglePhoto: (imageId: string) => void;
  onCreateFromPhotoBank: () => void;
  onDragActive: (active: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPickFiles: () => void;
  onRemove: (id: string) => void;
  onMainImageChange: (productId: string, imageId: string) => void;
}) {
  const [photoQuery, setPhotoQuery] = useState("");
  const visiblePhotos = photoQuery.trim()
    ? photoImages.filter((image) =>
        image.name.toLowerCase().includes(photoQuery.trim().toLowerCase()),
      )
    : photoImages;
  return (
    <div className="step-page upload-step">
      <div className="step-heading">
        <div>
          <h2>一组图片，建立一个商品</h2>
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

      {photoBankAvailable ? (
        <div className="photobank-panel">
          <div className="section-bar">
            <div>
              <h3>从店铺图片银行选择</h3>
              <p>分组与图片均来自已授权店铺的 Alibaba 图片银行，按选择顺序组成一个商品。</p>
            </div>
            <div className="photobank-toolbar">
              <select
                value={photoGroupId}
                aria-label="图片银行分组"
                onChange={(event) => onPhotoGroupChange(event.target.value)}
                disabled={photoBankLoading || !photoGroups.length}
              >
                {photoGroups.length ? null : <option value="">暂无分组</option>}
                {photoGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <div className="photobank-search">
                <MagnifyingGlass size={15} />
                <input
                  value={photoQuery}
                  placeholder="按图片名称搜索"
                  onChange={(event) => setPhotoQuery(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="button button-dark"
                onClick={onCreateFromPhotoBank}
                disabled={!photoSelection.length || busy}
              >
                {busy ? <CircleNotch size={16} className="spin" /> : <Plus size={16} />}
                以所选 {photoSelection.length} 张图建立商品
              </button>
            </div>
          </div>
          {photoBankError ? (
            <div className="photobank-state is-error">
              <WarningCircle size={18} />
              <span>{photoBankError}</span>
            </div>
          ) : photoBankLoading ? (
            <div className="photobank-state">
              <CircleNotch size={18} className="spin" />
              <span>正在从 Alibaba 同步图片银行…</span>
            </div>
          ) : visiblePhotos.length ? (
            <div className="photobank-grid">
              {visiblePhotos.map((image) => {
                const order = photoSelection.indexOf(image.id);
                return (
                  <button
                    key={image.id}
                    type="button"
                    className={`photobank-item ${order >= 0 ? "is-selected" : ""}`}
                    onClick={() => onTogglePhoto(image.id)}
                  >
                    <img src={image.url} alt={image.name} loading="lazy" />
                    {order >= 0 ? <span className="photobank-order">{order + 1}</span> : null}
                    <span className="photobank-name">{image.name || "未命名图片"}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="photobank-state">
              <Image size={18} />
              <span>
                {photoQuery.trim()
                  ? "没有匹配搜索的图片"
                  : "该分组下暂无图片，可切换分组或本地上传"}
              </span>
            </div>
          )}
        </div>
      ) : null}

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
                  <span
                    className={`upload-source-tag ${
                      product.images.some((image) => image.source === "photobank")
                        ? "is-photobank"
                        : "is-upload"
                    }`}
                  >
                    {product.images.some((image) => image.source === "photobank")
                      ? "图片银行"
                      : "本地上传"}
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
    </div>
  );
}

function AiStep({
  products,
  busy,
  activeProductId,
  onActiveChange,
  onAnalyze,
  onConfirm,
  onConfirmAll,
  onChange,
  onMainImageChange,
}: {
  products: ProductRecord[];
  busy: boolean;
  activeProductId: string;
  onActiveChange: (id: string) => void;
  onAnalyze: (product: ProductRecord) => Promise<{ success: boolean }>;
  onConfirm: (id: string) => void;
  onConfirmAll: () => void;
  onChange: (product: ProductRecord) => void;
  onMainImageChange: (productId: string, imageId: string) => void;
}) {
  const pending = products.filter((product) => !product.aiConfirmed);
  const active = products.find((product) => product.id === activeProductId) ?? products[0] ?? null;
  const listStatus = (product: ProductRecord) => {
    if (product.stage === "analyzing") {
      return { label: "分析中", className: "is-analyzing" };
    }
    if (product.stage === "error") {
      return { label: "分析失败", className: "is-error" };
    }
    if (product.stage === "uploaded") {
      return { label: "待分析", className: "is-pending" };
    }
    if (product.aiConfirmed) {
      return { label: "已确认", className: "is-confirmed" };
    }
    return { label: "待确认", className: "is-pending" };
  };
  return (
    <div className="step-page ai-step">
      <div className="step-heading">
        <div>
          <h2>确认商品内容</h2>
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

      <div className="ai-master-detail">
        <div className="ai-product-list" role="listbox" aria-label="商品列表">
          {products.map((product) => {
            const status = listStatus(product);
            return (
              <button
                key={product.id}
                type="button"
                className={`ai-product-item ${active?.id === product.id ? "is-active" : ""}`}
                onClick={() => onActiveChange(product.id)}
              >
                <img src={getMainProductImage(product).url} alt="" />
                <span className="ai-product-item-copy">
                  <strong>{product.title || product.reference}</strong>
                  <small>{product.images.length} 张图片</small>
                </span>
                <span className={`ai-product-status ${status.className}`}>
                  {product.stage === "analyzing" ? (
                    <CircleNotch size={13} className="spin" />
                  ) : null}
                  {status.label}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ai-review-list">
          {products
            .filter((product) => product.id === (active?.id ?? ""))
            .map((product) => (
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
                  <div className="ai-field-table-scroll">
                    <table className="ai-field-table">
                      <thead>
                        <tr>
                          <th>字段</th>
                          <th>中文说明 / 发布内容</th>
                          <th>来源</th>
                          <th>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row">商品标题</th>
                          <td>
                            <div className="ai-field-bilingual">
                              <AiLocalizedValue
                                value={product.titleZh}
                                emptyLabel="等待 AI 生成中文说明"
                              />
                              <label className="ai-field-publish">
                                <span>发布英文</span>
                                <textarea
                                  rows={2}
                                  value={product.title}
                                  placeholder="等待 AI 生成"
                                  aria-label={`${product.reference} 英文标题`}
                                  onChange={(event) =>
                                    onChange({ ...product, title: event.target.value })
                                  }
                                />
                              </label>
                            </div>
                          </td>
                          <td>
                            <AiFieldSource label="AI 生成" />
                          </td>
                          <td>{aiFieldStatus(product, Boolean(product.title.trim()))}</td>
                        </tr>
                        <tr>
                          <th scope="row">类目建议</th>
                          <td>
                            <AiLocalizedPair
                              localized={product.facts.categoryLabelZh}
                              publication={product.facts.categoryLabel}
                              publicationLabel="Alibaba 英文类目建议"
                              emptyLabel="等待 AI 分析"
                            />
                          </td>
                          <td>
                            <AiFieldSource label="AI 建议" />
                          </td>
                          <td>
                            {aiFieldStatus(product, Boolean(product.facts.categoryLabel.trim()))}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">关键词</th>
                          <td>
                            <AiLocalizedTags
                              localized={product.keywordsZh}
                              publication={product.keywords}
                              publicationLabel="发布英文"
                              emptyLabel="等待 AI 生成"
                            />
                          </td>
                          <td>
                            <AiFieldSource label="AI 生成" />
                          </td>
                          <td>{aiFieldStatus(product, product.keywords.length > 0)}</td>
                        </tr>
                        <tr>
                          <th scope="row">核心卖点</th>
                          <td>
                            <AiLocalizedList
                              localized={product.sellingPointsZh}
                              publication={product.sellingPoints}
                              publicationLabel="发布英文"
                              emptyLabel="等待 AI 生成"
                            />
                          </td>
                          <td>
                            <AiFieldSource label="AI 生成" />
                          </td>
                          <td>{aiFieldStatus(product, product.sellingPoints.length > 0)}</td>
                        </tr>
                        <tr>
                          <th scope="row">商品描述</th>
                          <td>
                            <AiLocalizedPair
                              localized={product.descriptionZh}
                              publication={product.description}
                              publicationLabel="发布英文"
                              emptyLabel="等待 AI 生成"
                            />
                          </td>
                          <td>
                            <AiFieldSource label="AI 生成" />
                          </td>
                          <td>{aiFieldStatus(product, Boolean(product.description.trim()))}</td>
                        </tr>
                        <tr>
                          <th scope="row">图片可见属性</th>
                          <td>
                            <AiLocalizedTags
                              localized={product.visibleTraitsZh}
                              publication={product.visibleTraits}
                              publicationLabel="图片识别原文"
                              emptyLabel="等待 AI 分析"
                            />
                          </td>
                          <td>
                            <AiFieldSource label="图片识别" />
                          </td>
                          <td>{aiFieldStatus(product, product.visibleTraits.length > 0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="ai-review-actions">
                  {product.stage !== "analyzing" ? (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void onAnalyze(product)}
                    >
                      <MagicWand size={17} />
                      {product.stage === "uploaded" || product.stage === "error"
                        ? "开始分析"
                        : "重新分析"}
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
          {!active ? <div className="preview-empty">还没有可确认的商品。</div> : null}
        </div>
      </div>
    </div>
  );
}

function AiFieldTags({ values, emptyLabel }: { values: string[]; emptyLabel: string }) {
  if (!values.length) {
    return <span className="ai-empty">{emptyLabel}</span>;
  }
  return (
    <div className="ai-field-tags">
      {values.map((value) => (
        <i key={value}>{value}</i>
      ))}
    </div>
  );
}

function AiLocalizedValue({ value, emptyLabel }: { value?: string; emptyLabel: string }) {
  return (
    <div className="ai-field-localized">
      <span>中文说明</span>
      <p className={value ? "ai-field-description" : "ai-empty"}>{value || emptyLabel}</p>
    </div>
  );
}

function AiLocalizedPair({
  localized,
  publication,
  publicationLabel,
  emptyLabel,
}: {
  localized?: string;
  publication: string;
  publicationLabel: string;
  emptyLabel: string;
}) {
  return (
    <div className="ai-field-bilingual">
      <AiLocalizedValue value={localized} emptyLabel={emptyLabel} />
      <div className="ai-field-publication">
        <span>{publicationLabel}</span>
        <p className={publication ? "ai-field-description" : "ai-empty"}>
          {publication || emptyLabel}
        </p>
      </div>
    </div>
  );
}

function AiLocalizedTags({
  localized = [],
  publication,
  publicationLabel,
  emptyLabel,
}: {
  localized?: string[];
  publication: string[];
  publicationLabel: string;
  emptyLabel: string;
}) {
  return (
    <div className="ai-field-bilingual">
      <div className="ai-field-localized">
        <span>中文说明</span>
        <AiFieldTags values={localized} emptyLabel={emptyLabel} />
      </div>
      <div className="ai-field-publication">
        <span>{publicationLabel}</span>
        <AiFieldTags values={publication} emptyLabel={emptyLabel} />
      </div>
    </div>
  );
}

function AiLocalizedList({
  localized = [],
  publication,
  publicationLabel,
  emptyLabel,
}: {
  localized?: string[];
  publication: string[];
  publicationLabel: string;
  emptyLabel: string;
}) {
  return (
    <div className="ai-field-bilingual">
      <div className="ai-field-localized">
        <span>中文说明</span>
        <AiFieldList values={localized} emptyLabel={emptyLabel} />
      </div>
      <div className="ai-field-publication">
        <span>{publicationLabel}</span>
        <AiFieldList values={publication} emptyLabel={emptyLabel} />
      </div>
    </div>
  );
}

function AiFieldList({ values, emptyLabel }: { values: string[]; emptyLabel: string }) {
  if (!values.length) {
    return <span className="ai-empty">{emptyLabel}</span>;
  }
  return (
    <ul className="ai-field-list">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

function AiFieldSource({ label }: { label: string }) {
  return <span className="ai-field-source">{label}</span>;
}

function aiFieldStatus(product: ProductRecord, hasValue: boolean) {
  const label =
    product.stage === "analyzing"
      ? "生成中"
      : hasValue
        ? product.aiConfirmed
          ? "已确认"
          : "待确认"
        : "待分析";
  return (
    <span
      className={`ai-field-status ${
        product.stage === "analyzing"
          ? "is-working"
          : hasValue
            ? product.aiConfirmed
              ? "is-confirmed"
              : "is-ready"
            : "is-empty"
      }`}
    >
      {label}
    </span>
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
  onBulkFill,
  selectedCount,
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
  onBulkFill: (
    values: Partial<Pick<ProductRecord["facts"], "price" | "moq" | "stock" | "grossWeight">>,
  ) => void;
  selectedCount: number;
}) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [checkFilter, setCheckFilter] = useState<CheckFilter>("all");
  const [bulkValues, setBulkValues] = useState({
    price: "",
    moq: "",
    stock: "",
    grossWeight: "",
  });
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
            <option value="user_confirmed">已确认</option>
            <option value="ai_candidate">AI 候选</option>
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

      <div className="wb-bulk-fill">
        <strong>批量填充交易信息</strong>
        <small>
          {selectedCount ? `套用到选中的 ${selectedCount} 个商品` : "未勾选时套用到全部商品"}
          ，只填空缺、不覆盖已填写的值
        </small>
        <label>
          <span>价格（USD）</span>
          <input
            value={bulkValues.price}
            onChange={(event) => setBulkValues({ ...bulkValues, price: event.target.value })}
            placeholder="如 2.35"
          />
        </label>
        <label>
          <span>MOQ</span>
          <input
            value={bulkValues.moq}
            onChange={(event) => setBulkValues({ ...bulkValues, moq: event.target.value })}
            placeholder="如 500"
          />
        </label>
        <label>
          <span>库存</span>
          <input
            value={bulkValues.stock}
            onChange={(event) => setBulkValues({ ...bulkValues, stock: event.target.value })}
            placeholder="如 10000"
          />
        </label>
        <label>
          <span>包装毛重（kg）</span>
          <input
            value={bulkValues.grossWeight}
            onChange={(event) => setBulkValues({ ...bulkValues, grossWeight: event.target.value })}
            placeholder="如 12.5"
          />
        </label>
        <button type="button" className="button button-dark" onClick={() => onBulkFill(bulkValues)}>
          批量填充空缺
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
                      {product.aiConfirmed ? "已确认" : "AI 候选"}
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
  settings,
  onOpenSettings,
  imageCandidates,
  imagePlan,
  imagePlanBusy,
  providedImageInputs,
  imageGenerationBusy,
  onClose,
  onSwitch,
  onChange,
  onRefreshImagePlan,
  onChangeImageInput,
  onGenerateImages,
  onAddGeneratedImage,
}: {
  product: ProductRecord;
  settings: StoreSettings;
  onOpenSettings: () => void;
  imageCandidates: ProductImageCandidate[];
  imagePlan: ImageSlotPlan[];
  imagePlanBusy: boolean;
  providedImageInputs: Record<string, string>;
  imageGenerationBusy: boolean;
  onClose: () => void;
  onSwitch: () => void;
  onChange: (product: ProductRecord) => void;
  onRefreshImagePlan: () => void;
  onChangeImageInput: (key: string, value: string) => void;
  onGenerateImages: (slots?: ImageSlot[]) => void;
  onAddGeneratedImage: (candidate: ProductImageCandidate) => void;
}) {
  const setFact = (key: keyof ProductRecord["facts"], value: string) => {
    onChange({ ...product, facts: { ...product.facts, [key]: value } });
  };
  const sourceBadge = (confirmed: boolean) => (
    <span className={`wb-source ${confirmed ? "is-confirmed" : "is-candidate"}`}>
      {confirmed ? "已确认" : "AI 候选"}
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
            <h3>智能补齐商品图</h3>
            <button
              type="button"
              className="button button-secondary wb-image-generation-button"
              onClick={onRefreshImagePlan}
              disabled={imagePlanBusy || imageGenerationBusy || product.isDemo}
            >
              {imagePlanBusy ? <CircleNotch size={15} className="spin" /> : <Sparkle size={15} />}
              {imagePlanBusy ? "检查中" : "检查缺失图种"}
            </button>
          </div>
          {product.isDemo ? (
            <p className="wb-image-generation-empty">演示商品无法生成图片。</p>
          ) : null}
          {imagePlan.length ? (
            <div className="wb-image-plan">
              <div className="wb-image-plan-summary">
                <span>
                  缺失 {imagePlan.length} 种 · 可生成{" "}
                  {imagePlan.filter((slot) => slot.can_generate).length} 种
                </span>
                <button
                  type="button"
                  className="button button-secondary wb-image-generation-button"
                  onClick={() => onGenerateImages()}
                  disabled={imageGenerationBusy || !imagePlan.some((slot) => slot.can_generate)}
                >
                  {imageGenerationBusy ? (
                    <CircleNotch size={15} className="spin" />
                  ) : (
                    <MagicWand size={15} />
                  )}
                  {imageGenerationBusy ? "生成中" : "生成全部就绪图种"}
                </button>
              </div>
              {imagePlan.map((slot) => (
                <article
                  key={slot.slot}
                  className={`wb-image-plan-item ${slot.can_generate ? "is-ready" : "is-blocked"}`}
                >
                  <div className="wb-image-plan-title">
                    <div>
                      <strong>{slot.label}</strong>
                      <span>{slot.purpose}</span>
                    </div>
                    <small>{slot.can_generate ? "可生成" : "需要商品信息"}</small>
                  </div>
                  {slot.missing_user_inputs.map((requirement) => (
                    <label key={requirement.key} className="wb-image-plan-input">
                      <span>{requirement.label}</span>
                      <input
                        value={providedImageInputs[requirement.key] ?? ""}
                        onChange={(event) =>
                          onChangeImageInput(requirement.key, event.target.value)
                        }
                        placeholder={requirement.description}
                      />
                    </label>
                  ))}
                  <div className="wb-image-plan-actions">
                    <button
                      type="button"
                      className="wb-link"
                      onClick={() => onGenerateImages([slot.slot])}
                      disabled={!slot.can_generate || imageGenerationBusy}
                    >
                      生成此图
                    </button>
                  </div>
                </article>
              ))}
            </div>
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
              {sourceBadge(product.aiConfirmed)}
              <div className="wb-input wb-input-readonly">
                {product.facts.categoryLabel ? (
                  <p>
                    {product.facts.categoryLabel}
                    {product.facts.categoryId ? <small>ID {product.facts.categoryId}</small> : null}
                  </p>
                ) : (
                  <p className="wb-input-empty">
                    等待 AI 类目建议（创建草稿时按 Alibaba 类目 schema 校验）
                  </p>
                )}
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
              <span className="wb-field-label">
                价格{settings.currency ? `（${settings.currency}）` : ""}
              </span>
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
            <span className="wb-field-label">计量单位</span>
            <div className="wb-field-control">
              {sourceBadge(true)}
              <div className="wb-input wb-input-readonly">
                {settings.priceUnit ? (
                  <p>{settings.priceUnit}</p>
                ) : (
                  <button type="button" className="wb-link" onClick={onOpenSettings}>
                    尚未从店铺同步，去通用模板设置
                  </button>
                )}
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
              <div className="wb-input wb-input-readonly">
                {settings.shippingTemplateLabel || settings.shippingTemplateId ? (
                  <p>
                    {settings.shippingTemplateLabel || `模板 ID ${settings.shippingTemplateId}`}
                  </p>
                ) : (
                  <button type="button" className="wb-link" onClick={onOpenSettings}>
                    尚未从店铺同步，去通用模板设置
                  </button>
                )}
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
  const aiPendingCount = scopedProducts.filter((product) => !product.aiConfirmed).length;
  const missingFactsCount = scopedProducts.filter(
    (product) => product.aiConfirmed && getFactErrors(product).length > 0,
  ).length;
  const failedCount = scopedProducts.filter((product) => product.stage === "error").length;
  return (
    <div className="step-page draft-step">
      <div className="step-heading">
        <div>
          <h2>逐商品校验并创建草稿</h2>
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

      <div className="draft-stat-cards">
        <div className="draft-stat-card is-ok">
          <CheckCircle size={22} weight="fill" />
          <span>
            <strong>{ready.length}</strong>
            <small>可创建草稿</small>
          </span>
        </div>
        <div className="draft-stat-card is-info">
          <Sparkle size={22} weight="fill" />
          <span>
            <strong>{aiPendingCount}</strong>
            <small>AI 内容待确认</small>
          </span>
        </div>
        <div className="draft-stat-card is-warn">
          <WarningCircle size={22} weight="fill" />
          <span>
            <strong>{missingFactsCount}</strong>
            <small>缺失事实</small>
          </span>
        </div>
        <div className="draft-stat-card is-danger">
          <XCircle size={22} weight="fill" />
          <span>
            <strong>{failedCount}</strong>
            <small>校验失败</small>
          </span>
        </div>
      </div>

      <div className="draft-table-wrap">
        <table className="draft-table">
          <thead>
            <tr>
              <th>商品</th>
              <th>类目（Alibaba）</th>
              <th>价格</th>
              <th>MOQ</th>
              <th>库存</th>
              <th>校验状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const errors = getProductErrors(product);
              const isDrafted = product.stage === "drafted" || product.stage === "published";
              const isFailed = product.stage === "error";
              return (
                <tr key={product.id} className={errors.length || isFailed ? "is-invalid" : ""}>
                  <td>
                    <div className="draft-table-product">
                      <img src={getMainProductImage(product).url} alt="" />
                      <span>
                        <strong>{product.title || product.reference}</strong>
                        <small>{product.reference}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    {product.facts.categoryLabel ? (
                      <span className="draft-table-category">
                        {product.facts.categoryLabel}
                        {product.facts.categoryId ? (
                          <small>ID {product.facts.categoryId}</small>
                        ) : null}
                      </span>
                    ) : (
                      <span className="ai-empty">待 AI 建议</span>
                    )}
                  </td>
                  <td className="is-numeric">{product.facts.price || "—"}</td>
                  <td className="is-numeric">{product.facts.moq || "—"}</td>
                  <td className="is-numeric">{product.facts.stock || "—"}</td>
                  <td>
                    {isDrafted ? (
                      <SourceBadge source="trusted" label="草稿已创建" />
                    ) : product.stage === "drafting" ? (
                      <span className="working-label">
                        <CircleNotch size={15} className="spin" />
                        创建中
                      </span>
                    ) : isFailed ? (
                      <span className="draft-error-text">{product.errors[0] ?? "创建失败"}</span>
                    ) : errors.length ? (
                      <span className="draft-error-text">{errors[0]}</span>
                    ) : (
                      <SourceBadge source="trusted" label="校验通过" />
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`row-action ${errors.length || isFailed ? "is-danger" : ""}`}
                      onClick={() => onOpenProduct(product.id)}
                    >
                      {errors.length || isFailed ? "修复" : "查看"}
                      <ArrowRight size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewStep({
  products,
  selected,
  publishCount,
  storeName,
  unit,
  currency,
  onSelect,
  onPublish,
  onFix,
}: {
  products: ProductRecord[];
  selected: Set<string>;
  publishCount: number;
  storeName: string;
  unit: string;
  currency: string;
  onSelect: (id: string) => void;
  onPublish: () => void;
  onFix: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = products.filter(
    (product) =>
      Boolean(product.draftProductId) ||
      product.stage === "drafted" ||
      product.stage === "publishing" ||
      product.stage === "published" ||
      product.stage === "error",
  );
  const succeeded = rows.filter((product) => product.stage !== "error").length;
  const failed = rows.length - succeeded;
  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const statusBadge = (product: ProductRecord) => {
    if (product.stage === "published") {
      return <SourceBadge source="trusted" label="已发布" />;
    }
    if (product.stage === "publishing") {
      return (
        <span className="working-label">
          <CircleNotch size={15} className="spin" />
          发布中
        </span>
      );
    }
    if (product.stage === "error") {
      return <SourceBadge source="missing" label="失败" />;
    }
    return <SourceBadge source="default" label="草稿待发布" />;
  };

  return (
    <div className="step-page preview-step">
      <div className="step-heading">
        <div>
          <h2>回读草稿并发布</h2>
        </div>
        <button
          type="button"
          className="button button-primary button-large"
          onClick={onPublish}
          disabled={publishCount === 0}
        >
          <UploadSimple size={19} />
          确认并发布所选 {publishCount} 个商品
        </button>
      </div>

      <div className={`publish-banner ${failed ? "has-failures" : ""}`}>
        {failed ? (
          <WarningCircle size={22} weight="fill" />
        ) : (
          <CheckCircle size={22} weight="fill" />
        )}
        <p>
          草稿创建完成：成功 <strong>{succeeded}</strong> 个
          {failed ? (
            <>
              {" "}
              · 失败 <strong>{failed}</strong> 个，展开失败行可查看 Alibaba 返回的具体错误
            </>
          ) : null}
        </p>
      </div>

      {rows.length ? (
        <div className="draft-table-wrap">
          <table className="draft-table readback-table">
            <thead>
              <tr>
                <th aria-label="选择" />
                <th>商品</th>
                <th>草稿 / 商品 ID</th>
                <th>店铺</th>
                <th>价格</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const canPublish = product.stage === "drafted";
                const isFailed = product.stage === "error";
                const isExpanded = expanded.has(product.id);
                return (
                  <Fragment key={product.id}>
                    <tr className={isFailed ? "is-invalid" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择发布 ${product.reference}`}
                          checked={selected.has(product.id)}
                          disabled={!canPublish}
                          onChange={() => onSelect(product.id)}
                        />
                      </td>
                      <td>
                        <div className="draft-table-product">
                          <img src={getMainProductImage(product).url} alt="" />
                          <span>
                            <strong>{product.title || product.reference}</strong>
                            <small>{product.reference}</small>
                          </span>
                        </div>
                      </td>
                      <td className="is-numeric">{product.draftProductId ?? "—"}</td>
                      <td>{storeName || "—"}</td>
                      <td className="is-numeric">
                        {product.facts.price
                          ? `${currency || "USD"} ${product.facts.price}${unit ? ` / ${unit}` : ""}`
                          : "—"}
                      </td>
                      <td>{statusBadge(product)}</td>
                      <td>
                        <div className="readback-actions">
                          {isFailed ? (
                            <>
                              <button
                                type="button"
                                className="row-action is-danger"
                                onClick={() => toggleExpanded(product.id)}
                              >
                                {isExpanded ? "收起错误" : "查看错误"}
                              </button>
                              <button
                                type="button"
                                className="row-action"
                                onClick={() => onFix(product.id)}
                              >
                                返回修复
                                <ArrowRight size={15} />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="row-action"
                              onClick={() => toggleExpanded(product.id)}
                            >
                              {isExpanded ? "收起" : "查看"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="readback-detail-row">
                        <td colSpan={7}>
                          {isFailed && product.errors.length ? (
                            <div className="readback-errors">
                              <strong>Alibaba 返回错误</strong>
                              <ul>
                                {product.errors.map((error) => (
                                  <li key={error}>{error}</li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <div className="readback-preview">
                              <img src={getMainProductImage(product).url} alt="" />
                              <div>
                                <h3>{product.title || product.reference}</h3>
                                <p>{product.facts.categoryLabel || "类目待定"}</p>
                                <p className="readback-preview-points">
                                  {product.sellingPoints.slice(0, 3).join(" · ")}
                                </p>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="preview-empty">还没有已创建的草稿，请先在上一步创建草稿。</div>
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
  const titleZh =
    getFieldDisplayString(generated, ["title", "subject", "english_title"]) || product.titleZh;
  const description =
    getFieldString(generated, ["description", "detail", "product_description"]) ||
    product.description;
  const descriptionZh =
    getFieldDisplayString(generated, ["description", "detail", "product_description"]) ||
    product.descriptionZh;
  const keywords = getFieldList(generated, ["keywords", "keyword"]) || product.keywords;
  const keywordsZh = getFieldDisplayList(generated, ["keywords", "keyword"]) || product.keywordsZh;
  const sellingPoints =
    getFieldList(generated, ["selling_points", "sellingPoints", "highlights"]) ||
    product.sellingPoints;
  const sellingPointsZh =
    getFieldDisplayList(generated, ["selling_points", "sellingPoints", "highlights"]) ||
    product.sellingPointsZh;
  const visibleTraits = Object.values(observed)
    .map((field) => normalizeFieldValue(field))
    .flatMap((value) => (Array.isArray(value) ? value.map(String) : [String(value)]))
    .filter(Boolean)
    .slice(0, 5);
  const translatedVisibleTraits = Object.values(observed)
    .map((field) => normalizeDisplayValue(field))
    .flatMap((value) => (Array.isArray(value) ? value.map(String) : [String(value)]))
    .filter(Boolean)
    .slice(0, 5);
  const visibleTraitsZh = translatedVisibleTraits.length
    ? translatedVisibleTraits
    : product.visibleTraitsZh;
  const category = normalizeFieldValue(response.category_suggestions[0]);
  const categoryZh = normalizeDisplayValue(response.category_suggestions[0]);
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
    titleZh,
    description,
    descriptionZh,
    keywords,
    keywordsZh,
    sellingPoints,
    sellingPointsZh,
    visibleTraits,
    visibleTraitsZh,
    aiConfirmed: false,
    stage: "ai_ready",
    facts: {
      ...product.facts,
      categoryId,
      categoryLabel,
      categoryLabelZh: typeof categoryZh === "string" ? categoryZh : product.facts.categoryLabelZh,
    },
    errors: [...response.warnings, "AI 内容尚未确认"],
  };
}

function getFieldDisplayString(fields: Record<string, DraftField>, keys: string[]): string {
  for (const key of keys) {
    const value = normalizeDisplayValue(fields[key]);
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
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

function getFieldDisplayList(fields: Record<string, DraftField>, keys: string[]): string[] | null {
  for (const key of keys) {
    const value = normalizeDisplayValue(fields[key]);
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

function normalizeDisplayValue(field?: DraftField): unknown {
  return field?.display_value_zh;
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

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
