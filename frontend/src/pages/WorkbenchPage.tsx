import {
  ArrowCounterClockwise,
  ArrowRight,
  Bell,
  CaretLeft,
  CaretRight,
  ChartBar,
  Check,
  CheckCircle,
  CheckSquare,
  CircleNotch,
  CloudArrowUp,
  FileText,
  FloppyDisk,
  GearSix,
  Image,
  LockSimple,
  MagicWand,
  MagnifyingGlass,
  Plus,
  Question,
  Sparkle,
  Translate,
  Trash,
  UploadSimple,
  Warning,
  WarningCircle,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { type TCountryCode, type TLanguageCode, countries, languages } from "countries-list";
import {
  type ChangeEvent,
  type DragEvent,
  Fragment,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type PhotoBankGroup,
  type PhotoBankImage,
  analyzeProductImages,
  applyListingTemplate,
  confirmListingField,
  createDraftBatch,
  createListingTemplate,
  deleteListingTemplate,
  findAlibabaVideos,
  findPhotoBankFileId,
  findPhotoBankGroups,
  findPhotoBankImages,
  findPhotoBankUrl,
  findSchemaData,
  generateProductImages,
  getAsyncFieldOptions,
  getCategoryPublishCapabilities,
  getCategorySchema,
  getListingFeatureFlags,
  getListingMetrics,
  getListingTasks,
  getSchemaGuidance,
  importListingProducts,
  listAlibabaVideos,
  listCategoryChildren,
  listListingTemplates,
  listPhotoBankGroups,
  listPhotoBankImages,
  planProductImages,
  publishBatch,
  recommendAlibabaCategories,
  recordListingMetricEvent,
  relateAlibabaVideo,
  translateProductContent,
  updateListingFeatureFlags,
  uploadAlibabaVideoFile,
  uploadPhotoBankImage,
} from "../api";
import { createEmptyFacts, getMainProductImage, getMissingStoreTemplateFields } from "../data";
import { resolveSchemaOptionValue, schemaOptionMatches } from "../schemaOptions";
import type {
  AlibabaCategoryOption,
  AlibabaCategoryRecommendation,
  AlibabaConnectedStore,
  AlibabaVideo,
  CapabilityResponse,
  DataMode,
  DraftField,
  DraftFieldDifference,
  FieldTask,
  ImageAnalysisResponse,
  ImageSlot,
  ImageSlotPlan,
  ListingFeatureFlags,
  ListingMetrics,
  ListingTemplate,
  ProductImage,
  ProductImageCandidate,
  ProductRecord,
  ProductTranslation,
  SchemaFieldGuidance,
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
  onProductsChange: (products: SetStateAction<ProductRecord[]>) => void;
  onDataModeChange: (mode: DataMode) => void;
  onResetDemo: () => void;
  onOpenSettings: () => void;
  notify: (tone: ToastMessage["tone"], title: string, detail?: string) => void;
};

const defaultListingFeatureFlags: ListingFeatureFlags = {
  workflow_v2: true,
  templates: true,
  imports: true,
  metrics: true,
  legacy_fallback: true,
};

const importedValue = (fields: Record<string, DraftField>, ...keys: string[]): unknown => {
  for (const key of keys) {
    const field = fields[key];
    if (field?.value !== undefined && field.value !== null && field.value !== "") {
      return field.value;
    }
  }
  return undefined;
};

const importedText = (fields: Record<string, DraftField>, ...keys: string[]): string => {
  const value = importedValue(fields, ...keys);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

const mergeListingFields = (
  product: ProductRecord,
  fields: Record<string, DraftField>,
): ProductRecord => {
  const dimensions = importedValue(fields, "dimensions");
  const packaging = importedValue(fields, "packaging");
  const dimensionValues =
    dimensions && typeof dimensions === "object" ? (dimensions as Record<string, unknown>) : {};
  const packagingValues =
    packaging && typeof packaging === "object" ? (packaging as Record<string, unknown>) : {};
  const listValue = (key: string) => {
    const value = importedValue(fields, key);
    return Array.isArray(value) ? value.map(String) : undefined;
  };
  const importedSkus = importedValue(fields, "sku_rows");
  const skuRows = Array.isArray(importedSkus)
    ? importedSkus.flatMap((value, index) => {
        if (!value || typeof value !== "object") {
          return [];
        }
        const row = value as Record<string, unknown>;
        return [
          {
            id: String(row.id || `sku-imported-${index}`),
            sku: String(row.sku ?? row.sku_id ?? row.code ?? ""),
            attributes: String(row.attributes ?? row.specification ?? row.spec ?? ""),
            price: String(row.price ?? ""),
            stock: String(row.stock ?? row.inventory ?? ""),
            propertyValues: Array.isArray(row.propertyValues)
              ? row.propertyValues.flatMap((item) => {
                  if (!item || typeof item !== "object" || Array.isArray(item)) {
                    return [];
                  }
                  const record = item as Record<string, unknown>;
                  const attributes =
                    record.attributes &&
                    typeof record.attributes === "object" &&
                    !Array.isArray(record.attributes)
                      ? Object.fromEntries(
                          Object.entries(record.attributes).map(([key, value]) => [key, String(value)]),
                        )
                      : {};
                  return [{ value: String(record.value ?? ""), attributes }];
                })
              : undefined,
          },
        ];
      })
    : product.facts.skuRows;
  const factText = (current: string, ...keys: string[]) => importedText(fields, ...keys) || current;
  return {
    ...product,
    title: factText(product.title, "subject", "title", "product_title"),
    description: factText(product.description, "description", "detail"),
    keywords: listValue("keywords") ?? product.keywords,
    sellingPoints: listValue("selling_points") ?? product.sellingPoints,
    facts: {
      ...product.facts,
      categoryId: factText(product.facts.categoryId, "category_id", "cat_id"),
      brand: factText(product.facts.brand, "brand"),
      model: factText(product.facts.model, "model"),
      material: factText(product.facts.material, "material"),
      price: factText(product.facts.price, "price"),
      moq: factText(product.facts.moq, "moq"),
      stock: factText(product.facts.stock, "inventory", "stock"),
      leadTime: factText(product.facts.leadTime, "lead_time"),
      origin: factText(product.facts.origin, "origin"),
      hsCode: factText(product.facts.hsCode, "hs_code"),
      grossWeight:
        factText(product.facts.grossWeight, "gross_weight") ||
        String(packagingValues.grossWeight ?? ""),
      packageLength:
        factText(product.facts.packageLength, "package_length") ||
        String(packagingValues.length ?? ""),
      packageWidth:
        factText(product.facts.packageWidth, "package_width") ||
        String(packagingValues.width ?? ""),
      packageHeight:
        factText(product.facts.packageHeight, "package_height") ||
        String(packagingValues.height ?? ""),
      productLength: product.facts.productLength || String(dimensionValues.length ?? ""),
      productWidth: product.facts.productWidth || String(dimensionValues.width ?? ""),
      productHeight: product.facts.productHeight || String(dimensionValues.height ?? ""),
      certifications: listValue("certifications") ?? product.facts.certifications,
      skuRows,
    },
    schemaFields: { ...product.schemaFields, ...fields },
  };
};

type TargetMarket = {
  code: string;
  label: string;
  languageCode: string;
  languageLabel: string;
};

type TargetCountry = {
  code: TCountryCode;
  label: string;
  defaultLanguageCode: TLanguageCode;
};

type TargetLanguage = {
  code: TLanguageCode;
  label: string;
};

const regionNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const languageNames = new Intl.DisplayNames(["zh-CN"], { type: "language" });

const targetCountries: TargetCountry[] = Object.entries(countries)
  .map(([code, country]) => ({
    code: code as TCountryCode,
    label: regionNames.of(code) ?? country.name,
    defaultLanguageCode: country.languages[0] ?? "en",
  }))
  .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));

const targetLanguages: TargetLanguage[] = Object.entries(languages)
  .map(([code, language]) => ({
    code: code as TLanguageCode,
    label: languageNames.of(code) ?? language.name,
  }))
  .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));

const getTargetMarket = (countryCode: string, languageCode: string): TargetMarket | null => {
  const country = targetCountries.find((item) => item.code === countryCode);
  const language = targetLanguages.find((item) => item.code === languageCode);
  if (!country || !language) {
    return null;
  }
  return {
    code: country.code,
    label: country.label,
    languageCode: `${language.code}-${country.code}`,
    languageLabel: language.label,
  };
};

const hasMarketTranslation = (
  product: ProductRecord,
  market: TargetMarket | null,
): product is ProductRecord & { translation: ProductTranslation } =>
  Boolean(
    market &&
      product.translation?.targetMarketCode === market.code &&
      product.translation.targetLanguageCode === market.languageCode,
  );
const demoImageCandidates: ProductImageCandidate[] = [
  {
    slot: "main",
    label: "白底主图",
    image_url: "/products/demo-ai-white-background.webp",
    error: null,
    requires_confirmation: true,
  },
  {
    slot: "scenario",
    label: "使用场景图",
    image_url: "/products/demo-ai-scene.webp",
    error: null,
    requires_confirmation: true,
  },
  {
    slot: "detail",
    label: "材质细节图",
    image_url: "/products/demo-ai-detail.webp",
    error: null,
    requires_confirmation: true,
  },
  {
    slot: "specification",
    label: "规格展示图",
    image_url: "/products/demo-ai-specification.webp",
    error: null,
    requires_confirmation: true,
  },
  {
    slot: "packaging",
    label: "包装展示图",
    image_url: null,
    error: "缺少包装样式与装箱数量，需客户补充后生成",
    requires_confirmation: true,
  },
];

const workflowStepLabels = ["上传商品", "确认并补资料", "草稿与发布"];
const workflowStepGuides = [
  {
    title: "上传商品图片",
    detail: "每组图片对应一个商品，系统会自动识别商品并生成可编辑内容。",
  },
  {
    title: "确认内容并补齐资料",
    detail: "核对 AI 结果，选择 Alibaba 最终类目，只填写系统仍缺少的真实信息。",
  },
  {
    title: "保存草稿并确认发布",
    detail: "先保存 Alibaba 草稿，再翻译和回读；正式发布仍需要单独勾选确认。",
  },
];

const workflowStepIndex = (step: number) => (step === 0 ? 0 : step <= 2 ? 1 : 2);

const advancedFactFields: Array<{
  key: Exclude<
    keyof ProductRecord["facts"],
    "categoryId" | "categoryLabel" | "categoryLabelZh" | "brand" | "certifications" | "skuRows"
  >;
  label: string;
}> = [
  { key: "model", label: "型号" },
  { key: "material", label: "材质" },
  { key: "price", label: "价格" },
  { key: "moq", label: "MOQ" },
  { key: "stock", label: "库存" },
  { key: "productLength", label: "产品长度（cm）" },
  { key: "productWidth", label: "产品宽度（cm）" },
  { key: "productHeight", label: "产品高度（cm）" },
  { key: "netWeight", label: "产品净重（kg）" },
  { key: "packageLength", label: "包装长度（cm）" },
  { key: "packageWidth", label: "包装宽度（cm）" },
  { key: "packageHeight", label: "包装高度（cm）" },
  { key: "grossWeight", label: "包装毛重（kg）" },
  { key: "unitsPerCarton", label: "每箱数量" },
  { key: "leadTime", label: "发货期（天）" },
  { key: "origin", label: "原产地" },
  { key: "hsCode", label: "美国 HS 编码" },
];

