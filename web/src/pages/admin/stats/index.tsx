import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, DatePicker, Segmented, Select, Table } from "antd";
import type { TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { Activity, CircleDollarSign, Clock3, Image, ListTodo, MessageSquareText, Send, Waypoints } from "lucide-react";

import { getAdminUsers } from "@/services/api/admin-users";
import { getAdminChannels, getAdminModels, getAdminStats } from "@/services/api/admin-platform";

type Filters = { range: [Dayjs, Dayjs]; userId?: string; modelId?: string; channelId?: string };

export default function AdminStatsPage() {
    const [filters, setFilters] = useState<Filters>(() => ({ range: [dayjs().subtract(29, "day").startOf("day"), dayjs().startOf("day")] }));
    const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: getAdminUsers });
    const modelsQuery = useQuery({ queryKey: ["admin", "models"], queryFn: getAdminModels });
    const channelsQuery = useQuery({ queryKey: ["admin", "channels"], queryFn: getAdminChannels });
    const statsQuery = useQuery({ queryKey: ["admin", "stats", filters.range[0].toISOString(), filters.range[1].toISOString(), filters.userId, filters.modelId, filters.channelId], queryFn: () => getAdminStats({ from: filters.range[0].startOf("day").toISOString(), to: filters.range[1].add(1, "day").startOf("day").toISOString(), userId: filters.userId, modelId: filters.modelId, channelId: filters.channelId }), staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true });
    const totals = statsQuery.data?.totals;
    const setPreset = (days: number) => setFilters((current) => ({ ...current, range: [dayjs().subtract(days - 1, "day").startOf("day"), dayjs().startOf("day")] }));

    return (
        <div className="w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Usage overview</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-stone-950 dark:text-stone-100">用量统计</h1><p className="mt-1 text-sm text-stone-500">按时间、用户、公开模型和实际渠道查看图片任务与内部估算费用。</p></div>
            <div className="mt-7 flex flex-wrap gap-3 rounded-xl border border-stone-200 bg-background p-4 dark:border-stone-800">
                <Segmented options={[{ label: "今天", value: 1 }, { label: "近 7 天", value: 7 }, { label: "近 30 天", value: 30 }]} onChange={(value) => setPreset(Number(value))} />
                <DatePicker.RangePicker value={filters.range} allowClear={false} onChange={(range) => range && setFilters((current) => ({ ...current, range: range as [Dayjs, Dayjs] }))} />
                <Select allowClear placeholder="全部用户" className="min-w-40" value={filters.userId} onChange={(userId) => setFilters((current) => ({ ...current, userId }))} options={(usersQuery.data || []).map((user) => ({ value: user.id, label: user.displayName }))} />
                <Select allowClear placeholder="全部模型" className="min-w-44" value={filters.modelId} onChange={(modelId) => setFilters((current) => ({ ...current, modelId }))} options={(modelsQuery.data || []).map((model) => ({ value: model.id, label: model.displayName }))} />
                <Select allowClear placeholder="全部渠道" className="min-w-40" value={filters.channelId} onChange={(channelId) => setFilters((current) => ({ ...current, channelId }))} options={(channelsQuery.data || []).map((channel) => ({ value: channel.id, label: channel.name }))} />
            </div>
            {statsQuery.isError ? <Alert className="mt-5" type="error" showIcon message="用量统计加载失败" description={statsQuery.error.message || "请稍后重试"} /> : null}
            {statsQuery.data ? <>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                <Metric icon={Send} label="请求图片" value={totals?.requestCount || 0} />
                <Metric icon={Image} label="成功图片" value={totals?.successImageCount || 0} />
                <Metric icon={CircleDollarSign} label="估算费用" value={`¥${Number(totals?.estimatedCost || 0).toFixed(2)}`} />
                <Metric icon={Activity} label="任务成功率" value={percent(totals?.succeededTaskCount, totals?.requestCount)} />
                <Metric icon={Waypoints} label="渠道成功率" value={percent(totals?.succeededAttemptCount, totals?.attemptCount)} />
                <Metric icon={Clock3} label="平均耗时" value={duration(totals?.averageDurationMs || 0)} />
                <Metric icon={Clock3} label="P50 耗时" value={duration(totals?.p50DurationMs || 0)} />
                <Metric icon={Clock3} label="P95 耗时" value={duration(totals?.p95DurationMs || 0)} />
                <Metric icon={ListTodo} label="图片队列" value={`${statsQuery.data?.queue.queuedCount || 0} 排队 / ${statsQuery.data?.queue.runningCount || 0} 运行`} />
                <Metric icon={MessageSquareText} label="文本调用" value={`${statsQuery.data?.textTotals.succeededRequestCount || 0}/${statsQuery.data?.textTotals.requestCount || 0} 成功`} />
            </div>
            <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <StatsTable title="按用户" loading={statsQuery.isLoading} rows={statsQuery.data?.byUsers || []} columns={[{ title: "用户", key: "user", render: (_, row) => <div><div className="font-medium">{row.displayName}</div><div className="text-xs text-stone-500">@{row.username}</div></div> }, ...taskColumns]} />
                <StatsTable title="按模型" loading={statsQuery.isLoading} rows={statsQuery.data?.byModels || []} columns={[{ title: "模型", key: "model", render: (_, row) => <div><div className="font-medium">{row.displayName}</div><div className="text-xs text-stone-500">{row.name}</div></div> }, ...taskColumns]} />
            </div>
            <div className="mt-5"><StatsTable title="按渠道尝试" loading={statsQuery.isLoading} rows={statsQuery.data?.byChannels || []} columns={[{ title: "渠道", dataIndex: "name" }, { title: "尝试数", dataIndex: "attemptCount", width: 90 }, { title: "成功数", dataIndex: "succeededAttemptCount", width: 90 }, { title: "成功率", key: "rate", width: 90, render: (_, row) => percent(row.succeededAttemptCount, row.attemptCount) }, { title: "平均耗时", dataIndex: "averageDurationMs", width: 110, render: duration }, { title: "P50", dataIndex: "p50DurationMs", width: 100, render: duration }, { title: "P95", dataIndex: "p95DurationMs", width: 100, render: duration }]} /></div>
            </> : null}
        </div>
    );
}

