import {
  CaretDown,
  CaretLeft,
  CaretRight,
  FunnelSimple,
  LockSimple,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { BatchRecord, CapabilityResponse, DataMode } from "../types";

type BatchesPageProps = {
  batches: BatchRecord[];
  capabilities: CapabilityResponse | null;
  dataMode: DataMode;
  onNewBatch: () => void;
};

type BatchFilter = "all" | "processing" | "ready" | "failed" | "complete" | "planned";

const filters: Array<{ key: BatchFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "processing", label: "处理中" },
  { key: "ready", label: "准备就绪" },
  { key: "failed", label: "发布失败" },
  { key: "complete", label: "已完成" },
  { key: "planned", label: "已计划" },
];

const statusMeta: Record<
  BatchRecord["status"],
  { label: string; tone: "info" | "success" | "danger" | "warning" }
> = {
  processing: { label: "处理中", tone: "info" },
  ready: { label: "准备就绪", tone: "success" },
  failed: { label: "发布失败", tone: "danger" },
  complete: { label: "已完成", tone: "success" },
  planned: { label: "已计划", tone: "warning" },
};

const formatCount = (value: number) => value.toLocaleString("en-US");

export function BatchesPage({ batches, onNewBatch }: BatchesPageProps) {
  const [filter, setFilter] = useState<BatchFilter>("all");
  const [query, setQuery] = useState("");

  const totals = useMemo(() => {
    const uploaded = batches.reduce((count, batch) => count + batch.productCount, 0);
    const drafted = batches.reduce((count, batch) => count + batch.draftCount, 0);
    const published = batches.reduce((count, batch) => count + batch.publishedCount, 0);
    const attention = batches.reduce(
      (count, batch) =>
        count + (batch.status === "failed" ? batch.productCount - batch.draftCount : 0),
      0,
    );
    return { uploaded, drafted, published, attention };
  }, [batches]);

  const percent = (value: number) =>
    totals.uploaded > 0 ? `${((value / totals.uploaded) * 100).toFixed(1)}%` : "0%";

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

  return (
    <div className="ds-page bt-page">
      <header className="ds-page-header bt-header">
        <h1>批次记录</h1>
        <button type="button" className="ds-button-primary" onClick={onNewBatch}>
          <Plus size={16} weight="bold" />
          新建批次
        </button>
      </header>

      <section className="bt-stats" aria-label="批次汇总">
        <div className="bt-stat">
          <span>商品总数</span>
          <strong>{formatCount(totals.uploaded)}</strong>
          <small>本月总数</small>
        </div>
        <div className="bt-stat is-success">
          <span>草稿成功</span>
          <strong>{formatCount(totals.drafted)}</strong>
          <small>{percent(totals.drafted)}</small>
        </div>
        <div className="bt-stat is-info">
          <span>已发布</span>
          <strong>{formatCount(totals.published)}</strong>
          <small>{percent(totals.published)}</small>
        </div>
        <div className="bt-stat is-brand">
          <span>需要处理</span>
          <strong>{formatCount(totals.attention)}</strong>
          <small>{percent(totals.attention)}</small>
        </div>
      </section>

      <section className="bt-table-shell" aria-label="批次列表">
        <div className="bt-toolbar">
          <div className="bt-tabs" role="tablist" aria-label="批次状态筛选">
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
              </button>
            ))}
          </div>
          <div className="bt-tools">
            <select aria-label="搜索字段" defaultValue="batch">
              <option value="batch">批次</option>
              <option value="store">店铺</option>
            </select>
            <label className="bt-search">
              <span className="sr-only">搜索批次</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="请输入批次名称"
              />
              <MagnifyingGlass size={16} />
            </label>
            <button
              type="button"
              className="bt-reset"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              重置
            </button>
            <button type="button" className="bt-filter" aria-label="更多筛选">
              <FunnelSimple size={16} />
            </button>
          </div>
        </div>

        <table className="bt-table">
          <thead>
            <tr>
              <th>批次</th>
              <th>商品</th>
              <th>完成度</th>
              <th>草稿</th>
              <th>已发布</th>
              <th>状态</th>
              <th>目标店铺</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredBatches.length ? (
              filteredBatches.map((batch) => <BatchRow key={batch.id} batch={batch} />)
            ) : (
              <tr>
                <td colSpan={9} className="bt-empty">
                  {query || filter !== "all"
                    ? "没有符合条件的批次。"
                    : "还没有批次记录，点击右上角「新建批次」开始。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <footer className="bt-pagination">
          <span className="bt-total">共 {filteredBatches.length} 条</span>
          <div className="bt-pager">
            <select aria-label="每页条数" defaultValue="20">
              <option value="20">20条/页</option>
              <option value="50">50条/页</option>
            </select>
            <button type="button" aria-label="上一页" disabled>
              <CaretLeft size={14} />
            </button>
            <button type="button" className="is-current">
              1
            </button>
            <button type="button" aria-label="下一页" disabled>
              <CaretRight size={14} />
            </button>
            <span className="bt-goto">
              前往 <input aria-label="页码" defaultValue="1" /> 页
            </span>
          </div>
        </footer>
      </section>
    </div>
  );
}

function BatchRow({ batch }: { batch: BatchRecord }) {
  const meta = statusMeta[batch.status];
  const action =
    batch.status === "processing"
      ? "继续处理"
      : batch.status === "ready"
        ? "发布"
        : batch.status === "failed"
          ? `查看 ${batch.failedCount ?? 0} 个失败项`
          : batch.status === "complete"
            ? "查看详情"
            : "编辑计划";

  return (
    <tr className={batch.status === "failed" ? "is-failed" : ""}>
      <td>
        <div className="bt-batch">
          <strong>{batch.id}</strong>
          <span>{batch.createdAt}</span>
        </div>
      </td>
      <td className="bt-num">{formatCount(batch.productCount)}</td>
      <td>
        <div className="bt-progress">
          <strong>{batch.completion}%</strong>
          <span
            className={`bt-bar ${batch.status === "failed" ? "is-danger" : batch.completion === 0 ? "is-empty" : ""}`}
            aria-hidden="true"
          >
            <i style={{ width: `${batch.completion}%` }} />
          </span>
        </div>
      </td>
      <td className="bt-num">{formatCount(batch.draftCount)}</td>
      <td className="bt-num">{formatCount(batch.publishedCount)}</td>
      <td>
        <div className="bt-status">
          <span className={`bt-status-label is-${meta.tone}`}>
            <i />
            {meta.label}
          </span>
          {batch.failureReason ? (
            <small className="bt-status-reason">原因：{batch.failureReason}</small>
          ) : null}
          {batch.plannedFor ? (
            <small className="bt-status-note">计划 {batch.plannedFor}</small>
          ) : null}
        </div>
      </td>
      <td>
        <div className="bt-store">
          <span>
            <LockSimple size={13} weight="fill" />
            {batch.targetStore ?? "当前工作区店铺"}
          </span>
          <small>({batch.targetDomain ?? "alibaba.com"})</small>
        </div>
      </td>
      <td className={`bt-time ${batch.status === "failed" ? "is-danger" : ""}`}>
        {batch.updatedAt}
      </td>
      <td>
        <div className="bt-actions">
          {batch.status === "failed" ? (
            <button type="button" className="bt-link">
              {action}
            </button>
          ) : (
            <button type="button" className="bt-action">
              {action}
            </button>
          )}
          <button type="button" className="bt-more" aria-label="更多操作">
            <CaretDown size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}