// 把后端/AI 供应商返回的错误信息翻译成用户可读的中文提示，区分"未配置/余额不足/模型未注册/结构非法"等。
const describeAiFailure = (message: string | undefined): string => {
  const raw = message ?? "";
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient credits") || lower.includes("insufficient_quota")) {
    return "AI 服务额度不足，请联系管理员。";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "AI 服务响应超时，系统已自动重试一次；你可以稍后单独重试该商品。";
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
  "price",
  "moq",
  "stock",
  "packageLength",
  "packageWidth",
  "packageHeight",
  "grossWeight",
  "leadTime",
  "origin",
  "hsCode",
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
  onResetDemo,
  onOpenSettings,
  notify,
}: WorkbenchPageProps) {
  const [step, setStep] = useState(0);
  const [maxUnlockedStep, setMaxUnlockedStep] = useState(0);
  const [activeProductId, setActiveProductId] = useState(() => products[0]?.id ?? "");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(products.map((product) => product.id)),
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadGroupingMode, setUploadGroupingMode] = useState<
    "single_product" | "separate_products"
  >("single_product");
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [targetMarketCode, setTargetMarketCode] = useState("");
  const [targetLanguageCode, setTargetLanguageCode] = useState("");
  const [translationBusy, setTranslationBusy] = useState(false);
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
  const [featureFlags, setFeatureFlags] = useState<ListingFeatureFlags>(defaultListingFeatureFlags);
  const [listingTemplates, setListingTemplates] = useState<ListingTemplate[]>([]);
  const [listingMetrics, setListingMetrics] = useState<ListingMetrics | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [listingToolsBusy, setListingToolsBusy] = useState(false);
  const photoBankAvailable =
    dataMode === "live" &&
    backendConnected &&
    Boolean(capabilities?.alibaba_credentials_configured);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetProductId = useRef<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const previousActiveProductId = useRef(activeProductId);
  const plannedImageProductsRef = useRef(new Set<string>());

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
      setMaxUnlockedStep(0);
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
    if (dataMode !== "live" || !backendConnected || !activeStore) {
      setFeatureFlags(defaultListingFeatureFlags);
      setListingTemplates([]);
      setListingMetrics(null);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      getListingFeatureFlags(),
      listListingTemplates(),
      getListingMetrics(),
    ]).then(([flagsResult, templatesResult, metricsResult]) => {
      if (cancelled) {
        return;
      }
      if (flagsResult.status === "fulfilled") {
        setFeatureFlags(flagsResult.value);
      }
      if (templatesResult.status === "fulfilled") {
        setListingTemplates(templatesResult.value);
        setTemplateId((current) => current || templatesResult.value[0]?.id || "");
      }
      if (metricsResult.status === "fulfilled") {
        setListingMetrics(metricsResult.value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeStore, backendConnected, dataMode]);

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

  useEffect(() => {
    if (step === 1 && activeProduct?.isDemo && !imageCandidates.length) {
      setImageCandidates(demoImageCandidates);
    }
  }, [activeProduct?.isDemo, imageCandidates.length, step]);

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
    (product) =>
      product.stage === "drafted" ||
      product.stage === "publishing" ||
      product.stage === "published",
  );
  const targetMarket = getTargetMarket(targetMarketCode, targetLanguageCode);
  const translatedProducts = draftedProducts.filter((product) =>
    hasMarketTranslation(product, targetMarket),
  );
  const translationComplete =
    Boolean(targetMarket) &&
    draftedProducts.length > 0 &&
    draftedProducts.every(
      (product) => hasMarketTranslation(product, targetMarket) && product.translation.confirmed,
    );
  const changeTargetCountry = (countryCode: string) => {
    setTargetMarketCode(countryCode);
    const country = targetCountries.find((item) => item.code === countryCode);
    setTargetLanguageCode(country?.defaultLanguageCode ?? "");
  };
  const publishedProducts = products.filter((product) => product.stage === "published");
  const publishTargets = getActionProducts(products, selected).filter(
    (product) =>
      (product.stage === "drafted" ||
        (product.stage === "error" && Boolean(product.draftProductId))) &&
      product.draftReadbackVerified,
  );
  const analysisComplete =
    products.length > 0 &&
    products.every(
      (product) =>
        product.stage === "error" ||
        (product.stage !== "uploaded" &&
          product.stage !== "analyzing" &&
          Boolean(product.title.trim() || product.aiConfirmed)),
    );
  const aiReviewComplete = analysisComplete && products.every((product) => product.aiConfirmed);
  const allProductsReady =
    aiReviewComplete && products.every((product) => getProductErrors(product).length === 0);
  const unlockedSteps = [
    true,
    maxUnlockedStep >= 1 && analysisComplete,
    maxUnlockedStep >= 2 && aiReviewComplete,
    maxUnlockedStep >= 3 && allProductsReady,
    maxUnlockedStep >= 4 && draftedProducts.length > 0,
    maxUnlockedStep >= 5 && translationComplete,
  ];
  const maxAccessibleStep = unlockedSteps.reduce(
    (highest, unlocked, index) => (unlocked ? index : highest),
    0,
  );
  const currentWorkflowStep = workflowStepIndex(step);
  const workflowCompletedSteps = [analysisComplete, allProductsReady, publishedProducts.length > 0];
  const workflowUnlockedSteps = [true, unlockedSteps[1], unlockedSteps[3]];
  const workflowTargets = [
    0,
    step >= 1 && step <= 2 ? step : aiReviewComplete ? 2 : 1,
    step >= 3 ? step : maxAccessibleStep,
  ];

  useEffect(() => {
    if (step > maxAccessibleStep) {
      setStep(maxAccessibleStep);
      setInspectorOpen(false);
    }
  }, [maxAccessibleStep, step]);

  const updateProduct = (nextProduct: ProductRecord) => {
    onProductsChange((currentProducts) =>
      currentProducts.map((product) => {
        if (product.id !== nextProduct.id) {
          return product;
        }
        const contentChanged =
          product.title !== nextProduct.title ||
          product.description !== nextProduct.description ||
          product.keywords.join("\u0000") !== nextProduct.keywords.join("\u0000") ||
          product.sellingPoints.join("\u0000") !== nextProduct.sellingPoints.join("\u0000");
        return contentChanged && nextProduct.translation
          ? {
              ...nextProduct,
              translation: { ...nextProduct.translation, confirmed: false },
            }
          : nextProduct;
      }),
    );
  };

  const replaceProduct = (id: string, updater: (product: ProductRecord) => ProductRecord) => {
    onProductsChange((currentProducts) =>
      currentProducts.map((product) => (product.id === id ? updater(product) : product)),
    );
  };

  const hydrateListingTasks = async (product: ProductRecord): Promise<ProductRecord> => {
    if (!featureFlags.workflow_v2 && featureFlags.legacy_fallback) {
      return { ...product, fieldTasks: undefined, fieldTaskSummary: undefined };
    }
    if (product.isDemo) {
      const tasks = demoConfirmationTasks(product);
      const confirm = tasks.filter((task) => task.status === "confirm").length;
      return {
        ...product,
        aiConfirmed: confirm === 0,
        fieldTasks: tasks,
        fieldTaskSummary: { completed: tasks.length - confirm, confirm, fill: 0, invalid: 0 },
      };
    }
    if (!product.schemaData) {
      const tasks = buildFallbackAiTasks(product);
      const summary = summarizeFieldTasks(tasks);
      return {
        ...product,
        aiConfirmed: summary.confirm === 0,
        fieldTasks: tasks,
        fieldTaskSummary: summary,
      };
    }
    const result = await getListingTasks(product, settings);
    if (featureFlags.metrics) {
      void recordListingMetricEvent({
        event_type: "task_evaluated",
        batch_id: batchId,
        reference: product.reference,
        payload: result.summary,
      });
    }
    const aiConfirmed = result.tasks.every((task) => task.status !== "confirm");
    return {
      ...product,
      aiConfirmed,
      fieldTasks: result.tasks,
      fieldTaskSummary: result.summary,
    };
  };

  useEffect(() => {
    if (!featureFlags.workflow_v2) {
      return;
    }
    const repairableProductIds = new Set(
      products
        .filter(
          (product) =>
            product.stage === "ai_ready" &&
            !product.aiConfirmed &&
            !product.schemaData &&
            (product.fieldTasks?.length ?? 0) === 0 &&
            Boolean(product.title.trim()),
        )
        .map((product) => product.id),
    );
    if (repairableProductIds.size === 0) {
      return;
    }
    onProductsChange((currentProducts) =>
      currentProducts.map((product) => {
        if (!repairableProductIds.has(product.id)) {
          return product;
        }
        const fieldTasks = buildFallbackAiTasks(product);
        const fieldTaskSummary = summarizeFieldTasks(fieldTasks);
        return {
          ...product,
          aiConfirmed: fieldTaskSummary.confirm === 0,
          fieldTasks,
          fieldTaskSummary,
        };
      }),
    );
  }, [featureFlags.workflow_v2, onProductsChange, products]);

  const handleFiles = (files: FileList | File[], targetProductId: string | null = null) => {
    const supportedImages = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const oversizedImages = supportedImages.filter(
      (file) => file.size > ALIBABA_PHOTO_BANK_MAX_BYTES,
    );
    const imageFiles = supportedImages.filter(
      (file) => file.size <= ALIBABA_PHOTO_BANK_MAX_BYTES,
    );
    if (oversizedImages.length) {
      notify(
        "warning",
        `${oversizedImages.length} 张图片超过 5 MB`,
        "Alibaba 图片银行不接受超过 5 MB 的图片，请压缩后重新选择。",
      );
    }
    if (!imageFiles.length) {
      notify("warning", "没有可用图片", "请选择 JPG、PNG 或 WebP 商品图片。");
      return;
    }

    const now = Date.now();
    const createImages = (filesForProduct: File[], productIndex: number) =>
      filesForProduct.map((file, imageIndex) => ({
        id: `uploaded-${now}-${productIndex}-image-${imageIndex}`,
        url: URL.createObjectURL(file),
        name: file.name,
        sourceFile: file,
        fileSize: file.size,
        source: "upload" as const,
      }));
    if (targetProductId) {
      const images = createImages(imageFiles, 0);
      replaceProduct(targetProductId, (product) => ({
        ...product,
        images: [...product.images, ...images],
        aiConfirmed: false,
        analyzedAt: undefined,
        stage: "uploaded",
        fieldTasks: undefined,
        fieldTaskSummary: undefined,
        errors: ["图片已更新，请重新进行 AI 分析"],
      }));
      setActiveProductId(targetProductId);
      setSelected((current) => new Set(current).add(targetProductId));
      notify("success", `已追加 ${images.length} 张图片`, "图片变化后需要重新进行 AI 分析。");
      return;
    }
    const groups =
      uploadGroupingMode === "separate_products" ? imageFiles.map((file) => [file]) : [imageFiles];
    const newProducts = groups.map((filesForProduct, productIndex): ProductRecord => {
      const images = createImages(filesForProduct, productIndex);
      return {
        id: `uploaded-${now}-${productIndex}`,
        reference: `AUTO-${String(now).slice(-6)}-${String(productIndex + 1).padStart(2, "0")}`,
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
    });
    if (dataMode === "live" && backendConnected && featureFlags.metrics) {
      for (const product of newProducts) {
        void recordListingMetricEvent({
          event_type: "upload_started",
          batch_id: batchId,
          reference: product.reference,
          payload: { image_count: product.images.length, grouping_mode: uploadGroupingMode },
        });
      }
    }

    const shouldReplaceDemo = dataMode === "demo";
    if (shouldReplaceDemo) {
      onDataModeChange("live");
    }
    onProductsChange((currentProducts) =>
      shouldReplaceDemo ? newProducts : [...currentProducts, ...newProducts],
    );
    setSelected((current) =>
      shouldReplaceDemo
        ? new Set(newProducts.map((product) => product.id))
        : new Set([...current, ...newProducts.map((product) => product.id)]),
    );
    setActiveProductId(newProducts[0].id);
    setStep(0);
    setMaxUnlockedStep(0);
    setInspectorOpen(false);
    notify(
      "success",
      `已加入 ${newProducts.length} 个商品 · ${imageFiles.length} 张图片`,
      uploadGroupingMode === "single_product"
        ? "本次选择的图片已合并为同一商品，第一张默认为主图。"
        : "本次选择的每张图片已分别建立一个商品。",
    );
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      handleFiles(event.target.files, uploadTargetProductId.current);
      uploadTargetProductId.current = null;
      event.target.value = "";
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    uploadTargetProductId.current = null;
    handleFiles(event.dataTransfer.files);
  };

  const pickProductImages = (productId: string | null = null) => {
    uploadTargetProductId.current = productId;
    fileInputRef.current?.click();
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
              sourceFile = await preparePhotoBankFile(blob, image.name || `photobank-${index}.jpg`);
            }
          } catch {
            sourceFile = undefined;
          }
          return {
            id: `photobank-${now}-${index}`,
            url: image.url,
            name: image.name || `图片银行图片 ${index + 1}`,
            sourceFile,
            fileSize: sourceFile?.size ?? image.fileSize,
            photoBankUrl: image.url,
            photoBankFileId: image.id,
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
      if (dataMode === "live" && featureFlags.metrics) {
        void recordListingMetricEvent({
          event_type: "upload_started",
          batch_id: batchId,
          reference: newProduct.reference,
          payload: { source: "photobank" },
        });
      }
      const shouldReplaceDemo = dataMode === "demo";
      onProductsChange(shouldReplaceDemo ? [newProduct] : [...products, newProduct]);
      setSelected((current) =>
        shouldReplaceDemo ? new Set([newProduct.id]) : new Set([...current, newProduct.id]),
      );
      if (shouldReplaceDemo) {
        onDataModeChange("live");
      }
      setActiveProductId(newProduct.id);
      setStep(0);
      setMaxUnlockedStep(0);
      setInspectorOpen(false);
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
      let analyzed = applyAnalysis(schemaData ? { ...product, schemaData } : product, response);
      if (!schemaData && analyzed.facts.categoryId) {
        try {
          const payload = await getCategorySchema(analyzed.facts.categoryId);
          schemaData = findSchemaData(payload) ?? undefined;
        } catch {
          schemaData = undefined;
        }
      }
      if (schemaData) {
        const schemaGuidance = await getSchemaGuidance(schemaData);
        analyzed = syncProductSchemaFields({ ...analyzed, schemaData, schemaGuidance }, settings);
      }
      analyzed = await hydrateListingTasks(analyzed);
      updateProduct(analyzed);
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
      if (featureFlags.metrics) {
        void recordListingMetricEvent({
          event_type: "analysis_failed",
          batch_id: batchId,
          reference: product.reference,
          reason: message,
        });
        setListingMetrics((current) =>
          current
            ? {
                ...current,
                total_events: current.total_events + 1,
                counters: {
                  ...current.counters,
                  analysis_failed: (current.counters.analysis_failed ?? 0) + 1,
                },
              }
            : current,
        );
      }
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
    const targets = products.filter(
      (product) => product.stage === "uploaded" || product.stage === "error",
    );
    const results: Array<Awaited<ReturnType<typeof analyzeOne>>> = [];
    const concurrency = 3;
    for (let index = 0; index < targets.length; index += concurrency) {
      results.push(
        ...(await Promise.all(targets.slice(index, index + concurrency).map(analyzeOne))),
      );
    }
    setBusy(false);
    const failures = results.filter((result) => !result.success);
    if (!results.length) {
      notify("info", "没有需要分析的商品", "所有商品都已完成 AI 分析。");
      return;
    }
    const successCount = results.length - failures.length;
    if (successCount > 0) {
      setMaxUnlockedStep((current) => Math.max(current, 1));
      setStep(1);
    }
    if (!failures.length) {
      notify("success", "AI 分析已完成", "请确认标题、类目建议和图片可见属性。");
      return;
    }
    notify(
      failures.length === results.length ? "error" : "warning",
      `AI 分析完成：成功 ${successCount}/${results.length}`,
      `${describeAiFailure(failures[0].error)} 成功商品可先确认，失败商品可单独重试。`,
    );
  };

  const openAiImageReview = async () => {
    if (!products.length) {
      notify("warning", "请先上传商品图片", "AI 套图需要至少一张真实商品参考图。");
      return;
    }
    if (!analysisComplete) {
      await analyzeAll();
      return;
    }
    setMaxUnlockedStep((current) => Math.max(current, 1));
    setStep(1);
    if (activeProduct?.isDemo) {
      setImageCandidates(demoImageCandidates);
    }
  };

  const confirmAiField = async (id: string, fieldPath: string) => {
    const product = products.find((item) => item.id === id);
    if (!product) {
      return;
    }
    const task = confirmationTasks(product).find((item) => item.field_path === fieldPath);
    if (!task || task.status !== "confirm") {
      return;
    }
    setBusy(true);
    try {
      const schemaFields = { ...product.schemaFields };
      if (product.isDemo) {
        const candidate = schemaFields[task.field_path];
        if (candidate) {
          schemaFields[task.field_path] = {
            ...candidate,
            value: task.value,
            source: "user_confirmed",
            requires_confirmation: false,
          };
        }
      } else if (!product.schemaData) {
        const next = confirmFallbackTaskLocally(product, task);
        updateProduct(next);
        if (featureFlags.metrics) {
          void recordListingMetricEvent({
            event_type: "field_confirmed",
            batch_id: batchId,
            reference: product.reference,
            payload: { field_path: fieldPath, fallback_without_schema: true },
          });
        }
        notify("success", `已确认：${task.label}`);
        return;
      } else {
        const result = await confirmListingField(
          batchId,
          product,
          fieldPath,
          task.value,
          schemaFields[fieldPath]?.user_edited ? "edited" : "accepted",
        );
        schemaFields[result.field_path] = result.field;
      }
      let next: ProductRecord = { ...product, schemaFields };
      next = await hydrateListingTasks(next);
      const aiConfirmed = (next.fieldTaskSummary?.confirm ?? 0) === 0;
      next = {
        ...next,
        aiConfirmed,
        stage: aiConfirmed ? "facts_needed" : "ai_ready",
        errors: getProductErrors({ ...next, aiConfirmed }),
      };
      updateProduct(next);
      notify("success", `已确认：${task.label}`);
    } catch (error) {
      notify("error", "字段确认失败", error instanceof Error ? error.message : "请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!backendConnected || dataMode !== "live") {
      notify("error", "导入需要连接后端和真实工作区");
      return;
    }
    setListingToolsBusy(true);
    try {
      const result = await importListingProducts(file);
      const now = Date.now();
      const importedProducts = result.rows.map((row, index) => {
        const base: ProductRecord = {
          id: `imported-${now}-${index}`,
          reference: row.reference,
          images: [],
          mainImageId: "",
          title: "",
          keywords: [],
          sellingPoints: [],
          description: "",
          visibleTraits: [],
          aiConfirmed: true,
          stage: "facts_needed",
          facts: createEmptyFacts(settings),
          schemaFields: row.fields,
          errors: row.warnings,
        };
        const merged = mergeListingFields(base, row.fields);
        return { ...merged, errors: [...row.warnings, ...getFactErrors(merged)] };
      });
      if (featureFlags.metrics) {
        for (const product of importedProducts) {
          void recordListingMetricEvent({
            event_type: "upload_started",
            batch_id: batchId,
            reference: product.reference,
            payload: { source: result.format },
          });
        }
      }
      if (!importedProducts.length) {
        notify("warning", "没有可导入的商品", result.errors.join("；") || "请检查商品编码列。");
        return;
      }
      onProductsChange([...products, ...importedProducts]);
      setSelected(new Set(importedProducts.map((product) => product.id)));
      setActiveProductId(importedProducts[0].id);
      setMaxUnlockedStep((current) => Math.max(current, 2));
      setStep(2);
      notify(
        result.errors.length ? "warning" : "success",
        `已导入 ${importedProducts.length} 个商品`,
        result.errors.length
          ? result.errors.join("；")
          : "业务数据已标记为 ERP/表格来源，请核对缺失项。",
      );
    } catch (error) {
      notify("error", "商品导入失败", error instanceof Error ? error.message : undefined);
    } finally {
      setListingToolsBusy(false);
    }
  };

  const saveActiveTemplate = async () => {
    if (!activeProduct || !templateName.trim()) {
      notify("warning", "请输入模板名称并选择一个商品");
      return;
    }
    setListingToolsBusy(true);
    try {
      const template = await createListingTemplate(templateName.trim(), activeProduct);
      setListingTemplates((current) => [template, ...current]);
      setTemplateId(template.id);
      setTemplateName("");
      notify("success", "类目模板已保存", "模板值仍会在应用时经过实时 Schema 校验。");
    } catch (error) {
      notify("error", "模板保存失败", error instanceof Error ? error.message : undefined);
    } finally {
      setListingToolsBusy(false);
    }
  };

  const applySelectedTemplate = async () => {
    const targets = products.filter((product) => selected.has(product.id));
    if (!templateId || !targets.length) {
      notify("warning", "请选择模板和需要应用的商品");
      return;
    }
    setListingToolsBusy(true);
    try {
      const updates = new Map<string, ProductRecord>();
      for (const product of targets) {
        const result = await applyListingTemplate(templateId, product, settings);
        const merged = mergeListingFields(product, result.fields);
        updates.set(product.id, {
          ...merged,
          fieldTasks: result.tasks.tasks,
          fieldTaskSummary: result.tasks.summary,
          errors: getProductErrors(merged),
        });
      }
      onProductsChange(products.map((product) => updates.get(product.id) ?? product));
      notify(
        "success",
        `模板已应用到 ${updates.size} 个商品`,
        "已有值不会被覆盖，请继续处理校验结果。",
      );
    } catch (error) {
      notify("error", "模板应用失败", error instanceof Error ? error.message : undefined);
    } finally {
      setListingToolsBusy(false);
    }
  };

  const removeSelectedTemplate = async () => {
    if (!templateId) {
      return;
    }
    setListingToolsBusy(true);
    try {
      await deleteListingTemplate(templateId);
      const next = listingTemplates.filter((template) => template.id !== templateId);
      setListingTemplates(next);
      setTemplateId(next[0]?.id ?? "");
      notify("success", "模板已删除");
    } catch (error) {
      notify("error", "模板删除失败", error instanceof Error ? error.message : undefined);
    } finally {
      setListingToolsBusy(false);
    }
  };

  const toggleWorkflowMode = async () => {
    setListingToolsBusy(true);
    try {
      const next = await updateListingFeatureFlags({ workflow_v2: !featureFlags.workflow_v2 });
      setFeatureFlags(next);
      notify(
        "success",
        next.workflow_v2 ? "已启用新版字段任务流程" : "已切换到兼容流程",
        "切换不会删除商品、模板或审计数据。",
      );
    } catch (error) {
      notify("error", "流程切换失败", error instanceof Error ? error.message : undefined);
    } finally {
      setListingToolsBusy(false);
    }
  };

  const refreshImagePlan = useCallback(async (): Promise<ImageSlotPlan[]> => {
    if (!activeProduct || activeProduct.isDemo) {
      return [];
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
      return response.slots;
    } catch (error) {
      notify("error", "无法检查缺失图种", error instanceof Error ? error.message : "请稍后重试。");
      return [];
    } finally {
      setImagePlanBusy(false);
    }
  }, [activeProduct, addedImageSlots, notify, providedImageInputs]);

  useEffect(() => {
    if (
      step !== 2 ||
      !activeProduct ||
      activeProduct.isDemo ||
      plannedImageProductsRef.current.has(activeProduct.id)
    ) {
      return;
    }
    plannedImageProductsRef.current.add(activeProduct.id);
    void refreshImagePlan();
  }, [activeProduct, refreshImagePlan, step]);

  const updateImageInput = (key: string, value: string) => {
    setProvidedImageInputs((current) => ({ ...current, [key]: value }));
  };

  const generateImagesForProduct = async (slots?: ImageSlot[]) => {
    if (!activeProduct) {
      return;
    }
    if (activeProduct.isDemo) {
      setImageGenerationBusy(true);
      await delay(550);
      setImageCandidates(
        slots?.length
          ? demoImageCandidates.filter((candidate) => slots.includes(candidate.slot))
          : demoImageCandidates,
      );
      setImageGenerationBusy(false);
      notify("success", "演示候选图已生成", "候选图完全隔离，不调用真实图片服务或 Alibaba 店铺。");
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
    const availablePlan = !slots && !imagePlan.length ? await refreshImagePlan() : imagePlan;
    const requestedSlots =
      slots ?? availablePlan.filter((slot) => slot.can_generate).map((slot) => slot.slot);
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

  const prepareGeneratedCandidate = async (
    candidate: ProductImageCandidate,
    index = 0,
  ): Promise<ProductImage> => {
    if (!candidate.image_url) {
      throw new Error("生成结果没有可用图片");
    }
    const response = await fetch(candidate.image_url);
    if (!response.ok) {
      throw new Error(`生成图片读取失败（HTTP ${response.status}）`);
    }
    const sourceFile = await preparePhotoBankFile(
      await response.blob(),
      `ai-${candidate.slot}-${Date.now()}-${index}.png`,
    );
    return {
      id: `generated-${candidate.slot}-${Date.now()}-${index}`,
      url: URL.createObjectURL(sourceFile),
      name: `${candidate.label}候选图`,
      sourceFile,
      fileSize: sourceFile.size,
      source: "generated",
    };
  };

  const addGeneratedImage = async (candidate: ProductImageCandidate) => {
    if (!activeProduct || !candidate.image_url) {
      return;
    }
    if (
      addedImageSlots.includes(candidate.slot) ||
      activeProduct.images.some((image) => image.url === candidate.image_url)
    ) {
      notify("info", "图片已在图库中", "无需重复添加。");
      return;
    }
    setImageGenerationBusy(true);
    let generatedImage: ProductImage;
    try {
      generatedImage = await prepareGeneratedCandidate(candidate);
    } catch (error) {
      notify(
        "error",
        "生成图暂时无法加入商品",
        error instanceof Error ? error.message : "请重新生成后再试。",
      );
      setImageGenerationBusy(false);
      return;
    }
    updateProduct({ ...activeProduct, images: [...activeProduct.images, generatedImage] });
    setAddedImageSlots((current) =>
      current.includes(candidate.slot) ? current : [...current, candidate.slot],
    );
    setImagePlan((current) => current.filter((slot) => slot.slot !== candidate.slot));
    notify("success", "已加入商品图库", `${candidate.label}可继续确认或设为主图。`);
    setImageGenerationBusy(false);
  };

  const addGeneratedImages = async (candidates: ProductImageCandidate[]) => {
    if (!activeProduct) {
      return;
    }
    const available = candidates.filter(
      (candidate) =>
        candidate.image_url &&
        !addedImageSlots.includes(candidate.slot) &&
        !activeProduct.images.some((image) => image.url === candidate.image_url),
    );
    if (!available.length) {
      notify("info", "候选图已全部加入", "无需重复添加。");
      return;
    }
    setImageGenerationBusy(true);
    const prepared = await Promise.allSettled(
      available.map((candidate, index) => prepareGeneratedCandidate(candidate, index)),
    );
    const generatedImages = prepared.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (!generatedImages.length) {
      notify("error", "生成图暂时无法加入商品", "图片读取失败，请重新生成后再试。");
      setImageGenerationBusy(false);
      return;
    }
    updateProduct({
      ...activeProduct,
      images: [...activeProduct.images, ...generatedImages],
    });
    setAddedImageSlots((current) => [
      ...new Set([...current, ...available.map((candidate) => candidate.slot)]),
    ]);
    setImagePlan((current) =>
      current.filter((slot) => !available.some((candidate) => candidate.slot === slot.slot)),
    );
    const failedCount = prepared.length - generatedImages.length;
    notify(
      failedCount ? "warning" : "success",
      `已加入 ${generatedImages.length} 张候选图`,
      failedCount
        ? `${failedCount} 张图片读取失败，可单独重新生成；其余图片仍需检查产品一致性。`
        : "仍需逐张检查产品一致性后发布。",
    );
    setImageGenerationBusy(false);
  };

  const validateAll = (sourceProducts = products) => {
    const nextProducts = sourceProducts.map((product) => {
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

  const createDrafts = async (targetSelection = selected) => {
    const targets = getActionProducts(products, targetSelection).filter(
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
        setMaxUnlockedStep(4);
        setStep(4);
        return;
      }

      const prepared = await Promise.all(
        targets.map(async (product) => {
          const images = await Promise.all(
            product.images.map(async (image) => {
              if (image.photoBankUrl) {
                return image;
              }
              if (!image.sourceFile) {
                throw new Error(
                  `${product.reference} 的 ${image.name} 尚未准备为可上传图片，请删除后重新添加。`,
                );
              }
              const upload = await uploadPhotoBankImage(
                image.sourceFile,
                settings.photoBankGroupId,
              );
              const photoBankUrl = findPhotoBankUrl(upload);
              const photoBankFileId = findPhotoBankFileId(upload);
              if (!photoBankUrl) {
                throw new Error(`${product.reference} 的 ${image.name} 未返回图片银行地址`);
              }
              if (!photoBankFileId) {
                throw new Error(`${product.reference} 的 ${image.name} 未返回图片银行文件 ID`);
              }
              return { ...image, photoBankUrl, photoBankFileId };
            }),
          );
          if (product.schemaData) {
            return syncProductSchemaFields({ ...product, images }, settings);
          }
          const payload = await getCategorySchema(product.facts.categoryId);
          const schemaData = findSchemaData(payload);
          if (!schemaData) {
            throw new Error(`${product.reference} 未获取到平台类目规则`);
          }
          const schemaGuidance = await getSchemaGuidance(schemaData);
          return syncProductSchemaFields(
            { ...product, images, schemaData, schemaGuidance },
            settings,
          );
        }),
      );
      const results = await createDraftBatch(batchId, prepared, settings);
      const preparedByReference = new Map(prepared.map((product) => [product.reference, product]));
      const resultByReference = new Map(results.map((result) => [result.reference, result]));
      const videoRelations = await Promise.all(
        results.map(async (result) => {
          const preparedProduct = preparedByReference.get(result.reference);
          const selectedVideos = preparedProduct
            ? ([
                ["main", preparedProduct.mainVideo],
                ["detail", preparedProduct.detailVideo],
              ] as const).filter((entry): entry is readonly ["main" | "detail", AlibabaVideo] =>
                Boolean(entry[1]),
              )
            : [];
          if (!result.success || !preparedProduct || !selectedVideos.length) {
            return { reference: result.reference, errors: [] as string[] };
          }
          const productId = getProductId(result.response);
          if (!productId) {
            return {
              reference: result.reference,
              errors: ["草稿已创建，但返回结果没有商品 ID，无法关联已选择的视频。"],
            };
          }
          const errors: string[] = [];
          for (const [placement, video] of selectedVideos) {
            try {
              await relateAlibabaVideo(video.id, productId, placement);
            } catch (error) {
              errors.push(
                `${placement === "main" ? "主图视频" : "详情视频"}“${video.title}”关联失败：${
                  error instanceof Error ? error.message : "Alibaba 视频接口返回失败"
                }`,
              );
            }
          }
          return { reference: result.reference, errors };
        }),
      );
      const videoRelationByReference = new Map(
        videoRelations.map((result) => [result.reference, result.errors]),
      );
      onProductsChange(
        products.map((product) => {
          const result = resultByReference.get(product.reference);
          const preparedProduct = preparedByReference.get(product.reference);
          if (!result || !preparedProduct) {
            return product;
          }
          const videoRelationErrors = videoRelationByReference.get(product.reference) ?? [];
          const readbackError = result.success ? getReadbackError(result.response) : undefined;
          const readbackDifferences = result.success
            ? getReadbackDifferences(result.response)
            : undefined;
          const readbackHasChanges = readbackDifferences?.some(
            (difference) => difference.status === "changed",
          );
          return {
            ...preparedProduct,
            stage: result.success ? "drafted" : "error",
            errors: result.success ? [] : [result.error ?? "草稿创建失败"],
            draftProductId: result.success ? getProductId(result.response) : undefined,
            draftReadback: result.success ? getReadback(result.response) : undefined,
            draftDifferences: readbackDifferences,
            draftReadbackError: readbackError,
            videoRelationErrors: videoRelationErrors.length ? videoRelationErrors : undefined,
            videoRelationsVerified: result.success && videoRelationErrors.length === 0,
            draftReadbackVerified:
              result.success &&
              Boolean(getReadback(result.response)) &&
              !readbackError &&
              !readbackHasChanges &&
              videoRelationErrors.length === 0,
          };
        }),
      );
      const succeeded = results.filter((result) => result.success).length;
      notify(
        succeeded === results.length && videoRelations.every((item) => !item.errors.length)
          ? "success"
          : "warning",
        `草稿创建完成: ${succeeded}/${results.length}`,
        videoRelations.some((item) => item.errors.length)
          ? "草稿已创建，但部分视频关联失败；请在草稿列表查看具体原因，修复前不会允许正式发布。"
          : "失败商品已隔离，不影响其他商品。",
      );
      const firstSucceeded = results.find((result) => result.success);
      if (firstSucceeded) {
        const product = products.find((item) => item.reference === firstSucceeded.reference);
        if (product) {
          setActiveProductId(product.id);
        }
        setMaxUnlockedStep(4);
        setStep(4);
      }
    } catch (error) {
      markProducts(targets, "error", error instanceof Error ? error.message : "草稿创建失败");
      notify("error", "草稿创建失败", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const retryVideoRelations = async (productId: string) => {
    const product = products.find((item) => item.id === productId);
    if (!product?.draftProductId) {
      notify("error", "无法重试视频关联", "当前商品没有可用的 Alibaba 草稿商品 ID。");
      return;
    }
    const selectedVideos = ([
      ["main", product.mainVideo],
      ["detail", product.detailVideo],
    ] as const).filter((entry): entry is readonly ["main" | "detail", AlibabaVideo] =>
      Boolean(entry[1]),
    );
    if (!selectedVideos.length) {
      notify("warning", "没有待关联的视频", "请返回资料页，在创建草稿前选择商品视频。");
      return;
    }
    setBusy(true);
    const errors: string[] = [];
    for (const [placement, video] of selectedVideos) {
      try {
        await relateAlibabaVideo(video.id, product.draftProductId, placement);
      } catch (error) {
        errors.push(
          `${placement === "main" ? "主图视频" : "详情视频"}“${video.title}”关联失败：${
            error instanceof Error ? error.message : "Alibaba 视频接口返回失败"
          }`,
        );
      }
    }
    onProductsChange((current) =>
      current.map((item) =>
        item.id === product.id
          ? {
              ...item,
              videoRelationErrors: errors.length ? errors : undefined,
              videoRelationsVerified: errors.length === 0,
              draftReadbackVerified:
                errors.length === 0 &&
                Boolean(item.draftReadback) &&
                !item.draftReadbackError &&
                !item.draftDifferences?.some((difference) => difference.status === "changed"),
            }
          : item,
      ),
    );
    notify(
      errors.length ? "error" : "success",
      errors.length ? "视频关联仍未完成" : "商品视频已成功关联",
      errors[0],
    );
    setBusy(false);
  };

  const translateDrafts = async () => {
    if (!targetMarket) {
      notify("warning", "请先选择目标国家", "系统会自动匹配该市场的主要语言。");
      return;
    }
    if (!draftedProducts.length) {
      notify("warning", "没有可翻译的草稿");
      return;
    }
    if (
      !targetMarket.languageCode.startsWith("en-") &&
      (!backendConnected || !capabilities?.model_credentials_configured)
    ) {
      notify(
        "error",
        !backendConnected ? "翻译服务暂不可用" : "AI 翻译服务尚未配置",
        "可以选择英语保留原文，或联系管理员配置现有 AI Provider。",
      );
      return;
    }

    setTranslationBusy(true);
    const results = await Promise.all(
      draftedProducts.map(async (product) => {
        try {
          const response = targetMarket.languageCode.startsWith("en-")
            ? {
                title: product.title,
                keywords: product.keywords,
                selling_points: product.sellingPoints,
                description: product.description,
              }
            : await translateProductContent(
                product,
                targetMarket.languageCode,
                targetMarket.languageLabel,
              );
          const translation: ProductTranslation = {
            targetMarketCode: targetMarket.code,
            targetMarketLabel: targetMarket.label,
            targetLanguageCode: targetMarket.languageCode,
            targetLanguageLabel: targetMarket.languageLabel,
            title: response.title,
            keywords: response.keywords,
            sellingPoints: response.selling_points,
            description: response.description,
            confirmed: false,
            translatedAt: new Date().toISOString(),
          };
          return { productId: product.id, translation, error: null };
        } catch (error) {
          return {
            productId: product.id,
            translation: null,
            error: error instanceof Error ? error.message : "翻译失败",
          };
        }
      }),
    );
    const translations = new Map(
      results
        .filter(
          (
            result,
          ): result is {
            productId: string;
            translation: ProductTranslation;
            error: null;
          } => result.translation !== null,
        )
        .map((result) => [result.productId, result.translation]),
    );
    onProductsChange(
      products.map((product) => {
        const translation = translations.get(product.id);
        return translation ? { ...product, translation } : product;
      }),
    );
    const failures = results.filter((result) => result.error);
    notify(
      failures.length ? "warning" : "success",
      failures.length
        ? `翻译完成 ${translations.size}/${results.length}`
        : `已生成 ${translations.size} 个${targetMarket.languageLabel}版本`,
      failures.length
        ? failures
            .slice(0, 2)
            .map((result) => result.error)
            .join("；")
        : "请逐项核对，确认后才会用于正式发布。",
    );
    setTranslationBusy(false);
  };

  const changeTranslation = (
    productId: string,
    patch: Partial<
      Pick<ProductTranslation, "title" | "keywords" | "sellingPoints" | "description">
    >,
  ) => {
    onProductsChange(
      products.map((product) =>
        product.id === productId && product.translation
          ? {
              ...product,
              translation: {
                ...product.translation,
                ...patch,
                confirmed: false,
              },
            }
          : product,
      ),
    );
  };

  const acceptReadbackChanges = (productId: string) => {
    onProductsChange((current) =>
      current.map((product) =>
        product.id === productId &&
        product.draftReadback &&
        !product.draftReadbackError &&
        !product.videoRelationErrors?.length
          ? { ...product, draftReadbackVerified: true }
          : product,
      ),
    );
    notify("success", "已确认平台保存结果", "该草稿现在可以进入最终发布确认。 ");
  };

  const confirmTranslation = (productId: string) => {
    onProductsChange(
      products.map((product) =>
        product.id === productId && product.translation
          ? {
              ...product,
              translation: { ...product.translation, confirmed: true },
            }
          : product,
      ),
    );
  };

  const confirmAllTranslations = () => {
    if (!targetMarket || translatedProducts.length !== draftedProducts.length) {
      notify("warning", "请先完成全部翻译");
      return;
    }
    onProductsChange(
      products.map((product) =>
        product.translation?.targetMarketCode === targetMarket.code &&
        product.translation.targetLanguageCode === targetMarket.languageCode
          ? {
              ...product,
              translation: { ...product.translation, confirmed: true },
            }
          : product,
      ),
    );
    setMaxUnlockedStep((current) => Math.max(current, 5));
  };

  const continueToPublish = () => {
    if (!translationComplete) {
      notify("warning", "翻译尚未全部确认", "所有草稿的目标语言文案确认后才能发布。");
      return;
    }
    setMaxUnlockedStep((current) => Math.max(current, 5));
    setStep(5);
  };

  const confirmPublish = async () => {
    const targets = getActionProducts(products, selected).filter(
      (product) =>
        product.stage === "drafted" ||
        (product.stage === "error" && Boolean(product.draftProductId)),
    );
    if (!publishConfirmed || !targets.length || !translationComplete) {
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
            draftProductId:
              (result.success ? getProductId(result.response) : undefined) ??
              product.draftProductId,
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
    if (!selected.size) {
      notify("warning", "请先勾选要批量填写的商品", "系统不会默认修改全部商品。");
      return;
    }
    const targetIds = new Set(
      products.filter((product) => selected.has(product.id)).map((product) => product.id),
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
    onProductsChange((currentProducts) => currentProducts.filter((item) => item.id !== id));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const setMainImage = (productId: string, imageId: string) => {
    replaceProduct(productId, (product) => ({
      ...product,
      mainImageId: imageId,
    }));
  };

  const moveProductImage = (productId: string, imageId: string, direction: -1 | 1) => {
    replaceProduct(productId, (product) => {
      const index = product.images.findIndex((image) => image.id === imageId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= product.images.length) {
        return product;
      }
      const images = [...product.images];
      [images[index], images[target]] = [images[target], images[index]];
      return { ...product, images };
    });
  };

  const splitProductImages = (productId: string) => {
    const product = products.find((item) => item.id === productId);
    if (!product || product.images.length < 2) {
      return;
    }
    const splitProducts = product.images.map(
      (image, index): ProductRecord => ({
        ...product,
        id: `${product.id}-split-${index}`,
        reference: `${product.reference.replace(/-\d+$/, "")}-${String(index + 1).padStart(2, "0")}`,
        images: [image],
        mainImageId: image.id,
        title: "",
        keywords: [],
        sellingPoints: [],
        description: "",
        visibleTraits: [],
        aiConfirmed: false,
        analyzedAt: undefined,
        stage: "uploaded",
        facts: createEmptyFacts(settings),
        schemaData: undefined,
        schemaGuidance: undefined,
        schemaFields: undefined,
        fieldTasks: undefined,
        fieldTaskSummary: undefined,
        errors: ["等待 AI 分析"],
      }),
    );
    onProductsChange((currentProducts) =>
      currentProducts.flatMap((item) => (item.id === productId ? splitProducts : [item])),
    );
    setSelected(new Set(splitProducts.map((item) => item.id)));
    setActiveProductId(splitProducts[0].id);
    notify("success", `已拆分为 ${splitProducts.length} 个商品`, "每张图片现在对应一个商品。");
  };

  const mergeSelectedProducts = () => {
    const selectedIds = new Set(selected);
    const targets = products.filter((product) => selectedIds.has(product.id));
    if (targets.length < 2) {
      notify("warning", "请至少选择两个商品", "选中的商品图片将合并为同一个商品。");
      return;
    }
    const base = targets[0];
    const merged: ProductRecord = {
      ...base,
      images: targets.flatMap((product) => product.images),
      mainImageId: base.mainImageId,
      title: "",
      keywords: [],
      sellingPoints: [],
      description: "",
      visibleTraits: [],
      aiConfirmed: false,
      analyzedAt: undefined,
      stage: "uploaded",
      facts: createEmptyFacts(settings),
      schemaData: undefined,
      schemaGuidance: undefined,
      schemaFields: undefined,
      fieldTasks: undefined,
      fieldTaskSummary: undefined,
      errors: ["图片已合并，请重新进行 AI 分析"],
    };
    onProductsChange((currentProducts) =>
      currentProducts.flatMap((product) => {
        if (product.id === base.id) {
          return [merged];
        }
        return selectedIds.has(product.id) ? [] : [product];
      }),
    );
    setSelected(new Set([base.id]));
    setActiveProductId(base.id);
    notify(
      "success",
      `已合并 ${targets.length} 个商品`,
      `合并后共有 ${merged.images.length} 张图片。`,
    );
  };

  const loadCategoryRules = async (): Promise<ProductRecord[] | null> => {
    if (dataMode === "demo") {
      return products;
    }
    if (products.some((product) => !product.facts.categoryId.trim())) {
      notify("warning", "类目尚未确认", "需要先确认每个商品的最终叶子类目。");
      return null;
    }
    setBusy(true);
    let failedCount = 0;
    const nextProducts = await Promise.all(
      products.map(async (product) => {
        try {
          let schemaData = product.schemaData;
          if (!schemaData) {
            const payload = await getCategorySchema(product.facts.categoryId);
            schemaData = findSchemaData(payload) ?? undefined;
          }
          if (!schemaData) {
            throw new Error("Alibaba 未返回类目 Schema");
          }
          const schemaGuidance = await getSchemaGuidance(schemaData);
          return syncProductSchemaFields({ ...product, schemaData, schemaGuidance }, settings);
        } catch {
          failedCount += 1;
          return product;
        }
      }),
    );
    onProductsChange(nextProducts);
    setBusy(false);
    if (failedCount) {
      notify(
        "warning",
        "无法读取实时类目规则",
        `${failedCount} 个商品未取得 Alibaba 必填字段，请稍后重试。`,
      );
      return null;
    }
    return nextProducts;
  };

  const goNext = async () => {
    if (step === 0) {
      void analyzeAll();
      return;
    }
    if (step === 1) {
      if (aiPending > 0) {
        notify("warning", "还有 AI 内容未确认", "确认后才能进入可信资料填写。");
        return;
      }
      setMaxUnlockedStep((current) => Math.max(current, 2));
      setStep(2);
      return;
    }
    if (step === 2) {
      const productsWithRules = await loadCategoryRules();
      if (!productsWithRules) {
        return;
      }
      if (productsWithRules.some((product) => getProductErrors(product).length > 0)) {
        notify("warning", "仍有商品资料尚未完整", "全部商品补齐 API 必填事实后才能创建草稿。");
        return;
      }
      validateAll(productsWithRules);
      setMaxUnlockedStep((current) => Math.max(current, 3));
      setStep(3);
      return;
    }
    if (step === 3) {
      void createDrafts();
      return;
    }
    if (step === 4) {
      continueToPublish();
      return;
    }
    if (step === 5) {
      setPublishDialogOpen(true);
    }
  };

  const confirmedCount = products.filter((product) => product.aiConfirmed).length;
  const failedCount = products.filter((product) => product.stage === "error").length;
  const missingCount = products.filter(
    (product) =>
      product.aiConfirmed && product.stage !== "error" && getFactErrors(product).length > 0,
  ).length;
  const draftReadyCount = products.filter(
    (product) =>
      product.aiConfirmed && product.stage !== "error" && getFactErrors(product).length === 0,
  ).length;
  const workflowStepCaptions = [
    analysisComplete ? `AI 已识别 ${products.length}` : `已上传 ${products.length}`,
    allProductsReady
      ? "资料已完成"
      : aiReviewComplete
        ? `还需补 ${missingCount} 项`
        : `待确认 ${products.length - confirmedCount} 项`,
    publishedProducts.length
      ? `已发布 ${publishedProducts.length}`
      : translationComplete
        ? "待正式确认"
        : draftedProducts.length
          ? `草稿 ${draftedProducts.length} 个`
          : `可建草稿 ${draftReadyCount}`,
  ];
  return (
    <div
      className={`wb-page ${step === 2 && activeProduct && inspectorOpen ? "has-inspector" : ""}`}
    >
      <header className="wb-topbar">
        <div className="wb-topbar-meta">
          <span>
            当前店铺：
            <strong>
              {activeStore?.login_id ?? activeStore?.account ?? activeStore?.id ?? "未连接店铺"}
            </strong>
          </span>
          <span>
            批次 ID：<strong>{batchId}</strong>
          </span>
          {dataMode === "demo" ? (
            <span className="wb-demo-badge">隔离演示 · 不写入真实店铺</span>
          ) : null}
        </div>
        <div className="wb-topbar-tools">
          {dataMode === "demo" ? (
            <button
              type="button"
              className="wb-demo-reset"
              onClick={() => {
                onResetDemo();
                setStep(0);
                setMaxUnlockedStep(0);
                setSelected(new Set(products.map((product) => product.id)));
                setInspectorOpen(false);
                setPublishDialogOpen(false);
                setTargetMarketCode("");
                setTargetLanguageCode("");
              }}
            >
              <ArrowCounterClockwise size={16} />
              重置演示
            </button>
          ) : null}
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
            {workflowStepLabels.map((label, index) => (
              <button
                key={label}
                type="button"
                className={`wb-step ${currentWorkflowStep === index ? "is-active" : ""} ${
                  workflowCompletedSteps[index] ? "is-complete" : ""
                }`}
                onClick={() => {
                  setStep(workflowTargets[index]);
                  if (index !== 1 || workflowTargets[index] !== 2) {
                    setInspectorOpen(false);
                  }
                }}
                disabled={!workflowUnlockedSteps[index]}
                title={!workflowUnlockedSteps[index] ? "请先完成上一步" : undefined}
              >
                <span className="wb-step-number">
                  {workflowCompletedSteps[index] && index < currentWorkflowStep ? (
                    <Check size={13} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="wb-step-copy">
                  <strong>{label}</strong>
                  <small>
                    {workflowUnlockedSteps[index] ? workflowStepCaptions[index] : "先完成上一步"}
                  </small>
                </span>
                {!workflowUnlockedSteps[index] ? (
                  <LockSimple className="wb-step-lock" size={13} />
                ) : null}
              </button>
            ))}
          </nav>
          <div className="wb-step-guide">
            <span>第 {currentWorkflowStep + 1} 步</span>
            <div>
              <strong>{workflowStepGuides[currentWorkflowStep].title}</strong>
              <p>{workflowStepGuides[currentWorkflowStep].detail}</p>
            </div>
          </div>
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
          {dataMode === "live" && backendConnected && (step === 0 || step === 2) ? (
            <ListingOperationsPanel
              flags={featureFlags}
              templates={listingTemplates}
              metrics={listingMetrics}
              templateName={templateName}
              templateId={templateId}
              selectedCount={selected.size}
              hasActiveProduct={Boolean(activeProduct)}
              busy={listingToolsBusy}
              onTemplateNameChange={setTemplateName}
              onTemplateIdChange={setTemplateId}
              onImport={() => importInputRef.current?.click()}
              onSaveTemplate={() => void saveActiveTemplate()}
              onApplyTemplate={() => void applySelectedTemplate()}
              onDeleteTemplate={() => void removeSelectedTemplate()}
              onToggleWorkflow={() => void toggleWorkflowMode()}
            />
          ) : null}
          {step === 0 ? (
            <UploadStep
              products={products}
              selected={selected}
              dragActive={dragActive}
              busy={busy}
              photoBankAvailable={photoBankAvailable}
              photoBankLoading={photoBankLoading}
              photoBankError={photoBankError}
              photoGroups={photoGroups}
              photoGroupId={photoGroupId}
              photoImages={photoImages}
              photoSelection={photoSelection}
              uploadGroupingMode={uploadGroupingMode}
              onPhotoGroupChange={setPhotoGroupId}
              onTogglePhoto={togglePhotoSelection}
              onCreateFromPhotoBank={() => void createProductFromPhotoBank()}
              onDragActive={setDragActive}
              onDrop={onDrop}
              onGroupingModeChange={setUploadGroupingMode}
              onPickFiles={() => pickProductImages()}
              onAddImages={(productId) => pickProductImages(productId)}
              onToggleSelected={toggleSelected}
              onToggleAll={toggleAll}
              onMergeSelected={mergeSelectedProducts}
              onSplitProduct={splitProductImages}
              onMoveImage={moveProductImage}
              onRemove={removeProduct}
              onMainImageChange={setMainImage}
              onOpenAiImages={() => void openAiImageReview()}
            />
          ) : null}

          {step === 1 ? (
            <AiStep
              products={products}
              busy={busy}
              activeProductId={activeProduct?.id ?? ""}
              onActiveChange={setActiveProductId}
              onAnalyze={analyzeOne}
              onConfirmField={(id, fieldPath) => void confirmAiField(id, fieldPath)}
              onChange={updateProduct}
              onMainImageChange={setMainImage}
              imageCandidates={imageCandidates}
              imageGenerationBusy={imageGenerationBusy}
              onGenerateImages={() => void generateImagesForProduct()}
              onAddGeneratedImage={addGeneratedImage}
              onAddGeneratedImages={() => addGeneratedImages(imageCandidates)}
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
              onEditAi={() => {
                setStep(1);
                setInspectorOpen(false);
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
              onToggleSelected={toggleSelected}
              onOpenProduct={(id) => {
                setActiveProductId(id);
                setInspectorOpen(true);
                setStep(2);
              }}
              onCreateDrafts={() => void createDrafts()}
              onBack={() => setStep(2)}
            />
          ) : null}

          {step === 4 ? (
            <TranslationStep
              products={draftedProducts}
              targetCountries={targetCountries}
              targetLanguages={targetLanguages}
              targetMarketCode={targetMarketCode}
              targetLanguageCode={targetLanguageCode}
              busy={translationBusy}
              onTargetMarketChange={changeTargetCountry}
              onTargetLanguageChange={setTargetLanguageCode}
              onTranslate={() => void translateDrafts()}
              onChange={changeTranslation}
              onConfirm={confirmTranslation}
              onConfirmAll={confirmAllTranslations}
              onContinue={continueToPublish}
            />
          ) : null}

          {step === 5 ? (
            <PreviewStep
              products={products}
              selected={selected}
              publishCount={publishTargets.length}
              storeName={activeStore?.login_id ?? activeStore?.account ?? ""}
              unit={settings.priceUnit}
              currency={settings.currency}
              targetLanguage={targetMarket?.languageLabel ?? ""}
              onSelect={toggleSelected}
              onPublish={() => setPublishDialogOpen(true)}
              onPublishOne={(id) => {
                setSelected(new Set([id]));
                setPublishDialogOpen(true);
              }}
              onRetry={(id) => {
                setSelected(new Set([id]));
                const product = products.find((item) => item.id === id);
                if (product?.draftProductId) {
                  setPublishDialogOpen(true);
                } else {
                  void createDrafts(new Set([id]));
                }
              }}
              onRetryVideo={(id) => void retryVideoRelations(id)}
              onAcceptReadback={acceptReadbackChanges}
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
            key={activeProduct.id}
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
          {step < 3 ? (
            <button
              type="button"
              className="wb-button-primary"
              onClick={goNext}
              disabled={
                busy ||
                !products.length ||
                (step === 1 && aiPending > 0) ||
                (step === 2 && !allProductsReady)
              }
            >
              {busy ? <CircleNotch size={17} className="spin" /> : null}
              {actionLabel(step, aiPending)}
            </button>
          ) : null}
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
      <input
        ref={importInputRef}
        className="sr-only"
        type="file"
        accept=".csv,.xlsx,.json,text/csv,application/json"
        onChange={(event) => void onImportFile(event)}
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

function ListingOperationsPanel({
  flags,
  templates,
  metrics,
  templateName,
  templateId,
  selectedCount,
  hasActiveProduct,
  busy,
  onTemplateNameChange,
  onTemplateIdChange,
  onImport,
  onSaveTemplate,
  onApplyTemplate,
  onDeleteTemplate,
  onToggleWorkflow,
}: {
  flags: ListingFeatureFlags;
  templates: ListingTemplate[];
  metrics: ListingMetrics | null;
  templateName: string;
  templateId: string;
  selectedCount: number;
  hasActiveProduct: boolean;
  busy: boolean;
  onTemplateNameChange: (value: string) => void;
  onTemplateIdChange: (value: string) => void;
  onImport: () => void;
  onSaveTemplate: () => void;
  onApplyTemplate: () => void;
  onDeleteTemplate: () => void;
  onToggleWorkflow: () => void;
}) {
  return (
    <section className="listing-operations" aria-label="批量效率工具">
      <header className="listing-operations-head">
        <div>
          <span>批量效率工具</span>
          <strong>{flags.workflow_v2 ? "新版字段任务流程" : "兼容流程"}</strong>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={onToggleWorkflow}
          disabled={busy}
        >
          <ArrowCounterClockwise size={16} />
          {flags.workflow_v2 ? "切换兼容流程" : "恢复新版流程"}
        </button>
      </header>
      <div className="listing-operations-grid">
        <article>
          <UploadSimple size={21} />
          <div>
            <strong>导入商品资料</strong>
            <p>支持 CSV、XLSX 和 ERP JSON；导入值标记为业务系统来源。</p>
          </div>
          <button
            type="button"
            className="button button-dark"
            onClick={onImport}
            disabled={busy || !flags.imports}
          >
            选择文件
          </button>
        </article>
        <article className="listing-template-tools">
          <FloppyDisk size={21} />
          <div>
            <strong>类目模板</strong>
            <p>保存当前商品的人工与 ERP 字段，应用时不会覆盖已有值。</p>
          </div>
          <div className="listing-template-row">
            <input
              value={templateName}
              onChange={(event) => onTemplateNameChange(event.target.value)}
              placeholder="新模板名称"
              aria-label="新模板名称"
            />
            <button
              type="button"
              onClick={onSaveTemplate}
              disabled={busy || !hasActiveProduct || !flags.templates}
            >
              保存
            </button>
          </div>
          <div className="listing-template-row">
            <select
              value={templateId}
              onChange={(event) => onTemplateIdChange(event.target.value)}
              aria-label="选择类目模板"
            >
              <option value="">选择模板</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.category_id ? ` · ${template.category_id}` : " · 通用"}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onApplyTemplate}
              disabled={busy || !templateId || !selectedCount}
            >
              应用到 {selectedCount}
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={onDeleteTemplate}
              disabled={busy || !templateId}
            >
              删除
            </button>
          </div>
        </article>
        <article className="listing-metrics-summary">
          <ChartBar size={21} />
          <div>
            <strong>运行质量</strong>
            <p>数据来自当前工作区的真实操作事件。</p>
          </div>
          {flags.metrics && metrics ? (
            <dl>
              <div>
                <dt>首次草稿通过率</dt>
                <dd>
                  {metrics.first_pass_draft_rate === null
                    ? "—"
                    : `${Math.round(metrics.first_pass_draft_rate * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>草稿中位耗时</dt>
                <dd>
                  {metrics.median_draft_duration_ms === null
                    ? "—"
                    : `${(metrics.median_draft_duration_ms / 1000).toFixed(1)}s`}
                </dd>
              </div>
              <div>
                <dt>失败事件</dt>
                <dd>
                  {(metrics.counters.analysis_failed ?? 0) +
                    (metrics.counters.draft_failed ?? 0) +
                    (metrics.counters.publish_failed ?? 0)}
                </dd>
              </div>
              <div>
                <dt>AI 安全完成率</dt>
                <dd>
                  {metrics.ai_safe_completion_rate === null
                    ? "—"
                    : `${Math.round(metrics.ai_safe_completion_rate * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>平均人工字段</dt>
                <dd>
                  {metrics.average_manual_field_count === null
                    ? "—"
                    : metrics.average_manual_field_count.toFixed(1)}
                </dd>
              </div>
              <div>
                <dt>错误定位率</dt>
                <dd>
                  {metrics.error_localization_rate === null
                    ? "—"
                    : `${Math.round(metrics.error_localization_rate * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>AI 确认修改率</dt>
                <dd>
                  {metrics.ai_confirmation_edit_rate === null
                    ? "—"
                    : `${Math.round(metrics.ai_confirmation_edit_rate * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>发布失败率</dt>
                <dd>
                  {metrics.publish_failure_rate === null
                    ? "—"
                    : `${Math.round(metrics.publish_failure_rate * 100)}%`}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="listing-empty-metric">尚无运行数据</p>
          )}
        </article>
      </div>
    </section>
  );
}

function UploadStep({
  products,
  selected,
  dragActive,
  busy,
  photoBankAvailable,
  photoBankLoading,
  photoBankError,
  photoGroups,
  photoGroupId,
  photoImages,
  photoSelection,
  uploadGroupingMode,
  onPhotoGroupChange,
  onGroupingModeChange,
  onTogglePhoto,
  onCreateFromPhotoBank,
  onDragActive,
  onDrop,
  onPickFiles,
  onAddImages,
  onToggleSelected,
  onToggleAll,
  onMergeSelected,
  onSplitProduct,
  onMoveImage,
  onRemove,
  onMainImageChange,
  onOpenAiImages,
}: {
  products: ProductRecord[];
  selected: Set<string>;
  dragActive: boolean;
  busy: boolean;
  photoBankAvailable: boolean;
  photoBankLoading: boolean;
  photoBankError: string;
  photoGroups: PhotoBankGroup[];
  photoGroupId: string;
  photoImages: PhotoBankImage[];
  photoSelection: string[];
  uploadGroupingMode: "single_product" | "separate_products";
  onPhotoGroupChange: (groupId: string) => void;
  onGroupingModeChange: (mode: "single_product" | "separate_products") => void;
  onTogglePhoto: (imageId: string) => void;
  onCreateFromPhotoBank: () => void;
  onDragActive: (active: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPickFiles: () => void;
  onAddImages: (productId: string) => void;
  onToggleSelected: (productId: string) => void;
  onToggleAll: () => void;
  onMergeSelected: () => void;
  onSplitProduct: (productId: string) => void;
  onMoveImage: (productId: string, imageId: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onMainImageChange: (productId: string, imageId: string) => void;
  onOpenAiImages: () => void;
}) {
  const [photoQuery, setPhotoQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "review" | "confirmed" | "error"
  >("all");
  const [sourceTab, setSourceTab] = useState<"local" | "photobank">("local");
  const visiblePhotos = photoQuery.trim()
    ? photoImages.filter((image) =>
        image.name.toLowerCase().includes(photoQuery.trim().toLowerCase()),
      )
    : photoImages;
  const pendingCount = products.filter(
    (product) => product.stage === "uploaded" || product.stage === "analyzing",
  ).length;
  const confirmedCount = products.filter((product) => product.aiConfirmed).length;
  const reviewCount = products.filter(
    (product) => product.stage === "ai_ready" && !product.aiConfirmed,
  ).length;
  const errorCount = products.filter((product) => product.stage === "error").length;
  const visibleProducts = products.filter((product) => {
    const normalized = productQuery.trim().toLowerCase();
    if (
      normalized &&
      !product.reference.toLowerCase().includes(normalized) &&
      !product.title.toLowerCase().includes(normalized)
    ) {
      return false;
    }
    if (statusFilter === "pending") {
      return product.stage === "uploaded" || product.stage === "analyzing";
    }
    if (statusFilter === "confirmed") {
      return product.aiConfirmed;
    }
    if (statusFilter === "review") {
      return product.stage === "ai_ready" && !product.aiConfirmed;
    }
    if (statusFilter === "error") {
      return product.stage === "error";
    }
    return true;
  });
  return (
    <div className="step-page upload-step">
      <div className="upload-source-bar">
        <div className="upload-source-tabs" role="tablist" aria-label="图片来源">
          <button
            type="button"
            role="tab"
            aria-selected={sourceTab === "local"}
            className={`upload-source-tab ${sourceTab === "local" ? "is-active" : ""}`}
            onClick={() => setSourceTab("local")}
          >
            <CloudArrowUp size={17} />
            本地上传图片
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceTab === "photobank"}
            className={`upload-source-tab ${sourceTab === "photobank" ? "is-active" : ""}`}
            onClick={() => setSourceTab("photobank")}
            disabled={!photoBankAvailable}
            title={photoBankAvailable ? undefined : "连接并授权 Alibaba 店铺后可用"}
          >
            <Image size={17} />
            从图片银行选择
          </button>
        </div>
        {sourceTab === "local" ? (
          <div className="upload-grouping-choice" role="group" aria-label="图片分组方式">
            <button
              type="button"
              className={uploadGroupingMode === "single_product" ? "is-active" : ""}
              onClick={() => onGroupingModeChange("single_product")}
            >
              同一商品多图
            </button>
            <button
              type="button"
              className={uploadGroupingMode === "separate_products" ? "is-active" : ""}
              onClick={() => onGroupingModeChange("separate_products")}
            >
              每张图建一个商品
            </button>
          </div>
        ) : null}
        <div className="upload-toolbar-end">
          {sourceTab === "photobank" && photoBankAvailable ? (
            <>
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
            </>
          ) : (
            <>
              <label className="upload-group-filter">
                <span>商品分组</span>
                <select aria-label="商品分组" defaultValue="all">
                  <option value="all">全部商品</option>
                </select>
              </label>
              <div className="photobank-search">
                <MagnifyingGlass size={15} />
                <input
                  value={productQuery}
                  placeholder="搜索货号 / 商品标题"
                  onChange={(event) => setProductQuery(event.target.value)}
                />
              </div>
              <span className="upload-view-switch" aria-label="网格视图">
                <button type="button" className="is-active" aria-label="网格视图">
                  ▦
                </button>
                <button type="button" aria-label="列表视图">
                  ≡
                </button>
              </span>
            </>
          )}
        </div>
        <button type="button" className="upload-ai-entry" onClick={onOpenAiImages}>
          <span>
            <MagicWand size={19} weight="fill" />
          </span>
          <strong>AI 智能套图</strong>
          <small>白底图 · 场景图 · 细节图 · 规格图</small>
          <ArrowRight size={16} />
        </button>
      </div>

      {sourceTab === "photobank" && photoBankAvailable ? (
        <div className="photobank-panel">
          <div className="photobank-panel-head">
            <p>分组与图片均来自已授权店铺的 Alibaba 图片银行，按选择顺序组成一个商品。</p>
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

      {sourceTab === "local" || products.length ? (
        <div className="upload-catalog-layout">
          <aside className="upload-status-panel" aria-label="上传状态">
            <div className="upload-status-title">
              <strong>上传状态</strong>
              <small>{products.length} 个商品</small>
            </div>
            {[
              { value: "all", label: "全部商品", count: products.length },
              { value: "pending", label: "待 AI 分析", count: pendingCount },
              { value: "review", label: "AI 待确认", count: reviewCount },
              { value: "confirmed", label: "内容已确认", count: confirmedCount },
              { value: "error", label: "处理异常", count: errorCount },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                className={statusFilter === item.value ? "is-active" : ""}
                onClick={() =>
                  setStatusFilter(
                    item.value as "all" | "pending" | "review" | "confirmed" | "error",
                  )
                }
              >
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            ))}
            <div className="upload-capacity">
              <span>本批容量</span>
              <strong>{products.length} / 100</strong>
              <i>
                <b style={{ width: `${Math.min(100, products.length)}%` }} />
              </i>
            </div>
          </aside>

          <div className="uploaded-products">
            <div className="section-bar">
              <div>
                <h3>{products.length ? `已选择 ${products.length} 个商品` : "添加第一个商品"}</h3>
                <p>每组图片对应一个商品，第一张图默认为主图。</p>
              </div>
              <div className="upload-list-tools">
                <label>
                  <input
                    type="checkbox"
                    checked={products.length > 0 && selected.size === products.length}
                    onChange={onToggleAll}
                  />
                  全选当前页
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={onMergeSelected}
                  disabled={selected.size < 2}
                >
                  合并所选
                </button>
                <select aria-label="商品排序" defaultValue="latest">
                  <option value="latest">按上传时间</option>
                  <option value="reference">按货号</option>
                </select>
                {products.length ? (
                  <button type="button" className="text-button" onClick={onPickFiles}>
                    继续添加
                  </button>
                ) : null}
              </div>
            </div>
            <div className="upload-grid">
              {sourceTab === "local" && statusFilter === "all" && !productQuery.trim() ? (
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
                    <CloudArrowUp size={26} />
                  </div>
                  <h3>
                    {uploadGroupingMode === "single_product"
                      ? "一次选择同一商品的全部图片"
                      : "选择多张图片并分别建商品"}
                  </h3>
                  <p>
                    {uploadGroupingMode === "single_product"
                      ? "本次选择的所有图片将合并为 1 个商品，第一张作为主图。"
                      : "本次选择的每张图片将分别创建 1 个商品。"}
                  </p>
                  <button type="button" className="button button-dark" onClick={onPickFiles}>
                    <Plus size={17} />
                    选择图片
                  </button>
                </div>
              ) : null}
              {visibleProducts.map((product, index) => (
                <article key={product.id} className="upload-card">
                  <button
                    type="button"
                    className={`upload-card-check ${selected.has(product.id) ? "is-selected" : ""}`}
                    onClick={() => onToggleSelected(product.id)}
                    aria-label={`${selected.has(product.id) ? "取消选择" : "选择"}${product.reference}`}
                  >
                    <Check size={12} weight="bold" />
                  </button>
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
                    {product.images.length > 1 ? (
                      <div className="upload-image-order-tools">
                        <button
                          type="button"
                          onClick={() => onMoveImage(product.id, product.mainImageId, -1)}
                          aria-label="主图向前移动"
                        >
                          <CaretLeft size={12} />
                        </button>
                        <span>移动当前主图</span>
                        <button
                          type="button"
                          onClick={() => onMoveImage(product.id, product.mainImageId, 1)}
                          aria-label="主图向后移动"
                        >
                          <CaretRight size={12} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="upload-card-copy">
                    <strong>{product.reference}</strong>
                    <span>
                      {product.title || `${product.images.length} 张商品图片 · 等待 AI 分析`}
                    </span>
                    <small className="upload-gallery-rule">
                      阿里主图轮播：当前主图排第 1，其余按缩略图顺序取前 6 张；全部图片用于详情。
                    </small>
                    <span
                      className={`upload-source-tag ${
                        product.images.some((image) => image.source === "photobank")
                          ? "is-photobank"
                          : "is-upload"
                      }`}
                    >
                      {product.images.some((image) => image.source === "photobank")
                        ? "图片银行"
                        : "上传完成"}
                    </span>
                    <button
                      type="button"
                      className="text-button upload-card-add-images"
                      onClick={() => onAddImages(product.id)}
                    >
                      <Plus size={13} />
                      向此商品追加图片
                    </button>
                    {product.images.length > 1 ? (
                      <button
                        type="button"
                        className="text-button upload-card-split"
                        onClick={() => onSplitProduct(product.id)}
                      >
                        拆分为 {product.images.length} 个商品
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onRemove(product.id)}
                  >
                    <Trash size={17} />
                    <span className="sr-only">移除商品</span>
                  </button>
                </article>
              ))}
            </div>
            <div className="upload-pagination">
              <span>共 {visibleProducts.length} 条</span>
              <div>
                <button type="button" disabled>
                  <CaretLeft size={14} />
                </button>
                <button type="button" className="is-current">
                  1
                </button>
                <button type="button" disabled>
                  <CaretRight size={14} />
                </button>
              </div>
              <select aria-label="每页条数" defaultValue="20">
                <option value="20">20 条 / 页</option>
              </select>
            </div>
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
  onConfirmField,
  onChange,
  onMainImageChange,
  imageCandidates,
  imageGenerationBusy,
  onGenerateImages,
  onAddGeneratedImage,
  onAddGeneratedImages,
}: {
  products: ProductRecord[];
  busy: boolean;
  activeProductId: string;
  onActiveChange: (id: string) => void;
  onAnalyze: (product: ProductRecord) => Promise<{ success: boolean }>;
  onConfirmField: (id: string, fieldPath: string) => void;
  onChange: (product: ProductRecord) => void;
  onMainImageChange: (productId: string, imageId: string) => void;
  imageCandidates: ProductImageCandidate[];
  imageGenerationBusy: boolean;
  onGenerateImages: () => void;
  onAddGeneratedImage: (candidate: ProductImageCandidate) => void;
  onAddGeneratedImages: () => void;
}) {
  const analyzable = products.filter((product) => product.stage !== "analyzing");
  const active = products.find((product) => product.id === activeProductId) ?? products[0] ?? null;
  const formatAnalyzedAt = (iso?: string) => {
    if (!iso) {
      return "未分析";
    }
    const date = new Date(iso);
    return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")} ${String(
      date.getHours(),
    ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };
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
        <span className="quiet-stat">
          AI 内容均需人工确认后才能进入下一步；中文仅供对照，发布以英文为准
        </span>
      </div>

      <div className="ai-master-detail">
        <div className="ai-product-list" aria-label="商品列表">
          <div className="ai-product-list-head">
            <span>商品信息</span>
            <span>AI 状态</span>
            <span>图片数</span>
            <span>最后分析</span>
          </div>
          {products.map((product) => {
            const status = listStatus(product);
            return (
              <button
                key={product.id}
                type="button"
                className={`ai-product-item ${active?.id === product.id ? "is-active" : ""}`}
                onClick={() => onActiveChange(product.id)}
              >
                <span className="ai-product-primary">
                  <i className="ai-row-check">
                    {active?.id === product.id ? <Check size={10} /> : null}
                  </i>
                  <img src={getMainProductImage(product).url} alt="" />
                  <span className="ai-product-item-copy">
                    <strong>{product.title || product.reference}</strong>
                    <small>{product.reference}</small>
                  </span>
                </span>
                <span className={`ai-product-status ${status.className}`}>
                  {product.stage === "analyzing" ? (
                    <CircleNotch size={13} className="spin" />
                  ) : null}
                  {status.label}
                </span>
                <span className="ai-product-image-count">{product.images.length}</span>
                <span className="ai-product-time">{formatAnalyzedAt(product.analyzedAt)}</span>
              </button>
            );
          })}
          <div className="ai-product-list-footer">
            <span>共 {products.length} 条</span>
            <div>
              <button type="button" disabled aria-label="上一页">
                <CaretLeft size={13} />
              </button>
              <button type="button" className="is-current">
                1
              </button>
              <button type="button" disabled aria-label="下一页">
                <CaretRight size={13} />
              </button>
            </div>
          </div>
        </div>
        <div className="ai-review-list">
          {products
            .filter((product) => product.id === (active?.id ?? ""))
            .map((product) => (
              <article key={product.id} className="ai-review-card">
                <div className="ai-review-content">
                  <div className="review-title-row">
                    <div className="ai-selected-product">
                      <img src={getMainProductImage(product).url} alt="" />
                      <span>
                        <small>已选择 1 个商品</small>
                        <strong>{product.title || product.reference}</strong>
                      </span>
                      <div className="ai-selected-gallery">
                        {product.images.slice(0, 4).map((image) => (
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
                    <span className="ai-review-summary">
                      {product.stage === "analyzing" ? (
                        <>
                          <CircleNotch size={16} className="spin" />
                          正在分析
                        </>
                      ) : (
                        <>
                          <Sparkle size={14} weight="fill" />
                          AI 已生成 {product.aiConfirmed ? "· 已确认" : "· 待确认"}
                        </>
                      )}
                    </span>
                  </div>
                  {product.stage === "error" ? (
                    <div className="ai-analysis-error" role="alert">
                      <WarningCircle size={18} weight="fill" />
                      <span>
                        <strong>AI 分析未完成</strong>
                        <small>{describeAiFailure(product.errors[0])}</small>
                      </span>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void onAnalyze(product)}
                        disabled={busy}
                      >
                        单独重试
                      </button>
                    </div>
                  ) : null}
                  <section className="ai-image-review">
                    <div className="ai-image-review-head">
                      <div>
                        <span>
                          <MagicWand size={15} weight="fill" />
                          AI 智能套图
                        </span>
                        <p>
                          基于真实参考图生成白底图、场景图、细节图和规格图；加入图库前需人工确认。
                        </p>
                      </div>
                      <div>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={onGenerateImages}
                          disabled={imageGenerationBusy}
                        >
                          {imageGenerationBusy ? (
                            <CircleNotch size={15} className="spin" />
                          ) : (
                            <ArrowCounterClockwise size={15} />
                          )}
                          {imageGenerationBusy
                            ? "生成中"
                            : imageCandidates.length
                              ? "重新生成套图"
                              : "生成 AI 套图"}
                        </button>
                        <button
                          type="button"
                          className="button button-dark"
                          onClick={onAddGeneratedImages}
                          disabled={!imageCandidates.some((candidate) => candidate.image_url)}
                        >
                          <CheckSquare size={15} />
                          加入全部成功图
                        </button>
                      </div>
                    </div>
                    {imageCandidates.length ? (
                      <div className="ai-image-candidate-grid">
                        {imageCandidates.map((candidate) => {
                          const added = Boolean(
                            candidate.image_url &&
                              product.images.some((image) => image.url === candidate.image_url),
                          );
                          return (
                            <article
                              key={candidate.slot}
                              className={candidate.image_url ? "" : "is-error"}
                            >
                              {candidate.image_url ? (
                                <img src={candidate.image_url} alt={candidate.label} />
                              ) : (
                                <div className="ai-image-candidate-error">
                                  <WarningCircle size={18} />
                                  <span>{candidate.error}</span>
                                </div>
                              )}
                              <footer>
                                <span>
                                  <strong>{candidate.label}</strong>
                                  <small>
                                    {candidate.image_url ? "AI 候选·需确认" : "暂未生成"}
                                  </small>
                                </span>
                                {candidate.image_url ? (
                                  <button
                                    type="button"
                                    className="wb-link"
                                    disabled={added}
                                    onClick={() => onAddGeneratedImage(candidate)}
                                  >
                                    {added ? "已加入" : "加入图库"}
                                  </button>
                                ) : null}
                              </footer>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ai-image-empty"
                        onClick={onGenerateImages}
                        disabled={imageGenerationBusy}
                      >
                        <MagicWand size={20} />
                        生成白底图、场景图、细节图和规格图候选
                      </button>
                    )}
                  </section>
                  <AiConfirmationTasks
                    product={product}
                    busy={busy}
                    onConfirmField={onConfirmField}
                    onChange={onChange}
                  />
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
                            {product.categoryEvidence ? (
                              <p className="ai-category-evidence">
                                证据：{product.categoryEvidence}
                              </p>
                            ) : null}
                          </td>
                          <td>
                            <AiFieldSource label="AI 建议" />
                            {typeof product.categoryConfidence === "number" ? (
                              <span className="ai-confidence">
                                置信度 {Math.round(product.categoryConfidence * 100)}%
                                <i
                                  className="ai-confidence-bar"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      Math.round(product.categoryConfidence * 100),
                                    )}%`,
                                  }}
                                />
                              </span>
                            ) : null}
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
                    disabled
                  >
                    {product.aiConfirmed ? (
                      <CheckCircle size={18} weight="fill" />
                    ) : (
                      <Check size={18} />
                    )}
                    {product.aiConfirmed
                      ? "已逐项确认"
                      : `请逐项确认（${product.fieldTaskSummary?.confirm ?? 0}）`}
                  </button>
                </div>
              </article>
            ))}
          {!active ? <div className="preview-empty">还没有可确认的商品。</div> : null}
        </div>
      </div>

      <div className="ai-bottom-bar">
        <span className="ai-bottom-check">AI 候选必须逐项确认，经营和合规事实不会由 AI 填写。</span>
        <div className="ai-bottom-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={!analyzable.length || busy}
            onClick={() => {
              for (const product of analyzable) {
                void onAnalyze(product);
              }
            }}
          >
            <MagicWand size={17} />
            重新分析全部
          </button>
        </div>
      </div>
    </div>
  );
}

function AiConfirmationTasks({
  product,
  busy,
  onConfirmField,
  onChange,
}: {
  product: ProductRecord;
  busy: boolean;
  onConfirmField: (id: string, fieldPath: string) => void;
  onChange: (product: ProductRecord) => void;
}) {
  const tasks = confirmationTasks(product);
  if (!tasks.length) {
    return product.aiConfirmed ? (
      <div className="ai-confirmation-complete">
        <CheckCircle size={16} weight="fill" />
        所有 AI 候选均已逐项确认
      </div>
    ) : null;
  }
  return (
    <section className="ai-confirmation-tasks" aria-label="待确认 AI 字段">
      <header>
        <div>
          <strong>请逐项确认</strong>
          <span>还剩 {tasks.length} 项，采用前可查看来源与证据</span>
        </div>
      </header>
      <div>
        {tasks.map((task) => (
          <article key={task.field_path}>
            <span className="ai-confirmation-task-copy">
              <strong>{task.question}</strong>
              <small>{task.explanation}</small>
              {task.evidence ? <em>证据：{task.evidence}</em> : null}
            </span>
            <span className="ai-confirmation-task-value">
              {task.field_path === "category_id" ? (
                taskValueText(task)
              ) : Array.isArray(task.value) ? (
                <textarea
                  rows={2}
                  value={task.value.map(String).join("\n")}
                  aria-label={`修改${task.label}`}
                  onChange={(event) =>
                    onChange(
                      updateAiTaskValue(
                        product,
                        task,
                        event.target.value
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      ),
                    )
                  }
                />
              ) : (
                <textarea
                  rows={2}
                  value={String(task.value ?? "")}
                  aria-label={`修改${task.label}`}
                  onChange={(event) =>
                    onChange(updateAiTaskValue(product, task, event.target.value))
                  }
                />
              )}
            </span>
            <button
              type="button"
              className="button button-primary"
              onClick={() => onConfirmField(product.id, task.field_path)}
              disabled={busy}
            >
              <Check size={15} />
              采用
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function confirmationTasks(product: ProductRecord): FieldTask[] {
  if (product.fieldTasks) {
    return product.fieldTasks.filter((task) => task.status === "confirm");
  }
  return product.isDemo
    ? demoConfirmationTasks(product).filter((task) => task.status === "confirm")
    : [];
}

function summarizeFieldTasks(tasks: FieldTask[]) {
  const summary = { completed: 0, confirm: 0, fill: 0, invalid: 0 };
  for (const task of tasks) {
    summary[task.status] += 1;
  }
  return summary;
}

function buildFallbackAiTasks(product: ProductRecord): FieldTask[] {
  const candidates: Array<{
    field: string;
    label: string;
    value: unknown;
    displayValue?: unknown;
    evidence?: string;
    confidence?: number;
  }> = [
    {
      field: "subject",
      label: "商品标题",
      value: product.title,
      displayValue: product.titleZh,
    },
    {
      field: "category_suggestion",
      label: "AI 类目建议",
      value: product.facts.categoryLabel,
      displayValue: product.facts.categoryLabelZh,
      evidence: product.categoryEvidence,
      confidence: product.categoryConfidence,
    },
    {
      field: "keywords",
      label: "关键词",
      value: product.keywords,
      displayValue: product.keywordsZh,
    },
    {
      field: "selling_points",
      label: "核心卖点",
      value: product.sellingPoints,
      displayValue: product.sellingPointsZh,
    },
    {
      field: "description",
      label: "商品描述",
      value: product.description,
      displayValue: product.descriptionZh,
    },
    {
      field: "visible_traits",
      label: "图片可见属性",
      value: product.visibleTraits,
      displayValue: product.visibleTraitsZh,
    },
  ];
  return candidates
    .filter(({ value }) => value !== "" && (!Array.isArray(value) || value.length > 0))
    .map(({ field, label, value, displayValue, evidence, confidence }) => ({
      field_path: field,
      label,
      question:
        field === "category_suggestion"
          ? "请确认 AI 类目建议仅作为参考；下一步仍需从 Alibaba 类目树选择最终叶子类目。"
          : `请确认“${label}”是否准确。`,
      explanation:
        field === "category_suggestion"
          ? "当前未取得真实类目 Schema，确认建议不会代替最终类目选择。"
          : "该内容由 AI 根据商品图片生成，采用前必须人工核对。",
      control_type: Array.isArray(value) ? "multiInput" : "input",
      status: "confirm" as const,
      responsibility: "ai_candidate" as const,
      responsibility_label: "AI 先填·客户确认",
      allowed_sources: ["ai_generated", "image_extracted", "user_confirmed"] as const,
      value,
      display_value_zh: displayValue,
      source: "ai_generated" as const,
      confidence,
      evidence,
      required: false,
      blocking: true,
      validation_errors: [],
      options: [],
      async_options: false,
    }));
}

function confirmFallbackTaskLocally(product: ProductRecord, task: FieldTask): ProductRecord {
  const fieldTasks = (product.fieldTasks ?? []).map((item) =>
    item.field_path === task.field_path
      ? {
          ...item,
          status: "completed" as const,
          source: "user_confirmed" as const,
          blocking: false,
          validation_errors: [],
        }
      : item,
  );
  const fieldTaskSummary = summarizeFieldTasks(fieldTasks);
  const candidate = product.schemaFields?.[task.field_path];
  const schemaFields = {
    ...product.schemaFields,
    [task.field_path]: {
      ...(candidate ?? { value: task.value }),
      value: task.value,
      display_value_zh: task.display_value_zh,
      source: "user_confirmed" as const,
      requires_confirmation: false,
    },
  };
  const aiConfirmed = fieldTaskSummary.confirm === 0;
  return {
    ...product,
    schemaFields,
    fieldTasks,
    fieldTaskSummary,
    aiConfirmed,
    stage: aiConfirmed ? "facts_needed" : "ai_ready",
    errors: aiConfirmed ? getFactErrors(product) : ["AI 内容尚未确认"],
  };
}

function demoConfirmationTasks(product: ProductRecord): FieldTask[] {
  return (product.schemaGuidance?.ai_fillable_fields ?? []).map((guidance) => {
    const field = product.schemaFields?.[guidance.field];
    const confirmed = field?.source === "user_confirmed";
    return {
      field_path: guidance.field,
      label: guidance.name || guidance.field,
      question: `请确认“${guidance.name || guidance.field}”是否准确。`,
      explanation: guidance.responsibility_reason,
      control_type: guidance.type || "text",
      status: confirmed ? "completed" : "confirm",
      responsibility: guidance.responsibility,
      responsibility_label: guidance.responsibility_label,
      allowed_sources: guidance.allowed_sources,
      value: field?.value,
      display_value_zh: field?.display_value_zh,
      source: field?.source,
      confidence: field?.confidence,
      evidence: field?.evidence,
      required: guidance.required,
      blocking: !confirmed,
      validation_errors: [],
      options: guidance.options,
      async_options: Boolean(guidance.async_options),
      async_query_method: guidance.async_query_method,
      max_length: guidance.max_length,
    };
  });
}

function taskValueText(task: FieldTask): string {
  if (Array.isArray(task.value)) {
    return task.value.map(String).join("、") || "暂无候选值";
  }
  if (task.value && typeof task.value === "object") {
    return JSON.stringify(task.value);
  }
  return String(task.value ?? "暂无候选值");
}

function updateAiTaskValue(product: ProductRecord, task: FieldTask, value: unknown): ProductRecord {
  const schemaFields = {
    ...product.schemaFields,
    [task.field_path]: {
      ...(product.schemaFields?.[task.field_path] ?? {
        source: task.source ?? "ai_generated",
      }),
      value,
      user_edited: true,
      requires_confirmation: true,
    },
  };
  const fieldTasks = product.fieldTasks?.map((item) =>
    item.field_path === task.field_path ? { ...item, value } : item,
  );
  const semantic = task.field_path.toLowerCase();
  return {
    ...product,
    schemaFields,
    fieldTasks,
    title:
      semantic.includes("subject") || semantic.includes("title")
        ? String(value ?? "")
        : product.title,
    description: semantic.includes("description") ? String(value ?? "") : product.description,
    keywords: semantic.includes("keyword")
      ? Array.isArray(value)
        ? value.map(String)
        : String(value ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
      : product.keywords,
    sellingPoints: semantic.includes("selling")
      ? Array.isArray(value)
        ? value.map(String)
        : [String(value ?? "")]
      : product.sellingPoints,
  };
}

function updateTaskValueLocally(
  product: ProductRecord,
  fieldPath: string,
  value: unknown,
): ProductRecord {
  if (!product.fieldTasks) {
    return product;
  }
  const hasValue = value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
  const fieldTasks = product.fieldTasks.map((task) =>
    task.field_path === fieldPath
      ? {
          ...task,
          value,
          source: "user_provided" as const,
          status: hasValue
            ? ("completed" as const)
            : task.required
              ? ("fill" as const)
              : ("completed" as const),
          blocking: task.required && !hasValue,
          validation_errors: [],
        }
      : task,
  );
  const fieldTaskSummary = { completed: 0, confirm: 0, fill: 0, invalid: 0 };
  for (const task of fieldTasks) {
    fieldTaskSummary[task.status] += 1;
  }
  return { ...product, fieldTasks, fieldTaskSummary };
}

function updateRepeatableGroupLocally(
  product: ProductRecord,
  groupPath: string,
  rows: Array<Record<string, unknown>>,
): ProductRecord {
  if (!product.fieldTasks) {
    return product;
  }
  const fieldTasks = product.fieldTasks.map((task) => {
    const repeatableGroups = task.repeatable_groups?.length
      ? task.repeatable_groups
      : task.repeatable_group
        ? [task.repeatable_group]
        : [];
    if (repeatableGroups[0] !== groupPath) {
      return task;
    }
    const relativePath = task.field_path.slice(groupPath.length + 1).split(".");
    const values = collectRepeatableFieldValues(rows, relativePath);
    const complete =
      rows.length > 0 &&
      values.every(
        (value) => value !== null && value !== "" && (!Array.isArray(value) || value.length > 0),
      );
    return {
      ...task,
      value: values,
      source: "user_provided" as const,
      status: complete
        ? ("completed" as const)
        : task.required
          ? ("fill" as const)
          : ("completed" as const),
      blocking: task.required && !complete,
      validation_errors: [],
    };
  });
  const fieldTaskSummary = { completed: 0, confirm: 0, fill: 0, invalid: 0 };
  for (const task of fieldTasks) {
    fieldTaskSummary[task.status] += 1;
  }
  return { ...product, fieldTasks, fieldTaskSummary };
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
  onEditAi,
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
  onEditAi: () => void;
  onOpenSettings: () => void;
  onBulkFill: (
    values: Partial<Pick<ProductRecord["facts"], "price" | "moq" | "stock" | "grossWeight">>,
  ) => void;
  selectedCount: number;
}) {
  const [checkFilter, setCheckFilter] = useState<CheckFilter>("all");
  const [bulkValues, setBulkValues] = useState({
    price: "",
    moq: "",
    stock: "",
    grossWeight: "",
  });
  const visibleProducts = products.filter((product) => {
    return checkFilter === "all" || getCheckState(product) === checkFilter;
  });
  const remainingCount = allProducts.filter((product) => getFactErrors(product).length > 0).length;
  const taskTotals = allProducts.reduce(
    (totals, product) => ({
      completed: totals.completed + (product.fieldTaskSummary?.completed ?? 0),
      confirm: totals.confirm + (product.fieldTaskSummary?.confirm ?? 0),
      fill: totals.fill + (product.fieldTaskSummary?.fill ?? 0),
      invalid: totals.invalid + (product.fieldTaskSummary?.invalid ?? 0),
    }),
    { completed: 0, confirm: 0, fill: 0, invalid: 0 },
  );

  return (
    <div className="wb-facts">
      <div className="wb-required-summary">
        <CheckCircle size={20} weight="fill" />
        <div>
          <strong>仅填写 Alibaba 当前类目仍缺少的必填项</strong>
          <p>
            系统会自动带入图片、AI 已确认内容和店铺默认值；右侧只显示 API 判定仍需你提供的真实信息。
          </p>
        </div>
        <div className="wb-task-summary" aria-label="字段任务状态">
          <span className="is-completed">AI 已完成 {taskTotals.completed}</span>
          <span className="is-confirm">请确认 {taskTotals.confirm}</span>
          <span className="is-fill">请填写 {taskTotals.fill}</span>
          <span className="is-invalid">需要修正 {taskTotals.invalid}</span>
          <b>{remainingCount ? `${remainingCount} 个商品待补充` : "已全部完成"}</b>
        </div>
      </div>
      <div className="wb-toolbar">
        <span className={`wb-facts-count ${remainingCount ? "" : "is-complete"}`}>
          {remainingCount ? `${remainingCount} 个商品待补充` : "已全部完成"}
        </span>
        <button type="button" className="wb-link" onClick={onEditAi}>
          修改 AI 内容
        </button>
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
        <strong>批量补空缺</strong>
        <small>
          {selectedCount ? `套用到选中的 ${selectedCount} 个商品` : "请先勾选需要套用的商品"}
          ，只填空缺、不覆盖已有值；不同商品请直接点击该商品填写
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
        <button
          type="button"
          className="button button-dark"
          disabled={!selectedCount}
          onClick={() => onBulkFill(bulkValues)}
        >
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
              <th>还需填写</th>
              <th>校验状态</th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product, index) => {
              const checkState = getCheckState(product);
              const factErrors = getFactErrors(product);
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
                    <span className={`wb-missing-summary ${factErrors.length ? "" : "is-done"}`}>
                      {factErrors.length
                        ? `${factErrors.slice(0, 2).join("、")}${
                            factErrors.length > 2 ? ` 等 ${factErrors.length} 项` : ""
                          }`
                        : "无需补充"}
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
  const [asyncOptionField, setAsyncOptionField] = useState("");
  const [asyncOptionError, setAsyncOptionError] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<AlibabaCategoryOption[]>([]);
  const [categoryPath, setCategoryPath] = useState<AlibabaCategoryOption[]>([]);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [categoryRecommendations, setCategoryRecommendations] = useState<
    AlibabaCategoryRecommendation[]
  >([]);
  const [categoryRecommendationBusy, setCategoryRecommendationBusy] = useState(false);
  const [categoryRecommendationError, setCategoryRecommendationError] = useState("");
  const [categoryRecommendationWarning, setCategoryRecommendationWarning] = useState("");
  const [manualCategoryPickerOpen, setManualCategoryPickerOpen] = useState(false);
  const [videoPlacement, setVideoPlacement] = useState<"main" | "detail" | null>(null);
  const [videoLibrary, setVideoLibrary] = useState<AlibabaVideo[]>([]);
  const [videoSearch, setVideoSearch] = useState("");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [videoUploadMessage, setVideoUploadMessage] = useState("");
  const addImageInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

  const loadVideoLibrary = async (placement: "main" | "detail", search = videoSearch) => {
    setVideoPlacement(placement);
    setVideoBusy(true);
    setVideoError("");
    try {
      const payload = await listAlibabaVideos(1, 50, search);
      const videos = findAlibabaVideos(payload);
      setVideoLibrary(videos);
      if (!videos.length) {
        setVideoError("Alibaba 视频库暂时没有可选视频，请先在国际站视频银行上传并完成审核。");
      }
    } catch (error) {
      setVideoLibrary([]);
      setVideoError(
        error instanceof Error
          ? error.message
          : "Alibaba 视频库加载失败，请检查当前应用的视频 API 权限。",
      );
    } finally {
      setVideoBusy(false);
    }
  };

  const selectVideo = (video: AlibabaVideo) => {
    if (!videoPlacement) {
      return;
    }
    onChange({
      ...product,
      [videoPlacement === "main" ? "mainVideo" : "detailVideo"]: video,
      videoRelationErrors: undefined,
      videoRelationsVerified: false,
      draftReadbackVerified: product.draftProductId ? false : product.draftReadbackVerified,
    });
    setVideoPlacement(null);
  };
  const uploadVideoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !videoPlacement) {
      return;
    }
    const maxBytes = videoPlacement === "main" ? 100 * 1024 * 1024 : 500 * 1024 * 1024;
    if (file.size > maxBytes) {
      setVideoError(
        `${videoPlacement === "main" ? "主图" : "详情"}视频不能超过 ${maxBytes / (1024 * 1024)} MB`,
      );
      return;
    }
    setVideoBusy(true);
    setVideoError("");
    setVideoUploadMessage("");
    try {
      await uploadAlibabaVideoFile(file, videoPlacement);
      setVideoUploadMessage("视频已提交 Alibaba 处理；审核完成后会出现在视频库中。请稍后刷新。 ");
      await loadVideoLibrary(videoPlacement, "");
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : "本地视频上传失败");
    } finally {
      setVideoBusy(false);
    }
  };
  const setFact = (key: keyof ProductRecord["facts"], value: string) => {
    const schemaFields = getRequiredSchemaFields(product).filter(
      (field) => schemaFactKey(field) === key,
    );
    const nextSchemaFields = { ...product.schemaFields };
    for (const field of schemaFields) {
      nextSchemaFields[field.field] = {
        value: normalizeSchemaChoiceValue(field, value),
        source: "user_provided",
      };
    }
    onChange({
      ...product,
      facts: { ...product.facts, [key]: value },
      schemaFields: nextSchemaFields,
    });
  };
  const setCertifications = (certifications: string[]) => {
    const schemaField = getRequiredSchemaFields(product).find(
      (field) => schemaFactKey(field) === "certifications",
    );
    onChange({
      ...product,
      facts: { ...product.facts, certifications },
      schemaFields: schemaField
        ? {
            ...product.schemaFields,
            [schemaField.field]: {
              value: certifications,
              source: "user_provided",
            },
          }
        : product.schemaFields,
    });
  };
  const loadCategoryOptions = async (
    categoryId: string,
    selectedCandidate?: AlibabaCategoryOption,
  ) => {
    setCategoryBusy(true);
    setCategoryError("");
    try {
      const response = await listCategoryChildren(categoryId);
      const terminalCandidate =
        response.categories.length === 0 && selectedCandidate
          ? [{ ...selectedCandidate, leaf: true }]
          : response.categories;
      setCategoryOptions(terminalCandidate);
      if (!response.categories.length) {
        setCategoryError(
          selectedCandidate
            ? `Alibaba 未返回「${selectedCandidate.name}」的更下级类目；请点击当前类目，系统将通过实时 Schema 验证它是否可用于发布。`
            : "该类目没有可选子类目，请返回上一级重新选择。",
        );
      }
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "类目加载失败，请稍后重试。");
      setCategoryOptions([]);
    } finally {
      setCategoryBusy(false);
    }
  };
  const loadCategoryRecommendations = async () => {
    setCategoryRecommendationBusy(true);
    setCategoryRecommendationError("");
    setCategoryRecommendationWarning("");
    try {
      const response = await recommendAlibabaCategories({
        title: product.title,
        keywords: product.keywords,
        categoryHint: product.facts.categoryLabel,
        visibleTraits: product.visibleTraits,
      });
      setCategoryRecommendations(response.recommendations);
      setCategoryRecommendationWarning(response.warning ?? "");
      if (!response.recommendations.length) {
        setCategoryRecommendationError("暂未匹配到可确认的叶子类目，请浏览全部类目后手动选择。");
        setManualCategoryPickerOpen(true);
        void loadCategoryOptions("0");
      }
    } catch (error) {
      setCategoryRecommendations([]);
      setCategoryRecommendationError(
        error instanceof Error ? error.message : "智能类目匹配失败，请改用人工选择。",
      );
      setManualCategoryPickerOpen(true);
      void loadCategoryOptions("0");
    } finally {
      setCategoryRecommendationBusy(false);
    }
  };
  const openCategoryPicker = () => {
    setCategoryPickerOpen(true);
    setCategoryPath([]);
    setCategoryOptions([]);
    setCategoryError("");
    setManualCategoryPickerOpen(false);
    void loadCategoryRecommendations();
  };
  const confirmLeafCategory = async (
    option: AlibabaCategoryOption,
    nextPath: AlibabaCategoryOption[],
  ) => {
    const categoryLabel = nextPath.map((item) => item.name).join(" > ");
    const selectedProduct: ProductRecord = {
      ...product,
      facts: {
        ...product.facts,
        categoryId: option.id,
        categoryLabel,
        categoryLabelZh: categoryLabel,
      },
      schemaData: undefined,
      schemaGuidance: undefined,
      schemaFields: {
        categoryId: {
          value: option.id,
          source: "user_confirmed",
        },
        categoryLabel: {
          value: categoryLabel,
          source: "user_confirmed",
        },
      },
    };
    setCategoryBusy(true);
    setCategoryError("");
    try {
      const [payload, publishCapabilities] = await Promise.all([
        getCategorySchema(option.id),
        getCategoryPublishCapabilities(option.id),
      ]);
      if (
        !publishCapabilities.support_post_whole_sale &&
        !publishCapabilities.support_post_sourcing
      ) {
        throw new Error("当前店铺没有该类目的下单品或询盘品发布权限");
      }
      const schemaData = findSchemaData(payload);
      if (!schemaData) {
        throw new Error("Alibaba 未返回类目 Schema");
      }
      const schemaGuidance = await getSchemaGuidance(schemaData);
      const confirmedProduct = syncProductSchemaFields(
        {
          ...selectedProduct,
          publishCapabilities,
          schemaData,
          schemaGuidance,
        },
        settings,
      );
      onChange(confirmedProduct);
      setCategoryPickerOpen(false);
      setCategoryOptions([]);
      setCategoryPath([]);
      setCategoryRecommendations([]);
      setManualCategoryPickerOpen(false);
    } catch (error) {
      setCategoryError(
        error instanceof Error
          ? `无法将当前类目用于发布：${error.message}`
          : "无法验证当前类目的实时必填字段，请重试或返回上一级。",
      );
    } finally {
      setCategoryBusy(false);
    }
  };
  const chooseCategory = async (option: AlibabaCategoryOption) => {
    const nextPath =
      categoryPath.at(-1)?.id === option.id ? categoryPath : [...categoryPath, option];
    if (!option.leaf) {
      setCategoryPath(nextPath);
      void loadCategoryOptions(option.id, option);
      return;
    }
    await confirmLeafCategory(option, nextPath);
  };
  const chooseRecommendedCategory = async (recommendation: AlibabaCategoryRecommendation) => {
    const leaf = recommendation.path.at(-1);
    if (!leaf) {
      setCategoryRecommendationError("推荐类目路径不完整，请改用人工选择。");
      return;
    }
    await confirmLeafCategory({ ...leaf, leaf: true }, recommendation.path);
  };
  const openManualCategoryPicker = () => {
    setManualCategoryPickerOpen(true);
    setCategoryPath([]);
    void loadCategoryOptions("0");
  };
  const goBackCategoryLevel = () => {
    const nextPath = categoryPath.slice(0, -1);
    setCategoryPath(nextPath);
    void loadCategoryOptions(nextPath.at(-1)?.id ?? "0");
  };
  const addProductImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }
    const now = Date.now();
    onChange({
      ...product,
      images: [
        ...product.images,
        ...files.map((file, index) => ({
          id: `added-${now}-${index}`,
          url: URL.createObjectURL(file),
          name: file.name,
          sourceFile: file,
          fileSize: file.size,
          source: "upload" as const,
        })),
      ],
    });
    event.target.value = "";
  };
  const removeProductImage = (imageId: string) => {
    const images = product.images.filter((image) => image.id !== imageId);
    if (!images.length) {
      return;
    }
    onChange({
      ...product,
      images,
      mainImageId: product.mainImageId === imageId ? images[0].id : product.mainImageId,
    });
  };
  const setSkuRows = (skuRows: NonNullable<ProductRecord["facts"]["skuRows"]>) => {
    const schemaFields: Record<string, DraftField> = {
      ...product.schemaFields,
      sku_rows: { value: skuRows, source: "user_provided" as const },
    };
    const skuGroupPath = findOfficialSkuGroupPath(product);
    if (skuGroupPath) {
      if (!skuRows.length) {
        delete schemaFields[skuGroupPath];
      } else if (skuRows.every((row) => row.propertyValues?.length)) {
        schemaFields[skuGroupPath] = {
          value: buildOfficialSkuSchemaRows(skuRows),
          source: "user_provided",
        };
      }
    }
    onChange({
      ...product,
      facts: { ...product.facts, skuRows },
      schemaFields,
    });
  };
  const setSchemaField = (field: SchemaFieldGuidance, value: unknown) => {
    const factKey = schemaFactKey(field);
    const factValue = schemaFactTextValue(value);
    onChange(
      updateTaskValueLocally(
        {
          ...product,
          facts:
            factKey && factValue !== null
              ? { ...product.facts, [factKey]: factValue }
              : product.facts,
          schemaFields: {
            ...product.schemaFields,
            [field.field]: {
              value,
              source: "user_provided",
            },
          },
        },
        field.field,
        value,
      ),
    );
  };
  const setRepeatableGroup = (groupPath: string, value: Array<Record<string, unknown>>) => {
    onChange(
      updateRepeatableGroupLocally(
        {
          ...product,
          schemaFields: {
            ...product.schemaFields,
            [groupPath]: { value, source: "user_provided" },
          },
        },
        groupPath,
        value,
      ),
    );
  };
  const loadAsyncOptions = async (field: SchemaFieldGuidance) => {
    setAsyncOptionField(field.field);
    setAsyncOptionError("");
    try {
      const result = await getAsyncFieldOptions(product, settings, field.field);
      const returnedFields = [...result.ai_fillable_fields, ...result.manual_fact_fields];
      const targetLeaf = field.field.split(".").at(-1);
      const returned = returnedFields.find(
        (item) => item.field === field.field || item.field.split(".").at(-1) === targetLeaf,
      );
      if (!returned?.options.length) {
        throw new Error("Alibaba 暂未返回可选项，请先填写或选择上级属性");
      }
      const replaceGuidance = (item: SchemaFieldGuidance) =>
        item.field === field.field ? { ...item, options: returned.options } : item;
      onChange({
        ...product,
        schemaGuidance: product.schemaGuidance
          ? {
              ...product.schemaGuidance,
              ai_fillable_fields: product.schemaGuidance.ai_fillable_fields.map(replaceGuidance),
              manual_fact_fields: product.schemaGuidance.manual_fact_fields.map(replaceGuidance),
            }
          : product.schemaGuidance,
        fieldTasks: product.fieldTasks?.map((task) =>
          task.field_path === field.field ? { ...task, options: returned.options } : task,
        ),
      });
    } catch (error) {
      setAsyncOptionError(error instanceof Error ? error.message : "无法加载 Alibaba 选项");
    } finally {
      setAsyncOptionField("");
    }
  };
  const complianceNote = product.facts.certifications[0] ?? "";
  const missingFacts = getFactErrors(product);
  const allSchemaFields = getAllSchemaFields(product);
  const supportsMainVideo = allSchemaFields.some(isMainVideoSchemaField);
  const supportsDetailVideo = allSchemaFields.some(isDetailVideoSchemaField);
  const requiredSchemaFields = getRequiredSchemaFields(product);
  const requiredSchemaFieldIds = new Set(product.schemaGuidance?.required_field_ids ?? []);
  const taskByField = new Map((product.fieldTasks ?? []).map((task) => [task.field_path, task]));
  const responsibilityCounts = {
    ai_candidate: 0,
    merchant: 0,
    business_system: 0,
    store_default: 0,
  };
  for (const field of allSchemaFields) {
    responsibilityCounts[field.responsibility] += 1;
  }
  const aiCandidateCount = responsibilityCounts.ai_candidate;
  const humanFactCount = allSchemaFields.length - aiCandidateCount;
  const repeatableGroups = new Map<string, SchemaFieldGuidance[]>();
  for (const field of allSchemaFields) {
    if (isSchemaFieldDisabled(product, field)) {
      continue;
    }
    const outerGroup = field.repeatable_groups?.[0] ?? field.repeatable_group;
    if (outerGroup) {
      const grouped = repeatableGroups.get(outerGroup) ?? [];
      grouped.push(field);
      repeatableGroups.set(outerGroup, grouped);
    }
  }
  const inputSchemaFields = allSchemaFields.filter((field) => {
    if (field.repeatable_group || field.repeatable_groups?.length) {
      return false;
    }
    if (isSchemaFieldDisabled(product, field)) {
      return false;
    }
    if (isImageSchemaField(field) || isTitleSchemaField(field) || isVideoSchemaField(field)) {
      return false;
    }
    return true;
  });
  const repeatableGroupEntries = [...repeatableGroups.entries()];
  const primarySchemaFields = inputSchemaFields.filter((field) =>
    requiredSchemaFieldIds.has(field.field),
  );
  const advancedSchemaFields = inputSchemaFields.filter(
    (field) => !requiredSchemaFieldIds.has(field.field),
  );
  const primaryRepeatableGroups = repeatableGroupEntries.filter(([groupPath]) =>
    requiredSchemaFieldIds.has(groupPath),
  );
  const advancedRepeatableGroups = repeatableGroupEntries.filter(
    ([groupPath]) => !requiredSchemaFieldIds.has(groupPath),
  );
  const missingRequiredSchemaCount = requiredSchemaFields.filter((field) =>
    field.repeatable_group || field.repeatable_groups?.length
      ? !hasRepeatableSchemaFieldValue(product, field)
      : !hasSchemaValue(getSchemaFieldValue(product, field)),
  ).length;

  const renderRepeatableGroups = (entries: Array<[string, SchemaFieldGuidance[]]>) =>
    entries.map(([groupPath, fields]) => (
      <MultiComplexEditor
        key={groupPath}
        groupPath={groupPath}
        fields={fields}
        value={repeatableGroupValue(product, groupPath)}
        photoBankGroupId={settings.photoBankGroupId}
        onChange={(value) => setRepeatableGroup(groupPath, value)}
      />
    ));

  const renderSchemaFields = (fields: SchemaFieldGuidance[], scope: string) =>
    fields.length ? (
      <div className="wb-schema-field-list">
        {fields.map((field, index) => {
          const task = taskByField.get(field.field);
          const value = getSchemaFieldValue(product, field);
          const inputId = `schema-${product.id}-${scope}-${index}`;
          const requirementLabel = requiredSchemaFieldIds.has(field.field)
            ? "API 必填"
            : field.required
              ? "条件必填"
              : "API 选填";
          return (
            <div
              key={field.field}
              className={`wb-schema-field is-${task?.status ?? "fill"} ${hasSchemaValue(value) ? "is-complete" : ""}`}
            >
              <div className="wb-schema-field-heading" id={`${inputId}-label`}>
                <span>
                  {task?.question || schemaFieldLabel(field)}
                  <i>{requirementLabel}</i>
                  <i className="is-control">{schemaFieldControlLabel(field)}</i>
                  <i className={`is-${field.responsibility}`}>{field.responsibility_label}</i>
                </span>
                <small>
                  {task?.validation_errors?.[0] ||
                    task?.explanation ||
                    field.tip ||
                    (isShippingTemplateIdField(field)
                      ? "请填写阿里国际站真实运费模板 ID，不要填写模板名称；若历史商品已使用模板，系统会优先自动带入。"
                      : undefined) ||
                    (hasSchemaValue(value) ? "已填写，可继续修改" : field.responsibility_reason)}
                </small>
              </div>
              {field.supported === false ? (
                <div className="wb-schema-dynamic-option is-blocked" role="alert">
                  <WarningCircle size={15} />
                  <span>{field.support_message || "该字段暂时无法安全填写"}</span>
                </div>
              ) : field.async_options && !field.options.length ? (
                <div className="wb-schema-dynamic-option">
                  <WarningCircle size={15} />
                  <span>{asyncOptionError || "需先选择上级属性，再从 Alibaba API 加载选项"}</span>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={asyncOptionField === field.field}
                    onClick={() => void loadAsyncOptions(field)}
                  >
                    {asyncOptionField === field.field ? (
                      <CircleNotch size={14} className="spin" />
                    ) : null}
                    {asyncOptionField === field.field ? "加载中" : "加载 Alibaba 选项"}
                  </button>
                </div>
              ) : (
                <SchemaValueControl
                  field={field}
                  value={value}
                  inputId={inputId}
                  placeholder={
                    isShippingTemplateIdField(field)
                      ? "请输入真实运费模板 ID"
                      : task?.example
                        ? `示例：${task.example}`
                        : "请输入真实信息"
                  }
                  onChange={(nextValue) => setSchemaField(field, nextValue)}
                />
              )}
            </div>
          );
        })}
      </div>
    ) : null;

  return (
    <aside className="wb-inspector" aria-label="商品资料">
      <header className="wb-inspector-header">
        <strong>填写必要信息</strong>
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
        <div className="wb-inspector-intro">
          <strong>{product.reference}</strong>
          <p>{product.title || "商品标题由 AI 确认步骤生成"}</p>
          <span>
            {missingFacts.length ? `还需填写 ${missingFacts.length} 项` : "必要信息已完成"}
          </span>
        </div>

        <details
          className="wb-inspector-optional wb-sku-optional"
          open={Boolean(product.facts.skuRows?.length)}
        >
          <summary>SKU 规格、价格与库存（{product.facts.skuRows?.length ?? 0}）</summary>
          <SkuTableEditor
            rows={product.facts.skuRows ?? []}
            combinations={buildOfficialSkuCombinations(product)}
            onChange={setSkuRows}
          />
        </details>

        <section className="wb-inspector-section wb-category-confirmation">
          <div className="wb-category-heading">
            <div>
              <h3>最终 Alibaba 类目</h3>
              <p>AI 只提供建议，最终叶子类目来自 Alibaba 实时类目树。</p>
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={openCategoryPicker}
              disabled={categoryBusy || product.isDemo}
            >
              {product.facts.categoryId ? "更换类目" : "选择类目"}
            </button>
          </div>
          {product.facts.categoryId ? (
            <div className="wb-category-selected">
              <CheckCircle size={17} weight="fill" />
              <span>
                <strong>{product.facts.categoryLabel}</strong>
                <small>叶子类目 ID {product.facts.categoryId}</small>
                {product.publishCapabilities ? (
                  <small>
                    店铺可发布：
                    {[
                      product.publishCapabilities.support_post_whole_sale ? "下单品" : "",
                      product.publishCapabilities.support_post_sourcing ? "询盘品" : "",
                    ]
                      .filter(Boolean)
                      .join("、")}
                  </small>
                ) : null}
              </span>
            </div>
          ) : (
            <div className="wb-category-suggestion">
              <WarningCircle size={17} />
              <span>
                <strong>尚未确认最终类目</strong>
                <small>
                  AI 建议：{product.facts.categoryLabel || "等待 AI 分析"}
                  ；请选择实际叶子类目后继续。
                </small>
              </span>
            </div>
          )}
          {categoryPickerOpen ? (
            <div className="wb-category-picker">
              <div className="wb-category-picker-bar">
                <span>智能匹配真实类目</span>
                <button
                  type="button"
                  className="wb-link"
                  onClick={() => setCategoryPickerOpen(false)}
                >
                  取消
                </button>
              </div>
              <p className="wb-category-path">
                推荐结果全部来自 Alibaba 实时类目树，需要你确认后才会写入商品。
              </p>
              {categoryRecommendationBusy ? (
                <div className="wb-category-loading wb-category-recommendation-loading">
                  <CircleNotch size={17} className="spin" />
                  正在根据商品标题、关键词和图片信息匹配
                </div>
              ) : null}
              {categoryRecommendationWarning ? (
                <p className="wb-category-warning">{categoryRecommendationWarning}</p>
              ) : null}
              {categoryRecommendationError ? (
                <p className="wb-category-error">{categoryRecommendationError}</p>
              ) : null}
              {categoryRecommendations.length ? (
                <div className="wb-category-recommendations">
                  {categoryRecommendations.map((recommendation) => (
                    <article key={recommendation.category_id}>
                      <div>
                        <strong>{recommendation.path.map((item) => item.name).join(" > ")}</strong>
                        <small>{recommendation.reason}</small>
                      </div>
                      <div className="wb-category-recommendation-action">
                        <span>{Math.round(recommendation.confidence * 100)}% 匹配</span>
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => void chooseRecommendedCategory(recommendation)}
                          disabled={categoryBusy}
                        >
                          {categoryBusy ? <CircleNotch size={14} className="spin" /> : null}
                          确认此类目
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
              {!manualCategoryPickerOpen ? (
                <button
                  type="button"
                  className="wb-category-manual-trigger"
                  onClick={openManualCategoryPicker}
                  disabled={categoryBusy || categoryRecommendationBusy}
                >
                  推荐不合适？浏览全部 Alibaba 类目
                  <CaretRight size={14} />
                </button>
              ) : null}
              {categoryError && !manualCategoryPickerOpen ? (
                <p className="wb-category-error">{categoryError}</p>
              ) : null}
              {manualCategoryPickerOpen ? (
                <div className="wb-category-manual-picker">
                  <div className="wb-category-picker-bar">
                    {categoryPath.length ? (
                      <button type="button" className="wb-link" onClick={goBackCategoryLevel}>
                        <CaretLeft size={14} />
                        返回上一级
                      </button>
                    ) : (
                      <span>浏览全部类目</span>
                    )}
                    <button
                      type="button"
                      className="wb-link"
                      onClick={() => setManualCategoryPickerOpen(false)}
                    >
                      收起
                    </button>
                  </div>
                  {categoryPath.length ? (
                    <p className="wb-category-path">
                      已选择：{categoryPath.map((item) => item.name).join(" > ")}
                    </p>
                  ) : null}
                  {categoryBusy ? (
                    <div className="wb-category-loading">
                      <CircleNotch size={17} className="spin" />
                      正在读取 Alibaba 类目
                    </div>
                  ) : null}
                  {categoryError ? <p className="wb-category-error">{categoryError}</p> : null}
                  {!categoryBusy && categoryOptions.length ? (
                    <div className="wb-category-options">
                      {categoryOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => void chooseCategory(option)}
                        >
                          <span>{option.name}</span>
                          {option.leaf ? <Check size={14} /> : <CaretRight size={14} />}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {!categoryPickerOpen && categoryError ? (
            <p className="wb-category-error">{categoryError}</p>
          ) : null}
        </section>

        {supportsMainVideo || supportsDetailVideo ? (
          <section className="wb-inspector-section wb-video-library">
            <div className="wb-video-library-heading">
              <div>
                <h3>Alibaba 商品视频</h3>
                <p>从当前店铺的视频库选择；创建草稿取得商品 ID 后，系统会自动完成关联。</p>
              </div>
            </div>
            <div className="wb-video-selections">
              {supportsMainVideo ? (
                <article className={product.mainVideo ? "is-selected" : ""}>
                  {product.mainVideo?.coverUrl ? (
                    <img src={product.mainVideo.coverUrl} alt="主图视频封面" />
                  ) : (
                    <div className="wb-video-placeholder">主图视频</div>
                  )}
                  <div>
                    <strong>{product.mainVideo?.title || "未选择主图视频"}</strong>
                    <small>展示在商品主图区域</small>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void loadVideoLibrary("main")}
                    disabled={videoBusy || Boolean(product.draftProductId)}
                  >
                    {product.mainVideo ? "更换" : "选择"}
                  </button>
                  {product.mainVideo ? (
                    <button
                      type="button"
                      className="wb-link is-danger"
                      disabled={Boolean(product.draftProductId)}
                      onClick={() =>
                        onChange({
                          ...product,
                          mainVideo: undefined,
                          videoRelationErrors: undefined,
                          videoRelationsVerified: false,
                          draftReadbackVerified: product.draftProductId
                            ? false
                            : product.draftReadbackVerified,
                        })
                      }
                    >
                      移除
                    </button>
                  ) : null}
                </article>
              ) : null}
              {supportsDetailVideo ? (
                <article className={product.detailVideo ? "is-selected" : ""}>
                  {product.detailVideo?.coverUrl ? (
                    <img src={product.detailVideo.coverUrl} alt="详情视频封面" />
                  ) : (
                    <div className="wb-video-placeholder">详情视频</div>
                  )}
                  <div>
                    <strong>{product.detailVideo?.title || "未选择详情视频"}</strong>
                    <small>展示在商品详情区域</small>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void loadVideoLibrary("detail")}
                    disabled={videoBusy || Boolean(product.draftProductId)}
                  >
                    {product.detailVideo ? "更换" : "选择"}
                  </button>
                  {product.detailVideo ? (
                    <button
                      type="button"
                      className="wb-link is-danger"
                      disabled={Boolean(product.draftProductId)}
                      onClick={() =>
                        onChange({
                          ...product,
                          detailVideo: undefined,
                          videoRelationErrors: undefined,
                          videoRelationsVerified: false,
                          draftReadbackVerified: product.draftProductId
                            ? false
                            : product.draftReadbackVerified,
                        })
                      }
                    >
                      移除
                    </button>
                  ) : null}
                </article>
              ) : null}
            </div>
            {videoPlacement ? (
              <div className="wb-video-picker">
                <input
                  ref={videoFileInputRef}
                  className="sr-only"
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v"
                  onChange={(event) => void uploadVideoFile(event)}
                />
                <div className="wb-video-picker-toolbar">
                  <label>
                    <span className="sr-only">搜索视频标题</span>
                    <input
                      value={videoSearch}
                      onChange={(event) => setVideoSearch(event.target.value)}
                      placeholder="搜索 Alibaba 视频库"
                    />
                  </label>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={videoBusy}
                    onClick={() => void loadVideoLibrary(videoPlacement, videoSearch)}
                  >
                    {videoBusy ? <CircleNotch size={14} className="spin" /> : <MagnifyingGlass size={14} />}
                    搜索
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={videoBusy}
                    onClick={() => videoFileInputRef.current?.click()}
                  >
                    <UploadSimple size={14} />
                    上传本地视频
                  </button>
                  <button type="button" className="wb-link" onClick={() => setVideoPlacement(null)}>
                    取消
                  </button>
                </div>
                {videoUploadMessage ? (
                  <div className="wb-schema-dynamic-option" role="status">
                    <CheckCircle size={15} weight="fill" />
                    <span>{videoUploadMessage}</span>
                  </div>
                ) : null}
                {videoError ? (
                  <div className="wb-schema-dynamic-option is-blocked" role="alert">
                    <WarningCircle size={15} />
                    <span>{videoError}</span>
                  </div>
                ) : null}
                {videoBusy ? (
                  <div className="wb-category-loading">
                    <CircleNotch size={17} className="spin" />
                    正在读取 Alibaba 视频库
                  </div>
                ) : null}
                {!videoBusy && videoLibrary.length ? (
                  <div className="wb-video-results">
                    {videoLibrary.map((video) => (
                      <button key={video.id} type="button" onClick={() => selectVideo(video)}>
                        {video.coverUrl ? (
                          <img src={video.coverUrl} alt="" />
                        ) : (
                          <span className="wb-video-placeholder">视频</span>
                        )}
                        <span>
                          <strong>{video.title}</strong>
                          <small>
                            ID {video.id}
                            {video.status ? ` · 状态 ${video.status}` : ""}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="wb-schema-note">
              {product.draftProductId
                ? "草稿创建后视频选择已锁定；关联失败可在草稿回读页直接重试。"
                : "可从店铺视频库选择，也可上传本地 MP4、MOV 或 M4V；本地视频提交 Alibaba 处理并审核通过后，再从视频库选择。"}
            </p>
          </section>
        ) : null}

        <section className="wb-inspector-section wb-image-generation wb-image-generation-prominent">
          <div className="wb-image-generation-heading">
            <div>
              <h3>AI 智能套图</h3>
              <p>至少使用一张真实参考图，生成结果加入图库前必须人工确认。</p>
            </div>
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
            <p className="wb-image-generation-empty">
              演示模式使用隔离候选图，不调用真实图片服务或 Alibaba 店铺。
            </p>
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
              {imagePlan.map((slot) => {
                const requiredInputsReady = slot.missing_user_inputs.every((requirement) =>
                  Boolean(providedImageInputs[requirement.key]?.trim()),
                );
                return (
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
                        onClick={
                          slot.can_generate
                            ? () => onGenerateImages([slot.slot])
                            : onRefreshImagePlan
                        }
                        disabled={
                          imageGenerationBusy ||
                          imagePlanBusy ||
                          (!slot.can_generate && !requiredInputsReady)
                        }
                      >
                        {slot.can_generate ? "生成此图" : "核对信息并解锁"}
                      </button>
                    </div>
                  </article>
                );
              })}
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
                      <span>{candidate.error || "图片服务未返回具体原因，请单独重试"}</span>
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
                      <button
                        type="button"
                        className="wb-link"
                        onClick={() => onGenerateImages([candidate.slot])}
                        disabled={imageGenerationBusy}
                      >
                        单独重试
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
        <details className="wb-inspector-optional wb-content-optional">
          <summary>查看全部字段 / 高级编辑</summary>
          <section className="wb-inspector-section">
            <h3>买家可见内容</h3>
            <div className="wb-field">
              <span className="wb-field-label">商品图片</span>
              <div className="wb-field-control">
                <div className="wb-advanced-images">
                  {product.images.map((image) => (
                    <article
                      key={image.id}
                      className={image.id === product.mainImageId ? "is-main" : ""}
                    >
                      <img src={image.url} alt={image.name} />
                      <div>
                        <button
                          type="button"
                          className="wb-link"
                          onClick={() =>
                            onChange({
                              ...product,
                              mainImageId: image.id,
                            })
                          }
                        >
                          {image.id === product.mainImageId ? "当前主图" : "设为主图"}
                        </button>
                        <button
                          type="button"
                          className="wb-link is-danger"
                          onClick={() => removeProductImage(image.id)}
                          disabled={product.images.length <= 1}
                          aria-label={`删除 ${image.name}`}
                        >
                          <Trash size={13} />
                        </button>
                      </div>
                    </article>
                  ))}
                  <button
                    type="button"
                    className="wb-advanced-image-add"
                    onClick={() => addImageInputRef.current?.click()}
                  >
                    <Plus size={17} />
                    添加图片
                  </button>
                </div>
                <input
                  ref={addImageInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={addProductImages}
                />
              </div>
            </div>
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
              <span className="wb-field-label">品牌</span>
              <div className="wb-field-control">
                <div className="wb-input">
                  <input
                    value={product.facts.brand}
                    onChange={(event) => setFact("brand", event.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="wb-field">
              <span className="wb-field-label">关键词</span>
              <div className="wb-field-control">
                <div className="wb-input">
                  <input
                    value={product.keywords.join(", ")}
                    onChange={(event) =>
                      onChange({
                        ...product,
                        keywords: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean)
                          .slice(0, 3),
                      })
                    }
                    placeholder="最多 3 个，用逗号分隔"
                  />
                </div>
              </div>
            </div>
            <div className="wb-field">
              <span className="wb-field-label">卖点</span>
              <div className="wb-field-control">
                <div className="wb-input wb-input-area">
                  <textarea
                    rows={3}
                    value={product.sellingPoints.join("\n")}
                    onChange={(event) =>
                      onChange({
                        ...product,
                        sellingPoints: event.target.value
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="每行一个卖点"
                  />
                </div>
              </div>
            </div>
            <div className="wb-field">
              <span className="wb-field-label">商品描述</span>
              <div className="wb-field-control">
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
            <h3>商业与规格资料</h3>
            <p className="wb-advanced-facts-note">
              以下内容不会由 AI 猜测；仅填写商家、ERP 或商品实物能够确认的真实信息。
            </p>
            <div className="wb-advanced-fact-grid">
              {advancedFactFields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <input
                    value={product.facts[field.key]}
                    onChange={(event) => setFact(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="wb-field">
              <span className="wb-field-label">认证与合规说明</span>
              <div className="wb-field-control">
                <div className="wb-input wb-input-area">
                  <textarea
                    rows={3}
                    value={product.facts.certifications.join("\n")}
                    onChange={(event) =>
                      setCertifications(
                        event.target.value
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      )
                    }
                    placeholder="每行一项，仅填写真实证书或合规说明"
                  />
                </div>
              </div>
            </div>
            <button type="button" className="wb-link" onClick={onOpenSettings}>
              修改币种、计量单位、运费模板等店铺默认值
            </button>
          </section>
        </details>

        {product.schemaGuidance ? (
          <section className="wb-inspector-section wb-schema-required">
            <div className="wb-schema-heading">
              <h3>
                当前类目必填（{requiredSchemaFields.length}，待填 {missingRequiredSchemaCount}）
              </h3>
            </div>
            {missingRequiredSchemaCount === 0 ? (
              <div className="wb-schema-complete">
                <CheckCircle size={18} weight="fill" />
                <span>当前类目要求的必填项已全部完成</span>
              </div>
            ) : null}
            {renderRepeatableGroups(primaryRepeatableGroups)}
            {renderSchemaFields(primarySchemaFields, "required")}

            {advancedSchemaFields.length || advancedRepeatableGroups.length ? (
              <details className="wb-inspector-optional wb-schema-advanced">
                <summary>
                  高级编辑：{advancedSchemaFields.length + advancedRepeatableGroups.length}
                  项选填或条件字段
                </summary>
                <details className="wb-schema-matrix">
                  <summary>
                    查看全部 {allSchemaFields.length} 个字段与责任（必填{" "}
                    {requiredSchemaFields.length}）
                  </summary>
                  <div>
                    <p className="wb-schema-policy">
                      AI 仅可起草文案与图片可见属性；价格、SKU、库存、材质和合规必须使用真实值。
                    </p>
                    <div className="wb-schema-responsibility" aria-label="当前类目字段责任分配">
                      <span className="is-default">
                        <strong>{responsibilityCounts.store_default}</strong>
                        店铺默认
                      </span>
                      <span className="is-system">
                        <strong>{responsibilityCounts.business_system}</strong>
                        ERP / 客户事实
                      </span>
                      <span className="is-merchant">
                        <strong>{responsibilityCounts.merchant}</strong>
                        客户填写
                      </span>
                    </div>
                    <h4>AI 可先填·客户确认（{aiCandidateCount}）</h4>
                    {allSchemaFields
                      .filter((field) => field.responsibility === "ai_candidate")
                      .map((field) => {
                        const value = getSchemaFieldValue(product, field);
                        return (
                          <p key={field.field}>
                            <span>{schemaFieldLabel(field)}</span>
                            <b>{schemaFieldControlLabel(field)}</b>
                            <i className={`is-${field.responsibility}`}>
                              {field.responsibility_label}
                            </i>
                            <small>{hasSchemaValue(value) ? "已确认" : "待确认"}</small>
                          </p>
                        );
                      })}
                    <h4>AI 不得填写（{humanFactCount}）</h4>
                    {allSchemaFields
                      .filter((field) => field.responsibility !== "ai_candidate")
                      .map((field) => {
                        const value = getSchemaFieldValue(product, field);
                        return (
                          <p key={field.field}>
                            <span>{schemaFieldLabel(field)}</span>
                            <b>{schemaFieldControlLabel(field)}</b>
                            <i className={`is-${field.responsibility}`}>
                              {field.responsibility_label}
                            </i>
                            <small>{hasSchemaValue(value) ? "已带入" : "待补充"}</small>
                          </p>
                        );
                      })}
                  </div>
                </details>
                {renderRepeatableGroups(advancedRepeatableGroups)}
                {renderSchemaFields(advancedSchemaFields, "advanced")}
              </details>
            ) : null}
            <p className="wb-schema-note">
              共 {allSchemaFields.length} 个 API 字段，其中必填 {requiredSchemaFields.length}
              个；日常只需处理上方必填项，全部可编辑字段仍保留在高级编辑中。
            </p>
          </section>
        ) : (
          <>
            <section className="wb-inspector-section">
              <h3>1. 交易信息</h3>
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
                  <span className="wb-field-label">MOQ</span>
                  <div className="wb-input">
                    <input
                      inputMode="numeric"
                      value={product.facts.moq}
                      onChange={(event) => setFact("moq", event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="wb-field">
                <span className="wb-field-label">库存（可售）</span>
                <div className="wb-field-control">
                  <div className="wb-input">
                    <input
                      inputMode="numeric"
                      value={product.facts.stock}
                      onChange={(event) => setFact("stock", event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="wb-auto-value">
                <span>系统自动</span>
                <p>
                  币种 {settings.currency || "待设置"} · 计量单位 {settings.priceUnit || "待设置"}
                </p>
                {!settings.currency || !settings.priceUnit ? (
                  <button type="button" className="wb-link" onClick={onOpenSettings}>
                    去店铺默认设置
                  </button>
                ) : null}
              </div>
            </section>

            <section className="wb-inspector-section">
              <h3>2. 包装与交期</h3>
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
                <span className="wb-field-label">发货期</span>
                <div className="wb-field-control">
                  <div className="wb-input wb-input-with-suffix">
                    <input
                      inputMode="numeric"
                      value={product.facts.leadTime}
                      onChange={(event) => setFact("leadTime", event.target.value)}
                    />
                    <span>天</span>
                  </div>
                </div>
              </div>
              <div className="wb-auto-value">
                <span>{settings.shippingTemplateId ? "历史商品自动复用" : "类目确认后补充"}</span>
                <p>
                  运费模板{" "}
                  {settings.shippingTemplateLabel ||
                    (settings.shippingTemplateId
                      ? `ID ${settings.shippingTemplateId}`
                      : "不阻断当前步骤")}
                </p>
                {!settings.shippingTemplateId ? (
                  <small>选择最终类目后，按 Alibaba Schema 要求填写真实模板 ID。</small>
                ) : null}
              </div>
            </section>

            <section className="wb-inspector-section">
              <h3>3. 合规信息</h3>
              <div className="wb-field">
                <span className="wb-field-label">原产地</span>
                <div className="wb-field-control">
                  <div className="wb-input">
                    <input
                      value={product.facts.origin}
                      onChange={(event) => setFact("origin", event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="wb-field">
                <span className="wb-field-label">美国 HS 编码</span>
                <div className="wb-field-control">
                  <div className="wb-input">
                    <input
                      value={product.facts.hsCode}
                      onChange={(event) => setFact("hsCode", event.target.value)}
                    />
                  </div>
                </div>
              </div>
            </section>

            <details className="wb-inspector-optional wb-product-optional">
              <summary>平台要求时再填写：型号、材质和认证</summary>
              <section className="wb-inspector-section">
                <div className="wb-field wb-field-split">
                  <div>
                    <span className="wb-field-label">型号</span>
                    <div className="wb-input">
                      <input
                        value={product.facts.model}
                        onChange={(event) => setFact("model", event.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="wb-field-label">材质</span>
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
                    <div className="wb-input wb-input-counter wb-input-area">
                      <textarea
                        rows={2}
                        value={complianceNote}
                        onChange={(event) => setCertifications([event.target.value])}
                      />
                      <small>{complianceNote.length}/200</small>
                    </div>
                  </div>
                </div>
              </section>
            </details>
          </>
        )}
      </div>
    </aside>
  );
}

type DraftCheckStatus = "ok" | "ai_pending" | "missing" | "failed";

type OfficialSkuPropertyValue = {
  value: string;
  attributes: Record<string, string>;
};

type OfficialSkuCombination = {
  key: string;
  label: string;
  propertyValues: OfficialSkuPropertyValue[];
};

function findOfficialSkuGroupPath(product: ProductRecord): string | null {
  const skuField = getAllSchemaFields(product).find((field) => {
    const leaf = field.field.split(".").at(-1)?.toLowerCase();
    return ["skuouterid", "skustock", "props"].includes(leaf || "") &&
      schemaRepeatableGroups(field).some((group) => group.split(".").at(-1) === "sku");
  });
  return skuField
    ? schemaRepeatableGroups(skuField).find((group) => group.split(".").at(-1) === "sku") || null
    : null;
}

function buildOfficialSkuCombinations(product: ProductRecord): OfficialSkuCombination[] {
  const salePropertyFields = getAllSchemaFields(product).filter(
    (field) => field.field.startsWith("saleProp.") && field.type === "multiCheck",
  );
  if (!salePropertyFields.length) {
    return [];
  }
  const dimensions: OfficialSkuCombination[][] = [];
  for (const field of salePropertyFields) {
    const selected = product.schemaFields?.[field.field]?.value;
    if (!Array.isArray(selected) || !selected.length) {
      return [];
    }
    const propName = field.field.split(".").at(-1) || field.field;
    const propId = propName.replace(/^p-/, "");
    const values = selected.flatMap((item) => {
      const attributed = schemaAttributedValue(item);
      if (!attributed.value) {
        return [];
      }
      const option = field.options.find((candidate) => candidate.value === attributed.value);
      const propValueName =
        attributed.attributes.inputValue || option?.display_name || attributed.value;
      const propertyValue: OfficialSkuPropertyValue = {
        value: `${propId}:${attributed.value}`,
        attributes: {
          propId,
          propName,
          propValueId: attributed.value,
          propValueName,
        },
      };
      return [
        {
          key: officialSkuCombinationKey([propertyValue]),
          label: `${field.name || propName}: ${propValueName}`,
          propertyValues: [propertyValue],
        },
      ];
    });
    if (!values.length) {
      return [];
    }
    dimensions.push(values);
  }
  return dimensions.reduce<OfficialSkuCombination[]>(
    (combinations, dimension) =>
      combinations.flatMap((combination) =>
        dimension.map((item) => {
          const propertyValues = [...combination.propertyValues, ...item.propertyValues];
          return {
            key: officialSkuCombinationKey(propertyValues),
            label: [combination.label, item.label].filter(Boolean).join(" / "),
            propertyValues,
          };
        }),
      ),
    [{ key: "", label: "", propertyValues: [] }],
  );
}

function officialSkuCombinationKey(values: OfficialSkuPropertyValue[]): string {
  return values
    .map((item) => `${item.attributes.propId}:${item.attributes.propValueId}`)
    .join("|");
}

function buildOfficialSkuSchemaRows(
  rows: NonNullable<ProductRecord["facts"]["skuRows"]>,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const value: Record<string, unknown> = {
      props: row.propertyValues ?? [],
    };
    if (row.sku.trim()) {
      value.skuOuterId = row.sku.trim();
    }
    if (row.price.trim()) {
      value.price = row.price.trim();
    }
    if (row.stock.trim()) {
      value.skuStock = [
        {
          value: row.stock.trim(),
          attributes: { warehouseCode: "CN_LOCAL_01", srcValue: "0" },
        },
      ];
    }
    return value;
  });
}

function getDraftCheckStatus(product: ProductRecord): DraftCheckStatus {
  if (product.stage === "error") {
    return "failed";
  }
  if (!product.aiConfirmed) {
    return "ai_pending";
  }
  if (getFactErrors(product).length > 0) {
    return "missing";
  }
  return "ok";
}

function SkuTableEditor({
  rows,
  combinations,
  onChange,
}: {
  rows: NonNullable<ProductRecord["facts"]["skuRows"]>;
  combinations: OfficialSkuCombination[];
  onChange: (rows: NonNullable<ProductRecord["facts"]["skuRows"]>) => void;
}) {
  const update = (id: string, key: "sku" | "attributes" | "price" | "stock", value: string) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  };
  const add = () => {
    onChange([
      ...rows,
      {
        id: `sku-${Date.now()}-${rows.length}`,
        sku: "",
        attributes: "",
        price: "",
        stock: "",
      },
    ]);
  };
  const syncCombinations = () => {
    const byCombination = new Map(
      rows
        .filter((row) => row.propertyValues?.length)
        .map((row) => [officialSkuCombinationKey(row.propertyValues ?? []), row]),
    );
    onChange(
      combinations.map((combination, index) => {
        const current = byCombination.get(combination.key);
        return {
          id: current?.id || `sku-combination-${Date.now()}-${index}`,
          sku: current?.sku || "",
          attributes: combination.label,
          price: current?.price || "",
          stock: current?.stock || "",
          propertyValues: combination.propertyValues,
        };
      }),
    );
  };
  const hasUnmappedRows = rows.some((row) => !row.propertyValues?.length);
  return (
    <section className="wb-sku-editor">
      <header>
        <div>
          <strong>每一行是一种可销售规格</strong>
          <p>先选择上方 Alibaba 销售属性，再自动生成全部组合；价格和库存必须是真实值。</p>
        </div>
        {combinations.length ? (
          <button type="button" className="button button-secondary" onClick={syncCombinations}>
            <ArrowCounterClockwise size={14} /> 同步销售属性组合
          </button>
        ) : (
          <button type="button" className="button button-secondary" onClick={add}>
            <Plus size={14} /> 添加 SKU
          </button>
        )}
      </header>
      {!combinations.length ? (
        <p className="wb-schema-inline-error">
          当前尚未选择颜色、尺寸等 Alibaba 销售属性；有多规格时请先完成销售属性。
        </p>
      ) : null}
      {hasUnmappedRows ? (
        <p className="wb-schema-inline-error">
          现有 SKU 只有文字规格，缺少 Alibaba 属性 ID。请点击“同步销售属性组合”重新生成。
        </p>
      ) : null}
      {rows.length ? (
        <div className="wb-sku-table">
          <div className="wb-sku-table-head">
            <span>SKU 编码</span>
            <span>规格组合</span>
            <span>价格</span>
            <span>库存</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const id = row.id || `sku-imported-${index}`;
            return (
              <div key={id} className="wb-sku-table-row">
                <input
                  value={row.sku ?? ""}
                  onChange={(event) => update(id, "sku", event.target.value)}
                  aria-label={`第 ${index + 1} 行 SKU 编码`}
                />
                <input
                  value={row.attributes ?? ""}
                  readOnly={Boolean(row.propertyValues?.length)}
                  onChange={(event) => update(id, "attributes", event.target.value)}
                  placeholder="请先同步销售属性组合"
                  aria-label={`第 ${index + 1} 行规格组合`}
                />
                <input
                  value={row.price ?? ""}
                  inputMode="decimal"
                  onChange={(event) => update(id, "price", event.target.value)}
                  aria-label={`第 ${index + 1} 行价格`}
                />
                <input
                  value={row.stock ?? ""}
                  inputMode="numeric"
                  onChange={(event) => update(id, "stock", event.target.value)}
                  aria-label={`第 ${index + 1} 行库存`}
                />
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((item) => item.id !== id))}
                  aria-label={`删除第 ${index + 1} 行 SKU`}
                >
                  <Trash size={15} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="wb-sku-empty">单规格商品可以不添加；多规格商品请逐行填写。</p>
      )}
    </section>
  );
}

function MultiComplexEditor({
  groupPath,
  fields,
  value,
  photoBankGroupId,
  onChange,
}: {
  groupPath: string;
  fields: SchemaFieldGuidance[];
  value: Array<Record<string, unknown>>;
  photoBankGroupId?: string;
  onChange: (value: Array<Record<string, unknown>>) => void;
}) {
  return (
    <section className="wb-multi-complex">
      <header>
        <div>
          <strong>{groupPath.split(".").at(-1) || "多组信息"}</strong>
          <span>Alibaba 多组字段；每一组都会按实时 Schema 原样提交</span>
        </div>
      </header>
      <MultiComplexRows
        groupPath={groupPath}
        fields={fields}
        value={value}
        photoBankGroupId={photoBankGroupId}
        onChange={onChange}
      />
    </section>
  );
}

function MultiComplexRows({
  groupPath,
  fields,
  value,
  photoBankGroupId,
  onChange,
}: {
  groupPath: string;
  fields: SchemaFieldGuidance[];
  value: Array<Record<string, unknown>>;
  photoBankGroupId?: string;
  onChange: (value: Array<Record<string, unknown>>) => void;
}) {
  const rows = value.length ? value : [{}];
  const directFields = fields.filter((field) => {
    const groups = schemaRepeatableGroups(field);
    return groups.at(-1) === groupPath;
  });
  const childGroups = Array.from(
    new Set(
      fields.flatMap((field) => {
        const groups = schemaRepeatableGroups(field);
        const index = groups.indexOf(groupPath);
        return index >= 0 && groups[index + 1] ? [groups[index + 1]] : [];
      }),
    ),
  );
  const updateRow = (index: number, field: SchemaFieldGuidance, nextValue: unknown) => {
    const relativePath = field.field.slice(groupPath.length + 1).split(".");
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? setNestedRecordValue(row, relativePath, nextValue) : row,
      ),
    );
  };
  const updateNestedRows = (
    index: number,
    nestedGroupPath: string,
    nextValue: Array<Record<string, unknown>>,
  ) => {
    const relativePath = nestedGroupPath.slice(groupPath.length + 1).split(".");
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? setNestedRecordValue(row, relativePath, nextValue) : row,
      ),
    );
  };
  return (
    <div className="wb-multi-complex-table">
      {rows.map((row, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: repeatable rows are positional Schema values and carry no publishable client id
        <article key={`${groupPath}-${rowIndex}`}>
          <b>第 {rowIndex + 1} 组</b>
          {directFields.map((field) => {
            const relativePath = field.field.slice(groupPath.length + 1).split(".");
            const currentValue = getNestedRecordValue(row, relativePath);
            const inputId = `multi-${groupPath}-${rowIndex}-${field.field}`;
            return (
              <label key={field.field} htmlFor={inputId}>
                <span>{field.name || relativePath.at(-1)}</span>
                {field.supported === false ? (
                  <span className="wb-schema-inline-error">
                    {field.support_message || "该字段暂时无法安全填写"}
                  </span>
                ) : (
                  <SchemaValueControl
                    field={field}
                    value={currentValue}
                    inputId={inputId}
                    placeholder="请输入真实信息"
                    photoBankGroupId={photoBankGroupId}
                    onChange={(nextValue) => updateRow(rowIndex, field, nextValue)}
                  />
                )}
              </label>
            );
          })}
          {childGroups.map((childGroup) => {
            const relativePath = childGroup.slice(groupPath.length + 1).split(".");
            const nestedValue = normalizeRepeatableGroupValue(getNestedRecordValue(row, relativePath));
            const nestedFields = fields.filter((field) =>
              schemaRepeatableGroups(field).includes(childGroup),
            );
            return (
              <section className="wb-multi-complex-nested" key={childGroup}>
                <strong>{childGroup.split(".").at(-1)}</strong>
                <MultiComplexRows
                  groupPath={childGroup}
                  fields={nestedFields}
                  value={nestedValue}
                  photoBankGroupId={photoBankGroupId}
                  onChange={(nextValue) => updateNestedRows(rowIndex, childGroup, nextValue)}
                />
              </section>
            );
          })}
          <div className="wb-multi-complex-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onChange([...rows, {}])}
            >
              <Plus size={14} /> 添加一组
            </button>
            <button
              type="button"
              className="wb-link is-danger"
              disabled={rows.length === 1}
              onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}
            >
              删除本组
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function schemaRepeatableGroups(field: SchemaFieldGuidance): string[] {
  if (field.repeatable_groups?.length) {
    return field.repeatable_groups;
  }
  return field.repeatable_group ? [field.repeatable_group] : [];
}

function SchemaValueControl({
  field,
  value,
  inputId,
  placeholder,
  photoBankGroupId,
  onChange,
}: {
  field: SchemaFieldGuidance;
  value: unknown;
  inputId: string;
  placeholder: string;
  photoBankGroupId?: string;
  onChange: (value: unknown) => void;
}) {
  if (schemaFieldLeafId(field) === "imageurl") {
    return (
      <PhotoBankUrlControl
        value={schemaScalarText(value)}
        inputId={inputId}
        groupId={photoBankGroupId ?? ""}
        onChange={onChange}
      />
    );
  }
  if (isBoxPackagingField(field)) {
    return (
      <BoxPackagingControl
        field={field}
        value={value}
        inputId={inputId}
        onChange={onChange}
      />
    );
  }
  if (field.value_attributes?.length) {
    return (
      <SchemaAttributedValueControl
        field={field}
        value={value}
        inputId={inputId}
        placeholder={placeholder}
        onChange={onChange}
      />
    );
  }
  if (field.type === "multiCheck" && field.options.length) {
    const selected = Array.isArray(value) ? value.map(schemaScalarText) : [];
    return (
      <div className="wb-schema-options" id={inputId} role="group">
        {field.options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label key={option.value} className={option.valid === false ? "is-disabled" : ""}>
              <input
                type="checkbox"
                checked={checked}
                disabled={option.valid === false}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((item) => item !== option.value)
                      : [...selected, option.value],
                  )
                }
              />
              <span>
                {option.display_name || option.value}
                {option.valid === false ? "（当前不可用）" : ""}
              </span>
            </label>
          );
        })}
      </div>
    );
  }
  if (field.options.length) {
    return (
      <select
        id={inputId}
        value={schemaScalarText(value)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">请选择</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.valid === false}>
            {option.display_name || option.value}
            {option.valid === false ? "（当前不可用）" : ""}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "multiInput") {
    const values = Array.isArray(value) ? value.map(schemaScalarText) : [];
    const rows = values.length ? values : [""];
    return (
      <div className="wb-schema-value-list" id={inputId}>
        {rows.map((item, index) => (
          <div key={`${field.field}-${index}`}>
            <SchemaScalarInput
              field={field}
              value={item}
              inputId={`${inputId}-${index}`}
              placeholder={placeholder}
              onChange={(nextValue) => {
                const next = rows.map((current, rowIndex) =>
                  rowIndex === index ? nextValue : current,
                );
                onChange(next.filter((current) => current !== ""));
              }}
            />
            <button
              type="button"
              className="wb-link is-danger"
              disabled={rows.length === 1}
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
            >
              删除
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button-secondary"
          disabled={field.max_input_num !== undefined && rows.length >= field.max_input_num}
          onClick={() => onChange([...rows, ""])}
        >
          <Plus size={14} /> 添加一项
        </button>
      </div>
    );
  }
  return (
    <SchemaScalarInput
      field={field}
      value={schemaScalarText(value)}
      inputId={inputId}
      placeholder={placeholder}
      onChange={onChange}
    />
  );
}

function PhotoBankUrlControl({
  value,
  inputId,
  groupId,
  onChange,
}: {
  value: string;
  inputId: string;
  groupId: string;
  onChange: (value: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!groupId) {
      setError("请先在通用模板中选择图片银行分组");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = await uploadPhotoBankImage(file, groupId);
      const photoBankUrl = findPhotoBankUrl(payload);
      if (!photoBankUrl) {
        throw new Error("Alibaba 未返回图片银行地址");
      }
      onChange(photoBankUrl);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "图片银行上传失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wb-photobank-url-control">
      {value ? <img src={value} alt="已选择的图片银行素材" /> : null}
      <input
        id={inputId}
        type="url"
        value={value}
        placeholder="图片银行地址会自动填入"
        onChange={(event) => onChange(event.target.value)}
      />
      <label className={`button button-secondary ${busy ? "is-disabled" : ""}`}>
        {busy ? <CircleNotch size={14} className="spin" /> : <CloudArrowUp size={14} />}
        {busy ? "上传中" : "本地上传到图片银行"}
        <input type="file" accept="image/*" disabled={busy} onChange={uploadImage} />
      </label>
      {error ? <small className="wb-schema-inline-error">{error}</small> : null}
    </div>
  );
}

function BoxPackagingControl({
  field,
  value,
  inputId,
  onChange,
}: {
  field: SchemaFieldGuidance;
  value: unknown;
  inputId: string;
  onChange: (value: unknown) => void;
}) {
  const selected = (Array.isArray(value) ? value : []).map(schemaAttributedValue);
  const selectedByValue = new Map(selected.map((item) => [item.value, item]));
  const updateAttributes = (optionValue: string, attribute: string, nextValue: string) => {
    onChange(
      selected.map((item) =>
        item.value === optionValue
          ? { ...item, attributes: { ...item.attributes, [attribute]: nextValue } }
          : item,
      ),
    );
  };
  if (!field.options.length) {
    return (
      <span className="wb-schema-inline-error" id={inputId}>
        Alibaba 未返回可用箱规，说明当前店铺尚未创建箱规；请先在国际站后台创建后重新拉取类目。
      </span>
    );
  }
  return (
    <div className="wb-box-packaging" id={inputId}>
      {field.options.map((option) => {
        const current = selectedByValue.get(option.value);
        return (
          <div key={option.value} className={current ? "is-selected" : ""}>
            <label>
              <input
                type="checkbox"
                checked={Boolean(current)}
                disabled={option.valid === false}
                onChange={() =>
                  onChange(
                    current
                      ? selected.filter((item) => item.value !== option.value)
                      : [
                          ...selected,
                          {
                            value: option.value,
                            attributes: { maxCount: "", totalWeight: "" },
                          },
                        ],
                  )
                }
              />
              <span>{option.display_name || option.value}</span>
            </label>
            {current ? (
              <div className="wb-field wb-field-split">
                <label>
                  <span>每箱最多装入数量</span>
                  <input
                    inputMode="numeric"
                    value={current.attributes.maxCount || ""}
                    onChange={(event) =>
                      updateAttributes(option.value, "maxCount", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>装满后总重（kg）</span>
                  <input
                    inputMode="decimal"
                    value={current.attributes.totalWeight || ""}
                    onChange={(event) =>
                      updateAttributes(option.value, "totalWeight", event.target.value)
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SchemaScalarInput({
  field,
  value,
  inputId,
  placeholder,
  onChange,
}: {
  field: SchemaFieldGuidance;
  value: string;
  inputId: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  if (field.value_type === "textarea" || field.value_type === "html") {
    return (
      <textarea
        id={inputId}
        rows={field.value_type === "html" ? 6 : 3}
        value={value}
        maxLength={field.max_length}
        placeholder={field.value_type === "html" ? "请输入 Alibaba 接受的 HTML 内容" : placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const numeric = ["double", "decimal", "integer", "long"].includes(field.value_type || "");
  return (
    <input
      id={inputId}
      type={field.value_type === "date" ? "date" : field.value_type === "url" ? "url" : "text"}
      inputMode={
        numeric
          ? ["double", "decimal"].includes(field.value_type || "")
            ? "decimal"
            : "numeric"
          : undefined
      }
      value={value}
      minLength={field.min_length}
      maxLength={field.max_length}
      placeholder={placeholder}
      title={field.pattern ? `需符合 Alibaba 格式规则：${field.pattern}` : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function SchemaAttributedValueControl({
  field,
  value,
  inputId,
  placeholder,
  onChange,
}: {
  field: SchemaFieldGuidance;
  value: unknown;
  inputId: string;
  placeholder: string;
  onChange: (value: unknown) => void;
}) {
  const multiple = field.type === "multiInput" || field.type === "multiCheck";
  const source = multiple ? (Array.isArray(value) ? value : []) : [value];
  const rows = (source.length ? source : [""]).map(schemaAttributedValue);
  const valueAttributes = field.value_attributes ?? [];
  const update = (index: number, next: { value: string; attributes: Record<string, string> }) => {
    const nextRows = rows.map((row, rowIndex) => (rowIndex === index ? next : row));
    onChange(multiple ? nextRows.filter((row) => row.value) : nextRows[0]);
  };
  return (
    <div className="wb-schema-attributed-values" id={inputId}>
      {rows.map((row, index) => (
        <div className="wb-schema-attributed-row" key={`${field.field}-${index}`}>
          {field.options.length ? (
            <select
              value={row.value}
              onChange={(event) => {
                const option = field.options.find((item) => item.value === event.target.value);
                const attributes = { ...row.attributes };
                for (const attribute of valueAttributes) {
                  if (option?.attributes?.[attribute]) {
                    attributes[attribute] = option.attributes[attribute];
                  }
                }
                update(index, { value: event.target.value, attributes });
              }}
            >
              <option value="">请选择</option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.valid === false}>
                  {option.display_name || option.value}
                </option>
              ))}
            </select>
          ) : (
            <SchemaScalarInput
              field={field}
              value={row.value}
              inputId={`${inputId}-${index}-value`}
              placeholder={placeholder}
              onChange={(nextValue) => update(index, { ...row, value: nextValue })}
            />
          )}
          <div className="wb-schema-attributes">
            {valueAttributes.map((attribute) => (
              <label key={attribute}>
                <span>Alibaba 值属性：{attribute}</span>
                <input
                  value={row.attributes[attribute] || ""}
                  placeholder={`请输入 ${attribute}`}
                  onChange={(event) =>
                    update(index, {
                      ...row,
                      attributes: { ...row.attributes, [attribute]: event.target.value },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {multiple ? (
            <button
              type="button"
              className="wb-link is-danger"
              disabled={rows.length === 1}
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
            >
              删除本项
            </button>
          ) : null}
        </div>
      ))}
      {multiple ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={field.max_input_num !== undefined && rows.length >= field.max_input_num}
          onClick={() => onChange([...rows, schemaAttributedValue("")])}
        >
          <Plus size={14} /> 添加一项
        </button>
      ) : null}
    </div>
  );
}

function schemaScalarText(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
    return String((value as { value?: unknown }).value ?? "");
  }
  return value === null || value === undefined ? "" : String(value);
}

function schemaAttributedValue(value: unknown): {
  value: string;
  attributes: Record<string, string>;
} {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
    const record = value as { value?: unknown; attributes?: unknown };
    return {
      value: String(record.value ?? ""),
      attributes:
        record.attributes &&
        typeof record.attributes === "object" &&
        !Array.isArray(record.attributes)
          ? Object.fromEntries(
              Object.entries(record.attributes).map(([key, item]) => [key, String(item)]),
            )
          : {},
    };
  }
  return { value: schemaScalarText(value), attributes: {} };
}

function repeatableGroupValue(
  product: ProductRecord,
  groupPath: string,
): Array<Record<string, unknown>> {
  const value = product.schemaFields?.[groupPath]?.value;
  return normalizeRepeatableGroupValue(value);
}

function normalizeRepeatableGroupValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
    : [];
}

function collectRepeatableFieldValues(
  rows: Array<Record<string, unknown>>,
  path: string[],
): unknown[] {
  const result: unknown[] = [];
  const visit = (value: unknown, offset: number) => {
    if (offset >= path.length) {
      result.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, offset);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      result.push(undefined);
      return;
    }
    visit((value as Record<string, unknown>)[path[offset]], offset + 1);
  };
  for (const row of rows) {
    visit(row, 0);
  }
  return result;
}

function setNestedRecordValue(
  source: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (!path.length) {
    return source;
  }
  const [head, ...tail] = path;
  if (!tail.length) {
    return { ...source, [head]: value };
  }
  const current = source[head];
  const child = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  return {
    ...source,
    [head]: setNestedRecordValue(child as Record<string, unknown>, tail, value),
  };
}

function getNestedRecordValue(source: Record<string, unknown>, path: string[]): unknown {
  let value: unknown = source;
  for (const part of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function DraftStep({
  products,
  busy,
  selected,
  onToggleSelected,
  onOpenProduct,
  onCreateDrafts,
  onBack,
}: {
  products: ProductRecord[];
  busy: boolean;
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  onOpenProduct: (id: string) => void;
  onCreateDrafts: () => void;
  onBack: () => void;
}) {
  const [draftQuery, setDraftQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | DraftCheckStatus>("all");
  const [detailProductId, setDetailProductId] = useState("");
  const scopedProducts = selected.size
    ? products.filter((product) => selected.has(product.id))
    : products;
  const ready = scopedProducts.filter((product) => getProductErrors(product).length === 0);
  const aiPendingCount = scopedProducts.filter((product) => !product.aiConfirmed).length;
  const missingFactsCount = scopedProducts.filter(
    (product) => product.aiConfirmed && getFactErrors(product).length > 0,
  ).length;
  const failedCount = scopedProducts.filter((product) => product.stage === "error").length;
  const categories = Array.from(
    new Set(products.map((product) => product.facts.categoryLabel).filter(Boolean)),
  );
  const visibleRows = products.filter((product) => {
    const normalized = draftQuery.trim().toLowerCase();
    if (
      normalized &&
      !product.title.toLowerCase().includes(normalized) &&
      !product.reference.toLowerCase().includes(normalized)
    ) {
      return false;
    }
    if (categoryFilter !== "all" && product.facts.categoryLabel !== categoryFilter) {
      return false;
    }
    if (statusFilter !== "all" && getDraftCheckStatus(product) !== statusFilter) {
      return false;
    }
    return true;
  });
  const detailProduct = products.find((product) => product.id === detailProductId) ?? null;
  const statusBadge = (status: DraftCheckStatus, product: ProductRecord) => {
    if (product.stage === "drafted" || product.stage === "published") {
      return <SourceBadge source="trusted" label="草稿已创建" />;
    }
    if (product.stage === "drafting") {
      return (
        <span className="working-label">
          <CircleNotch size={15} className="spin" />
          创建中
        </span>
      );
    }
    if (status === "failed") {
      return <SourceBadge source="missing" label="校验失败" />;
    }
    if (status === "ai_pending") {
      return <SourceBadge source="ai" label="AI 待确认" />;
    }
    if (status === "missing") {
      return <SourceBadge source="default" label="缺失事实" />;
    }
    return <SourceBadge source="trusted" label="校验通过" />;
  };
  return (
    <div className="step-page draft-step">
      <div className="step-heading">
        <div>
          <h2>逐商品校验并创建草稿</h2>
        </div>
        <span className="quiet-stat">存在校验失败或缺失事实的商品不会进入本次草稿创建</span>
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

      <div className="draft-filter-bar">
        <div className="photobank-search">
          <MagnifyingGlass size={15} />
          <input
            value={draftQuery}
            placeholder="请输入商品标题或货号"
            onChange={(event) => setDraftQuery(event.target.value)}
          />
        </div>
        <label className="draft-filter">
          <span>类目</span>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">全部</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="draft-filter">
          <span>校验状态</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | DraftCheckStatus)}
          >
            <option value="all">全部</option>
            <option value="ok">校验通过</option>
            <option value="ai_pending">AI 待确认</option>
            <option value="missing">缺失事实</option>
            <option value="failed">校验失败</option>
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setDraftQuery("");
            setCategoryFilter("all");
            setStatusFilter("all");
          }}
        >
          重置
        </button>
        <span className="quiet-stat">共 {visibleRows.length} 条</span>
      </div>

      <div className="draft-table-wrap">
        <table className="draft-table">
          <thead>
            <tr>
              <th aria-label="选择" />
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
            {visibleRows.map((product) => {
              const errors = getProductErrors(product);
              const status = getDraftCheckStatus(product);
              const isFailed = product.stage === "error";
              return (
                <Fragment key={product.id}>
                  <tr className={errors.length || isFailed ? "is-invalid" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${product.reference}`}
                        checked={selected.has(product.id)}
                        onChange={() => onToggleSelected(product.id)}
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
                    <td>{statusBadge(status, product)}</td>
                    <td>
                      <div className="readback-actions">
                        <button
                          type="button"
                          className="row-action"
                          onClick={() => setDetailProductId(product.id)}
                        >
                          查看
                        </button>
                        {errors.length || isFailed ? (
                          <button
                            type="button"
                            className="row-action is-danger"
                            onClick={() => onOpenProduct(product.id)}
                          >
                            修复
                            <ArrowRight size={15} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {errors.length || isFailed ? (
                    <tr className="draft-reason-row">
                      <td colSpan={8}>
                        <XCircle size={14} weight="fill" />
                        失败原因：{(isFailed ? product.errors : errors).join("；")}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!visibleRows.length ? (
          <div className="preview-empty">没有匹配当前筛选条件的商品。</div>
        ) : null}
      </div>

      <div className="draft-bottom-bar">
        <button type="button" className="button button-secondary" onClick={onBack}>
          返回补齐事实
        </button>
        {busy ? (
          <div className="draft-progress" role="status">
            <span>正在创建草稿…</span>
            <i className="draft-progress-track">
              <i className="draft-progress-bar" />
            </i>
          </div>
        ) : null}
        <button
          type="button"
          className="button button-primary button-large"
          onClick={onCreateDrafts}
          disabled={!ready.length || busy}
          title={ready.length ? undefined : "存在校验失败或缺失事实的商品，暂不可创建草稿"}
        >
          {busy ? <CircleNotch size={19} className="spin" /> : <FileText size={19} />}
          批量创建草稿（{ready.length}）
        </button>
      </div>

      {detailProduct ? (
        <DraftDetailDrawer
          product={detailProduct}
          onClose={() => setDetailProductId("")}
          onFix={() => {
            setDetailProductId("");
            onOpenProduct(detailProduct.id);
          }}
        />
      ) : null}
    </div>
  );
}

function DraftDetailDrawer({
  product,
  onClose,
  onFix,
}: {
  product: ProductRecord;
  onClose: () => void;
  onFix: () => void;
}) {
  const errors = product.stage === "error" ? product.errors : getProductErrors(product);
  const checks: Array<{ label: string; passed: boolean }> = [
    { label: "标题长度", passed: Boolean(product.title.trim()) },
    { label: "类目选择", passed: Boolean(product.facts.categoryId.trim()) },
    { label: "AI 内容确认", passed: product.aiConfirmed },
    { label: "价格信息", passed: Boolean(product.facts.price.trim()) },
    { label: "MOQ", passed: Boolean(product.facts.moq.trim()) },
    { label: "库存数量", passed: Boolean(product.facts.stock.trim()) },
    {
      label: "包装尺寸",
      passed: Boolean(
        product.facts.packageLength.trim() &&
          product.facts.packageWidth.trim() &&
          product.facts.packageHeight.trim(),
      ),
    },
    { label: "包装毛重", passed: Boolean(product.facts.grossWeight.trim()) },
    { label: "发货期", passed: Boolean(product.facts.leadTime.trim()) },
    { label: "原产地", passed: Boolean(product.facts.origin.trim()) },
    { label: "美国 HS 编码", passed: Boolean(product.facts.hsCode.trim()) },
    { label: "主图就绪", passed: product.images.length > 0 },
  ];
  const passedChecks = checks.filter((check) => check.passed);
  return (
    <aside className="draft-detail-drawer" aria-label="商品校验详情">
      <div className="draft-detail-head">
        <h3>商品校验详情</h3>
        <button type="button" className="icon-button" onClick={onClose}>
          <X size={18} />
          <span className="sr-only">关闭校验详情</span>
        </button>
      </div>
      <div className="draft-detail-product">
        <img src={getMainProductImage(product).url} alt="" />
        <div>
          <strong>{product.title || product.reference}</strong>
          <small>货号：{product.reference}</small>
          {product.facts.categoryLabel ? <small>类目：{product.facts.categoryLabel}</small> : null}
        </div>
      </div>
      <div className="draft-detail-section">
        <h4>校验结果</h4>
        {errors.length ? (
          <SourceBadge source="missing" label="校验失败" />
        ) : (
          <SourceBadge source="trusted" label="校验通过" />
        )}
      </div>
      {errors.length ? (
        <div className="draft-detail-section">
          <h4>不通过项（{errors.length}）</h4>
          <ul className="draft-detail-errors">
            {errors.map((error) => (
              <li key={error}>
                <XCircle size={15} weight="fill" />
                <span>{error}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="button button-dark" onClick={onFix}>
            去修复
          </button>
        </div>
      ) : null}
      <div className="draft-detail-section">
        <h4>通过项（{passedChecks.length}）</h4>
        <ul className="draft-detail-passes">
          {passedChecks.map((check) => (
            <li key={check.label}>
              <span>{check.label}</span>
              <i>通过</i>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function TranslationStep({
  products,
  targetCountries,
  targetLanguages,
  targetMarketCode,
  targetLanguageCode,
  busy,
  onTargetMarketChange,
  onTargetLanguageChange,
  onTranslate,
  onChange,
  onConfirm,
  onConfirmAll,
  onContinue,
}: {
  products: ProductRecord[];
  targetCountries: TargetCountry[];
  targetLanguages: TargetLanguage[];
  targetMarketCode: string;
  targetLanguageCode: string;
  busy: boolean;
  onTargetMarketChange: (code: string) => void;
  onTargetLanguageChange: (code: string) => void;
  onTranslate: () => void;
  onChange: (
    productId: string,
    patch: Partial<
      Pick<ProductTranslation, "title" | "keywords" | "sellingPoints" | "description">
    >,
  ) => void;
  onConfirm: (productId: string) => void;
  onConfirmAll: () => void;
  onContinue: () => void;
}) {
  const [activeProductId, setActiveProductId] = useState(() => products[0]?.id ?? "");
  const market = getTargetMarket(targetMarketCode, targetLanguageCode);
  const countryLanguageCodes = targetMarketCode
    ? (countries[targetMarketCode as TCountryCode]?.languages ?? [])
    : [];
  const countryLanguages = countryLanguageCodes
    .map((code) => targetLanguages.find((language) => language.code === code))
    .filter((language): language is TargetLanguage => Boolean(language));
  const otherLanguages = targetLanguages.filter(
    (language) => !countryLanguageCodes.includes(language.code),
  );
  const activeProduct =
    products.find((product) => product.id === activeProductId) ?? products[0] ?? null;
  const matchingTranslation =
    activeProduct && hasMarketTranslation(activeProduct, market) ? activeProduct.translation : null;
  const translatedCount = products.filter((product) =>
    hasMarketTranslation(product, market),
  ).length;
  const confirmedCount = products.filter(
    (product) => hasMarketTranslation(product, market) && product.translation.confirmed,
  ).length;
  const allTranslated = products.length > 0 && translatedCount === products.length;
  const allConfirmed = products.length > 0 && confirmedCount === products.length;

  useEffect(() => {
    if (products.length && !products.some((product) => product.id === activeProductId)) {
      setActiveProductId(products[0].id);
    }
  }, [activeProductId, products]);

  return (
    <div className="step-page translation-step">
      <div className="step-heading">
        <div>
          <h2>翻译为目标市场语言</h2>
        </div>
        <span className="quiet-stat">
          仅翻译标题、关键词、卖点和详情；价格、SKU、物流与合规事实不变
        </span>
      </div>

      <div className="translation-market-bar">
        <label>
          <span>目标国家 / 市场</span>
          <select
            value={targetMarketCode}
            onChange={(event) => onTargetMarketChange(event.target.value)}
          >
            <option value="">请选择国家或地区</option>
            {targetCountries.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>目标语言</span>
          <select
            value={targetLanguageCode}
            onChange={(event) => onTargetLanguageChange(event.target.value)}
            disabled={!targetMarketCode}
          >
            <option value="">请选择目标语言</option>
            {countryLanguages.length ? (
              <optgroup label="该国家 / 地区常用语言">
                {countryLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="其他语言">
              {otherLanguages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </optgroup>
          </select>
          <small>{market ? `发布文案语言：${market.languageCode}` : "可覆盖系统推荐语言"}</small>
        </label>
        <div className="translation-scope">
          <span>翻译范围</span>
          <strong>标题 · 关键词 · 卖点 · 商品详情</strong>
          <small>类目枚举和业务事实继续使用 Alibaba API 原值</small>
        </div>
        <button
          type="button"
          className="button button-dark translation-run"
          onClick={onTranslate}
          disabled={!market || busy || !products.length}
        >
          {busy ? <CircleNotch size={17} className="spin" /> : <Translate size={17} />}
          {busy ? "正在翻译" : translatedCount ? "重新生成翻译" : "自动翻译全部"}
        </button>
      </div>

      <div className="translation-status-strip">
        <span>
          <strong>{products.length}</strong>
          待处理草稿
        </span>
        <span>
          <strong>{translatedCount}</strong>
          已生成翻译
        </span>
        <span className={allConfirmed ? "is-complete" : ""}>
          <strong>{confirmedCount}</strong>
          已人工确认
        </span>
        <p>
          <WarningCircle size={15} weight="fill" />
          AI 翻译不会改写数字、单位、型号、材质或认证；正式发布前仍需逐项核对。
        </p>
      </div>

      <div className="translation-workspace">
        <div className="translation-product-list">
          {products.map((product) => {
            const translation = hasMarketTranslation(product, market) ? product.translation : null;
            return (
              <button
                type="button"
                key={product.id}
                className={product.id === activeProduct?.id ? "is-active" : ""}
                onClick={() => setActiveProductId(product.id)}
              >
                <img src={getMainProductImage(product).url} alt="" />
                <span>
                  <strong>{product.title || product.reference}</strong>
                  <small>{product.reference}</small>
                </span>
                {translation?.confirmed ? (
                  <CheckCircle size={17} weight="fill" />
                ) : translation ? (
                  <WarningCircle size={17} weight="fill" />
                ) : (
                  <Translate size={17} />
                )}
              </button>
            );
          })}
        </div>

        <div className="translation-editor">
          {activeProduct && matchingTranslation ? (
            <>
              <div className="translation-editor-head">
                <span>
                  <small>{activeProduct.reference}</small>
                  <strong>
                    {matchingTranslation.targetMarketLabel} ·{" "}
                    {matchingTranslation.targetLanguageLabel}
                  </strong>
                </span>
                <SourceBadge
                  source={matchingTranslation.confirmed ? "trusted" : "ai"}
                  label={matchingTranslation.confirmed ? "人工已确认" : "AI 翻译待确认"}
                />
              </div>
              <div className="translation-field">
                <span>商品标题</span>
                <div className="translation-pair">
                  <p>{activeProduct.title}</p>
                  <textarea
                    rows={2}
                    value={matchingTranslation.title}
                    onChange={(event) => onChange(activeProduct.id, { title: event.target.value })}
                  />
                </div>
              </div>
              <div className="translation-field">
                <span>关键词</span>
                <div className="translation-pair">
                  <p>{activeProduct.keywords.join(" · ") || "—"}</p>
                  <textarea
                    rows={2}
                    value={matchingTranslation.keywords.join(", ")}
                    onChange={(event) =>
                      onChange(activeProduct.id, {
                        keywords: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
              </div>
              <div className="translation-field">
                <span>核心卖点</span>
                <div className="translation-pair">
                  <p>{activeProduct.sellingPoints.join("\n") || "—"}</p>
                  <textarea
                    rows={4}
                    value={matchingTranslation.sellingPoints.join("\n")}
                    onChange={(event) =>
                      onChange(activeProduct.id, {
                        sellingPoints: event.target.value
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
              </div>
              <div className="translation-field">
                <span>商品详情</span>
                <div className="translation-pair">
                  <p>{activeProduct.description || "—"}</p>
                  <textarea
                    rows={5}
                    value={matchingTranslation.description}
                    onChange={(event) =>
                      onChange(activeProduct.id, { description: event.target.value })
                    }
                  />
                </div>
              </div>
              <div className="translation-editor-actions">
                <small>左侧为已确认原文，右侧为正式发布候选译文。</small>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => onConfirm(activeProduct.id)}
                  disabled={!matchingTranslation.title.trim() || matchingTranslation.confirmed}
                >
                  <Check size={16} />
                  {matchingTranslation.confirmed ? "当前译文已确认" : "确认当前译文"}
                </button>
              </div>
            </>
          ) : (
            <div className="translation-empty">
              <Translate size={28} />
              <strong>{market ? `尚未生成${market.languageLabel}版本` : "先选择目标国家"}</strong>
              <p>点击“自动翻译全部”后，在这里逐项核对原文和译文。</p>
            </div>
          )}
        </div>
      </div>

      <div className="translation-bottom-bar">
        <span>
          {allConfirmed
            ? "全部译文已人工确认，发布时将使用目标语言文案。"
            : `还需确认 ${products.length - confirmedCount} 个商品的译文。`}
        </span>
        <div>
          <button
            type="button"
            className="button button-secondary"
            onClick={onConfirmAll}
            disabled={!allTranslated || allConfirmed}
          >
            <CheckSquare size={16} />
            确认全部译文
          </button>
          <button
            type="button"
            className="button button-primary button-large"
            onClick={onContinue}
            disabled={!allConfirmed}
          >
            进入回读发布
            <ArrowRight size={17} />
          </button>
        </div>
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
  targetLanguage,
  onSelect,
  onPublish,
  onPublishOne,
  onRetry,
  onRetryVideo,
  onAcceptReadback,
  onFix,
}: {
  products: ProductRecord[];
  selected: Set<string>;
  publishCount: number;
  storeName: string;
  unit: string;
  currency: string;
  targetLanguage: string;
  onSelect: (id: string) => void;
  onPublish: () => void;
  onPublishOne: (id: string) => void;
  onRetry: (id: string) => void;
  onRetryVideo: (id: string) => void;
  onAcceptReadback: (id: string) => void;
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

  const exportResults = () => {
    const header = ["商品ID", "货号", "标题", "店铺", "状态", "错误信息"];
    const escapeCsvValue = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const lines = rows.map((product) =>
      [
        product.draftProductId ?? "",
        product.reference,
        product.translation?.confirmed ? product.translation.title : product.title,
        storeName,
        product.stage === "published"
          ? "已发布"
          : product.stage === "publishing"
            ? "发布中"
            : product.stage === "error"
              ? "失败"
              : "草稿待发布",
        product.errors.join("；"),
      ]
        .map(escapeCsvValue)
        .join(","),
    );
    const blob = new Blob(
      [`\uFEFF${[header.map(escapeCsvValue).join(","), ...lines].join("\n")}`],
      {
        type: "text/csv;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "readback-results.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="step-page preview-step">
      <div className="step-heading">
        <div>
          <h2>回读草稿并发布</h2>
          <small>发布文案：{targetLanguage || "未选择目标语言"}</small>
        </div>
        <div className="readback-head-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={exportResults}
            disabled={!rows.length}
          >
            导出结果
          </button>
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
      </div>

      <div className={`publish-banner ${failed ? "has-failures" : ""}`}>
        {failed ? (
          <WarningCircle size={22} weight="fill" />
        ) : (
          <CheckCircle size={22} weight="fill" />
        )}
        <p>
          本批 {succeeded}/{rows.length} 个草稿创建成功
          {failed ? (
            <>
              {" "}
              · <strong>{failed}</strong> 个失败可重试，展开失败行可查看 Alibaba 返回的具体错误
            </>
          ) : null}
        </p>
      </div>

      {rows.length ? (
        <div className="readback-results">
          <div className="draft-table-wrap">
            <table className="draft-table readback-table">
              <thead>
                <tr>
                  <th aria-label="选择" />
                  <th>商品 ID</th>
                  <th>标题</th>
                  <th>店铺</th>
                  <th>价格</th>
                  <th>发布状态</th>
                  <th>Alibaba 商品链接</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => {
                  const canPublish = product.stage === "drafted" && product.draftReadbackVerified;
                  const isFailed = product.stage === "error";
                  const isExpanded = expanded.has(product.id);
                  const productUrl =
                    product.stage === "published" && product.draftProductId
                      ? `https://www.alibaba.com/product-detail/${product.draftProductId}.html`
                      : "";
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
                        <td className="is-numeric">{product.draftProductId ?? "—"}</td>
                        <td>
                          <div className="draft-table-product">
                            <img src={getMainProductImage(product).url} alt="" />
                            <span>
                              <strong>
                                {product.translation?.confirmed
                                  ? product.translation.title
                                  : product.title || product.reference}
                              </strong>
                              <small>{product.reference}</small>
                            </span>
                          </div>
                        </td>
                        <td>{storeName || "—"}</td>
                        <td className="is-numeric">
                          {product.facts.price
                            ? `${currency || "USD"} ${product.facts.price}${unit ? ` / ${unit}` : ""}`
                            : "—"}
                        </td>
                        <td>{statusBadge(product)}</td>
                        <td>
                          {productUrl ? (
                            <a
                              className="readback-link"
                              href={productUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {productUrl}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <div className="readback-actions">
                            {canPublish ? (
                              <button
                                type="button"
                                className="row-action is-primary"
                                onClick={() => onPublishOne(product.id)}
                              >
                                发布
                              </button>
                            ) : null}
                            {isFailed ? (
                              <button
                                type="button"
                                className="row-action is-danger"
                                onClick={() => onRetry(product.id)}
                              >
                                重试
                              </button>
                            ) : null}
                            {product.videoRelationErrors?.length ? (
                              <button
                                type="button"
                                className="row-action is-danger"
                                onClick={() => onRetryVideo(product.id)}
                              >
                                重试视频关联
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="row-action"
                              onClick={() => toggleExpanded(product.id)}
                            >
                              {isExpanded ? "收起" : "查看"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="readback-detail-row">
                          <td colSpan={8}>
                            {isFailed && product.errors.length ? (
                              <div className="readback-failure">
                                <div className="readback-errors">
                                  <strong>失败原因（Alibaba 通道）</strong>
                                  <ul>
                                    {product.errors.map((error) => (
                                      <li key={error}>{error}</li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="readback-suggestion">
                                  <strong>修复建议</strong>
                                  <p>
                                    1. 请进入「补齐事实」步骤，检查并补充缺失的类目属性与交易信息；
                                  </p>
                                  <p>2. 修改完成后回到本页点击「重试」重新创建草稿。</p>
                                  <button
                                    type="button"
                                    className="button button-dark"
                                    onClick={() => onFix(product.id)}
                                  >
                                    去补齐事实
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="readback-detail-grid">
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
                                <ReadbackDiff
                                  product={product}
                                  onAcceptChanges={() => onAcceptReadback(product.id)}
                                />
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
          <div className="readback-pagination">
            <span>共 {rows.length} 条</span>
            <select aria-label="每页条数" defaultValue="20">
              <option value="20">20 条 / 页</option>
            </select>
            <div>
              <button type="button" disabled aria-label="上一页">
                <CaretLeft size={13} />
              </button>
              <button type="button" className="is-current">
                1
              </button>
              <button type="button" disabled aria-label="下一页">
                <CaretRight size={13} />
              </button>
            </div>
          </div>
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
    return "AI 识别并继续";
  }
  if (step === 1) {
    return aiPending ? `请先确认剩余 ${aiPending} 项` : "继续补齐资料";
  }
  if (step === 2) {
    return "资料完成，创建草稿";
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
  const schemaImageLimit = getSchemaMainImageLimit(product);
  if (schemaImageLimit) {
    const mainImage = getMainProductImage(product);
    const orderedImages = [
      mainImage,
      ...product.images.filter((image) => image.id !== mainImage.id),
    ];
    for (const image of orderedImages.slice(0, 6)) {
      const size = image.fileSize ?? image.sourceFile?.size;
      if (size && size > schemaImageLimit) {
        errors.push(
          `${image.name} 超过当前 Alibaba 类目主图限制（${formatFileSize(schemaImageLimit)}）`,
        );
      }
    }
  }
  return errors;
}

function getSchemaMainImageLimit(product: ProductRecord): number | undefined {
  return product.schemaGuidance?.main_image_max_size_bytes;
}

function formatFileSize(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function getRequiredSchemaFields(product: ProductRecord): SchemaFieldGuidance[] {
  if (!product.schemaGuidance) {
    return [];
  }
  const requiredIds = new Set(product.schemaGuidance.required_field_ids);
  const fields = getAllSchemaFields(product);
  const byId = new Map(
    fields.filter((field) => requiredIds.has(field.field)).map((field) => [field.field, field]),
  );
  for (const field of requiredIds) {
    if (!byId.has(field)) {
      byId.set(field, {
        field,
        required: true,
        manual_fact: true,
        responsibility: "merchant",
        responsibility_label: "客户填写",
        responsibility_reason: "API 返回必填字段，但未提供可安全自动填充的依据",
        allowed_sources: ["user_provided", "user_confirmed", "business_system"],
        options: [],
        value_attributes: [],
        conditional_disable: [],
        supported: false,
        support_message: "API 返回必填字段，但缺少可渲染的字段定义，请重新拉取实时 Schema",
      });
    }
  }
  return Array.from(byId.values()).filter((field) => !isSchemaFieldDisabled(product, field));
}

function getAllSchemaFields(product: ProductRecord): SchemaFieldGuidance[] {
  if (!product.schemaGuidance) {
    return [];
  }
  const fields = [
    ...product.schemaGuidance.ai_fillable_fields,
    ...product.schemaGuidance.manual_fact_fields,
  ];
  return Array.from(new Map(fields.map((field) => [field.field, field])).values());
}

function isSchemaFieldDisabled(product: ProductRecord, field: SchemaFieldGuidance): boolean {
  const groups = field.conditional_disable ?? [];
  if (!groups.length) {
    return false;
  }
  return groups.some((group) => {
    const matches = group.expressions.map((expression) =>
      schemaDependencyMatches(
        product,
        expression.field_id,
        expression.symbol,
        expression.value ?? "",
      ),
    );
    return group.operator === "or" ? matches.some(Boolean) : matches.every(Boolean);
  });
}

function schemaDependencyMatches(
  product: ProductRecord,
  dependencyFieldId: string,
  symbol: string,
  expected: string,
): boolean {
  const dependencyField = getAllSchemaFields(product).find(
    (candidate) =>
      !candidate.repeatable_group &&
      !candidate.repeatable_groups?.length &&
      (candidate.field === dependencyFieldId || schemaFieldLeafId(candidate) === dependencyFieldId.toLowerCase()),
  );
  const rawValue = dependencyField ? getSchemaFieldValue(product, dependencyField) : undefined;
  const values = Array.isArray(rawValue)
    ? rawValue.map(schemaScalarText).filter(Boolean)
    : [schemaScalarText(rawValue)].filter(Boolean);
  const comparable = Array.isArray(rawValue) ? values : values[0] ?? "";
  if (symbol === "is null") {
    return values.length === 0;
  }
  if (symbol === "contains" || symbol === "not contains") {
    const contains = Array.isArray(comparable)
      ? comparable.includes(expected)
      : comparable.includes(expected);
    return symbol === "contains" ? contains : !contains;
  }
  if (symbol === "==" || symbol === "!=") {
    const equal = String(comparable) === expected;
    return symbol === "==" ? equal : !equal;
  }
  if ([">", "<", ">=", "<="].includes(symbol)) {
    const left = Number(comparable);
    const right = Number(expected);
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return false;
    }
    if (symbol === ">") return left > right;
    if (symbol === "<") return left < right;
    if (symbol === ">=") return left >= right;
    return left <= right;
  }
  if (symbol.includes("value in fieldOptions") || symbol.includes("value not in fieldOptions")) {
    const allowed = new Set((dependencyField?.options ?? []).map((option) => option.value));
    const inOptions = values.length > 0 && values.every((value) => allowed.has(value));
    return symbol.includes(" not in ") ? !inOptions : inOptions;
  }
  return false;
}

function hasRepeatableSchemaFieldValue(
  product: ProductRecord,
  field: SchemaFieldGuidance,
): boolean {
  const groups = schemaRepeatableGroups(field);
  const outerGroup = groups[0] ?? field.repeatable_group;
  if (!outerGroup) {
    return hasSchemaValue(getSchemaFieldValue(product, field));
  }
  const rows = repeatableGroupValue(product, outerGroup);
  if (!rows.length) {
    return false;
  }
  const relativePath = field.field.slice(outerGroup.length + 1).split(".");
  const values = collectRepeatableFieldValues(rows, relativePath);
  return values.length > 0 && values.every(hasSchemaValue);
}

function getFactErrors(product: ProductRecord): string[] {
  const schemaFields = getRequiredSchemaFields(product);
  if (product.schemaGuidance) {
    const errors = schemaFields
      .filter((field) =>
        field.repeatable_group || field.repeatable_groups?.length
          ? !hasRepeatableSchemaFieldValue(product, field)
          : !hasSchemaValue(getSchemaFieldValue(product, field)),
      )
      .map((field) => `${schemaFieldLabel(field)}缺失`);
    if (!product.facts.categoryId.trim()) {
      errors.unshift("最终叶子类目缺失");
    }
    if (!product.title.trim()) {
      errors.push("商品标题缺失");
    }
    errors.push(...getSkuErrors(product));
    errors.push(...getPriceModeErrors(product));
    errors.push(...getSemiManagedErrors(product));
    return Array.from(new Set(errors));
  }
  if (!product.isDemo) {
    const errors = [
      product.facts.categoryId.trim() ? "类目实时必填字段未加载" : "最终叶子类目缺失",
    ];
    if (!product.title.trim()) {
      errors.push("商品标题缺失");
    }
    return errors;
  }
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

function getSkuErrors(product: ProductRecord): string[] {
  const rows = product.facts.skuRows ?? [];
  if (!rows.length) {
    return selectedSchemaPriceMode(product) === "3"
      ? ["SKU 计价模式必须先从真实销售属性生成并填写至少一个 SKU"]
      : [];
  }
  const errors: string[] = [];
  if (!findOfficialSkuGroupPath(product)) {
    errors.push("当前 Alibaba 类目未返回 SKU 组件");
    return errors;
  }
  if (rows.some((row) => !row.propertyValues?.length)) {
    errors.push("SKU 规格尚未与 Alibaba 销售属性同步");
  }
  if (rows.some((row) => !row.price.trim() || Number(row.price) <= 0)) {
    errors.push("SKU 价格必须为大于 0 的真实数值");
  }
  if (
    rows.some(
      (row) =>
        !row.stock.trim() ||
        !Number.isInteger(Number(row.stock)) ||
        Number(row.stock) < 0,
    )
  ) {
    errors.push("SKU 库存必须为不小于 0 的整数");
  }
  const combinations = rows
    .filter((row) => row.propertyValues?.length)
    .map((row) => officialSkuCombinationKey(row.propertyValues ?? []));
  if (new Set(combinations).size !== combinations.length) {
    errors.push("SKU 销售属性组合不能重复");
  }
  const codes = rows.map((row) => row.sku.trim()).filter(Boolean);
  if (new Set(codes).size !== codes.length) {
    errors.push("SKU 编码不能重复");
  }
  return errors;
}

function selectedSchemaPriceMode(product: ProductRecord): string {
  const field = getAllSchemaFields(product).find(
    (candidate) => candidate.field === "scPrice",
  );
  return field ? schemaScalarText(getSchemaFieldValue(product, field)) : "";
}

function getPriceModeErrors(product: ProductRecord): string[] {
  const mode = selectedSchemaPriceMode(product);
  const fields = getAllSchemaFields(product);
  const requiredPaths =
    mode === "1"
      ? [
          "ladderPrice.ladderPrice_0.quantity",
          "ladderPrice.ladderPrice_0.price",
        ]
      : mode === "2"
        ? ["fob.range_min", "fob.range_max", "fob.unit_type"]
        : [];
  return requiredPaths.flatMap((path) => {
    const field = fields.find((candidate) => candidate.field === path);
    if (!field || hasSchemaValue(getSchemaFieldValue(product, field))) {
      return [];
    }
    return [`${schemaFieldLabel(field)}缺失`];
  });
}

function isActivePriceModeField(
  field: SchemaFieldGuidance,
  product: ProductRecord,
): boolean {
  const mode = selectedSchemaPriceMode(product);
  if (mode === "1") {
    return field.field.startsWith("ladderPrice.ladderPrice_0.");
  }
  if (mode === "2") {
    return field.field.startsWith("fob.");
  }
  return false;
}

function getSemiManagedErrors(product: ProductRecord): string[] {
  const fields = getAllSchemaFields(product);
  const semiManagedField = fields.find((field) =>
    schemaFieldSearchText(field).includes("semimanaged"),
  );
  if (!semiManagedField) {
    return [];
  }
  const semiManagedValue = schemaScalarText(getSchemaFieldValue(product, semiManagedField)).toLowerCase();
  if (!["true", "1", "yes"].includes(semiManagedValue)) {
    return [];
  }
  const boxField = fields.find(
    (field) => isBoxPackagingField(field) && !field.field.toLowerCase().includes("sku."),
  );
  if (!boxField || !boxField.options.length) {
    return ["半托管商品需要箱规；请先在 Alibaba 后台创建箱规并重新加载"];
  }
  const values = getSchemaFieldValue(product, boxField);
  if (!Array.isArray(values) || !values.length) {
    return ["半托管商品必须选择至少一个箱规"];
  }
  if (
    values.some((item) => {
      const attributed = schemaAttributedValue(item);
      return !attributed.attributes.maxCount || !attributed.attributes.totalWeight;
    })
  ) {
    return ["箱规必须填写每箱数量和装满后总重"];
  }
  return [];
}

function schemaFieldLabel(field: SchemaFieldGuidance): string {
  if (field.name?.trim()) {
    return field.name.trim();
  }
  const text = schemaFieldSearchText(field);
  if (text.includes("fobrangemin")) {
    return "最低报价";
  }
  if (text.includes("fobrangemax")) {
    return "最高报价";
  }
  if (text.includes("fobunittype")) {
    return "报价币种";
  }
  if (text.includes("shippingtemplatetemplatetype")) {
    return "运费方式";
  }
  if (text.includes("scprice")) {
    return "价格模式";
  }
  return field.field;
}

function schemaFieldSearchText(field: SchemaFieldGuidance): string {
  return `${field.field} ${field.name ?? ""}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function schemaFieldLeafId(field: SchemaFieldGuidance): string {
  return (field.field.split(".").at(-1) ?? field.field).toLowerCase();
}

function isMainVideoSchemaField(field: SchemaFieldGuidance): boolean {
  return schemaFieldLeafId(field) === "imagevideo";
}

function isDetailVideoSchemaField(field: SchemaFieldGuidance): boolean {
  return schemaFieldLeafId(field) === "detailvideo";
}

function isVideoSchemaField(field: SchemaFieldGuidance): boolean {
  return isMainVideoSchemaField(field) || isDetailVideoSchemaField(field);
}

function schemaFactKey(field: SchemaFieldGuidance): keyof ProductRecord["facts"] | null {
  const text = schemaFieldSearchText(field);
  if (
    text.includes("fobrangemin") ||
    text.includes("fobrangemax") ||
    text.includes("ladderpriceprice") ||
    text.includes("singleprice") ||
    text.includes("单件价格")
  ) {
    return "price";
  }
  if (
    text.includes("ladderpricequantity") ||
    text.includes("ladderperiodquantity") ||
    text.includes("minimumorder") ||
    text.includes("最小起订") ||
    text.includes("起订量")
  ) {
    return "moq";
  }
  if (text.includes("inventory") || text.includes("stock") || text.includes("库存")) {
    return "stock";
  }
  if (
    text.includes("pkgmeasurelength") ||
    text.includes("packagelength") ||
    text.includes("包装长度") ||
    text.includes("长宽高长")
  ) {
    return "packageLength";
  }
  if (
    text.includes("pkgmeasurewidth") ||
    text.includes("packagewidth") ||
    text.includes("包装宽度") ||
    text.includes("长宽高宽")
  ) {
    return "packageWidth";
  }
  if (
    text.includes("pkgmeasureheight") ||
    text.includes("packageheight") ||
    text.includes("包装高度") ||
    text.includes("长宽高高")
  ) {
    return "packageHeight";
  }
  if (
    text.includes("pkgweight") ||
    text.includes("grossweight") ||
    text.includes("packageweight") ||
    text.includes("毛重")
  ) {
    return "grossWeight";
  }
  if (
    text.includes("ladderperiodday") ||
    text.includes("leadtime") ||
    text.includes("deliverytime") ||
    text.includes("预计时间") ||
    text.includes("发货期")
  ) {
    return "leadTime";
  }
  if (
    text.includes("placeoforigin") ||
    text.includes("countryoforigin") ||
    text.includes("原产地")
  ) {
    return "origin";
  }
  if (text.includes("tariffshscode") || text.includes("hscode") || text.includes("hs编码")) {
    return "hsCode";
  }
  if (text.includes("material") || text.includes("材质")) {
    return "material";
  }
  if (text.includes("model") || text.includes("型号")) {
    return "model";
  }
  if (text.includes("brand") || text.includes("品牌")) {
    return "brand";
  }
  return null;
}

function getSchemaFieldValue(product: ProductRecord, field: SchemaFieldGuidance): unknown {
  const schemaValue = product.schemaFields?.[field.field]?.value;
  if (hasSchemaValue(schemaValue)) {
    return schemaValue;
  }
  const factKey = schemaFactKey(field);
  if (factKey) {
    return product.facts[factKey];
  }
  const text = schemaFieldSearchText(field);
  if (isTitleSchemaField(field)) {
    return product.title;
  }
  if (isImageSchemaField(field)) {
    return product.images;
  }
  if (text.includes("categoryid") || text.includes("catid") || text.includes("叶子类目")) {
    return product.facts.categoryId;
  }
  return schemaValue;
}

function schemaFactTextValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value) && (typeof value[0] === "string" || typeof value[0] === "number")) {
    return String(value[0]);
  }
  return null;
}

function isTitleSchemaField(field: SchemaFieldGuidance): boolean {
  const text = schemaFieldSearchText(field);
  return (
    text.includes("producttitle") ||
    text.includes("subject") ||
    text.includes("商品名称") ||
    text.includes("商品标题")
  );
}

function isBoxPackagingField(field: SchemaFieldGuidance): boolean {
  return schemaFieldSearchText(field).includes("boxpackaging");
}

function isImageSchemaField(field: SchemaFieldGuidance): boolean {
  const text = schemaFieldSearchText(field);
  return (
    text.includes("scimages") ||
    text.includes("detailimage") ||
    text.includes("productimage") ||
    text.includes("产品图片") ||
    text.includes("商品图片")
  );
}

function hasSchemaValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function schemaFieldControlLabel(field: SchemaFieldGuidance): string {
  if (field.supported === false) {
    return "需处理";
  }
  if (field.type === "singleCheck") {
    return field.async_options && !field.options.length
      ? "动态单选"
      : `单选 ${field.options.length} 项`;
  }
  if (field.type === "multiCheck") {
    return field.async_options && !field.options.length
      ? "动态多选"
      : `多选 ${field.options.length} 项`;
  }
  if (field.type === "multiInput") {
    return "多值输入";
  }
  if (field.type === "complex") {
    return "组合字段";
  }
  if (field.type === "multiComplex") {
    return "多组字段";
  }
  const valueTypeLabels: Record<string, string> = {
    double: "小数",
    decimal: "小数",
    integer: "整数",
    long: "长整数",
    date: "日期",
    url: "网址",
    textarea: "多行文本",
    html: "HTML 内容",
    text: "文本输入",
  };
  return valueTypeLabels[field.value_type || "text"] || "未知类型";
}

function schemaDefaultForField(field: SchemaFieldGuidance, settings: StoreSettings): string | null {
  const text = schemaFieldSearchText(field);
  if (text.includes("priceunit") || text.includes("计量单位")) {
    return schemaOptionValue(field, settings.priceUnit);
  }
  if (text.includes("currency") || text.includes("币种") || text.includes("fobunittype")) {
    return schemaOptionValue(field, settings.currency);
  }
  if (text.includes("shippingtemplatetemplatetype") && settings.shippingTemplateId) {
    return schemaOptionValue(field, "aliLogistics");
  }
  if (
    text.includes("shippingtemplateid") ||
    text.includes("运费模板id") ||
    text.includes("运费模板编号")
  ) {
    return settings.shippingTemplateId || null;
  }
  if (text.includes("warehouse") || text.includes("仓库")) {
    return settings.warehouseId || null;
  }
  if (text.includes("productgroup") || text.includes("商品分组")) {
    return settings.productGroupId || null;
  }
  if (text.includes("photobankgroup") || text.includes("图片银行分组")) {
    return settings.photoBankGroupId || null;
  }
  if (text.includes("inventorycode") || text.includes("库存地点")) {
    return settings.inventoryCode || null;
  }
  if (
    text.includes("placeoforigin") ||
    text.includes("countryoforigin") ||
    text.includes("原产地")
  ) {
    return schemaOptionValue(field, settings.origin);
  }
  return null;
}

function isShippingTemplateIdField(field: SchemaFieldGuidance): boolean {
  const text = schemaFieldSearchText(field);
  return (
    text.includes("shippingtemplateid") ||
    text.includes("运费模板id") ||
    text.includes("运费模板编号")
  );
}

function schemaOptionValue(field: SchemaFieldGuidance, setting: string): string | null {
  return (
    resolveSchemaOptionValue(field.options, setting) ?? (field.options.length ? null : setting)
  );
}

function normalizeSchemaChoiceValue(field: SchemaFieldGuidance, value: unknown): unknown {
  if (field.type !== "singleCheck" && field.type !== "multiCheck") {
    return value;
  }
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.map((item, index) => {
    if (typeof item !== "string" && typeof item !== "number") {
      return item;
    }
    const text = String(item).trim();
    if (!text) {
      return item;
    }
    const option = field.options.find((candidate) => schemaOptionMatches(candidate, text));
    if (option) {
      return option.value;
    }
    if ((field.value_attributes ?? []).includes("inputValue")) {
      return {
        value: String(-(index + 1)),
        attributes: { inputValue: text },
      };
    }
    return item;
  });
  return field.type === "multiCheck" ? normalized : normalized[0];
}

function syncProductSchemaFields(product: ProductRecord, settings: StoreSettings): ProductRecord {
  if (!product.schemaGuidance) {
    return product;
  }
  const schemaFields = { ...product.schemaFields };
  for (const field of getAllSchemaFields(product)) {
    if (
      isSchemaFieldDisabled(product, field) &&
      !field.repeatable_group &&
      !field.repeatable_groups?.length
    ) {
      delete schemaFields[field.field];
    }
  }
  const fieldsToSync = new Map(
    [
      ...getRequiredSchemaFields(product),
      ...getAllSchemaFields(product).filter(
        (field) =>
          !isSchemaFieldDisabled(product, field) &&
          (schemaDefaultForField(field, settings) !== null ||
            isSafeFactSyncField(field, product)),
      ),
    ].map((field) => [field.field, field]),
  );
  for (const field of fieldsToSync.values()) {
    if (isImageSchemaField(field)) {
      const text = schemaFieldSearchText(field);
      if (!text.includes("scimages") && hasSchemaValue(schemaFields[field.field]?.value)) {
        continue;
      }
      const imageValue = schemaImageValue(field, product);
      if (imageValue) {
        schemaFields[field.field] = {
          value: imageValue,
          source: "user_confirmed",
        };
      }
      continue;
    }
    if (hasSchemaValue(schemaFields[field.field]?.value)) {
      continue;
    }
    const defaultValue =
      field.responsibility === "store_default" ? schemaDefaultForField(field, settings) : null;
    if (defaultValue) {
      schemaFields[field.field] = {
        value: normalizeSchemaChoiceValue(field, defaultValue),
        source: schemaFactKey(field) === "origin" ? "business_system" : "account_default",
      };
      continue;
    }
    const value = schemaSubmissionValue(
      field,
      getSchemaFieldValue(product, field),
      settings,
    );
    if (!hasSchemaValue(value)) {
      continue;
    }
    schemaFields[field.field] = {
      value: normalizeSchemaChoiceValue(field, value),
      source:
        field.responsibility === "ai_candidate"
          ? product.aiConfirmed
            ? "user_confirmed"
            : "ai_generated"
          : "user_provided",
      requires_confirmation: field.responsibility === "ai_candidate" && !product.aiConfirmed,
    };
  }
  const skuGroupPath = findOfficialSkuGroupPath(product);
  const skuRows = product.facts.skuRows ?? [];
  if (
    skuGroupPath &&
    skuRows.length &&
    skuRows.every((row) => row.propertyValues?.length) &&
    !hasSchemaValue(schemaFields[skuGroupPath]?.value)
  ) {
    schemaFields[skuGroupPath] = {
      value: buildOfficialSkuSchemaRows(skuRows),
      source: "user_provided",
    };
  }
  return { ...product, schemaFields };
}

function isSafeFactSyncField(
  field: SchemaFieldGuidance,
  product: ProductRecord,
): boolean {
  if (field.repeatable_group || field.repeatable_groups?.length) {
    return false;
  }
  const factKey = schemaFactKey(field);
  if (!factKey) {
    return false;
  }
  if (field.field.startsWith("fob.") || field.field.startsWith("ladderPrice.")) {
    return isActivePriceModeField(field, product);
  }
  if (field.field.startsWith("ladderPeriod.")) {
    return field.field.startsWith("ladderPeriod.ladderPeriod_0.");
  }
  return true;
}

function schemaSubmissionValue(
  field: SchemaFieldGuidance,
  value: unknown,
  settings: StoreSettings,
): unknown {
  const attributes = field.value_attributes ?? [];
  if (
    field.type === "multiInput" &&
    schemaFieldSearchText(field).includes("inventory") &&
    attributes.includes("warehouseCode") &&
    attributes.includes("srcValue") &&
    hasSchemaValue(value)
  ) {
    return [
      {
        value: schemaScalarText(value),
        attributes: {
          warehouseCode: settings.inventoryCode || "CN_LOCAL_01",
          srcValue: "0",
        },
      },
    ];
  }
  return value;
}

function schemaImageValue(field: SchemaFieldGuidance, product: ProductRecord): unknown {
  const mainImage = getMainProductImage(product);
  const orderedImages = [
    mainImage,
    ...product.images.filter((image) => image.id !== mainImage.id),
  ];
  const images = orderedImages
    .map((image) =>
      image.photoBankUrl && image.photoBankFileId
        ? { url: image.photoBankUrl, fileId: image.photoBankFileId }
        : null,
    )
    .filter((image): image is { url: string; fileId: string } => image !== null);
  if (!images.length) {
    return null;
  }
  const text = schemaFieldSearchText(field);
  if (text.includes("scimages")) {
    return Object.fromEntries(
      images
        .slice(0, 6)
        .map((image, index) => [
          `scImages_${index}`,
          { value: image.url, attributes: { fileId: image.fileId } },
        ]),
    );
  }
  if (text.includes("detailimage")) {
    return [
      {
        gallery: "350",
        images: images.map((image) => ({
          imageURL: image.url,
          generalText: product.title,
        })),
      },
    ];
  }
  return images.map((image) => ({
    value: image.url,
    attributes: { fileId: image.fileId },
  }));
}

function factErrorLabel(key: keyof ProductRecord["facts"]): string {
  const labels: Partial<Record<keyof ProductRecord["facts"], string>> = {
    categoryId: "最终叶子类目缺失",
    price: "价格缺失",
    moq: "MOQ 缺失",
    stock: "库存缺失",
    packageLength: "包装长度缺失",
    packageWidth: "包装宽度缺失",
    packageHeight: "包装高度缺失",
    grossWeight: "包装毛重缺失",
    leadTime: "发货期缺失",
    origin: "原产地缺失",
    hsCode: "美国 HS 编码缺失",
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
  const categorySuggestion = response.category_suggestions[0];
  const subjectCandidate = findDraftField(generated, ["subject", "title", "english_title"]);
  const keywordCandidate = findDraftField(generated, ["keywords", "keyword"]);
  const descriptionCandidate = findDraftField(generated, [
    "description",
    "detail",
    "product_description",
  ]);
  const sellingPointCandidate = findDraftField(generated, [
    "selling_points",
    "sellingPoints",
    "highlights",
  ]);
  const category = normalizeFieldValue(categorySuggestion);
  const categoryZh = normalizeDisplayValue(categorySuggestion);
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
    analyzedAt: new Date().toISOString(),
    categoryConfidence:
      typeof categorySuggestion?.confidence === "number"
        ? categorySuggestion.confidence
        : product.categoryConfidence,
    categoryEvidence:
      typeof categorySuggestion?.evidence === "string" && categorySuggestion.evidence.trim()
        ? categorySuggestion.evidence
        : product.categoryEvidence,
    stage: "ai_ready",
    schemaFields: {
      ...product.schemaFields,
      ...observed,
      ...generated,
      ...(subjectCandidate
        ? { subject: { ...subjectCandidate, value: title, display_value_zh: titleZh } }
        : {}),
      ...(keywordCandidate
        ? { keywords: { ...keywordCandidate, value: keywords, display_value_zh: keywordsZh } }
        : {}),
      ...(descriptionCandidate
        ? {
            description: {
              ...descriptionCandidate,
              value: description,
              display_value_zh: descriptionZh,
            },
          }
        : {}),
      ...(sellingPointCandidate
        ? {
            selling_points: {
              ...sellingPointCandidate,
              value: sellingPoints,
              display_value_zh: sellingPointsZh,
            },
          }
        : {}),
      ...(categorySuggestion && categoryId
        ? {
            category_id: {
              ...categorySuggestion,
              value: categoryId,
              display_value_zh: categoryZh,
            },
          }
        : {}),
    },
    facts: {
      ...product.facts,
      categoryId,
      categoryLabel,
      categoryLabelZh: typeof categoryZh === "string" ? categoryZh : product.facts.categoryLabelZh,
    },
    errors: [...response.warnings, "AI 内容尚未确认"],
  };
}

function findDraftField(
  fields: Record<string, DraftField>,
  keys: string[],
): DraftField | undefined {
  for (const key of keys) {
    if (fields[key]) {
      return fields[key];
    }
  }
  return undefined;
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

function getReadback(response?: Record<string, unknown>): Record<string, unknown> | undefined {
  const readback = response?._readback;
  return readback && typeof readback === "object" && !Array.isArray(readback)
    ? (readback as Record<string, unknown>)
    : undefined;
}

function getReadbackDifferences(
  response?: Record<string, unknown>,
): DraftFieldDifference[] | undefined {
  const differences = response?._differences;
  if (!Array.isArray(differences)) {
    return undefined;
  }
  return differences.filter((item): item is DraftFieldDifference =>
    Boolean(
      item &&
        typeof item === "object" &&
        "field_path" in item &&
        "status" in item &&
        ((item as { status?: unknown }).status === "changed" ||
          (item as { status?: unknown }).status === "matched"),
    ),
  );
}

function getReadbackError(response?: Record<string, unknown>): string | undefined {
  const error = response?._readback_error;
  return typeof error === "string" && error.trim() ? error : undefined;
}

function ReadbackDiff({
  product,
  onAcceptChanges,
}: {
  product: ProductRecord;
  onAcceptChanges: () => void;
}) {
  if (product.videoRelationErrors?.length) {
    return (
      <div className="readback-diff is-error">
        <strong>草稿已创建，但商品视频未完整关联</strong>
        <ul>
          {product.videoRelationErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
        <p>请检查视频审核状态与应用权限；视频关联成功前不会允许正式发布。</p>
      </div>
    );
  }
  if (product.draftReadbackError) {
    return (
      <div className="readback-diff is-error">
        <strong>平台回读失败，暂不可正式发布</strong>
        <p>{product.draftReadbackError}</p>
      </div>
    );
  }
  const differences = product.draftDifferences ?? [];
  const changed = differences.filter((item) => item.status === "changed");
  return (
    <div className={`readback-diff ${changed.length ? "has-changes" : "is-verified"}`}>
      <strong>
        {changed.length ? `Alibaba 保存后有 ${changed.length} 项变化` : "已完成 Alibaba 草稿回读"}
      </strong>
      {changed.length ? (
        <>
          <p>平台保存结果与提交内容不同；确认这些调整前不会允许正式发布。</p>
          <ul>
            {changed.map((item) => (
              <li key={item.field_path}>
                <b>{item.field_path}</b>
                <span>提交：{readbackValue(item.local_value)}</span>
                <span>平台：{readbackValue(item.platform_value)}</span>
              </li>
            ))}
          </ul>
          {!product.draftReadbackVerified ? (
            <button type="button" className="button button-secondary" onClick={onAcceptChanges}>
              我已核对，接受平台保存结果
            </button>
          ) : (
            <p>已人工确认平台调整，可以进入最终发布确认。</p>
          )}
        </>
      ) : (
        <p>当前可比对字段未发现平台转换；正式发布仍需人工确认。</p>
      )}
    </div>
  );
}

function readbackValue(value: unknown): string {
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "—");
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const ALIBABA_PHOTO_BANK_MAX_BYTES = 5 * 1024 * 1024;
const AI_SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const preparePhotoBankFile = async (blob: Blob, fileName: string): Promise<File> => {
  const declaredType = blob.type.split(";", 1)[0].toLowerCase();
  if (AI_SUPPORTED_IMAGE_TYPES.has(declaredType)) {
    return new File([blob], fileName, { type: declaredType });
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to prepare photo-bank image");
    }
    context.drawImage(bitmap, 0, 0);
    const converted = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value);
        } else {
          reject(new Error("Unable to convert photo-bank image"));
        }
      }, "image/png");
    });
    return new File([converted], fileName.replace(/\.[^.]+$/, ".png"), { type: "image/png" });
  } finally {
    bitmap.close();
  }
};
