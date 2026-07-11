# auto-shoper

阿里巴巴国际站自动上品、AI 商品内容与商家上品工作台。当前不包含需求文档中的“销售专家”模块。

## 已实现范围

- 国际站 API 能力清单与推荐调用流程
- GOP HMAC-SHA256 签名客户端
- 类目、发布 Schema、图片银行、草稿、正式发布、商品查询接口
- 图片银行查询、商品更新、质量分、库存同步和上下架接口
- 最多 100 条/批的草稿和正式发布接口，并发数可控、单条失败不影响整批
- 官方 Schema XML 解析和填值：执行必填、枚举、长度、数值、正则、值属性规则，并生成官方 XML 值结构
- 官方上品流程接口：返回授权、类目、素材、字段填写、草稿预览、审核和发布后维护步骤
- 同一商品最多 10 张图库图片：第一张默认主图，可切换主图，AI 综合整组图片生成一个商品候选
- 人工必填字段校验：价格、MOQ、材质、尺寸、认证、库存等禁止 AI 猜测
- 四象限字段矩阵：区分全店通用/每商品、AI 辅助/可信来源专属字段
- 店铺默认值继承：只允许币种、单位、仓库、运费模板等白名单字段复用
- 来源强制门禁：AI/图片提取值即使漏标 `requires_confirmation` 也不能进入草稿
- 官方安全写入接口：从带来源的字段构建实时 Schema XML，再创建草稿或确认发布
- OpenAI 兼容的文生图和参考商品图编辑接口；参考图编辑强制人工确认
- 两个主页面的商家前端：批量上品工作台、批次记录
- 店铺默认配置抽屉、商品动态资料检查器和五步安全发布流程
- 演示数据与真实 API 明确隔离，正式发布必须二次确认

详细 API 调研见 [docs/alibaba-api-matrix.md](docs/alibaba-api-matrix.md)。

## 本地开发

### 后端

```bash
python -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
cp .env.example .env
.venv/bin/python -m uvicorn backend.app.main:app --reload
```

访问 `http://127.0.0.1:8000/docs` 查看 OpenAPI 文档。

Windows PowerShell 将 `.venv/bin/python` 替换为 `.venv\Scripts\python.exe`，将 `cp` 替换为 `Copy-Item`。

### 前端

```bash
cd frontend
npm install
npm run dev
```

Vite 在 `http://127.0.0.1:5173` 启动，并把 `/api` 和 `/health` 代理到后端 `8000` 端口。

### Alibaba 商家授权

1. 在 Alibaba.com ICBU 开放平台创建应用并取得 AppKey/AppSecret。
2. 将回调白名单设为本服务的稳定 HTTPS 地址：
   `https://<backend-domain>/api/v1/alibaba/oauth/callback`。
3. 后端配置 `ALIBABA_APP_KEY`、`ALIBABA_APP_SECRET`、
   `ALIBABA_OAUTH_REDIRECT_URI`、`ALIBABA_OAUTH_SUCCESS_URL` 和
   `ALIBABA_OAUTH_ERROR_URL`。
4. 任意商家在设置页「店铺连接」点击「登录并授权店铺」，后端生成 10 分钟有效的签名 `state`，
   跳转 Alibaba 登录授权；回调验证 `state` 后向新版 GOP 网关
   （`ALIBABA_API_BASE_URL` 的 `/auth/token/create`）用授权码交换 token。
5. token 按商家 `user_id` 分别保存，可同时连接多个店铺；设置页会列出已授权店铺。

Token 交换使用新版开放平台 GOP 网关（`/auth/token/create`、`/auth/token/refresh`，
HMAC-SHA256 签名），不再走旧版 TOP `eco.taobao.com` 网关。

AppSecret、AccessToken 和 RefreshToken 只能保存在后端。当前多商家 token store 仍是单进程
内存实现（按 `user_id` 分租户）；生产环境还需把 token 加密持久化、接入应用账号体系绑定登录
用户身份，并实现 refresh token 自动轮换、撤权和审计。不能用前端传入的商家 ID 代替身份认证。

