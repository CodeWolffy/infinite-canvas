import { ApiError, apiRequest } from "@/services/api/request";

export type PublicModel = {
    id: string;
    name: string;
    displayName: string;
    capability: "image" | "text";
    sortOrder: number;
    description: string | null;
};

export type UploadedMedia = {
    id: string;
    originalName: string;
    mimeType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    createdAt: string;
    url: string;
};

export type GenerationBatch = {
    id: string;
    canvasProjectId: string | null;
    modelId: string;
    prompt: string;
    requestedCount: number;
    parameters: Record<string, unknown>;
    createdAt: string;
    retentionDays?: number;
};

export type GenerationTask = {
    id: string;
    batchId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    sequence: number;
    errorCode: string | null;
    errorMessage: string | null;
    queuedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    modelName: string | null;
    modelDisplayName: string | null;
    image?: { mediaId: string; url: string; mimeType?: string; bytes?: number; width?: number | null; height?: number | null; isSaved?: boolean };
};

export type GenerationBatchDetail = { batch: GenerationBatch; tasks: GenerationTask[]; referenceMediaIds: string[] };

export type GenerationBatchSummary = {
    totalCount: number;
    succeededCount: number;
    failedCount: number;
    activeCount: number;
    savedCount: number;
    thumbnailMediaIds: string[];
};

export type GenerationBatchListItem = GenerationBatch & { summary: GenerationBatchSummary };

export type GenerationBatchPage = { batches: GenerationBatchListItem[]; hasMore: boolean };

/** 服务端单页上限 100，永远不要一次把用户的全部生图历史拉下来。 */
export const GENERATION_PAGE_SIZE = 50;

const publicModelsCacheTtl = 60_000;
let publicModelsCache: { models: PublicModel[]; expiresAt: number } | null = null;

export async function getPublicModels() {
    if (!publicModelsCache || publicModelsCache.expiresAt <= Date.now()) {
        publicModelsCache = { models: (await apiRequest<{ models: PublicModel[] }>("/api/models")).models, expiresAt: Date.now() + publicModelsCacheTtl };
    }
    return publicModelsCache.models;
}

export async function getGenerationPreferences() {
    return (await apiRequest<{ preferences: Record<string, unknown> }>("/api/preferences")).preferences;
}

export async function updateGenerationPreferences(preferences: Record<string, unknown>) {
    return (await apiRequest<{ preferences: Record<string, unknown> }>("/api/preferences", { method: "PUT", body: preferences })).preferences;
}

export async function uploadGenerationMedia(input: Blob, filename = "reference.png") {
    const form = new FormData();
    form.append("file", input, filename);
    const response = await fetch("/api/media", { method: "POST", body: form, credentials: "include" });
    if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
        if (response.status === 401) window.dispatchEvent(new Event("auth:unauthorized"));
        if (payload?.error === "password_change_required") window.dispatchEvent(new Event("auth:password-change-required"));
        throw new ApiError(payload?.message || `上传失败（HTTP ${response.status}）`, response.status, payload?.error);
    }
    return ((await response.json()) as { media: UploadedMedia }).media;
}

export async function createGenerationBatch(input: { modelId: string; prompt: string; count: number; parameters: Record<string, unknown>; referenceMediaIds: string[]; canvasProjectId?: string }) {
    return await apiRequest<{ batch: GenerationBatch; tasks: GenerationTask[] }>("/api/generation-batches", { method: "POST", body: input });
}

export async function listGenerationBatches(limit = GENERATION_PAGE_SIZE, offset = 0): Promise<GenerationBatchPage> {
    const batches = (await apiRequest<{ batches: GenerationBatchListItem[] }>(`/api/generation-batches?limit=${limit}&offset=${offset}`)).batches;
    return { batches, hasMore: batches.length === limit };
}

export async function getGenerationBatch(id: string) {
    return await apiRequest<GenerationBatchDetail>(`/api/generation-batches/${id}`);
}

export async function deleteGenerationBatch(id: string) {
    await apiRequest<void>(`/api/generation-batches/${id}`, { method: "DELETE" });
}

export async function retryGenerationTask(taskId: string) {
    return (await apiRequest<{ task: GenerationTask }>(`/api/generation-batches/tasks/${taskId}/retry`, { method: "POST" })).task;
}
