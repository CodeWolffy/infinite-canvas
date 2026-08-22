import { apiRequest, serializeApiParams } from "@/services/api/request";

export type AdminModel = {
    id: string;
    name: string;
    displayName: string;
    capability: "image" | "text";
    sortOrder: number;
    status: "draft" | "published" | "disabled";
    pricePerImage: string | null;
    description: string | null;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export type AdminChannel = {
    id: string;
    name: string;
    protocol: "openai" | "gemini";
    baseUrl: string;
    status: "active" | "disabled" | "needs_attention";
    timeoutMs: number;
    maxConcurrency: number;
    apiKeyConfigured: boolean;
    apiKeyHint: string | null;
    cooldownUntil: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastErrorCode: string | null;
    lastAttempt?: {
        status: "running" | "succeeded" | "failed";
        durationMs: number | null;
        httpStatus: number | null;
        errorCategory: string | null;
        errorMessage: string | null;
        upstreamModel: string;
        startedAt: string;
        finishedAt: string | null;
    } | null;
    createdAt: string;
    updatedAt: string;
};

export type ModelChannelBinding = {
    modelId: string;
    channelId: string;
    channelName: string;
    channelStatus: AdminChannel["status"];
    upstreamModel: string;
    priority: number;
    weight: number;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
};

export type ModelInput = Pick<AdminModel, "name" | "displayName" | "capability" | "status"> & { sortOrder?: number; pricePerImage?: string | number | null; description?: string | null; config?: Record<string, unknown> };
export type ChannelInput = Pick<AdminChannel, "name" | "protocol" | "baseUrl" | "status" | "timeoutMs" | "maxConcurrency"> & { apiKey?: string };
export type BindingInput = Pick<ModelChannelBinding, "upstreamModel" | "priority" | "weight" | "enabled">;

export async function getAdminModels() {
    return (await apiRequest<{ models: AdminModel[] }>("/api/admin/models")).models;
}

export async function createAdminModel(input: ModelInput) {
    return (await apiRequest<{ model: AdminModel }>("/api/admin/models", { method: "POST", body: input })).model;
}

export async function updateAdminModel(id: string, input: Partial<ModelInput>) {
    return (await apiRequest<{ model: AdminModel }>(`/api/admin/models/${id}`, { method: "PUT", body: input })).model;
}

export async function updateAdminModelStatus(id: string, status: AdminModel["status"]) {
    return (await apiRequest<{ model: AdminModel }>(`/api/admin/models/${id}/status`, { method: "PATCH", body: { status } })).model;
}

export async function deleteAdminModel(id: string) {
    await apiRequest<void>(`/api/admin/models/${id}`, { method: "DELETE" });
}

export async function getModelChannelBindings(modelId: string) {
    return (await apiRequest<{ bindings: ModelChannelBinding[] }>(`/api/admin/models/${modelId}/channels`)).bindings;
}

export async function saveModelChannelBinding(modelId: string, channelId: string, input: BindingInput) {
    await apiRequest(`/api/admin/models/${modelId}/channels/${channelId}`, { method: "PUT", body: input });
}

export async function deleteModelChannelBinding(modelId: string, channelId: string) {
    await apiRequest<void>(`/api/admin/models/${modelId}/channels/${channelId}`, { method: "DELETE" });
}

export async function getAdminChannels() {
    return (await apiRequest<{ channels: AdminChannel[] }>("/api/admin/channels")).channels;
}

export async function createAdminChannel(input: ChannelInput) {
    return (await apiRequest<{ channel: AdminChannel }>("/api/admin/channels", { method: "POST", body: input })).channel;
}

export async function updateAdminChannel(id: string, input: Partial<ChannelInput>) {
    return (await apiRequest<{ channel: AdminChannel }>(`/api/admin/channels/${id}`, { method: "PUT", body: input })).channel;
}

export async function deleteAdminChannel(id: string) {
    await apiRequest<void>(`/api/admin/channels/${id}`, { method: "DELETE" });
}

export async function fetchAdminChannelModels(id: string) {
    return await apiRequest<{ models: string[]; health: { ok: true; checkedAt: string } }>(`/api/admin/channels/${id}/models`, { method: "POST" });
}

export type AdminStats = {
    range: { from: string; to: string };
    filters: { userId?: string; modelId?: string; channelId?: string };
    storage: { totalCount: number; totalBytes: number };
    queue: { queuedCount: number; runningCount: number };
    textTotals: { requestCount: number; succeededRequestCount: number; failedRequestCount: number };
    totals: { requestCount: number; succeededTaskCount: number; averageDurationMs: number; p50DurationMs: number; p95DurationMs: number; successImageCount: number; estimatedCost: string; attemptCount: number; succeededAttemptCount: number };
    byUsers: Array<{ id: string; username: string; displayName: string; requestCount: number; successImageCount: number; estimatedCost: string }>;
    byModels: Array<{ id: string; name: string; displayName: string; requestCount: number; successImageCount: number; estimatedCost: string }>;
    byChannels: Array<{ id: string; name: string; attemptCount: number; succeededAttemptCount: number; averageDurationMs: number; p50DurationMs: number; p95DurationMs: number }>;
};

export async function getAdminStats(params: { from?: string; to?: string; userId?: string; modelId?: string; channelId?: string }) {
    const query = serializeApiParams(params);
    return await apiRequest<AdminStats>(`/api/admin/stats${query.size ? `?${query}` : ""}`);
}
