import { CaretRight, Check } from "@phosphor-icons/react";
import type {
  AlibabaConnectedStore,
  BatchRecord,
  CapabilityResponse,
  DataMode,
  ProductRecord,
} from "../types";

type OverviewPageProps = {
  batches: BatchRecord[];
  products: ProductRecord[];
  capabilities: CapabilityResponse | null;
  backendConnected: boolean;
  dataMode: DataMode;
  activeStore: AlibabaConnectedStore | null;
  onNavigateWorkbench: () => void;
  onNavigateBatches: () => void;
  onNavigateStores: () => void;
};

const stageWeight: Record<ProductRecord["stage"], number> = {
  uploaded: 12,
  analyzing: 18,
  ai_ready: 32,
  facts_needed: 48,
  ready: 64,
  drafting: 72,
  drafted: 84,
  publishing: 92,
  published: 100,
  error: 28,
};

const batchStatusMeta: Record<BatchRecord["status"], { label: string; className: string }> = {
  processing: { label: "进行中", className: "is-processing" },
  ready: { label: "草稿中", className: "is-draft" },
  complete: { label: "已完成", className: "is-complete" },
  failed: { label: "已取消", className: "is-cancelled" },
  planned: { label: "已计划", className: "is-planned" },
};

export function OverviewPage({
  batches,
  products,
  capabilities,
  activeStore,
  onNavigateWorkbench,
  onNavigateBatches,
  onNavigateStores,
}: OverviewPageProps) {
  const total = products.length;
  const confirmed = products.filter((product) => product.aiConfirmed).length;
  const factsDone = products.filter(
    (product) =>
      product.stage !== "uploaded" &&
      product.stage !== "analyzing" &&
      product.stage !== "ai_ready" &&
      product.stage !== "facts_needed",
  ).length;
  const drafted = products.filter(
    (product) => product.stage === "drafted" || product.stage === "published",
  ).length;
  const needsAttention = products.filter(
    (product) => product.stage === "error" || product.errors.length > 0,
  ).length;
  const progress = total
    ? Math.round(products.reduce((sum, product) => sum + stageWeight[product.stage], 0) / total)
    : 0;

  const storeReady = activeStore?.draft_readiness === "ready";
  const groupSelected =
    capabilities?.active_store_id != null && activeStore?.photobank_sync_state === "synced";
  const storeName = activeStore
    ? (activeStore.login_id ?? activeStore.account ?? activeStore.user_id ?? "Alibaba 店铺")
    : "尚未连接店铺";
  const recentBatches = batches.slice(0, 5);

  return (
    <div className="ds-page ov-page">
      <header className="ds-page-header">
        <div>
          <h1>上品运营总览</h1>
          <p className="ds-page-subtitle">在这里查看当前上品批次的整体进度，快速完成上品流程。</p>
        </div>
        <button type="button" className="ds-button-primary" onClick={onNavigateWorkbench}>
          新建上品批次
        </button>
      </header>

      <section className="ov-store-bar" aria-label="当前店铺">
        <span className="ov-store-badge">阿</span>
        <span>
          当前店铺：{storeName}
          {activeStore ? "（Alibaba）" : ""}
        </span>
        <button type="button" className="ds-link" onClick={onNavigateStores}>
          {activeStore ? "切换店铺" : "前往授权"}
        </button>
      </section>

      <section className="ov-metrics" aria-label="工作区指标">
        <article className="ov-metric">
          <span className="ov-metric-label">当前批次</span>
          <div className="ov-metric-value">
            <strong>{total}</strong>
            <span>个商品</span>
          </div>
        </article>
        <article className="ov-metric">
          <span className="ov-metric-label">可用草稿</span>
          <div className="ov-metric-value">
            <strong>{drafted}</strong>
            <span>个商品</span>
          </div>
        </article>
        <article className={`ov-metric ${needsAttention ? "is-warning" : ""}`}>
          <span className="ov-metric-label">需要处理</span>
          <div className="ov-metric-value">
            <strong>{needsAttention}</strong>
            <span>个商品</span>
          </div>
        </article>
      </section>

      <div className="ov-grid">
        <section className="ov-panel" aria-label="当前批次进度">
          <h2>当前批次进度</h2>
          <div className="ov-selected">
            <strong>{confirmed}</strong>
            <span className="ov-selected-total">/{total}</span>
            <span>已选商品</span>
          </div>
          <span className="ov-progress-track">
            <i style={{ width: `${progress}%` }} />
          </span>
          <p className="ov-progress-caption">整体进度 {progress}%</p>

          <div className="ov-steps">
            <BatchStep
              index={1}
              title="确认 AI 候选"
              description="逐条确认 AI 生成的标题与卖点"
              value={confirmed}
              total={total}
              onClick={onNavigateWorkbench}
            />
            <BatchStep
              index={2}
              title="补充商品事实"
              description="补齐价格、库存与包装等真实资料"
              value={factsDone}
              total={total}
              onClick={onNavigateWorkbench}
            />
            <BatchStep
              index={3}
              title="创建草稿"
              description="校验通过后批量创建 Alibaba 草稿"
              value={drafted}
              total={total}
              onClick={onNavigateWorkbench}
            />
          </div>
        </section>

        <section className="ov-panel" aria-label="开始下一步">
          <h2>开始下一步</h2>
          <p className="ov-panel-subtitle">按顺序完成以下任务，确保上品顺利进行。</p>
          <div className="ov-next-steps">
            <NextStep
              index={1}
              title="店铺授权"
              description={storeReady ? `已授权：${storeName}` : "连接并授权 Alibaba 店铺"}
              done={storeReady}
              onClick={onNavigateStores}
            />
            <NextStep
              index={2}
              title="选择图片分组"
              description="从图片银行选择要上品的商品图"
              done={groupSelected}
              onClick={onNavigateWorkbench}
            />
            <NextStep
              index={3}
              title="补充商品事实"
              description="录入价格、库存等仅可信来源字段"
              done={total > 0 && factsDone === total}
              onClick={onNavigateWorkbench}
            />
            <NextStep
              index={4}
              title="创建草稿"
              description="批量创建草稿并回渡发布"
              done={total > 0 && drafted === total}
              onClick={onNavigateWorkbench}
            />
          </div>
        </section>
      </div>

      <section className="ov-recent" aria-label="最近批次">
        <h2>最近批次</h2>
        <table>
          <thead>
            <tr>
              <th>批次名称</th>
              <th>创建时间</th>
              <th>商品数量</th>
              <th>草稿数量</th>
              <th>进度</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {recentBatches.length ? (
              recentBatches.map((batch) => {
                const meta = batchStatusMeta[batch.status];
                return (
                  <tr key={batch.id}>
                    <td>{batch.name}</td>
                    <td className="ds-num">{batch.createdAt}</td>
                    <td className="ds-num">{batch.productCount}</td>
                    <td className="ds-num">{batch.draftCount}</td>
                    <td>
                      <span className="ov-progress-cell">
                        <span
                          className={`ov-progress-bar ${
                            batch.completion >= 100 ? "is-complete" : ""
                          }`}
                        >
                          <i
                            style={{
                              width: `${batch.completion}%`,
                              background:
                                batch.completion >= 100
                                  ? "var(--ds-success)"
                                  : batch.status === "failed"
                                    ? "var(--ds-disabled)"
                                    : "var(--ds-brand)",
                            }}
                          />
                        </span>
                        <span className="ds-num">{batch.completion}%</span>
                      </span>
                    </td>
                    <td>
                      <span className={`ov-status-text ${meta.className}`}>{meta.label}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ds-link-brand"
                        onClick={
                          batch.status === "complete" ? onNavigateBatches : onNavigateWorkbench
                        }
                      >
                        {batch.status === "complete" ? "查看" : "继续"}
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="ov-recent-empty">
                  还没有批次记录，点击右上角「新建上品批次」开始。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function BatchStep({
  index,
  title,
  description,
  value,
  total,
  onClick,
}: {
  index: number;
  title: string;
  description: string;
  value: number;
  total: number;
  onClick: () => void;
}) {
  const done = total > 0 && value >= total;
  const started = value > 0;
  return (
    <button type="button" className="ov-step" onClick={onClick}>
      <span className={`ov-step-index ${done ? "is-done-circle" : started ? "" : "is-pending"}`}>
        {index}
      </span>
      <span className="ov-step-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className={`ov-step-status ${done ? "is-done" : started ? "is-active" : "is-pending"}`}>
        {done ? "已完成" : started ? "进行中" : "待开始"}
      </span>
      <span className="ov-step-count ds-num">
        {value}/{total}
      </span>
      <CaretRight size={14} />
    </button>
  );
}

function NextStep({
  index,
  title,
  description,
  done,
  onClick,
}: {
  index: number;
  title: string;
  description: string;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="ov-next-step" onClick={onClick}>
      <span className={`ov-next-index ${done ? "is-done" : ""}`}>
        {done ? <Check size={14} weight="bold" /> : index}
      </span>
      <span className="ov-step-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <CaretRight size={14} className="ov-next-caret" />
    </button>
  );
}
