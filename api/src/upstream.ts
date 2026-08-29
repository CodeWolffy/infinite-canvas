import { fileTypeFromBuffer } from "file-type";
import type { ChannelCandidate } from "./channel-scheduler.js";
import { UpstreamError } from "./channel-scheduler.js";
import { config } from "./config.js";

type ReferenceImage = { buffer: Buffer; mimeType: string; filename: string };
type TextImage = { buffer: Buffer; mimeType: string };
type TextMessage = { role: string; content: string; images?: TextImage[] };
const geminiAspectRatios = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
const maxGeneratedMb = Math.round(config.MAX_GENERATED_BYTES / (1024 * 1024));

function decodeBase64Image(value: string) {
  if (value.length > Math.ceil(config.MAX_GENERATED_BYTES * 4 / 3) + 16) {
    throw new UpstreamError(`生成图片超过 ${maxGeneratedMb}MB`, "image_too_large", undefined, "never");
  }
  return Buffer.from(value, "base64");
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function openAIParameters(parameters: Record<string, unknown>, reserved: string[]) {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => !reserved.includes(key)));
}

function closestGeminiAspectRatio(width: number, height: number) {
  const target = width / height;
  return geminiAspectRatios.reduce((best, item) => {
    const ratio = (value: string) => value.split(":").map(Number).reduce((left, right) => left / right);
    return Math.abs(ratio(item) - target) < Math.abs(ratio(best) - target) ? item : best;
  });
}

function upstreamMessage(message: string) {
  try {
    const value = JSON.parse(message) as { error?: { message?: unknown } | unknown; message?: unknown };
    const error = value.error;
    const nested = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
    const text = nested ?? value.message;
    if (typeof text === "string" && text.trim()) return text.trim().slice(0, 1000);
  } catch {
    // Keep plain-text upstream responses as-is.
  }
  return message.trim().replace(/\s+/g, " ").slice(0, 1000);
}

function classifyHttp(status: number, message: string) {
  const detail = upstreamMessage(message);
  const lower = `${message} ${detail}`.toLowerCase();
  const contentPolicy =
    status === 451 ||
    (lower.includes("content") && (lower.includes("policy") || lower.includes("safety") || lower.includes("moderation"))) ||
    lower.includes("prompt is considered unsafe") ||
    lower.includes("prompt considered unsafe") ||
    lower.includes("cannot be used to generate content");
  if (contentPolicy) {
    return new UpstreamError("内容审核拒绝：上游判定提示词或参考图不安全，请修改后重试", "content_policy", status, "never");
  }
  if (status === 429 || status >= 500 || status === 401 || status === 403) {
    return new UpstreamError(`上游返回 HTTP ${status}${detail ? `：${detail}` : ""}`, `http_${status}`, status, "always");
  }
  if (status >= 400 && status < 500) {
    return new UpstreamError(`上游返回 HTTP ${status}${detail ? `：${detail}` : ""}`, "invalid_request", status, "never");
  }
  return new UpstreamError(`上游响应异常${detail ? `：${detail}` : ""}`, "upstream_error", status, "once");
}

async function upstreamJson(candidate: ChannelCandidate, url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), candidate.timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const message = (await response.text()).slice(0, 2000);
      throw classifyHttp(response.status, message);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error instanceof SyntaxError) throw new UpstreamError("上游响应不是有效 JSON", "invalid_response", undefined, "once");
    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamError("上游请求超时", "timeout", undefined, "always");
    }
    throw new UpstreamError("无法连接上游", "network", undefined, "always");
  } finally {
    clearTimeout(timeout);
  }
}

async function decodeImageResponse(value: unknown) {
  if (!value || typeof value !== "object") throw new UpstreamError("上游未返回图片", "invalid_response", undefined, "once");
  const data = (value as { data?: unknown }).data;
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    const first = data[0] as { b64_json?: unknown; url?: unknown };
    if (typeof first.b64_json === "string") return decodeBase64Image(first.b64_json);
    if (typeof first.url === "string") return downloadImage(first.url);
  }
  const candidates = (value as { candidates?: unknown }).candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const parts = (candidate as { content?: { parts?: unknown } })?.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const inline = (part as { inlineData?: { data?: unknown }; inline_data?: { data?: unknown } }).inlineData ??
          (part as { inline_data?: { data?: unknown } }).inline_data;
        if (inline && typeof inline.data === "string") return decodeBase64Image(inline.data);
        const fileData = (part as { fileData?: { fileUri?: unknown }; file_data?: { file_uri?: unknown } }).fileData ??
          (part as { file_data?: { file_uri?: unknown } }).file_data;
        const fileUri = fileData && ("fileUri" in fileData ? fileData.fileUri : "file_uri" in fileData ? fileData.file_uri : undefined);
        if (typeof fileUri === "string") return downloadImage(fileUri);
      }
    }
  }
  throw new UpstreamError("上游未返回图片", "invalid_response", undefined, "once");
}

export async function readStreamWithLimit(
  stream: NodeJS.ReadableStream | AsyncIterable<Uint8Array | Buffer>,
  maxBytes: number,
  errorMessage: string,
  errorCategory = "media_too_large",
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > maxBytes) {
        if ("destroy" in stream && typeof (stream as { destroy?: () => void }).destroy === "function") {
          (stream as { destroy: () => void }).destroy();
        }
        throw new UpstreamError(errorMessage, errorCategory, undefined, "never");
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if ("destroy" in stream && typeof (stream as { destroy?: () => void }).destroy === "function") {
      (stream as { destroy: () => void }).destroy();
    }
    throw error;
  }
}

