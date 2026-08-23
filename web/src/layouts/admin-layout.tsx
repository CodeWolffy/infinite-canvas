import { useState } from "react";
import { App, Button, Input, Modal } from "antd";
import { BarChart3, Cable, History, Images, LayoutDashboard, LogOut, Megaphone, Shapes, UsersRound } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { getAnnouncement, updateAnnouncement } from "@/services/api/preferences";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

const adminLinks = [
    { to: "/admin/users", label: "用户管理", icon: UsersRound },
    { to: "/admin/models", label: "模型管理", icon: Shapes },
    { to: "/admin/channels", label: "渠道管理", icon: Cable },
    { to: "/admin/logs", label: "请求日志", icon: History },
    { to: "/admin/assets", label: "公共素材", icon: Images },
    { to: "/admin/stats", label: "用量统计", icon: BarChart3 },
];

export default function AdminLayout() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const logout = useUserStore((state) => state.logout);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const [announcementOpen, setAnnouncementOpen] = useState(false);
    const [announcementDraft, setAnnouncementDraft] = useState("");
    const [announcementSaving, setAnnouncementSaving] = useState(false);

    const openAnnouncement = () => {
        setAnnouncementDraft("");
        setAnnouncementOpen(true);
        void getAnnouncement().then(setAnnouncementDraft).catch(() => undefined);
    };

    const saveAnnouncement = async () => {
        setAnnouncementSaving(true);
        try {
            await updateAnnouncement(announcementDraft.trim());
            message.success(announcementDraft.trim() ? "公告已发布" : "公告已清空");
            setAnnouncementOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "公告保存失败");
        } finally {
            setAnnouncementSaving(false);
        }
    };

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-50/70 md:flex dark:border-stone-800 dark:bg-stone-950/40">
                <Link to="/admin/users" className="flex h-16 items-center gap-2.5 border-b border-stone-200 px-6 text-sm font-semibold dark:border-stone-800">
                    <span className="size-5 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                    平台管理
                </Link>
                <nav className="flex-1 space-y-1 p-3">
                    {adminLinks.map(({ to, label, icon: Icon }) => (
                        <NavLink key={to} to={to} className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition", isActive ? "bg-stone-950 font-medium text-white dark:bg-stone-100 dark:text-stone-950" : "text-stone-600 hover:bg-black/5 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-100")}>
                            <Icon className="size-4" />{label}
                        </NavLink>
                    ))}
                </nav>
                <div className="border-t border-stone-200 p-4 dark:border-stone-800">
                    <div className="mb-3 min-w-0 px-2"><div className="truncate text-sm font-medium">{user?.displayName}</div><div className="truncate text-xs text-stone-500">@{user?.username}</div></div>
                    <button type="button" className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-stone-500 transition hover:bg-black/5 hover:text-stone-950 dark:hover:bg-white/10 dark:hover:text-stone-100" onClick={() => void logout().then(() => navigate("/login", { replace: true }))}><LogOut className="size-4" />退出登录</button>
                </div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-16 shrink-0 items-center justify-between border-b border-stone-200 px-4 sm:px-6 dark:border-stone-800">
                    <div className="flex items-center gap-2 md:hidden"><span className="size-5 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} /><span className="font-semibold">平台管理</span></div>
                    <nav className="hide-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto md:hidden">{adminLinks.map(({ to, label }) => <NavLink key={to} to={to} className={({ isActive }) => cn("shrink-0 rounded-md px-2 py-1.5 text-sm", isActive ? "font-medium text-stone-950 dark:text-stone-100" : "text-stone-500")}>{label}</NavLink>)}</nav>
                    <div className="ml-auto flex items-center gap-1">
                        <Button type="text" size="small" className="!px-2 text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100" icon={<Megaphone className="size-4" />} onClick={openAnnouncement}>公告</Button>
                        <Link to="/" className="inline-flex size-9 items-center justify-center rounded-lg text-stone-500 transition hover:bg-black/5 hover:text-stone-950 dark:hover:bg-white/10 dark:hover:text-stone-100" title="返回工作台"><LayoutDashboard className="size-4" /></Link>
                        <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className="inline-flex size-9 items-center justify-center rounded-lg text-stone-500 transition hover:bg-black/5 hover:text-stone-950 dark:hover:bg-white/10 dark:hover:text-stone-100" aria-label="切换主题" />
                        <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg text-stone-500 transition hover:bg-black/5 hover:text-stone-950 md:hidden dark:hover:bg-white/10 dark:hover:text-stone-100" title="退出登录" onClick={() => void logout().then(() => navigate("/login", { replace: true }))}><LogOut className="size-4" /></button>
                    </div>
                </header>
                <main className="min-h-0 flex-1 overflow-y-auto"><Outlet /></main>
            </div>
            <Modal
                title="平台公告"
                open={announcementOpen}
                onCancel={() => setAnnouncementOpen(false)}
                okText="发布"
                cancelText="取消"
                confirmLoading={announcementSaving}
                onOk={() => void saveAnnouncement()}
                destroyOnHidden
            >
                <p className="mb-3 mt-1 text-sm leading-6 text-stone-500">公告会显示在所有用户工作台顶部，清空并保存即可撤下。最多 500 字。</p>
                <Input.TextArea rows={4} maxLength={500} showCount value={announcementDraft} onChange={(event) => setAnnouncementDraft(event.target.value)} placeholder="例如：周五 18:00-19:00 渠道维护，期间生成可能失败。" />
            </Modal>
        </div>
    );
}
