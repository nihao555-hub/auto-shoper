from backend.app.models import (
    DraftField,
    FieldInputMode,
    FieldScope,
    FieldSource,
    ListingChecklistItem,
    ListingFieldDefinition,
    ListingFieldGroup,
    OfficialListingFlowResponse,
    OfficialListingStep,
)


def listing_field_groups() -> list[ListingFieldGroup]:
    return [
        ListingFieldGroup(
            key="store_ai_assisted",
            label="全店通用：AI 可起草、一次确认后复用",
            scope=FieldScope.STORE,
            input_mode=FieldInputMode.AI_ASSISTED,
            fields=[
                _field("company_profile", "公司介绍文案", "AI 可润色真实公司资料"),
                _field("detail_page_template", "详情页版式", "AI 可生成通用排版和模块结构"),
                _field("after_sales_policy", "售后说明文案", "只能改写商家已确认的真实政策"),
                _field("customization_policy", "定制说明文案", "只能改写真实定制能力"),
                _field("image_style_prompt", "店铺图片风格", "统一白底、场景和视觉风格"),
            ],
            allowed_sources=[
                FieldSource.AI_GENERATED,
                FieldSource.USER_CONFIRMED,
                FieldSource.ACCOUNT_DEFAULT,
            ],
            confirmation_rule="AI 初稿必须由用户确认一次，之后才能保存为店铺默认值",
        ),
        ListingFieldGroup(
            key="store_trusted_defaults",
            label="全店通用：只能由用户、店铺配置或业务系统提供",
            scope=FieldScope.STORE,
            input_mode=FieldInputMode.TRUSTED_ONLY,
            fields=[
                _field("product_group_id", "商品分组", "必须使用店铺真实分组 ID"),
                _field("photo_bank_group_id", "图片银行分组", "必须使用店铺真实图片分组"),
                _field("currency", "默认币种", "必须与店铺报价规则一致"),
                _field("price_unit", "默认计量单位", "必须使用 Schema 枚举值"),
                _field("warehouse_id", "仓库", "必须来自店铺或 ERP 仓库配置"),
                _field("inventory_code", "库存地点", "必须来自库存系统"),
                _field("shipping_template_id", "运费模板", "必须使用店铺真实模板 ID"),
                _field("company_qualifications", "公司资质", "必须有真实证明文件"),
                _field("brand_authorizations", "品牌授权", "必须有真实授权链路"),
                _field("service_policy", "统一服务政策", "必须由商家确认实际可履约范围"),
            ],
            allowed_sources=[
                FieldSource.USER_PROVIDED,
                FieldSource.USER_CONFIRMED,
                FieldSource.BUSINESS_SYSTEM,
                FieldSource.ACCOUNT_DEFAULT,
            ],
            confirmation_rule="只可保存真实店铺配置；不得由图片或模型推测",
        ),
        ListingFieldGroup(
            key="product_ai_assisted",
            label="每个商品：上传一张图后 AI 可生成候选",
            scope=FieldScope.PRODUCT,
            input_mode=FieldInputMode.AI_ASSISTED,
            fields=[
                _field("category_suggestion", "叶子类目建议", "最终类目仍需用户确认"),
                _field("product_title", "英文标题", "只使用图片可见或用户提供的事实"),
                _field("keywords", "关键词", "最多三个，并按实时 Schema 校验"),
                _field("selling_points", "卖点文案", "不能加入未证实性能或合规声明"),
                _field("description", "详情文案", "只能组织已知事实"),
                _field("visible_color", "可见颜色候选", "受光线影响，必须确认"),
                _field("visible_pattern", "可见花纹候选", "不清晰时必须留空"),
                _field("visible_shape", "外形和结构候选", "不能推断内部结构"),
                _field("visible_components", "可见配件和数量", "遮挡时必须留空"),
                _field("scene_images", "白底图和场景图", "必须保持商品身份和数量不变"),
                _field("detail_images", "详情图版式", "不得增加不存在的部件或标识"),
                _field("image_quality_review", "图片质量检查", "检查清晰度、遮挡和一致性"),
            ],
            allowed_sources=[
                FieldSource.IMAGE_EXTRACTED,
                FieldSource.AI_GENERATED,
                FieldSource.USER_CONFIRMED,
            ],
            confirmation_rule="AI 和图片提取结果永远是候选；确认后来源必须改为 user_confirmed",
        ),
        ListingFieldGroup(
            key="product_trusted_facts",
            label="每个商品：AI 绝不能自行填写",
            scope=FieldScope.PRODUCT,
            input_mode=FieldInputMode.TRUSTED_ONLY,
            fields=[
                _field("category_id", "最终叶子类目", "决定实时 Schema 和发布规则"),
                _field("brand", "品牌", "必须来自商品资料或真实授权"),
                _field("model", "型号", "必须来自企业商品系统"),
                _field("material", "材质和成分", "图片外观不能证明真实材质"),
                _field("specifications", "精确规格", "必须来自测量或产品资料"),
                _field("dimensions", "商品尺寸", "图片无法进行精确测量"),
                _field("weight", "商品和包装重量", "图片无法确定重量"),
                _field("sku", "SKU 组合和编码", "必须与 ERP 和真实销售属性一致"),
                _field("price", "价格和阶梯价", "必须来自报价系统或人工"),
                _field("moq", "最小起订量", "属于真实交易条件"),
                _field("inventory", "库存", "必须来自库存系统或人工盘点"),
                _field("sample_policy", "样品规则", "必须符合真实报价和履约能力"),
                _field("packaging", "包装方式和箱规", "必须来自实际包装方案"),
                _field("lead_time", "交期", "必须来自生产和供应链计划"),
                _field("logistics", "物流属性和运费", "必须来自真实物流配置"),
                _field("origin", "原产地和港口", "属于贸易和合规事实"),
                _field("hs_code", "HS Code", "必须由业务或报关资料确认"),
                _field("certifications", "认证", "禁止生成不存在的认证声明"),
                _field("patent_trademark", "专利和商标", "必须有真实权利证明"),
                _field("image_rights", "图片版权", "必须确认素材使用权"),
            ],
            allowed_sources=[
                FieldSource.USER_PROVIDED,
                FieldSource.USER_CONFIRMED,
                FieldSource.BUSINESS_SYSTEM,
            ],
            confirmation_rule="必须逐商品读取可信数据；同款继承后仍需逐 SKU 校验",
        ),
    ]


