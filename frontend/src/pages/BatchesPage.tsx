import { ArrowRight, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { sampleBatches } from "../data";
import type { BatchRecord, CapabilityResponse } from "../types";

type BatchesPageProps = {
  capabilities: CapabilityResponse | null;
  onNewBatch: () => void;
};

type BatchFilter = "all" | "processing" | "ready" | "failed" | "complete";

const filters: Array<{ key: BatchFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "processing", label: "处理中" },
  { key: "ready", label: "待发布" },
  { key: "failed", label: "审核异常" },
  { key: "complete", label: "已完成" },
];

export function BatchesPage({ capabilities, onNewBatch }: BatchesPageProps) {
  const [filter, setFilter] = useState<BatchFilter>("all");
  const [query, setQuery] = useState("");
  const connected = capabilities?.alibaba_credentials_configured === true;
  const totals = useMemo(
    () => ({
      uploaded: sampleBatches.reduce((count, batch) => count + batch.productCount, 0),
      drafted: sampleBatches.reduce((count, batch) => count + batch.draftCount, 0),
      published: sampleBatches.reduce((count, batch) => count + batch.publishedCount, 0),
      attention: sampleBatches.filter((batch) => batch.status !== "complete").length,
    }),
    [],
  );

  const batches = useMemo(
    () =>
      sampleBatches.filter((batch) => {
        const matchesFilter = filter === "all" || batch.status === filter;
        const normalizedQuery = query.trim().toLowerCase();
        const matchesQuery =
          !normalizedQuery ||
          batch.name.toLowerCase().includes(normalizedQuery) ||
          batch.id.toLowerCase().includes(normalizedQuery);
        return matchesFilter && matchesQuery;
      }),
    [filter, query],
  );
  const filterCount = (key: BatchFilter) =>
    key === "all"
      ? sampleBatches.length
      : sampleBatches.filter((batch) => batch.status === key).length;

  return (
    <div className="page batches-page">
      <header className="page-header batches-header">
        <div>
          <span className="eyebrow">发布记录</span>
          <h1>批次记录</h1>
          <p>继续未完成的工作，或处理发布后的异常。</p>
        </div>
        <div className="header-actions">
          <div className="account-status">
            <span className="alibaba-symbol small">a</span>
            <div>
              <strong>Alibaba.com</strong>
              <span>
                <i className={`connection-dot ${connected ? "is-online" : "is-offline"}`} />
                {connected ? "已连接" : "演示模式"}
              </span>
            </div>
          </div>
          <button type="button" className="button button-dark button-large" onClick={onNewBatch}>
            <Plus size={20} />
            新建上品批次
          </button>
        </div>
      </header>

      <div className="batch-layout">
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
              <MagnifyingGlass size={18} />
              <span className="sr-only">搜索批次</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索批次名称或批次 ID"
              />
            </label>
          </div>

          <div className="batch-table-scroll">
            <table className="batch-table">
              <thead>
                <tr>
                  <th>批次</th>
                  <th>创建时间</th>
                  <th>商品</th>
                  <th>资料完整度</th>
                  <th>草稿</th>
                  <th>发布</th>
                  <th>审核</th>
                  <th>最近更新</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <BatchRow key={batch.id} batch={batch} onOpen={onNewBatch} />
                ))}
              </tbody>
            </table>
            {batches.length === 0 ? (
              <div className="table-empty">
                <strong>没有匹配的批次</strong>
                <p>尝试更改筛选条件或搜索内容。</p>
              </div>
            ) : null}
          </div>

          <footer className="table-footer">
            <span>共 {batches.length} 条</span>
            <span>演示记录 · 全部展示</span>
          </footer>
        </section>

        <aside className="weekly-summary">
          <span className="eyebrow">演示数据</span>
          <h2>批次汇总</h2>
          <div className="summary-metrics">
            <SummaryMetric label="已上传" value={String(totals.uploaded)} />
            <SummaryMetric label="已建草稿" value={String(totals.drafted)} />
            <SummaryMetric label="已发布" value={String(totals.published)} tone="success" />
            <SummaryMetric label="待处理批次" value={String(totals.attention)} tone="danger" />
          </div>
          <p>连接真实业务数据后自动更新</p>
        </aside>
      </div>
    </div>
  );
}

function BatchRow({ batch, onOpen }: { batch: BatchRecord; onOpen: () => void }) {
  const isCurrentDemoBatch = batch.id === "B250521-001";
  return (
    <tr className={batch.status === "failed" ? "is-error-row" : ""}>
      <td>
        <div className="batch-name">
          <strong>{batch.name}</strong>
          <span>批次 ID: {batch.id}</span>
        </div>
      </td>
      <td className="muted-cell">{batch.createdAt}</td>
      <td>
        <div className="thumbnail-stack" aria-label={`${batch.productCount} 个商品`}>
          {batch.images.map((image) => (
            <img key={image} src={image} alt="" />
          ))}
          {batch.productCount > 3 ? <span>+{batch.productCount - 3}</span> : null}
        </div>
      </td>
      <td>
        <div className="completion-cell">
          <strong>{batch.completion}%</strong>
          <span className="mini-progress" aria-hidden="true">
            <i
              className={batch.completion < 70 ? "is-warning" : ""}
              style={{ width: `${batch.completion}%` }}
            />
          </span>
        </div>
      </td>
      <td>
        <StatusBadge tone="info" label={batch.draftCount ? "已完成" : "未开始"} />
        <small>
          {batch.draftCount}/{batch.productCount}
        </small>
      </td>
      <td>
        <StatusBadge
          tone={
            batch.status === "failed"
              ? "danger"
              : batch.publishedCount === batch.productCount
                ? "success"
                : "warning"
          }
          label={
            batch.status === "failed"
              ? "发布失败"
              : batch.publishedCount === batch.productCount
                ? "已发布"
                : "待发布"
          }
        />
        <small>
          {batch.publishedCount}/{batch.productCount}
        </small>
      </td>
      <td>
        <span
          className={`review-label ${
            batch.reviewStatus === "failed"
              ? "is-danger"
              : batch.reviewStatus === "passed"
                ? "is-success"
                : ""
          }`}
        >
          {batch.reviewLabel}
        </span>
      </td>
      <td className="muted-cell">{batch.updatedAt}</td>
      <td>
        {isCurrentDemoBatch ? (
          <button type="button" className="row-action" onClick={onOpen}>
            继续编辑
            <ArrowRight size={15} />
          </button>
        ) : (
          <span className="row-action row-action-muted">演示记录</span>
        )}
      </td>
    </tr>
  );
}

function StatusBadge({
  tone,
  label,
}: {
  tone: "info" | "success" | "warning" | "danger";
  label: string;
}) {
  return <span className={`status-badge badge-${tone}`}>{label}</span>;
}

function SummaryMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  return (
    <div className={`summary-metric ${tone ? `is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
