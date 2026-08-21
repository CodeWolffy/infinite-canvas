import { ApiError, apiRequest } from "@/services/api/request";

export type PublicModel = {
    id: string;
    name: string;
    displayName: string;
    capability: "image" | "text";
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
    image?: { mediaId: string; url: string };
};

export type GenerationBatchDetail = { batch: GenerationBatch; tasks: GenerationTask[]; referenceMediaIds: string[] };

export async function getPublicModels() {
    return (await apiRequest<{ models: PublicModel[] }>("/api/models")).models;
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

export async function listGenerationBatches() {
    const batches: GenerationBatch[] = [];
    for (;;) {
        const page = (await apiRequest<{ batches: GenerationBatch[] }>(`/api/generation-batches?limit=100&offset=${batches.length}`)).batches;
        batches.push(...page);
        if (page.length < 100) return batches;
    }
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
