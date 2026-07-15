import type {
  AlibabaConnectedStore,
  BatchRecord,
  DraftField,
  ProductFacts,
  ProductImage,
  ProductRecord,
  SchemaFieldGuidance,
  SchemaGuidanceResult,
  StoreSettings,
} from "./types";

const facts = (overrides: Partial<ProductFacts> = {}): ProductFacts => ({
  categoryId: "100003852",
  categoryLabel: "Art Supplies > Painting Supplies > Paint Brushes",
  brand: "Giorgione",
  model: "",
  material: "Nylon Hair",
  price: "",
  moq: "50",
  stock: "",
  productLength: "20",
  productWidth: "2",
  productHeight: "1",
  netWeight: "0.08",
  packageLength: "24",
  packageWidth: "11",
  packageHeight: "3",
  grossWeight: "",
  unitsPerCarton: "100",
  leadTime: "15",
  origin: "China",
  hsCode: "9603301090",
  certifications: [],
  ...overrides,
});

export const defaultSettings: StoreSettings = {
  currency: "",
  priceUnit: "",
  productGroupId: "",
  productGroupLabel: "",
  photoBankGroupId: "",
  photoBankGroupLabel: "",
  warehouseId: "",
  warehouseLabel: "",
  shippingTemplateId: "",
  shippingTemplateLabel: "",
  inventoryCode: "",
  companyProfile: "",
  afterSalesPolicy: "",
  customizationPolicy: "",
  detailTemplate: "",
  brand: "",
  origin: "",
  port: "",
  reuseCompanyProfile: false,
  reuseAfterSales: false,
  reuseCustomization: false,
  reuseDetailTemplate: false,
  reuseOrigin: false,
};

export type StoreTemplateField = {
  key: keyof StoreSettings;
  label: string;
  autoFilledFromStore: boolean;
};

export const requiredStoreTemplateFields: StoreTemplateField[] = [
  { key: "currency", label: "币种", autoFilledFromStore: true },
  { key: "priceUnit", label: "计量单位", autoFilledFromStore: true },
  { key: "productGroupId", label: "商品分组", autoFilledFromStore: true },
  { key: "photoBankGroupId", label: "图片银行分组", autoFilledFromStore: true },
];

export const getMissingStoreTemplateFields = (settings: StoreSettings): StoreTemplateField[] =>
  requiredStoreTemplateFields.filter((field) => {
    const value = settings[field.key];
    return typeof value === "string" ? value.trim() === "" : !value;
  });

export const isStoreTemplateComplete = (settings: StoreSettings): boolean =>
  getMissingStoreTemplateFields(settings).length === 0;

const demoImage = (id: string, url: string): ProductImage => ({
  id,
  url,
  name: url.split("/").at(-1) ?? "product image",
});

const demoGuidanceField = (
  field: string,
  name: string,
  type: string,
  responsibility: SchemaFieldGuidance["responsibility"],
  options: SchemaFieldGuidance["options"] = [],
): SchemaFieldGuidance => {
  const responsibilityCopy = {
    ai_candidate: {
      label: "AI 先填·客户确认",
      reason: "AI 只能生成候选，客户确认后才能提交",
      sources: ["image_extracted", "ai_generated", "user_confirmed"] as const,
    },
    merchant: {
      label: "客户填写",
      reason: "API 未证明该字段可由 AI 安全生成，默认要求客户提供真实值",
      sources: ["user_provided", "user_confirmed", "business_system"] as const,
    },
    business_system: {
      label: "ERP / 客户事实",
      reason: "优先从 ERP、商品档案或供应链系统同步，缺失时由客户填写",
      sources: ["business_system", "user_provided", "user_confirmed"] as const,
    },
    store_default: {
      label: "店铺默认",
      reason: "从已确认的店铺配置带入，客户只需维护一次",
      sources: ["account_default", "user_confirmed", "business_system"] as const,
    },
  }[responsibility];
  return {
    field,
    name,
    type,
    required: true,
    manual_fact: responsibility !== "ai_candidate",
    responsibility,
    responsibility_label: responsibilityCopy.label,
    responsibility_reason: responsibilityCopy.reason,
    allowed_sources: [...responsibilityCopy.sources],
    options,
  };
};

