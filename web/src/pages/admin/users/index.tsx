import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import dayjs from "dayjs";
import { KeyRound, Plus, Search, UserRoundPlus } from "lucide-react";

import { createAdminUser, getAdminUsers, resetAdminUserPassword, updateAdminUserStatus } from "@/services/api/admin-users";
import type { AuthUser, UserRole } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

type CreateValues = { username: string; displayName: string; temporaryPassword: string; role: UserRole };

export default function AdminUsersPage() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const currentUser = useUserStore((state) => state.user);
    const [keyword, setKeyword] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [resettingUser, setResettingUser] = useState<AuthUser | null>(null);
    const [createForm] = Form.useForm<CreateValues>();
    const [resetForm] = Form.useForm<{ temporaryPassword: string }>();
    const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: getAdminUsers });

    const updateUserCache = (user: AuthUser) => queryClient.setQueryData<AuthUser[]>(["admin", "users"], (users = []) => users.map((item) => (item.id === user.id ? user : item)));
    const createMutation = useMutation({ mutationFn: createAdminUser, onSuccess: (user) => { queryClient.setQueryData<AuthUser[]>(["admin", "users"], (users = []) => [user, ...users]); setCreateOpen(false); createForm.resetFields(); message.success("用户已创建"); }, onError: showError(message.error) });
    const statusMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) => updateAdminUserStatus(id, status), onSuccess: (user) => { updateUserCache(user); message.success(user.status === "active" ? "账号已启用" : "账号已禁用"); }, onError: showError(message.error) });
    const resetMutation = useMutation({ mutationFn: ({ id, temporaryPassword }: { id: string; temporaryPassword: string }) => resetAdminUserPassword(id, temporaryPassword), onSuccess: (user) => { updateUserCache(user); setResettingUser(null); resetForm.resetFields(); message.success("临时密码已重置，现有会话已失效"); }, onError: showError(message.error) });

    const users = useMemo(() => {
        const normalized = keyword.trim().toLowerCase();
        if (!normalized) return usersQuery.data || [];
        return (usersQuery.data || []).filter((user) => `${user.displayName} ${user.username}`.toLowerCase().includes(normalized));
    }, [keyword, usersQuery.data]);

    const changeStatus = (user: AuthUser, active: boolean) => {
        const status = active ? "active" : "disabled";
        if (status === "disabled") {
            modal.confirm({ title: `禁用 ${user.displayName}？`, content: "禁用后该用户的全部现有会话会立即失效。", okText: "确认禁用", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => statusMutation.mutateAsync({ id: user.id, status }) });
            return;
        }
        statusMutation.mutate({ id: user.id, status });
    };

    const columns: TableColumnsType<AuthUser> = [
        { title: "用户", key: "user", fixed: "left", width: 210, render: (_, user) => <div className="min-w-0"><div className="truncate font-medium text-stone-950 dark:text-stone-100">{user.displayName}</div><div className="truncate text-xs text-stone-500">@{user.username}</div></div> },
        { title: "角色", dataIndex: "role", width: 100, render: (role: UserRole) => <Tag color={role === "admin" ? "gold" : "default"}>{role === "admin" ? "管理员" : "普通用户"}</Tag> },
        { title: "首次改密", dataIndex: "mustChangePassword", width: 110, render: (required: boolean) => required ? <Tag color="orange">待修改</Tag> : <span className="text-stone-500">已完成</span> },
        { title: "最近登录", dataIndex: "lastLoginAt", width: 170, render: (value: string | null) => <span className="text-stone-500">{value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "尚未登录"}</span> },
        { title: "创建时间", dataIndex: "createdAt", width: 170, render: (value: string) => <span className="text-stone-500">{dayjs(value).format("YYYY-MM-DD HH:mm")}</span> },
        { title: "启用", dataIndex: "status", width: 90, render: (status: AuthUser["status"], user) => <Switch size="small" checked={status === "active"} disabled={user.id === currentUser?.id || statusMutation.isPending} onChange={(checked) => changeStatus(user, checked)} /> },
        { title: "操作", key: "actions", fixed: "right", width: 120, render: (_, user) => <Button type="text" size="small" disabled={user.id === currentUser?.id} icon={<KeyRound className="size-3.5" />} onClick={() => setResettingUser(user)}>重置密码</Button> },
    ];

    return (
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Access control</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-stone-950 dark:text-stone-100">用户管理</h1><p className="mt-1 text-sm text-stone-500">创建内部账号，控制账号状态和首次改密流程。</p></div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>创建用户</Button>
            </div>
            <div className="mt-7 overflow-hidden rounded-xl border border-stone-200 bg-background dark:border-stone-800">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 p-4 dark:border-stone-800">
                    <Input allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索姓名或用户名" value={keyword} onChange={(event) => setKeyword(event.target.value)} className="max-w-xs" />
                    <span className="text-xs text-stone-500">共 {usersQuery.data?.length || 0} 个账号</span>
                </div>
                <Table<AuthUser> rowKey="id" columns={columns} dataSource={users} loading={usersQuery.isLoading} pagination={false} scroll={{ x: 980 }} locale={{ emptyText: usersQuery.isError ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={usersQuery.error instanceof Error ? usersQuery.error.message : "用户加载失败"} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无用户" /> }} />
            </div>

            <Modal title="创建用户" open={createOpen} footer={null} onCancel={() => setCreateOpen(false)} destroyOnHidden>
                <Form<CreateValues> form={createForm} layout="vertical" requiredMark={false} initialValues={{ role: "user" }} className="pt-3" onFinish={(values) => createMutation.mutate(values)}>
                    <Form.Item name="username" label="用户名" extra="3–64 位，仅支持字母、数字、点、下划线和短横线" rules={[{ required: true, message: "请输入用户名" }, { pattern: /^[a-zA-Z0-9._-]{3,64}$/, message: "用户名格式不正确" }]}><Input autoComplete="off" /></Form.Item>
                    <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: "请输入显示名称" }]}><Input /></Form.Item>
                    <Form.Item name="role" label="角色" rules={[{ required: true }]}><Select options={[{ value: "user", label: "普通用户" }, { value: "admin", label: "管理员" }]} /></Form.Item>
                    <Form.Item name="temporaryPassword" label="临时密码" extra="至少 10 位，用户首次登录后必须修改" rules={[{ required: true, message: "请输入临时密码" }, { min: 10, message: "临时密码至少需要 10 位" }]}><Input.Password autoComplete="new-password" /></Form.Item>
                    <Space className="flex justify-end"><Button onClick={() => setCreateOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={createMutation.isPending} icon={<UserRoundPlus className="size-4" />}>创建账号</Button></Space>
                </Form>
            </Modal>

            <Modal title={`重置 ${resettingUser?.displayName || "用户"} 的密码`} open={Boolean(resettingUser)} footer={null} onCancel={() => setResettingUser(null)} destroyOnHidden>
                <p className="mb-5 text-sm leading-6 text-stone-500">保存后，该用户的全部现有会话会立即失效，下次登录必须修改临时密码。</p>
                <Form form={resetForm} layout="vertical" requiredMark={false} onFinish={({ temporaryPassword }) => resettingUser && resetMutation.mutate({ id: resettingUser.id, temporaryPassword })}>
                    <Form.Item name="temporaryPassword" label="新临时密码" rules={[{ required: true, message: "请输入临时密码" }, { min: 10, message: "临时密码至少需要 10 位" }]}><Input.Password autoComplete="new-password" /></Form.Item>
                    <Space className="flex justify-end"><Button onClick={() => setResettingUser(null)}>取消</Button><Button type="primary" htmlType="submit" loading={resetMutation.isPending}>确认重置</Button></Space>
                </Form>
            </Modal>
        </div>
    );
}

function showError(notify: (content: string) => void) {
    return (error: Error) => notify(error.message || "操作失败");
}
