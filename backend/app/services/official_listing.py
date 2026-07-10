from backend.app.models import (
    DraftField,
    ListingChecklistItem,
    OfficialListingFlowResponse,
    OfficialListingStep,
)


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
                backend_endpoints=["POST /api/v1/products/official-listing/validate"],
                human_confirmation=True,
            ),
            OfficialListingStep(
                order=5,
                phase="draft_preview",
                label="保存草稿并回读预览",
                actions=[
                    "先保存草稿，不直接正式发布",
                    "用草稿 ID 回读平台渲染结果，人工检查字段和图片效果",
                ],
                backend_endpoints=[
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
                    "PATCH /api/v1/alibaba/schemas/{schema_id}",
                ],
                human_confirmation=True,
            ),
        ],
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