const demoAiSchemaFields = [
  demoGuidanceField("productTitle", "商品标题", "input", "ai_candidate"),
  demoGuidanceField("icbuCatProp.application", "适用场景", "multiCheck", "ai_candidate", [
    { display_name: "墙面涂装", value: "wall" },
    { display_name: "木器涂装", value: "wood" },
    { display_name: "家具翻新", value: "furniture" },
  ]),
];

const demoManualSchemaFields = [
  demoGuidanceField("categoryId", "最终叶子类目", "input", "merchant"),
  demoGuidanceField("icbuCatProp.brand", "品牌", "input", "business_system"),
  demoGuidanceField("icbuCatProp.model", "型号", "input", "business_system"),
  demoGuidanceField("icbuCatProp.material", "刷毛材质", "singleCheck", "business_system", [
    { display_name: "尼龙", value: "nylon" },
    { display_name: "聚酯纤维", value: "polyester" },
    { display_name: "天然鬃毛", value: "natural_bristle" },
  ]),
  demoGuidanceField("icbuCatProp.surfaceType", "适用表面", "singleCheck", "merchant", [
    { display_name: "墙面", value: "wall" },
    { display_name: "木材", value: "wood" },
    { display_name: "金属", value: "metal" },
    { display_name: "多种表面", value: "multi_surface" },
  ]),
  demoGuidanceField("price", "价格", "input", "business_system"),
  demoGuidanceField("currency", "币种", "singleCheck", "store_default", [
    { display_name: "美元 USD", value: "USD" },
    { display_name: "欧元 EUR", value: "EUR" },
    { display_name: "人民币 CNY", value: "CNY" },
  ]),
  demoGuidanceField("fobUnitType", "计量单位", "singleCheck", "store_default", [
    { display_name: "件", value: "Piece/Pieces" },
    { display_name: "套", value: "Set/Sets" },
    { display_name: "箱", value: "Carton/Cartons" },
  ]),
  demoGuidanceField("moq", "最小起订量", "input", "business_system"),
  demoGuidanceField("skuOuterId", "商家 SKU", "input", "business_system"),
  demoGuidanceField("skuStock", "可售库存", "input", "business_system"),
  demoGuidanceField("packageWeight", "包装毛重", "input", "business_system"),
  demoGuidanceField("packageLength", "包装长度", "input", "business_system"),
  demoGuidanceField("packageWidth", "包装宽度", "input", "business_system"),
  demoGuidanceField("packageHeight", "包装高度", "input", "business_system"),
  demoGuidanceField("leadTime", "交期", "input", "business_system"),
  demoGuidanceField("placeOfOrigin", "原产地", "singleCheck", "business_system", [
    { display_name: "中国", value: "CN" },
    { display_name: "越南", value: "VN" },
    { display_name: "印度", value: "IN" },
  ]),
];

const demoSchemaGuidance: SchemaGuidanceResult = {
  ai_fillable_fields: demoAiSchemaFields,
  manual_fact_fields: demoManualSchemaFields,
  required_field_ids: [...demoAiSchemaFields, ...demoManualSchemaFields].map(
    (field) => field.field,
  ),
};

const demoSchemaFields = (
  sku: string,
  productFacts: ProductFacts,
  title: string,
): Record<string, DraftField> => {
  const surfaceNeedsConfirmation = ["BP-ANG-2IN", "BP-LATEX-3P", "BP-FOAM-5P"].includes(sku);
  return {
    productTitle: { value: title, source: "user_confirmed" },
    "icbuCatProp.application": { value: ["wall", "wood"], source: "user_confirmed" },
    categoryId: { value: productFacts.categoryId, source: "user_confirmed" },
    "icbuCatProp.brand": { value: productFacts.brand, source: "business_system" },
    ...(productFacts.model
      ? {
          "icbuCatProp.model": {
            value: productFacts.model,
            source: "business_system" as const,
          },
        }
      : {}),
    "icbuCatProp.material": { value: "nylon", source: "business_system" },
    ...(!surfaceNeedsConfirmation
      ? {
          "icbuCatProp.surfaceType": {
            value: "multi_surface",
            source: "user_confirmed" as const,
          },
        }
      : {}),
    ...(productFacts.price
      ? { price: { value: productFacts.price, source: "business_system" as const } }
      : {}),
    currency: { value: "USD", source: "account_default" },
    fobUnitType: { value: "Set/Sets", source: "account_default" },
    moq: { value: productFacts.moq, source: "business_system" },
    skuOuterId: { value: sku, source: "business_system" },
    ...(productFacts.stock
      ? { skuStock: { value: productFacts.stock, source: "business_system" as const } }
      : {}),
    ...(productFacts.grossWeight
      ? {
          packageWeight: {
            value: productFacts.grossWeight,
            source: "business_system" as const,
          },
        }
      : {}),
    packageLength: { value: productFacts.packageLength, source: "business_system" },
    packageWidth: { value: productFacts.packageWidth, source: "business_system" },
    packageHeight: { value: productFacts.packageHeight, source: "business_system" },
    leadTime: { value: productFacts.leadTime, source: "business_system" },
    placeOfOrigin: { value: "CN", source: "business_system" },
  };
};

