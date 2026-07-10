# auto-shoper 后端

阿里巴巴国际站自动上品与 AI 生图后端。本阶段不包含前端，也不包含需求文档中的“销售专家”模块。

## 已实现范围

- 国际站 API 能力清单与推荐调用流程
- GOP HMAC-SHA256 签名客户端
- 类目、发布 Schema、图片银行、草稿、正式发布、商品查询接口
- 图片银行查询、商品更新、质量分、库存同步和上下架接口
- 最多 100 条/批的草稿和正式发布接口，并发数可控、单条失败不影响整批
- 商品图 AI 分析：只提取可观察信息，生成不改变商品事实的文案
- 人工必填字段校验：价格、MOQ、材质、尺寸、认证、库存等禁止 AI 猜测
- OpenAI 兼容的文生图接口

详细 API 调研见 [docs/alibaba-api-matrix.md](docs/alibaba-api-matrix.md)。

## 本地启动

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload
```

访问 `http://127.0.0.1:8000/docs` 查看 OpenAPI 文档。

## 测试

```powershell
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy backend
.\.venv\Scripts\python.exe -m pytest
```

## 关键流程

1. 获取类目树，人工确认叶子类目。
2. 获取该类目的发布 Schema。
3. 上传商品图，AI 仅提取视觉事实并生成安全文案草稿。
4. 人工补充价格、MOQ、材质、尺寸、重量、认证、库存、交期等事实字段。
5. 校验 Schema 必填项。
6. 上传图片银行。
7. 先保存国际站草稿，使用草稿 ID 回读并人工预览。
8. 只有显式确认后才调用正式发布接口。
9. 发布后查询审核状态和质量分，并持续同步库存与上下架状态。

批量草稿和批量发布由本服务受控并发地逐条调用 ICBU 接口，并非 Alibaba 原生一次提交 100 个商品。

## 安全边界

- `.env` 不进入 Git。
- 正式发布接口要求 `confirmed_by_user=true`。
- AI 输出带来源和确认标记，不能把推测值直接提交给国际站。
- 阿里 API 的 AppKey、AppSecret、AccessToken 尚未提供时，可运行全部单元测试，但不能做真实店铺联调。