### 生产构建

```bash
cd frontend
npm run build
cd ..
.venv/bin/python -m uvicorn backend.app.main:app
```

存在 `frontend/dist` 时，FastAPI 会在根路径提供前端，并继续保留 `/api/v1` 和 `/docs`。

## 质量检查

```bash
.venv/bin/python -m ruff check .
.venv/bin/python -m mypy backend
.venv/bin/python -m pytest
cd frontend
npm run check
npm run build
```

前端视觉和交互规范见 [DESIGN.md](DESIGN.md)。

## 关键流程

1. 获取类目树，人工确认叶子类目。
2. 获取该类目的发布 Schema。
3. 解析官方 XML Schema，并按标量、多值、复合、多复合和值属性结构填入商品事实。
4. 将同一商品的主图、详情图、规格图和包装图放入一个图库，AI 综合整组图片，仅提取视觉事实并生成安全文案草稿。
5. 人工补充价格、MOQ、材质、尺寸、重量、认证、库存、交期等事实字段。
6. 按官方 Schema 和字段来源策略校验，AI 不得直接提交商业事实。
7. 上传图片银行。
8. 先保存国际站草稿，使用返回的草稿商品 ID 回读并人工预览。
9. 只有显式确认后才调用正式发布接口。
10. 发布后查询审核状态和质量分，并持续同步库存与上下架状态。

批量草稿和批量发布由本服务受控并发地逐条调用 ICBU 接口，并非 Alibaba 原生一次提交 100 个商品。

## 官方流程辅助接口

- `GET /api/v1/alibaba/listing-flow`：返回对标官方后台的完整上品步骤和每步后端接口。
- `POST /api/v1/alibaba/schemas/parse`：解析 `schema.get` 返回的 XML，输出字段、规则、枚举、必填项和人工确认字段。
- `POST /api/v1/alibaba/schemas/build`：把字段值写入实时 Schema XML，执行动态规则并返回字段级错误。
- `POST /api/v1/products/official-listing/validate`：把官方 Schema 必填项与字段来源策略合并校验，并返回按官方流程分组的缺失清单。
- `GET /api/v1/alibaba/listing-field-matrix`：返回全店通用/每商品和 AI 辅助/可信来源专属的四组字段。
- `POST /api/v1/products/official-listing/prepare`：合并合法店铺默认值、校验来源并生成可提交 XML。
- `POST /api/v1/products/official-listing/drafts`：只为通过来源和 Schema 校验的单品创建草稿。
- `POST /api/v1/products/official-listing/batch/drafts`：逐商品校验并创建最多 100 个草稿，失败隔离。
- `POST /api/v1/products/official-listing/publish`：通过同一门禁并显式确认后正式发布。
- `POST /api/v1/products/official-listing/batch/publish`：显式确认后逐商品发布，保持顺序并隔离失败。

## 字段来源规则

- `image_extracted`、`ai_generated` 永远只是候选，不能直接创建草稿或正式发布。
- 用户确认 AI 候选后，来源必须改为 `user_confirmed`。
- `account_default` 只允许用于全店白名单字段，不能提供单品价格、SKU、库存、材质、尺寸、重量、认证等事实。
- `user_provided`、`user_confirmed`、`business_system` 可作为可信单品来源。
- 同款商品可以继承已确认的公共事实，但每个 SKU 的价格、库存、尺寸、重量和包装仍须逐项校验。

## 安全边界

- `.env` 不进入 Git。
- 正式发布接口要求 `confirmed_by_user=true`。
- AI 输出带来源和确认标记，不能把推测值直接提交给国际站。
- 阿里 API 的 AppKey、AppSecret、AccessToken 尚未提供时，可运行全部单元测试，但不能做真实店铺联调。