export const getMainProductImage = (product: ProductRecord): ProductImage =>
  product.images.find((image) => image.id === product.mainImageId) ?? product.images[0];

const brushCategory = {
  categoryId: "127814008",
  categoryLabel: "工具 > 涂装工具 > 刷子",
  brand: "BrushPro",
};

const demoProduct = (input: {
  id: string;
  sku: string;
  image: string;
  title: string;
  description: string;
  aiConfirmed: boolean;
  stage: ProductRecord["stage"];
  factOverrides: Partial<ProductFacts>;
  errors: string[];
}): ProductRecord => {
  const productFacts = facts({ ...brushCategory, ...input.factOverrides });
  return {
    id: input.id,
    reference: input.sku,
    images: [demoImage(`${input.id}-main`, input.image)],
    mainImageId: `${input.id}-main`,
    title: input.title,
    keywords: ["paint brush", "painting tools", "wall painting"],
    sellingPoints: [input.description, "耐用结构，适合连续涂装", "握持舒适，操作省力"],
    description: input.description,
    visibleTraits: [],
    aiConfirmed: input.aiConfirmed,
    stage: input.stage,
    facts: productFacts,
    errors: input.errors,
    schemaGuidance: demoSchemaGuidance,
    schemaFields: demoSchemaFields(input.sku, productFacts, input.title),
    isDemo: true,
  };
};

