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
    "category_schema_level_get": AlibabaOperation(
        key="category_schema_level_get",
        operation="/alibaba/icbu/category/schema/level/get",
        purpose="根据已选上级属性加载联动枚举选项",
        safety="只读取 Alibaba 动态选项，不生成或猜测枚举值",
    ),
    "photo_upload": AlibabaOperation(
        key="photo_upload",
        operation="/alibaba/icbu/photobank/upload",
        purpose="上传图片银行",
        safety="可自动执行",
    ),
    "photo_list": AlibabaOperation(
        key="photo_list",
        operation="/icbu/product/photobank/list",
        purpose="分页查询图片银行图片",
        safety="可自动执行",
    ),
    "photo_group_list": AlibabaOperation(
        key="photo_group_list",
        operation="/icbu/product/photobank/group/list",
        purpose="分页查询图片银行分组",
        safety="可自动执行",
    ),
    "product_group_get": AlibabaOperation(
        key="product_group_get",
        operation="/alibaba/icbu/product/group/get",
        purpose="查询当前店铺商品分组",
        safety="只读店铺配置",
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
    "schema_update": AlibabaOperation(
        key="schema_update",
        operation="/icbu/product/schema/update",
        purpose="增量更新已发布商品 Schema",
        safety="事实字段变更需要人工或业务系统确认",
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
        operation="alibaba.icbu.product.sku.inventory.get",
        purpose="查询 SKU 库存",
        safety="可自动执行",
    ),
    "inventory_update": AlibabaOperation(
        key="inventory_update",
        operation="alibaba.icbu.product.inventory.update",
        purpose="更新 SKU 库存",
        safety="必须使用 ERP 或人工确认的库存事实",
    ),
    "display_update": AlibabaOperation(
        key="display_update",
        operation="alibaba.icbu.product.batch.update.display",
        purpose="商品上下架",
        safety="需要操作审计和明确业务规则",
    ),
}
