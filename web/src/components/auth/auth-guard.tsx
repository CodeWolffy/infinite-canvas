import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Spin } from "antd";

import { useUserStore } from "@/stores/use-user-store";

export function AuthGuard({ children }: { children: ReactNode }) {
    const location = useLocation();
    const user = useUserStore((state) => state.user);
    const status = useUserStore((state) => state.status);
    const initialize = useUserStore((state) => state.initialize);
    const clearSession = useUserStore((state) => state.clearSession);
    const requirePasswordChange = useUserStore((state) => state.requirePasswordChange);

    useEffect(() => {
        void initialize();
    }, [initialize]);

    useEffect(() => {
        window.addEventListener("auth:unauthorized", clearSession);
        window.addEventListener("auth:password-change-required", requirePasswordChange);
        return () => {
            window.removeEventListener("auth:unauthorized", clearSession);
            window.removeEventListener("auth:password-change-required", requirePasswordChange);
        };
    }, [clearSession, requirePasswordChange]);

    if (status === "idle" || status === "loading") {
        return <div className="grid h-dvh place-items-center bg-background"><Spin size="large" /></div>;
    }
    if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
    if (user.mustChangePassword && location.pathname !== "/change-password") return <Navigate to="/change-password" replace />;
    return children;
}

export function AdminGuard({ children }: { children: ReactNode }) {
    const user = useUserStore((state) => state.user);
    return user?.role === "admin" ? children : <Navigate to="/" replace />;
}
