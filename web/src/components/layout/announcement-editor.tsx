import { useEffect, useState } from "react";
import { App, Button, Input, Modal, Segmented, Space, Tabs } from "antd";
import { Plus, Trash2 } from "lucide-react";

import { MarkdownLite } from "@/lib/markdown-lite";
import { getAnnouncement, updateAnnouncement, type ChangelogEntry } from "@/services/api/preferences";

const TAG_PRESETS = ["new", "update", "fix"];
const emptyEntry: ChangelogEntry = { date: "", tag: "new", title: "", body: "" };

export function AnnouncementEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [entries, setEntries] = useState<ChangelogEntry[]>([]);
    const [saving, setSaving] = useState(false);
    const [mode, setMode] = useState<"edit" | "preview">("edit");

    useEffect(() => {
        if (!open) return;
        setMode("edit");
        void getAnnouncement()
            .then((value) => {
                setTitle(value.title);
                setContent(value.content);
                setEntries(value.entries);
            })
            .catch(() => undefined);
    }, [open]);

    const updateEntry = (index: number, patch: Partial<ChangelogEntry>) => {
        setEntries((value) => value.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));
    };

    const save = async () => {
        setSaving(true);
        try {
            const draft = {
                title: title.trim(),
                content: content.trim(),
                entries: entries.filter((entry) => entry.title.trim() || entry.body.trim()),
            };
            await updateAnnouncement(draft);
            message.success(draft.content || draft.entries.length ? "公告已发布" : "公告已清空");
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "公告保存失败");
        } finally {
            setSaving(false);
        }
    };

    const noticeTab = (
        <div className="space-y-3">
            <Input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="公告标题，留空则显示默认标题" />
            <Segmented
                value={mode}
                onChange={(value) => setMode(value as "edit" | "preview")}
                options={[{ label: "编辑", value: "edit" }, { label: "预览", value: "preview" }]}
                size="small"
            />
            {mode === "edit" ? (
                <Input.TextArea
                    rows={12}
                    maxLength={8000}
                    showCount
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    placeholder={"支持 Markdown：\n## 小标题\n- 列表项\n**加粗**、`代码`、[链接](https://example.com)\n> 重点提示会显示为高亮框"}
                />
            ) : (
                <div className="max-h-[24rem] overflow-y-auto rounded-xl border border-stone-200 px-3.5 py-3 dark:border-stone-800">
                    {content.trim() ? <MarkdownLite content={content} /> : <span className="text-sm text-stone-400">暂无内容</span>}
                </div>
            )}
            <p className="m-0 text-xs leading-5 text-stone-500">支持 # 标题、- 列表、**加粗**、`代码`、[链接](url)、&gt; 高亮框、--- 分割线。清空内容并发布即可撤下公告。</p>
        </div>
    );

    const changelogTab = (
        <div className="space-y-3">
            <div className="max-h-[26rem] space-y-3 overflow-y-auto pe-1">
                {entries.map((entry, index) => (
                    <div key={index} className="space-y-2 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                        <Space.Compact block>
                            <Input value={entry.date} maxLength={40} onChange={(event) => updateEntry(index, { date: event.target.value })} placeholder="2026-09-01" className="!w-[9.5rem]" />
                            <Input
                                value={entry.tag}
                                maxLength={20}
                                onChange={(event) => updateEntry(index, { tag: event.target.value })}
                                placeholder="标签"
                                className="!w-[6.5rem]"
                                list={`tag-presets-${index}`}
                            />
                            <datalist id={`tag-presets-${index}`}>{TAG_PRESETS.map((tag) => <option key={tag} value={tag} />)}</datalist>
                            <Input value={entry.title} maxLength={120} onChange={(event) => updateEntry(index, { title: event.target.value })} placeholder="更新标题" />
                            <Button danger icon={<Trash2 className="size-3.5" />} onClick={() => setEntries((value) => value.filter((_, position) => position !== index))} aria-label="删除该条" />
                        </Space.Compact>
                        <Input.TextArea rows={2} maxLength={1000} value={entry.body} onChange={(event) => updateEntry(index, { body: event.target.value })} placeholder="更新说明，支持 Markdown（可留空）" />
                    </div>
                ))}
            </div>
            <Button block icon={<Plus className="size-4" />} onClick={() => setEntries((value) => [{ ...emptyEntry }, ...value])} disabled={entries.length >= 30}>
                新增更新记录
            </Button>
            <p className="m-0 text-xs leading-5 text-stone-500">标签 new / update / fix 会显示为绿 / 蓝 / 橙色，其他标签显示为灰色。最多 30 条。</p>
        </div>
    );

    return (
        <Modal
            title="平台公告"
            open={open}
            onCancel={onClose}
            okText="发布"
            cancelText="取消"
            width={680}
            confirmLoading={saving}
            onOk={() => void save()}
            destroyOnHidden
        >
            <Tabs
                size="small"
                items={[
                    { key: "notice", label: "公告内容", children: noticeTab },
                    { key: "changelog", label: `更新日志${entries.length ? ` (${entries.length})` : ""}`, children: changelogTab },
                ]}
            />
        </Modal>
    );
}