export async function downloadImage(url: string) {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new UpstreamError("生成图片地址协议不受支持", "invalid_image_url", undefined, "never");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new UpstreamError("生成图片下载失败", "image_download", response.status, "once");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > config.MAX_GENERATED_BYTES) throw new UpstreamError(`生成图片超过 ${maxGeneratedMb}MB`, "image_too_large", undefined, "never");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > config.MAX_GENERATED_BYTES) {
        await reader.cancel("image_too_large").catch(() => undefined);
        throw new UpstreamError(`生成图片超过 ${maxGeneratedMb}MB`, "image_too_large", undefined, "never");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (reader) {
      await reader.cancel("download_failed").catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateGeneratedImage(buffer: Buffer) {
  if (!buffer.length || buffer.length > config.MAX_GENERATED_BYTES) {
    throw new UpstreamError("生成图片大小无效", "image_too_large", undefined, "never");
  }
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !["image/png", "image/jpeg", "image/webp"].includes(detected.mime)) {
    throw new UpstreamError("生成结果不是受支持的图片", "invalid_image", undefined, "once");
  }
  return detected;
}

export async function generateImage(
  candidate: ChannelCandidate,
  prompt: string,
  parameters: Record<string, unknown>,
  references: ReferenceImage[],
) {
  if (candidate.protocol === "openai") {
    const safeParameters = openAIParameters(parameters, ["model", "prompt", "n", "response_format", "image", "image[]"]);
    const headers = candidate.apiKey ? { Authorization: `Bearer ${candidate.apiKey}` } : undefined;
    if (references.length) {
      const form = new FormData();
      for (const [key, value] of Object.entries(safeParameters)) {
        if (value !== undefined && value !== null) form.set(key, String(value));
      }
      form.set("model", candidate.upstreamModel);
      form.set("prompt", prompt);
      form.set("n", "1");
      form.set("response_format", "b64_json");
      for (const reference of references) {
        form.append("image", new Blob([new Uint8Array(reference.buffer)], { type: reference.mimeType }), reference.filename);
      }
      const response = await upstreamJson(candidate, endpoint(candidate.baseUrl, "images/edits"), {
        method: "POST",
        headers,
        body: form,
      });
      return decodeImageResponse(response);
    }
    const response = await upstreamJson(candidate, endpoint(candidate.baseUrl, "images/generations"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ ...safeParameters, model: candidate.upstreamModel, prompt, n: 1, response_format: "b64_json" }),
    });
    return decodeImageResponse(response);
  }

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const reference of references) {
    parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.buffer.toString("base64") } });
  }
  const url = new URL(endpoint(candidate.baseUrl, `models/${encodeURIComponent(candidate.upstreamModel)}:generateContent`));
  if (candidate.apiKey) url.searchParams.set("key", candidate.apiKey);
  const { size, quality, background: _background, ...geminiParameters } = parameters;
  const dimensions = typeof size === "string" ? size.match(/^(\d+)x(\d+)$/) : null;
  const qualitySize =
    typeof quality === "string"
      ? quality.toLowerCase() === "low"
        ? "512"
        : quality.toLowerCase() === "medium"
          ? "1K"
          : quality.toLowerCase() === "high"
            ? "2K"
            : undefined
      : undefined;
  const image = {
    ...(dimensions ? { aspectRatio: closestGeminiAspectRatio(Number(dimensions[1]), Number(dimensions[2])) } : {}),
    ...(qualitySize ? { imageSize: qualitySize } : {}),
  };
  const response = await upstreamJson(candidate, url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        ...geminiParameters,
        ...(Object.keys(image).length ? { imageConfig: image } : {}),
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });
  return decodeImageResponse(response);
}

export async function generateText(
  candidate: ChannelCandidate,
  messages: TextMessage[],
  parameters: Record<string, unknown>,
) {
  const { reasoningEffort, ...textParameters } = parameters;
  if (candidate.protocol === "openai") {
    const safeParameters = openAIParameters(textParameters, ["model", "messages", "stream"]);
    const upstreamMessages = messages.map((message) =>
      message.images?.length
        ? {
            role: message.role,
            content: [
              { type: "text", text: message.content },
              ...message.images.map((image) => ({
                type: "image_url",
                image_url: { url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}` },
              })),
            ],
          }
        : { role: message.role, content: message.content },
    );
    const value = (await upstreamJson(candidate, endpoint(candidate.baseUrl, "chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(candidate.apiKey ? { Authorization: `Bearer ${candidate.apiKey}` } : {}),
      },
      body: JSON.stringify({
        ...safeParameters,
        ...(typeof reasoningEffort === "string" ? { reasoning_effort: reasoningEffort } : {}),
        model: candidate.upstreamModel,
        messages: upstreamMessages,
        stream: false,
      }),
    })) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = value.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new UpstreamError("上游未返回文本", "invalid_response", undefined, "once");
    return content;
  }

  const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
  const contents = messages
    .filter((item) => item.role !== "system")
    .map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [
        { text: item.content },
        ...(item.images ?? []).map((image) => ({
          inlineData: { mimeType: image.mimeType, data: image.buffer.toString("base64") },
        })),
      ],
    }));
  const url = new URL(endpoint(candidate.baseUrl, `models/${encodeURIComponent(candidate.upstreamModel)}:generateContent`));
  if (candidate.apiKey) url.searchParams.set("key", candidate.apiKey);
  const value = (await upstreamJson(candidate, url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: textParameters,
    }),
  })) as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> };
  const content = value.candidates?.[0]?.content?.parts?.map((part) => part.text).filter((text): text is string => typeof text === "string").join("");
  if (!content) throw new UpstreamError("上游未返回文本", "invalid_response", undefined, "once");
  return content;
}