const taskColumns = [
    { title: "请求数", dataIndex: "requestCount", width: 90 },
    { title: "成功图片", dataIndex: "successImageCount", width: 100 },
    { title: "估算费用", dataIndex: "estimatedCost", width: 110, render: (value: string) => `¥${Number(value || 0).toFixed(2)}` },
];

function Metric({ icon: Icon, label, value }: { icon: typeof Send; label: string; value: string | number }) {
    return <div className="rounded-xl border border-stone-200 bg-background p-3 dark:border-stone-800"><div className="flex items-center gap-2 text-xs text-stone-500"><Icon className="size-3.5" />{label}</div><div className="mt-2 text-xl font-semibold tracking-[-0.03em] text-stone-950 dark:text-stone-100">{value}</div></div>;
}

function StatsTable<T extends { id: string }>({ title, loading, rows, columns }: { title: string; loading: boolean; rows: T[]; columns: TableColumnsType<T> }) {
    return <section className="overflow-hidden rounded-xl border border-stone-200 bg-background dark:border-stone-800"><div className="border-b border-stone-200 px-4 py-3 text-sm font-medium dark:border-stone-800">{title}</div><Table<T> size="small" rowKey="id" dataSource={rows} columns={columns} loading={loading} pagination={false} /></section>;
}

function percent(value = 0, total = 0) { return total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%"; }
function duration(milliseconds: number) { return milliseconds >= 60_000 ? `${(milliseconds / 60_000).toFixed(1)} 分` : `${(milliseconds / 1000).toFixed(1)} 秒`; }
