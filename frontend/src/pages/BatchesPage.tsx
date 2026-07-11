import { ArrowRight, MagnifyingGlass, Package, Plus, WarningCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { BatchRecord, CapabilityResponse, DataMode } from "../types";

type BatchesPageProps = {
  batches: BatchRecord[];
  capabilities: CapabilityResponse | null;
  dataMode: DataMode;
  onNewBatch: () => void;
};

type BatchFilter = "all" | "processing" | "ready" | "failed" | "complete";

const filters: Array<{ key: BatchFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "processing", label: "处理中" },
  { key: "ready", label: "待发布" },
  { key: "failed", label: "需处理" },
  { key: "complete", label: "已完成" },
];

export function BatchesPage({ batches, capabilities, dataMode, onNewBatch }: BatchesPageProps) {
  const [filter, setFilter] = useState<BatchFilter>("all");
  const [query, setQuery] = useState("");
  const connected = capabilities?.alibaba_credentials_configured === true;

  const totals = useMemo(
    () => ({
      uploaded: batches.reduce((count, batch) => count + batch.productCount, 0),
      drafted: batches.reduce((count, batch) => count + batch.draftCount, 0),
      published: batches.reduce((count, batch) => count + batch.publishedCount, 0),
      attention: batches.filter((batch) => batch.status === "failed").length,
    }),
    [batches],
  );

  const filteredBatches = useMemo(
    () =>
      batches.filter((batch) => {
        const matchesFilter = filter === "all" || batch.status === filter;
        const normalizedQuery = query.trim().toLowerCase();
        const matchesQuery =
          !normalizedQuery ||
          batch.name.toLowerCase().includes(normalizedQuery) ||
          batch.id.toLowerCase().includes(normalizedQuery);
        return matchesFilter && matchesQuery;
      }),
    [batches, filter, query],
  );

  const filterCount = (key: BatchFilter) =>
    key === "all" ? batches.length : batches.filter((batch) => batch.status === key).length;

  return (
    <div className="page batches-page">
      <header className="page-header batches-header refined-page-header">
        <div>
          <div className="page-context">
            <span>{dataMode === "demo" ? "演示数据" : "真实记录"}</span>
            <i />
            <span>{connected ? "Alibaba 已授权" : "Alibaba 待授权"}</span>
          </div>
          <h1>批次记录</h1>
          <p>查看每个批次的草稿、发布结果和需要重试的商品。</p>
        </div>
        <button type="button" className="button button-primary button-large" onClick={onNewBatch}>
          <Plus size={18} weight="bold" />
          新建批次
        </button>
      </header>

      <section className="batch-stat-strip" aria-label="批次汇总">
        <BatchStat label="商品总数" value={totals.uploaded} />
        <BatchStat label="草稿成功" value={totals.drafted} />
        <BatchStat label="已发布" value={totals.published} tone="success" />
        <BatchStat label="需要处理" value={totals.attention} tone="warning" />
      </section>

      <section className="batch-table-shell" aria-label="批次列表">
        <div className="batch-toolbar">
          <div className="segmented-tabs" role="tablist" aria-label="批次状态筛选">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                className={filter === item.key ? "is-active" : ""}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
                <span>{filterCount(item.key)}</span>
              </button>
            ))}
          </div>
          <label className="search-field">
            <MagnifyingGlass size={17} />
            <span className="sr-only">搜索批次</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索批次名称或编号"
            />
          </label>
        </div>

        {filteredBatches.length ? (
          <div className="batch-table-scroll">
            <table className="batch-table">
              <thead>
                <tr>
                  <th>批次</th>
                  <th>商品</th>
                  <th>完成度</th>
                  <th>草稿</th>
                  <th>已发布</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((batch) => (
                  <BatchRow key={batch.id} batch={batch} onOpen={onNewBatch} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="batch-empty-state">
            <div className="empty-visual">
              {query || filter !== "all" ? <MagnifyingGlass size={27} /> : <Package size={27} />}
            </div>
            <h2>{query || filter !== "all" ? "没有符合条件的批次" : "还没有真实批次记录"}</h2>
            <p>
              {dataMode === "demo"
                ? "演示记录已被筛选条件隐藏。"
                : "创建批次并上传商品后，进度和结果会自动显示在这里。"}
            </p>
            {!query && filter === "all" ? (
              <button type="button" className="button button-dark" onClick={onNewBatch}>
                创建第一个批次
              </button>
            ) : null}
          </div>
        )}

        {dataMode === "demo" ? (
          <footer className="demo-table-note">
            <WarningCircle size={16} />
            当前为演示记录，所有商品和发布状态均与真实账户隔离。
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function BatchRow({ batch, onOpen }: { batch: BatchRecord; onOpen: () => void }) {
  return (
    <tr className={batch.status === "failed" ? "is-error-row" : ""}>
      <td>
        <div className="batch-name">
          <strong>{batch.name}</strong>
          <span>{batch.id}</span>
        </div>
      </td>
      <td>
        <div className="batch-product-cell">
          <div className="thumbnail-stack" aria-label={`${batch.productCount} 个商品`}>
            {batch.images.slice(0, 3).map((image) => (
              <img key={`${batch.id}-${image}`} src={image} alt="" />
            ))}
          </div>
          <strong>{batch.productCount}</strong>
        </div>
      </td>
      <td>
        <div className="completion-cell">
          <strong>{batch.completion}%</strong>
          <span className="mini-progress" aria-hidden="true">
            <i
              className={batch.completion < 70 ? "is-warning" : ""}
              style={{ transform: `scaleX(${batch.completion / 100})` }}
            />
          </span>
        </div>
      </td>
      <td className="numeric-cell">{batch.draftCount}</td>
      <td className="numeric-cell">{batch.publishedCount}</td>
      <td>
        <StatusBadge status={batch.status} />
      </td>
      <td className="muted-cell">{batch.updatedAt}</td>
      <td>
        <button type="button" className="row-action" onClick={onOpen}>
          继续
          <ArrowRight size={15} />
        </button>
      </td>
    </tr>
  );
}

function BatchStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <div className={`batch-stat is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: BatchRecord["status"] }) {
  const labels: Record<BatchRecord["status"], string> = {
    processing: "处理中",
    ready: "待发布",
    failed: "需处理",
    complete: "已完成",
  };
  return <span className={`status-badge badge-${status}`}>{labels[status]}</span>;
}
