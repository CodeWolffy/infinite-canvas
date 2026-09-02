import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Empty, Image, Input, Popconfirm, Select, Spin, Tag, Tooltip } from "antd";
import { Clock, Copy, Download, FolderPlus, FolderSync, Info, RefreshCw, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import { saveAs } from "file-saver";

import { createZip } from "@/lib/zip";
import { formatBytes } from "@/lib/image-utils";
import {
    deleteGenerationBatch,
    getGenerationBatch,
    listGenerationBatches,
    type GenerationBatchDetail,
    type GenerationBatchListItem,
} from "@/services/api/generation";
import { createAsset } from "@/services/api/assets";

export default function UserGenerationsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [batches, setBatches] = useState<GenerationBatchListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [batchDetails, setBatchDetails] = useState<Record<string, GenerationBatchDetail>>({});
    const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
    const [savingMedia, setSavingMedia] = useState<Record<string, boolean>>({});
    const [savingBatch, setSavingBatch] = useState<Record<string, boolean>>({});
    const [searchPrompt, setSearchPrompt] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "temporary" | "permanent" | "expiring">("all");

    const loadBatches = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listGenerationBatches(50, 0);
            setBatches(data);
        } catch {
            message.error("获取生图历史失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void loadBatches();
    }, [loadBatches]);

    useEffect(() => {
        const hasActive = batches.some((b) => (b.summary?.activeCount ?? 0) > 0);
        if (!hasActive) return;
        const timer = setInterval(() => {
            void listGenerationBatches(50, 0).then((data) => {
                setBatches(data);
                data.forEach((batch) => {
                    if (batchDetails[batch.id]) {
                        void getGenerationBatch(batch.id).then((detail) => {
                            setBatchDetails((prev) => ({ ...prev, [batch.id]: detail }));
                        }).catch(() => undefined);
                    }
                });
            }).catch(() => undefined);
        }, 3000);
        return () => clearInterval(timer);
    }, [batches, batchDetails]);

    const loadDetail = async (batchId: string) => {
        if (batchDetails[batchId] || loadingDetails[batchId]) return;
        setLoadingDetails((prev) => ({ ...prev, [batchId]: true }));
        try {
            const detail = await getGenerationBatch(batchId);
            setBatchDetails((prev) => ({ ...prev, [batchId]: detail }));
        } catch {
            // ignore
        } finally {
            setLoadingDetails((prev) => ({ ...prev, [batchId]: false }));
        }
    };

    const handleDelete = async (batchId: string) => {
        try {
            await deleteGenerationBatch(batchId);
            setBatches((prev) => prev.filter((b) => b.id !== batchId));
            message.success("已删除该条生图记录");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    };

    const handleCopyPrompt = (prompt: string) => {
        void navigator.clipboard.writeText(prompt);
        message.success("提示词已复制");
    };

    const handleRemix = (batch: GenerationBatchListItem) => {
        navigate("/image", {
            state: {
                prompt: batch.prompt,
                modelId: batch.modelId,
            },
        });
    };

    const handleSaveToAsset = async (batchId: string, mediaId: string, prompt: string) => {
        setSavingMedia((prev) => ({ ...prev, [mediaId]: true }));
        try {
            await createAsset({
                type: "image",
                mediaId,
                title: prompt.slice(0, 40) || "生图素材",
                scope: "private",
            });
            message.success(t("userCenter.savedSuccess"));
            setBatchDetails((prev) => {
                const detail = prev[batchId];
                if (!detail) return prev;
                return {
                    ...prev,
                    [batchId]: {
                        ...detail,
                        tasks: detail.tasks.map((task) =>
                            task.image?.mediaId === mediaId
                                ? { ...task, image: { ...task.image, isSaved: true } }
                                : task,
                        ),
                    },
                };
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "转存失败");
        } finally {
            setSavingMedia((prev) => ({ ...prev, [mediaId]: false }));
        }
    };

    const handleSaveBatchToAssets = async (detail: GenerationBatchDetail) => {
        const unsavedTasks = detail.tasks.filter((task) => task.image?.mediaId && !task.image.isSaved);
        if (!unsavedTasks.length) {
            message.info("该批次所有图片已保存在素材库中");
            return;
        }

        const batchId = detail.batch.id;
        setSavingBatch((prev) => ({ ...prev, [batchId]: true }));
        try {
            let successCount = 0;
            await Promise.all(
                unsavedTasks.map(async (task) => {
                    const mediaId = task.image!.mediaId;
                    try {
                        await createAsset({
                            type: "image",
                            mediaId,
                            title: detail.batch.prompt.slice(0, 40) || "生图素材",
                            scope: "private",
                        });
                        successCount++;
                    } catch {
                        // ignore
                    }
                }),
            );

            message.success(t("userCenter.saveAllSuccess", { count: successCount }));
            setBatchDetails((prev) => ({
                ...prev,
                [batchId]: {
                    ...detail,
                    tasks: detail.tasks.map((task) => ({
                        ...task,
                        image: task.image ? { ...task.image, isSaved: true } : undefined,
                    })),
                },
            }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "整批转存失败");
        } finally {
            setSavingBatch((prev) => ({ ...prev, [batchId]: false }));
        }
    };

    const handleDownloadAll = async (detail: GenerationBatchDetail) => {
        const images = detail.tasks.flatMap((task) => (task.image?.url ? [{ url: task.image.url, name: `image_${task.sequence + 1}.png` }] : []));
        if (!images.length) return;
        try {
            message.loading({ content: "正在打包下载...", key: "download-zip" });
            const zipBlob = await createZip(images.map((img) => ({ url: img.url, filename: img.name })));
            saveAs(zipBlob, `batch_${detail.batch.id.slice(0, 8)}.zip`);
            message.success({ content: "打包下载完成", key: "download-zip" });
        } catch {
            message.error({ content: "打包下载失败", key: "download-zip" });
        }
    };

    const calculateExpiration = (createdAt: string, retentionDays = 7) => {
        const created = new Date(createdAt).getTime();
        const expiresAt = created + retentionDays * 24 * 60 * 60 * 1000;
        const remainingDays = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
        return { expiresAt, remainingDays };
    };

    const filteredBatches = useMemo(() => {
        return batches.filter((batch) => {
            if (searchPrompt.trim() && !batch.prompt.toLowerCase().includes(searchPrompt.trim().toLowerCase())) {
                return false;
            }
            const { remainingDays } = calculateExpiration(batch.createdAt, batch.retentionDays || 7);
            const isExpiring = remainingDays <= 3;
            const detail = batchDetails[batch.id];
            const isAllSaved = Boolean(detail && detail.tasks.length > 0 && detail.tasks.every((t) => t.image?.isSaved));

            if (statusFilter === "expiring" && !isExpiring) return false;
            if (statusFilter === "permanent" && !isAllSaved) return false;
            if (statusFilter === "temporary" && isAllSaved) return false;

            return true;
        });
    }, [batches, batchDetails, searchPrompt, statusFilter]);

    return (
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="m-0 text-xl font-semibold text-stone-950 dark:text-stone-100">
                        {t("userCenter.generationsTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-stone-500">
                        {t("userCenter.generationsDesc")}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void loadBatches()} loading={loading}>
                        刷新
                    </Button>
                    <Link to="/image">
                        <Button type="primary" icon={<Sparkles className="size-4" />}>
                            {t("userCenter.goToGenerate")}
                        </Button>
                    </Link>
                </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 text-xs leading-5 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">
                <Info className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
                <span>{t("userCenter.retentionHint", { days: batches[0]?.retentionDays || 45 })}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Input
                    prefix={<Search className="size-4 text-stone-400" />}
                    placeholder={t("userCenter.searchPromptPlaceholder")}
                    value={searchPrompt}
                    onChange={(e) => setSearchPrompt(e.target.value)}
                    allowClear
                    className="max-w-xs"
                />
                <Select
                    value={statusFilter}
                    onChange={setStatusFilter}
                    className="w-36"
                    options={[
                        { value: "all", label: t("userCenter.filterStatusAll") },
                        { value: "temporary", label: t("userCenter.filterStatusTemporary") },
                        { value: "permanent", label: t("userCenter.filterStatusPermanent") },
                        { value: "expiring", label: t("userCenter.filterStatusExpiring") },
                    ]}
                />
            </div>

            {loading && !batches.length ? (
                <div className="flex h-64 items-center justify-center">
                    <Spin size="large" />
                </div>
            ) : !filteredBatches.length ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("userCenter.emptyGenerations")}
                    className="my-16"
                >
                    <Link to="/image">
                        <Button type="primary" icon={<Sparkles className="size-4" />}>
                            {t("userCenter.goToGenerate")}
                        </Button>
                    </Link>
                </Empty>
            ) : (
                <div className="space-y-4">
                    {filteredBatches.map((batch) => {
                        const { remainingDays } = calculateExpiration(batch.createdAt, batch.retentionDays || 7);
                        const detail = batchDetails[batch.id];
                        const isLoadingDetail = loadingDetails[batch.id];
                        const isExpired = remainingDays <= 0;
                        const isAllSaved = Boolean(detail && detail.tasks.length > 0 && detail.tasks.every((t) => t.image?.isSaved));

                        return (
                            <Card
                                key={batch.id}
                                className="overflow-hidden border-stone-200 transition-shadow hover:shadow-sm dark:border-stone-800"
                                bodyStyle={{ padding: "1rem" }}
                            >
                                <div className="flex flex-col gap-3">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-xs text-stone-500">
                                                {dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm:ss")}
                                            </span>
                                            {isAllSaved ? (
                                                <Tag color="success">{t("userCenter.savedPermanent")}</Tag>
                                            ) : isExpired ? (
                                                <Tag color="error">{t("userCenter.expiresToday")}</Tag>
                                            ) : remainingDays <= 3 ? (
                                                <Tag color="warning" icon={<Clock className="size-3" />}>
                                                    {t("userCenter.expiresInDays", { days: remainingDays })}
                                                </Tag>
                                            ) : (
                                                <Tag color="default" icon={<Clock className="size-3" />}>
                                                    {t("userCenter.expiresInDays", { days: remainingDays })}
                                                </Tag>
                                            )}
                                            {batch.summary && (
                                                <span className="text-xs text-stone-500">
                                                    共 {batch.summary.totalCount} 张 · 成功 {batch.summary.succeededCount}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <Tooltip title={t("userCenter.remixPrompt")}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    className="text-purple-600 hover:text-purple-700 dark:text-purple-400"
                                                    icon={<Wand2 className="size-3.5" />}
                                                    onClick={() => handleRemix(batch)}
                                                />
                                            </Tooltip>
                                            <Tooltip title="复制提示词">
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<Copy className="size-3.5" />}
                                                    onClick={() => handleCopyPrompt(batch.prompt)}
                                                />
                                            </Tooltip>
                                            {detail && !isAllSaved && (
                                                <Tooltip title={t("userCenter.saveAllToAsset")}>
                                                    <Button
                                                        size="small"
                                                        type="text"
                                                        className="text-amber-600 hover:text-amber-700 dark:text-amber-400"
                                                        icon={<FolderSync className="size-3.5" />}
                                                        loading={savingBatch[batch.id]}
                                                        onClick={() => void handleSaveBatchToAssets(detail)}
                                                    />
                                                </Tooltip>
                                            )}
                                            {detail && (
                                                <Tooltip title="下载全部图片">
                                                    <Button
                                                        size="small"
                                                        type="text"
                                                        icon={<Download className="size-3.5" />}
                                                        onClick={() => void handleDownloadAll(detail)}
                                                    />
                                                </Tooltip>
                                            )}
                                            <Popconfirm
                                                title={t("userCenter.deleteBatchConfirm")}
                                                description={t("userCenter.deleteBatchDesc")}
                                                onConfirm={() => void handleDelete(batch.id)}
                                                okText="删除"
                                                cancelText="取消"
                                                okButtonProps={{ danger: true }}
                                            >
                                                <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} />
                                            </Popconfirm>
                                        </div>
                                    </div>

                                    <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-800 dark:bg-stone-900/60 dark:text-stone-200">
                                        <span className="font-medium">{batch.prompt}</span>
                                    </div>

                                    {!detail ? (
                                        <div className="flex items-center justify-between pt-1">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                {batch.summary?.thumbnailMediaIds.map((mediaId) => (
                                                    <img
                                                        key={mediaId}
                                                        src={`/api/media/${mediaId}`}
                                                        alt="Thumbnail"
                                                        className="size-12 rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                                                        loading="lazy"
                                                    />
                                                ))}
                                            </div>
                                            <Button
                                                size="small"
                                                onClick={() => void loadDetail(batch.id)}
                                                loading={isLoadingDetail}
                                            >
                                                查看详情
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 pt-2">
                                            {detail.tasks.map((task) => (
                                                <div
                                                    key={task.id}
                                                    className="group relative flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/40"
                                                >
                                                    {task.image?.url ? (
                                                        <div className="relative aspect-square w-full overflow-hidden bg-stone-100 dark:bg-stone-950">
                                                            <Image
                                                                src={task.image.url}
                                                                alt={batch.prompt}
                                                                className="h-full w-full object-cover"
                                                                preview={{ mask: "点击放大预览" }}
                                                            />
                                                            <div className="absolute top-2 right-2 z-10">
                                                                {task.image.isSaved ? (
                                                                    <Tag color="success" className="!m-0">
                                                                        {t("userCenter.savedPermanent")}
                                                                    </Tag>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex aspect-square w-full items-center justify-center p-3 text-center text-xs text-stone-400">
                                                            {task.status === "failed" ? (
                                                                <span className="text-red-500">生成失败: {task.errorMessage || "未知错误"}</span>
                                                            ) : (
                                                                <span>{t(`userCenter.task${task.status.charAt(0).toUpperCase() + task.status.slice(1)}`)}</span>
                                                            )}
                                                        </div>
                                                    )}

                                                    {task.image?.mediaId && (
                                                        <div className="flex items-center justify-between border-t border-stone-200 p-2 text-xs dark:border-stone-800">
                                                            <span className="font-mono text-stone-400">
                                                                {task.image.bytes ? formatBytes(task.image.bytes) : ""}
                                                            </span>
                                                            <div className="flex items-center gap-1">
                                                                {!task.image.isSaved ? (
                                                                    <Tooltip title={t("userCenter.saveToAsset")}>
                                                                        <Button
                                                                            size="small"
                                                                            type="text"
                                                                            icon={<FolderPlus className="size-3.5 text-amber-600" />}
                                                                            loading={savingMedia[task.image.mediaId]}
                                                                            onClick={() =>
                                                                                handleSaveToAsset(
                                                                                    batch.id,
                                                                                    task.image!.mediaId,
                                                                                    batch.prompt,
                                                                                )
                                                                            }
                                                                        />
                                                                    </Tooltip>
                                                                ) : null}
                                                                <a
                                                                    href={task.image.url}
                                                                    download={`image_${task.sequence + 1}.png`}
                                                                    className="inline-flex size-6 items-center justify-center rounded text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
                                                                >
                                                                    <Download className="size-3.5" />
                                                                </a>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
