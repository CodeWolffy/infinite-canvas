import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Empty, Popover, Tabs } from "antd";
import { Bell, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getAnnouncement, type Announcement } from "@/services/api/preferences";
import { MarkdownLite } from "@/lib/markdown-lite";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";

const ANNOUNCEMENT_SEEN_KEY = "announcementSeenAt";

function readSeenAnnouncement(): string {
    try {
        return localStorage.getItem(ANNOUNCEMENT_SEEN_KEY) || "";
    } catch {
        return "";
    }
}

const TAG_CLASS: Record<string, string> = {
    new: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
    fix: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
    update: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
};

function tagClass(tag: string) {
    return TAG_CLASS[tag.trim().toLowerCase()] || "border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300";
}

export function NotificationCenter() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<"announcement" | "system">("announcement");
    const theme = useThemeStore((state) => state.theme);

    // 全站公告查询：缓存 5 分钟
    const announcementQuery = useQuery({
        queryKey: ["announcement"],
        queryFn: getAnnouncement,
        staleTime: 1000 * 60 * 5,
    });

    const [seenAt, setSeenAt] = useState(readSeenAnnouncement);

    const announcement = announcementQuery.data;
    const hasAnnouncementContent = Boolean(
        announcement && (announcement.content.trim() || announcement.entries.some((e) => e.title.trim() || e.body.trim())),
    );
    const announcementUnread = Boolean(
        hasAnnouncementContent &&
        announcement?.publishedAt &&
        announcement.publishedAt !== seenAt,
    );

    const markAnnouncementSeen = useCallback(() => {
        if (!announcement?.publishedAt) return;
        try {
            localStorage.setItem(ANNOUNCEMENT_SEEN_KEY, announcement.publishedAt);
        } catch {
            // ignore
        }
        setSeenAt(announcement.publishedAt);
    }, [announcement]);

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen) {
            void announcementQuery.refetch();
            if (activeTab === "announcement" && announcementUnread) {
                markAnnouncementSeen();
            }
        }
    };

    const handleTabChange = (key: string) => {
        const nextTab = key as "announcement" | "system";
        setActiveTab(nextTab);
        if (nextTab === "announcement" && announcementUnread) {
            markAnnouncementSeen();
        }
    };

    const entries = announcement?.entries.filter((entry) => entry.title.trim() || entry.body.trim()) || [];
    const hasNotice = Boolean(announcement?.content?.trim());

    const popoverContent = (
        <div className="w-[360px] sm:w-[420px]">
            <div className="flex items-center justify-between border-b border-stone-200 pb-2.5 dark:border-stone-800">
                <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">通知中心</span>
                <div className="flex items-center gap-1">
                    <Button
                        type="text"
                        size="small"
                        icon={<RefreshCw className={`size-3.5 ${announcementQuery.isFetching ? "animate-spin" : ""}`} />}
                        onClick={() => void announcementQuery.refetch()}
                        className="text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                    >
                        刷新
                    </Button>
                </div>
            </div>

            <Tabs
                size="small"
                activeKey={activeTab}
                onChange={handleTabChange}
                className="[&_.ant-tabs-nav]:mb-2"
                items={[
                    {
                        key: "announcement",
                        label: (
                            <span className="flex items-center gap-1.5 text-xs">
                                <span>全站公告</span>
                                {announcementUnread ? <span className="size-1.5 rounded-full bg-red-500" /> : null}
                            </span>
                        ),
                        children: (
                            <div className="max-h-[380px] overflow-y-auto pr-1">
                                {hasAnnouncementContent && announcement ? (
                                    <div className="py-2 text-xs">
                                        {announcement.title ? (
                                            <h3 className="mb-2 font-semibold text-stone-950 dark:text-stone-100">{announcement.title}</h3>
                                        ) : null}
                                        {hasNotice ? (
                                            <div className="text-stone-700 dark:text-stone-300">
                                                <MarkdownLite content={announcement.content} />
                                            </div>
                                        ) : null}
                                        {entries.length ? (
                                            <div className={`space-y-3 ${hasNotice ? "mt-3 border-t border-stone-200 pt-3 dark:border-stone-800" : ""}`}>
                                                <p className="mb-2 font-medium text-stone-900 dark:text-stone-100">更新日志</p>
                                                <ol className="m-0 list-none space-y-3 p-0">
                                                    {entries.map((entry, index) => (
                                                        <li key={`${entry.date}-${index}`} className="relative ps-3 before:absolute before:start-0 before:top-[0.45rem] before:size-1.5 before:rounded-full before:bg-stone-300 after:absolute after:start-[0.1875rem] after:top-4 after:bottom-[-0.75rem] after:w-px after:bg-stone-200 last:after:hidden dark:before:bg-stone-600 dark:after:bg-stone-800">
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                {entry.date ? <span className="font-mono text-[11px] text-stone-400">{entry.date}</span> : null}
                                                                {entry.tag ? <span className={`rounded px-1.5 py-0.2 text-[10px] leading-4 border ${tagClass(entry.tag)}`}>{entry.tag}</span> : null}
                                                                {entry.title ? <span className="text-xs font-medium text-stone-900 dark:text-stone-100">{entry.title}</span> : null}
                                                            </div>
                                                            {entry.body ? <MarkdownLite content={entry.body} className="mt-1 text-stone-600 dark:text-stone-300" /> : null}
                                                        </li>
                                                    ))}
                                                </ol>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无全站公告" className="my-8" />
                                )}
                            </div>
                        ),
                    },
                    {
                        key: "system",
                        label: <span className="text-xs">系统通知</span>,
                        children: (
                            <div className="max-h-[380px] overflow-y-auto pr-1">
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无系统通知" className="my-8" />
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );

    return (
        <Popover
            content={popoverContent}
            trigger="click"
            open={open}
            onOpenChange={handleOpenChange}
            placement="bottomRight"
            arrow={false}
            overlayInnerStyle={{ padding: "12px 14px", borderRadius: 12 }}
        >
            <Badge dot={announcementUnread} offset={[-2, 4]}>
                <button
                    type="button"
                    aria-label="通知中心"
                    title="通知中心"
                    style={{ color: canvasThemes[theme].node.text }}
                    className="inline-flex size-7 items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                    <Bell className="size-4" />
                </button>
            </Badge>
        </Popover>
    );
}

export const AnnouncementCenter = NotificationCenter;
