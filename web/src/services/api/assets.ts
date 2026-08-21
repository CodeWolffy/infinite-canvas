import { apiRequest } from "@/services/api/request";

export type AssetScope = "private" | "public";
export type AssetType = "image" | "text";

export type AssetRecord = {
    id: string;
    ownerId: string;
    scope: AssetScope;
    type: AssetType;
    title: string;
    content: string | null;
    mediaId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export type AssetInput = {
    scope?: AssetScope;
    type: AssetType;
    title: string;
    content?: string | null;
    mediaId?: string | null;
    metadata?: Record<string, unknown>;
};

export async function listAssets(scope: AssetScope | "all" = "all") {
    return (await apiRequest<{ assets: AssetRecord[] }>(`/api/assets?scope=${scope}`)).assets;
}

export async function createAsset(input: AssetInput) {
    return (await apiRequest<{ asset: AssetRecord }>("/api/assets", { method: "POST", body: input })).asset;
}

export async function updateAsset(id: string, input: Partial<AssetInput>) {
    return (await apiRequest<{ asset: AssetRecord }>(`/api/assets/${id}`, { method: "PUT", body: input })).asset;
}

export async function deleteAsset(id: string) {
    await apiRequest<void>(`/api/assets/${id}`, { method: "DELETE" });
}