def official_listing_flow() -> OfficialListingFlowResponse:
    return OfficialListingFlowResponse(
        steps=[
            OfficialListingStep(
                order=1,
                phase="authorization",
                label="授权和店铺能力检查",
                actions=[
                    "确认 Alibaba Open Platform 应用已授权商品、图片银行、库存和上下架接口",
                    "检查 access_token 有效期和店铺发品权限",
                ],
                backend_endpoints=["GET /api/v1/capabilities", "GET /api/v1/alibaba/operations"],
                human_confirmation=True,
            ),
            OfficialListingStep(
                order=2,
                phase="category_schema",
                label="选择叶子类目并获取动态 Schema",
                actions=[
                    "AI 可以推荐类目，但最终叶子类目必须由用户确认",
                    "读取该类目的 XML Schema、必填规则、枚举和字段联动",
                ],
                backend_endpoints=[
                    "GET /api/v1/alibaba/categories/{category_id}",
                    "GET /api/v1/alibaba/categories/{category_id}/schema",
                    "POST /api/v1/alibaba/schemas/parse",
                    "POST /api/v1/alibaba/schemas/build",
                ],
                human_confirmation=True,
            ),
            OfficialListingStep(
                order=3,
                phase="media_ai",
                label="素材处理、商品图分析和生图",
                actions=[
                    "AI 只提取可见事实并生成标题、关键词、卖点和场景图",
                    "最终图片上传图片银行后再写入商品 Schema",
                ],
                backend_endpoints=[
                    "POST /api/v1/products/analyze-image",
                    "POST /api/v1/images/generate",
                    "POST /api/v1/images/generate-from-product",
                    "POST /api/v1/alibaba/photo-bank/images",
                ],
                human_confirmation=True,
            ),
            OfficialListingStep(
                order=4,
                phase="product_data",
                label="填写官方模板字段",
                actions=[
                    "按实时 Schema 填写基础信息、类目属性、SKU、交易和履约资料",
                    "价格、SKU、库存、重量尺寸、认证等事实必须来自人工或业务系统",
                ],
                backend_endpoints=[
                    "POST /api/v1/products/official-listing/validate",
                    "POST /api/v1/products/official-listing/prepare",
                ],
                human_confirmation=True,
            ),
            OfficialListingStep(
                order=5,
                phase="draft_preview",
                label="保存草稿并回读预览",
                actions=[
                    "先保存草稿，不直接正式发布",
                    "用草稿商品 ID 回读平台渲染结果，人工检查字段和图片效果",
                ],
                backend_endpoints=[
                    "POST /api/v1/products/official-listing/drafts",
                    "POST /api/v1/products/official-listing/batch/drafts",
                    "POST /api/v1/alibaba/products/drafts",
                    "POST /api/v1/alibaba/products/batch/drafts",
                    "POST /api/v1/alibaba/products/drafts/render",
                ],
                human_confirmation=True,
            ),
            OfficialListingStep(
                order=6,
                phase="publish_audit",
                label="确认发布和平台审核",
                actions=[
                    "只有 confirmed_by_user=true 才能正式发布",
                    "发布后查询商品详情、列表和质量分，保存审核或失败原因",
                ],
                backend_endpoints=[
                    "POST /api/v1/products/official-listing/publish",
                    "POST /api/v1/products/official-listing/batch/publish",
                    "POST /api/v1/alibaba/products/publish",
                    "POST /api/v1/alibaba/products/batch/publish",
                    "GET /api/v1/alibaba/products/{product_id}",
                    "GET /api/v1/alibaba/products/{product_id}/score",
                ],
                human_confirmation=True,
            ),
            OfficialListingStep(
                order=7,
                phase="post_publish",
                label="发布后维护",
                actions=[
                    "按 ERP 或人工事实同步库存",
                    "按业务规则做增量更新和上下架",
                ],
                backend_endpoints=[
                    "GET /api/v1/alibaba/products/{product_id}/inventory",
                    "PUT /api/v1/alibaba/products/{product_id}/inventory",
                    "PATCH /api/v1/alibaba/products/{product_id}/display",
                    "PATCH /api/v1/alibaba/products/{product_id}/schema",
                ],
                human_confirmation=True,
            ),
        ],
        field_groups=listing_field_groups(),
        ai_can_generate=[
            "英文标题表达、关键词建议、卖点文案、详情结构和场景图提示词",
            "基于已知事实的多语言改写和详情页排版",
        ],
        ai_requires_confirmation=[
            "图片中可见的颜色、形状、件数、品牌型号和类目建议",
            "生成图片的背景、构图、使用场景和视觉风格",
        ],
        must_be_user_or_business_system=[
            "最终叶子类目、价格、币种、MOQ、SKU、库存",
            "材质、尺寸、重量、包装、交期、物流模板",
            "认证、专利、商标、原产地、港口和合规声明",
        ],
    )