export const sampleProducts: ProductRecord[] = [
  demoProduct({
    id: "product-pb-set-09",
    sku: "BP-PB-SET-09",
    image: "/products/fan-brush-set.webp",
    title: "专业级油漆刷套装 9件套 墙面木器涂用 尼龙刷毛",
    description: "适用于乳胶漆、墙面漆等多种涂料，刷毛顺滑不掉毛，手柄舒适省力。",
    aiConfirmed: true,
    stage: "ready",
    factOverrides: {
      model: "PB-SET-09",
      price: "8.99",
      moq: "2",
      stock: "1200",
      grossWeight: "9.80",
    },
    errors: [],
  }),
  demoProduct({
    id: "product-ang-2in",
    sku: "BP-ANG-2IN",
    image: "/products/flat-brush-set.webp",
    title: "2英寸斜角刷 油漆刷 适用于切边和角落",
    description: "斜角设计，方便处理墙角与边缘细节。",
    aiConfirmed: false,
    stage: "facts_needed",
    factOverrides: { model: "ANG-2IN", price: "1.29", moq: "10", stock: "860", grossWeight: "" },
    errors: ["包装毛重缺失"],
  }),
  demoProduct({
    id: "product-latex-3p",
    sku: "BP-LATEX-3P",
    image: "/products/round-brush-set.webp",
    title: "3件套乳胶漆刷 家庭装修 墙面涂刷工具套装",
    description: "适用于乳胶漆、墙面漆等多种涂料，刷毛顺滑不掉毛，手柄舒适省力。",
    aiConfirmed: true,
    stage: "facts_needed",
    factOverrides: { model: "LATEX-3P", price: "4.59", moq: "5", stock: "", grossWeight: "" },
    errors: ["库存缺失", "包装毛重缺失"],
  }),
  demoProduct({
    id: "product-foam-5p",
    sku: "BP-FOAM-5P",
    image: "/products/filbert-brush-set.webp",
    title: "泡沫刷套装 5件套 海绵刷 油漆涂抹工具",
    description: "细腻海绵刷头，涂抹均匀无刷痕。",
    aiConfirmed: false,
    stage: "ai_ready",
    factOverrides: {
      model: "FOAM-5P",
      price: "2.19",
      moq: "10",
      stock: "1500",
      grossWeight: "6.20",
    },
    errors: ["AI 内容尚未确认"],
  }),
  demoProduct({
    id: "product-frame-9in",
    sku: "BP-FRAME-9IN",
    image: "/products/fan-brush-set.webp",
    title: "9英寸滚筒刷架 带手柄 适配标准滚筒芯",
    description: "金属支架结实耐用，适配标准 9 英寸滚筒芯。",
    aiConfirmed: true,
    stage: "facts_needed",
    factOverrides: {
      model: "FRAME-9IN",
      material: "",
      price: "2.89",
      moq: "10",
      stock: "960",
      grossWeight: "7.10",
    },
    errors: ["材质缺失"],
  }),
  demoProduct({
    id: "product-cover-9in-3",
    sku: "BP-COVER-9IN-3",
    image: "/products/flat-brush-set.webp",
    title: "9英寸乳胶漆滚筒刷芯 3只装 高吸附 耐用",
    description: "高吸附纤维刷芯，覆盖均匀省漆。",
    aiConfirmed: false,
    stage: "ai_ready",
    factOverrides: {
      model: "COVER-9IN-3",
      price: "3.49",
      moq: "10",
      stock: "2100",
      grossWeight: "8.40",
    },
    errors: ["AI 内容尚未确认"],
  }),
  demoProduct({
    id: "product-detail-6p",
    sku: "BP-DETAIL-6P",
    image: "/products/round-brush-set.webp",
    title: "细节刷套装 6件套 适合细节涂装与修补",
    description: "小巧刷头，适合家具修补与细节涂装。",
    aiConfirmed: false,
    stage: "facts_needed",
    factOverrides: { model: "DETAIL-6P", price: "2.79", moq: "10", stock: "780", grossWeight: "" },
    errors: ["包装毛重缺失"],
  }),
  demoProduct({
    id: "product-wide-4in",
    sku: "BP-WIDE-4IN",
    image: "/products/filbert-brush-set.webp",
    title: "4英寸宽平刷 木柄刷 适用于水性漆和油性漆",
    description: "宽幅刷头，大面积涂刷效率更高。",
    aiConfirmed: true,
    stage: "error",
    factOverrides: { model: "WIDE-4IN", price: "", moq: "", stock: "", grossWeight: "5.60" },
    errors: ["价格、库存必填"],
  }),
];

const demoTargetStore = "杭州上品优选贸易有限公司";
const demoTargetDomain = "alibaba.com";

export const sampleBatches: BatchRecord[] = [
  {
    id: "BATCH-20240520-001",
    name: "BATCH-20240520-001",
    createdAt: "2024-05-20 10:28:31",
    updatedAt: "2024-05-20 12:45:33",
    productCount: 1234,
    completion: 45,
    draftCount: 556,
    publishedCount: 0,
    reviewStatus: "pending",
    reviewLabel: "处理中",
    status: "processing",
    images: [],
    targetStore: demoTargetStore,
    targetDomain: demoTargetDomain,
  },
  {
    id: "BATCH-20240519-007",
    name: "BATCH-20240519-007",
    createdAt: "2024-05-19 16:14:02",
    updatedAt: "2024-05-19 16:20:11",
    productCount: 856,
    completion: 100,
    draftCount: 856,
    publishedCount: 0,
    reviewStatus: "none",
    reviewLabel: "准备就绪",
    status: "ready",
    images: [],
    targetStore: demoTargetStore,
    targetDomain: demoTargetDomain,
  },
  {
    id: "BATCH-20240518-003",
    name: "BATCH-20240518-003",
    createdAt: "2024-05-18 09:33:47",
    updatedAt: "2024-05-18 10:02:19",
    productCount: 512,
    completion: 60,
    draftCount: 307,
    publishedCount: 0,
    reviewStatus: "failed",
    reviewLabel: "发布失败",
    status: "failed",
    images: [],
    targetStore: demoTargetStore,
    targetDomain: demoTargetDomain,
    failureReason: "部分商品类目不匹配",
    failedCount: 3,
  },
  {
    id: "BATCH-20240517-012",
    name: "BATCH-20240517-012",
    createdAt: "2024-05-17 14:08:55",
    updatedAt: "2024-05-17 14:35:22",
    productCount: 2048,
    completion: 100,
    draftCount: 2048,
    publishedCount: 2048,
    reviewStatus: "passed",
    reviewLabel: "已完成",
    status: "complete",
    images: [],
    targetStore: demoTargetStore,
    targetDomain: demoTargetDomain,
  },
  {
    id: "BATCH-20240521-001",
    name: "BATCH-20240521-001",
    createdAt: "2024-05-21 08:00:00",
    updatedAt: "2024-05-21 08:00:00",
    productCount: 1000,
    completion: 0,
    draftCount: 0,
    publishedCount: 0,
    reviewStatus: "none",
    reviewLabel: "已计划",
    status: "planned",
    images: [],
    targetStore: demoTargetStore,
    targetDomain: demoTargetDomain,
    plannedFor: "2024-05-21 20:00",
  },
];

