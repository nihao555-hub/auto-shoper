from backend.app.models import AlibabaOperation

OPERATIONS = {
    "category_get": AlibabaOperation(
        key="category_get",
        operation="/icbu/product/category/get",
        purpose="获取类目树或类目详情",
        safety="AI 可推荐类目，最终叶子类目必须人工确认",
    ),
    "schema_get": AlibabaOperation(
        key="schema_get",
        operation="/alibaba/icbu/product/schema/get",
        purpose="获取类目发布 Schema 和动态必填规则",
        safety="可自动读取",
    ),
    "photo_upload": AlibabaOperation(
        key="photo_upload",
        operation="/alibaba/icbu/photobank/upload",
        purpose="上传图片银行",
        safety="可自动执行",
    ),
    "draft_create": AlibabaOperation(
        key="draft_create",
        operation="/icbu/product/schema/add/draft",
        purpose="保存商品草稿",
        safety="可自动保存，发布前人工复核",
    ),
    "draft_render": AlibabaOperation(
        key="draft_render",
        operation="/icbu/product/schema/render/draft",
        purpose="回读草稿数据和规则",
        safety="可自动执行",
    ),
    "publish": AlibabaOperation(
        key="publish",
        operation="/icbu/product/schema/add",
        purpose="正式发布商品",
        safety="必须人工显式确认",
    ),
    "product_get": AlibabaOperation(
        key="product_get",
        operation="/icbu/product/get",
        purpose="查询商品详情",
        safety="可自动执行",
    ),
    "product_list": AlibabaOperation(
        key="product_list",
        operation="/alibaba/icbu/product/list",
        purpose="分页查询商品",
        safety="可自动执行",
    ),
    "product_score": AlibabaOperation(
        key="product_score",
        operation="/icbu/product/score/get",
        purpose="查询商品质量分",
        safety="可自动执行",
    ),
    "inventory_get": AlibabaOperation(
        key="inventory_get",
        operation="/icbu/product/inventory/get",
        purpose="查询 SKU 库存",
        safety="可自动执行",
    ),
    "inventory_update": AlibabaOperation(
        key="inventory_update",
        operation="/icbu/product/inventory/update",
        purpose="更新 SKU 库存",
        safety="必须使用 ERP 或人工确认的库存事实",
    ),
    "display_update": AlibabaOperation(
        key="display_update",
        operation="/icbu/product/update/display",
        purpose="商品上下架",
        safety="需要操作审计和明确业务规则",
    ),
}
