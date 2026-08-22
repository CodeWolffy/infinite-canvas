import { useLayoutEffect, useState, type ReactNode } from "react";
import { Button } from "antd";

import { AgentPanel } from "@/components/agent/agent-panel";
import { Megaphone } from "lucide-react";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { getAnnouncement } from "@/services/api/preferences";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const hydrateProjects = useCanvasStore((state) => state.hydrateProjects);
    const hydrateAssets = useAssetStore((state) => state.hydrateAssets);
    const hydratePlatformModels = useConfigStore((state) => state.hydratePlatformModels);
    const userId = useUserStore((state) => state.user?.id || "");
    const [announcement, setAnnouncement] = useState("");
    const [announcementClosed, setAnnouncementClosed] = useState(() => sessionStorage.getItem("announcementDismissed") === "1");

    useLayoutEffect(() => {
        if (userId) void Promise.all([hydrateProjects(userId), hydrateAssets(userId), hydratePlatformModels()]).catch(() => undefined);
    }, [hydrateAssets, hydratePlatformModels, hydrateProjects, userId]);

    useLayoutEffect(() => {
        let cancelled = false;
        void getAnnouncement().then((content) => {
            if (!cancelled && content) setAnnouncement(content);
        }).catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    const closeAnnouncement = () => {
        sessionStorage.setItem("announcementDismissed", "1");
        setAnnouncementClosed(true);
    };

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                {announcement && !announcementClosed ? (
                    <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                        <Megaphone className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 whitespace-pre-wrap">{announcement}</span>
                        <Button size="small" type="text" className="!text-amber-900 dark:!text-amber-200" onClick={closeAnnouncement}>
                            知道了
                        </Button>
                    </div>
                ) : null}
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
        </div>
    );
}
