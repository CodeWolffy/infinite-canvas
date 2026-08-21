import { apiRequest } from "@/services/api/request";

export type TextMessage = { id: string; role: "system" | "user" | "assistant"; content: string; createdAt: string };

export async function createTextConversation(input: { canvasProjectId?: string; title?: string }) {
    return (await apiRequest<{ conversation: { id: string; title: string; canvasProjectId: string | null } }>("/api/text/conversations", { method: "POST", body: input })).conversation;
}

export async function createTextRequest(input: {
    requestId: string;
    conversationId?: string;
    canvasProjectId?: string;
    title?: string;
    modelId: string;
    content: string;
    attachmentMediaIds?: string[];
    parameters?: Record<string, unknown>;
}, signal?: AbortSignal) {
    return apiRequest<{ conversationId: string; requestId: string; message: TextMessage }>("/api/text/requests", { method: "POST", body: input, signal });
}

export async function listTextConversations() {
    return (await apiRequest<{ conversations: Array<{ id: string; title: string; canvasProjectId: string | null; createdAt: string; updatedAt: string }> }>("/api/text/conversations")).conversations;
}

export async function getTextConversation(id: string) {
    return apiRequest<{
        conversation: { id: string; title: string; canvasProjectId: string | null };
        messages: TextMessage[];
        latestRequest: { id: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; errorCode: string | null; responseMessageId: string | null; createdAt: string; finishedAt: string | null } | null;
    }>(`/api/text/conversations/${id}`);
}

export async function getTextRequest(id: string) {
    return apiRequest<{
        request: { id: string; conversationId: string; responseMessageId: string | null; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; errorCode: string | null; createdAt: string; finishedAt: string | null };
        message: TextMessage | null;
    }>(`/api/text/requests/${id}`);
}
