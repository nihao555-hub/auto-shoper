import {
  ArrowRight,
  CheckCircle,
  Clock,
  FileText,
  Package,
  PlugsConnected,
  WarningCircle,
} from "@phosphor-icons/react";
import type { BatchRecord, CapabilityResponse, DataMode, ProductRecord } from "../types";

type OverviewPageProps = {
  batches: BatchRecord[];
  products: ProductRecord[];
  capabilities: CapabilityResponse | null;
  backendConnected: boolean;
  dataMode: DataMode;
  onNavigateWorkbench: () => void;
  onNavigateBatches: () => void;
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

export function OverviewPage({
  batches,
  products,
  capabilities,
  backendConnected,
  dataMode,
  onNavigateWorkbench,
  onNavigateBatches,
}: OverviewPageProps) {
  const drafted = products.filter(
    (product) => product.stage === "drafted" || product.stage === "published",
  ).length;
  const published = products.filter((product) => product.stage === "published").length;
  const needsAttention = products.filter(
    (product) => product.stage === "error" || product.errors.length > 0,
  ).length;
  const progress = products.length
    ? Math.round(
        products.reduce((total, product) => total + stageWeight[product.stage], 0) /
          products.length,
      )
    : 0;
  const recentBatches = batches.slice(0, 4);

  return (
    <div className="page overview-page">
      <header className="overview-header">
        <div>
          <div className="page-context">
            <span>{dataMode === "demo" ? "演示空间" : "真实工作区"}</span>
            <i />
            <span>{backendConnected ? "服务正常" : "服务暂不可用"}</span>
          </div>
          <h1>上品运营总览</h1>
          <p>集中查看当前批次、发布准备和需要处理的异常项。</p>
        </div>
        <button
          type="button"
          className="button button-primary overview-primary"
          onClick={onNavigateWorkbench}
        >
          新建上品批次
          <span className="button-icon-island">
            <ArrowRight size={16} />
          </span>
        </button>
      </header>

      {dataMode === "demo" ? (
        <div className="workspace-notice is-demo">
          <span>演示数据与真实账户完全隔离</span>
          <p>可以完整查看上传、AI 确认、资料补齐、草稿与发布门禁。</p>
        </div>
      ) : !backendConnected ? (
        <div className="workspace-notice is-warning">
          <WarningCircle size={18} weight="fill" />
          <span>后端服务未连接，上传与发布操作暂不可用。</span>
        </div>
      ) : null}

      <section className="overview-metrics" aria-label="工作区指标">
        <OverviewMetric
          label="当前批次"
          value={products.length}
          detail={products.length ? `完成度 ${progress}%` : "尚未上传商品"}
          icon={Package}
        />
        <OverviewMetric
          label="可用草稿"
          value={drafted}
          detail={drafted ? `${published} 个已发布` : "通过校验后生成"}
          icon={FileText}
        />
        <OverviewMetric
          label="需要处理"
          value={needsAttention}
          detail={needsAttention ? "存在缺失或错误字段" : "当前没有阻塞项"}
          icon={needsAttention ? WarningCircle : CheckCircle}
          tone={needsAttention ? "warning" : "success"}
        />
      </section>

      <div className="overview-grid">
        <section className="overview-panel current-batch-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">进度与趋势</span>
              <h2>{products.length ? "当前批次进度" : "还没有进行中的批次"}</h2>
            </div>
            {products.length ? (
              <button type="button" className="text-button" onClick={onNavigateWorkbench}>
                继续处理 <ArrowRight size={15} />
              </button>
            ) : null}
          </div>

          {products.length ? (
            <>
              <div className="batch-progress-hero">
                <div className="progress-value">
                  <strong>{progress}</strong>
                  <span>%</span>
                </div>
                <div className="progress-copy">
                  <span className="overview-progress-track">
                    <i style={{ transform: `scaleX(${progress / 100})` }} />
                  </span>
                  <p>
                    {products.length} 个商品 · {drafted} 个草稿 · {published} 个已发布
                  </p>
                </div>
              </div>
              <div className="stage-summary">
                <StageLine
                  label="AI 内容已确认"
                  value={products.filter((product) => product.aiConfirmed).length}
                  total={products.length}
                />
                <StageLine
                  label="真实资料已补齐"
                  value={products.filter((product) => product.stage !== "facts_needed").length}
                  total={products.length}
                />
                <StageLine label="草稿已创建" value={drafted} total={products.length} />
              </div>
            </>
          ) : (
            <div className="overview-empty">
              <div className="empty-visual">
                <Package size={28} />
              </div>
              <h3>上传商品图片，建立第一个批次</h3>
              <p>真实工作区默认不加载任何示例数据。每张图片会创建一条待处理商品。</p>
              <button type="button" className="button button-dark" onClick={onNavigateWorkbench}>
                前往批量上品
              </button>
            </div>
          )}
        </section>

        <aside className="overview-panel readiness-panel">
          <div className="panel-heading compact">
            <div>
              <span className="panel-kicker">发布准备</span>
              <h2>服务、模型与授权</h2>
            </div>
            <PlugsConnected size={21} />
          </div>
          <ReadinessLine
            label="系统服务"
            detail={backendConnected ? "上传与发布功能可用" : "请稍后重试或联系管理员"}
            ready={backendConnected}
          />
          <ReadinessLine
            label="智能生成"
            detail={
              capabilities?.model_credentials_configured ? "智能生成可用" : "智能生成尚未开通"
            }
            ready={capabilities?.model_credentials_configured === true}
          />
          <ReadinessLine
            label="Alibaba.com"
            detail={
              capabilities?.alibaba_credentials_configured ? "真实账户已授权" : "正式发布前需要授权"
            }
            ready={capabilities?.alibaba_credentials_configured === true}
          />
        </aside>
      </div>

      <section className="overview-panel recent-batches-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">最近记录</span>
            <h2>批次结果</h2>
          </div>
          <button type="button" className="text-button" onClick={onNavigateBatches}>
            查看全部 <ArrowRight size={15} />
          </button>
        </div>
        {recentBatches.length ? (
          <div className="recent-batch-list">
            {recentBatches.map((batch) => (
              <button type="button" key={batch.id} onClick={onNavigateBatches}>
                <span className="recent-batch-icon">
                  <Clock size={18} />
                </span>
                <span className="recent-batch-name">
                  <strong>{batch.name}</strong>
                  <small>
                    {batch.id} · {batch.updatedAt}
                  </small>
                </span>
                <span className="recent-batch-count">
                  <strong>{batch.publishedCount}</strong>
                  <small>/ {batch.productCount} 已发布</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <div className="recent-empty">完成的批次会显示在这里。</div>
        )}
      </section>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Package;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <article className={`overview-metric is-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <Icon size={22} weight="duotone" />
    </article>
  );
}

function StageLine({ label, value, total }: { label: string; value: number; total: number }) {
  const percentage = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="stage-line">
      <span>{label}</span>
      <span className="stage-line-track">
        <i style={{ transform: `scaleX(${percentage / 100})` }} />
      </span>
      <strong>
        {value}/{total}
      </strong>
    </div>
  );
}

function ReadinessLine({
  label,
  detail,
  ready,
}: {
  label: string;
  detail: string;
  ready: boolean;
}) {
  return (
    <div className="readiness-line">
      <span className={`readiness-icon ${ready ? "is-ready" : ""}`}>
        {ready ? <CheckCircle size={18} weight="fill" /> : <Clock size={18} />}
      </span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}