export const createEmptyFacts = (settings: StoreSettings): ProductFacts =>
  facts({
    brand: settings.brand,
    origin: settings.origin,
    categoryId: "",
    categoryLabel: "",
    material: "",
    productLength: "",
    productWidth: "",
    productHeight: "",
    netWeight: "",
    packageLength: "",
    packageWidth: "",
    packageHeight: "",
    unitsPerCarton: "",
    leadTime: "",
    hsCode: "",
  });

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

export const demoActiveStoreId = "demo-store-1";

export const demoStores: AlibabaConnectedStore[] = [
  {
    id: "demo-store-1",
    user_id: "1100001234567",
    login_id: "上品优选国际店",
    account: "supplier_1688@163.com",
    expires_at: daysFromNow(223),
    expired: false,
    active: true,
    created_at: daysFromNow(-120),
    updated_at: daysFromNow(-1),
    last_sync_at: daysFromNow(-1),
    product_count: 1268,
    product_sync_state: "synced",
    photobank_group_count: 46,
    photobank_sync_state: "synced",
    product_group_count: 46,
    product_group_sync_state: "synced",
    permissions: {},
    permission_health: "healthy",
    permission_verified_count: 128,
    permission_total_count: 128,
    draft_readiness: "ready",
    ready_to_create_draft: true,
    readiness_blockers: [],
    sync_error: null,
    merchant_assets: {
      company_profile: "",
      after_sales_policy: "",
      customization_policy: "",
      detail_template: "",
      origin: "",
      brand: "",
    },
  },
  {
    id: "demo-store-2",
    user_id: "1100007654321",
    login_id: "上品精选跨境店",
    account: "supplier_abc@126.com",
    expires_at: daysFromNow(96),
    expired: false,
    active: false,
    created_at: daysFromNow(-90),
    updated_at: daysFromNow(-2),
    last_sync_at: daysFromNow(-2),
    product_count: 956,
    product_sync_state: "synced",
    photobank_group_count: 32,
    photobank_sync_state: "synced",
    product_group_count: 32,
    product_group_sync_state: "synced",
    permissions: {},
    permission_health: "healthy",
    permission_verified_count: 96,
    permission_total_count: 96,
    draft_readiness: "ready",
    ready_to_create_draft: true,
    readiness_blockers: [],
    sync_error: null,
    merchant_assets: {
      company_profile: "",
      after_sales_policy: "",
      customization_policy: "",
      detail_template: "",
      origin: "",
      brand: "",
    },
  },
  {
    id: "demo-store-3",
    user_id: "1100009999999",
    login_id: "上品旧店",
    account: "old_supplier@163.com",
    expires_at: daysFromNow(-18),
    expired: true,
    active: false,
    created_at: daysFromNow(-400),
    updated_at: daysFromNow(-18),
    last_sync_at: daysFromNow(-18),
    product_count: 120,
    product_sync_state: "failed",
    photobank_group_count: 8,
    photobank_sync_state: "failed",
    product_group_count: 8,
    product_group_sync_state: "failed",
    permissions: {},
    permission_health: "pending",
    permission_verified_count: 12,
    permission_total_count: 128,
    draft_readiness: "blocked",
    ready_to_create_draft: false,
    readiness_blockers: ["授权已过期，请重新授权后再同步"],
    sync_error: "同步异常",
    merchant_assets: {
      company_profile: "",
      after_sales_policy: "",
      customization_policy: "",
      detail_template: "",
      origin: "",
      brand: "",
    },
  },
];
