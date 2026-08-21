import { useEffect, useState } from "react";
import { Alert, Button, Form, Input } from "antd";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type LoginValues = { username: string; password: string };

export default function LoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const status = useUserStore((state) => state.status);
    const initialize = useUserStore((state) => state.initialize);
    const login = useUserStore((state) => state.login);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        void initialize();
    }, [initialize]);

    if (user) return <Navigate to={user.mustChangePassword ? "/change-password" : "/"} replace />;

    const submit = async (values: LoginValues) => {
        setSubmitting(true);
        setError("");
        try {
            const loggedInUser = await login(values);
            const target = (location.state as { from?: string } | null)?.from || "/";
            navigate(loggedInUser.mustChangePassword ? "/change-password" : target, { replace: true });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "登录失败，请稍后重试");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="relative grid h-dvh overflow-y-auto bg-background px-5 py-8 text-foreground lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,.9fr)] lg:p-4">
            <section className="relative hidden overflow-hidden rounded-2xl bg-stone-950 p-12 text-white lg:flex lg:flex-col lg:justify-between dark:bg-stone-900">
                <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_20%_20%,rgba(255,255,255,.18),transparent_28%),radial-gradient(circle_at_80%_70%,rgba(168,162,158,.25),transparent_30%)]" />
                <div className="relative flex items-center gap-3 text-sm font-medium tracking-wide">
                    <span className="size-6 bg-white" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                    INFINITE CANVAS
                </div>
                <div className="relative max-w-xl">
                    <p className="mb-5 text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">Internal creative workspace</p>
                    <h1 className="text-5xl font-semibold leading-[1.08] tracking-[-0.045em]">把灵感、生成与画布，收进同一个工作空间。</h1>
                    <p className="mt-7 max-w-lg text-base leading-7 text-stone-400">使用公司分配的账号登录。模型、渠道和创作数据由平台统一管理。</p>
                </div>
                <p className="relative text-xs text-stone-500">仅供公司内部授权成员使用</p>
            </section>

            <section className="relative flex items-center justify-center px-1 py-8 sm:px-10 lg:px-16">
                <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className="absolute right-1 top-0 inline-flex size-9 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 dark:hover:bg-stone-800 sm:right-10 sm:top-6" aria-label="切换主题" />
                <div className="w-full max-w-sm">
                    <div className="mb-10 lg:hidden"><span className="inline-flex items-center gap-2 text-sm font-semibold"><span className="size-5 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />Infinite Canvas</span></div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">欢迎回来</p>
                    <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-stone-950 dark:text-stone-100">登录创作平台</h2>
                    <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">请输入管理员为你创建的账号和密码。</p>
                    {error || status === "error" ? <Alert className="mt-6" type="error" showIcon message={error || "暂时无法连接到平台服务"} /> : null}
                    <Form<LoginValues> layout="vertical" requiredMark={false} className="mt-8" onFinish={(values) => void submit(values)}>
                        <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                            <Input size="large" prefix={<UserRound className="size-4 text-stone-400" />} autoComplete="username" placeholder="请输入用户名" autoFocus />
                        </Form.Item>
                        <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                            <Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} autoComplete="current-password" placeholder="请输入密码" />
                        </Form.Item>
                        <Button type="primary" size="large" htmlType="submit" loading={submitting || status === "loading"} block className="mt-2" iconPosition="end" icon={<ArrowRight className="size-4" />}>登录</Button>
                    </Form>
                </div>
            </section>
        </main>
    );
}