def _field(name: str, label: str, reason: str) -> ListingFieldDefinition:
    return ListingFieldDefinition(name=name, label=label, reason=reason)


def build_official_checklist(
    fields: dict[str, DraftField],
    schema_required_fields: list[str],
) -> list[ListingChecklistItem]:
    phase_fields = {
        "category_schema": ("类目和 Schema", ["category_id", "cat_id"]),
        "media_ai": ("图片和素材", []),
        "product_data": ("基础和类目属性", []),
        "trade_sku": ("SKU、价格和交易条件", []),
        "fulfillment": ("包装、物流和履约", []),
        "compliance": ("认证和合规", []),
        "draft_preview": ("草稿预览", []),
    }
    missing_by_phase: dict[str, list[str]] = {phase: [] for phase in phase_fields}
    for field_id in schema_required_fields:
        phase = _phase_for_field(field_id)
        if not _field_present(fields, field_id):
            missing_by_phase[phase].append(field_id)

    if not _field_present(fields, "category_id") and not _field_present(fields, "cat_id"):
        missing_by_phase["category_schema"].append("category_id")

    return [
        ListingChecklistItem(
            phase=phase,
            label=label,
            required_fields=sorted(
                set(required + _required_for_phase(schema_required_fields, phase))
            ),
            missing_fields=sorted(set(missing_by_phase[phase])),
        )
        for phase, (label, required) in phase_fields.items()
    ]


def _required_for_phase(schema_required_fields: list[str], phase: str) -> list[str]:
    return [field for field in schema_required_fields if _phase_for_field(field) == phase]


def _phase_for_field(field_id: str) -> str:
    normalized = _normalize(field_id)
    if any(token in normalized for token in ("image", "video", "scimages", "picture")):
        return "media_ai"
    if any(token in normalized for token in ("price", "moq", "sku", "stock", "inventory")):
        return "trade_sku"
    if any(
        token in normalized
        for token in ("package", "weight", "dimension", "shipping", "logistic", "leadtime")
    ):
        return "fulfillment"
    if any(token in normalized for token in ("cert", "origin", "patent", "trademark", "hs_code")):
        return "compliance"
    if "cat" in normalized or "category" in normalized:
        return "category_schema"
    return "product_data"


def _field_present(fields: dict[str, DraftField], field_id: str) -> bool:
    normalized_target = _normalize(field_id)
    for name, field in fields.items():
        if _normalize(name) == normalized_target and field.value not in (None, "", []):
            return True
    return False


def _normalize(field_id: str) -> str:
    return "".join(char.lower() for char in field_id if char.isalnum() or char == "_")
