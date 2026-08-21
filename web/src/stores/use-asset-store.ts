import { create } from "zustand";

import * as assetApi from "@/services/api/assets";
import { mediaId, mediaUrl } from "@/services/api/media";
import { useUserStore } from "@/stores/use-user-store";

export type AssetKind = "text" | "image" | "video";
export type AssetScope = "private" | "public";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    ownerId?: string;
    scope?: AssetScope;
    editable?: boolean;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type AssetDraft = DistributiveOmit<Asset, "id" | "createdAt" | "updatedAt">;
type AssetStore = {
    hydrated: boolean;
    hydratedUserId: string;
    assets: Asset[];
    hydrateAssets: (userId: string, force?: boolean) => Promise<void>;
    addAsset: (asset: AssetDraft) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

const hydratePromises = new Map<string, Promise<void>>();

function stringMetadata(metadata: Record<string, unknown>, key: string) {
    return typeof metadata[key] === "string" ? (metadata[key] as string) : "";
}

function numberMetadata(metadata: Record<string, unknown>, key: string) {
    return typeof metadata[key] === "number" ? (metadata[key] as number) : 0;
}

function normalizeAsset(record: assetApi.AssetRecord): Asset {
    const metadata = record.metadata || {};
    const user = useUserStore.getState().user;
    const common = {
        id: record.id,
        ownerId: record.ownerId,
        scope: record.scope,
        editable: record.ownerId === user?.id || (user?.role === "admin" && record.scope === "public"),
        title: record.title,
        coverUrl: stringMetadata(metadata, "coverUrl"),
        tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === "string") : [],
        source: stringMetadata(metadata, "source") || undefined,
        note: stringMetadata(metadata, "note") || undefined,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        metadata,
    };
    if (record.type === "text") return { ...common, kind: "text", data: { content: record.content || "" } };
    const url = record.mediaId ? mediaUrl(record.mediaId) : "";
    return {
        ...common,
        kind: "image",
        coverUrl: common.coverUrl || url,
        data: {
            dataUrl: url,
            storageKey: record.mediaId ? `image:${record.mediaId}` : undefined,
            width: numberMetadata(metadata, "width"),
            height: numberMetadata(metadata, "height"),
            bytes: numberMetadata(metadata, "bytes"),
            mimeType: stringMetadata(metadata, "mimeType") || "image/png",
        },
    };
}

function assetInput(asset: AssetDraft | Asset) {
    const metadata = { ...(asset.metadata || {}), tags: asset.tags, source: asset.source || "", note: asset.note || "", coverUrl: asset.coverUrl?.startsWith("data:") ? "" : asset.coverUrl || "" };
    if (asset.kind === "text") return { scope: asset.scope || "private", type: "text" as const, title: asset.title, content: asset.data.content, mediaId: null, metadata };
    if (asset.kind === "video") throw new Error("首版暂不支持视频素材");
    return {
        scope: asset.scope || "private",
        type: "image" as const,
        title: asset.title,
        content: null,
        mediaId: asset.data.storageKey ? mediaId(asset.data.storageKey) : null,
        metadata: { ...metadata, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType },
    };
}

export const useAssetStore = create<AssetStore>()((set, get) => ({
    hydrated: false,
    hydratedUserId: "",
    assets: [],
    hydrateAssets: async (userId, force = false) => {
        if (!force && get().hydrated && get().hydratedUserId === userId) return;
        if (get().hydratedUserId !== userId) set({ assets: [], hydrated: false, hydratedUserId: userId });
        let request = hydratePromises.get(userId);
        if (!request) {
            request = assetApi.listAssets().then((records) => { if (get().hydratedUserId === userId) set({ assets: records.map(normalizeAsset), hydrated: true }); }).finally(() => { hydratePromises.delete(userId); });
            hydratePromises.set(userId, request);
        }
        await request;
    },
    addAsset: (draft) => {
        if (draft.kind === "video") return "";
        const temporaryId = `pending-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        set((state) => ({ assets: [{ ...draft, id: temporaryId, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
        void assetApi
            .createAsset(assetInput(draft))
            .then((record) => set((state) => ({ assets: state.assets.map((asset) => (asset.id === temporaryId ? normalizeAsset(record) : asset)) })))
            .catch(() => set((state) => ({ assets: state.assets.filter((asset) => asset.id !== temporaryId) })));
        return temporaryId;
    },
    updateAsset: (id, patch) => {
        const current = get().assets.find((asset) => asset.id === id);
        if (!current || current.kind === "video" || current.editable === false) return;
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() } as Asset;
        set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? next : asset)) }));
        if (!id.startsWith("pending-")) void assetApi.updateAsset(id, assetInput(next)).then((record) => set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? normalizeAsset(record) : asset)) }))).catch(() => set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? current : asset)) })));
    },
    removeAsset: (id) => {
        const current = get().assets.find((asset) => asset.id === id);
        if (!current || current.editable === false) return;
        set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
        if (!id.startsWith("pending-")) void assetApi.deleteAsset(id).catch(() => set((state) => ({ assets: [current, ...state.assets] })));
    },
    replaceAssets: (assets) => set({ assets }),
    cleanupImages: () => {},
}));
