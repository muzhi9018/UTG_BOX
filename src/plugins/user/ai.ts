import {MessageContext} from "@mtcute/dispatcher";
import {html} from "@mtcute/html-parser";
import {FileLocation, InputMedia, Message} from "@mtcute/core";
import {BasePlugin, PluginContext, PluginScope} from "../../core/base-plugin.js";
import {Low} from "lowdb";
import {JSONFilePreset} from "lowdb/node";
import {execFile} from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import axios, {AxiosInstance, AxiosRequestConfig, AxiosResponse} from "axios";
import {generateImage, generateText} from "ai";
import {createGoogleGenerativeAI} from "@ai-sdk/google";
import {createOpenAI} from "@ai-sdk/openai";
import sharp from "sharp";
import http from "node:http";
import https from "node:https";
import {promisify} from "node:util";

interface ProviderConfig {
    tag: string;
    url: string;
    key: string;
}

interface TelegraphItem {
    url: string;
    title: string;
    createdAt: string;
}

interface DB {
    configs: Record<string, ProviderConfig>;
    currentChatTag: string;
    currentChatModel: string;
    currentImageTag: string;
    currentImageModel: string;
    currentVideoTag: string;
    currentVideoModel: string;
    imagePreview: boolean;
    videoPreview: boolean;
    videoAudio: boolean;
    videoDuration: number;
    prompt: string;
    collapse: boolean;
    timeout: number;
    telegraphToken: string;
    telegraph: {
        enabled: boolean;
        limit: number;
        list: TelegraphItem[];
    };
}

type AIContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

interface AIImage {
    data?: Buffer;
    url?: string;
    mimeType: string;
}

interface AIVideo {
    data?: Buffer;
    url?: string;
    mimeType: string;
}

type ResolvedImageData = {
    data: Buffer;
    mimeType: string;
};

interface AbortToken {
    readonly aborted: boolean;
    readonly reason?: string;
    readonly signal: AbortSignal;

    abort(reason?: string): void;

    throwIfAborted(): void;
}

interface FeatureHandler {
    readonly name: string;
    readonly command: string;
    readonly description: string;

    execute(msg: MessageContext, args: string[], prefixes: string[]): Promise<void>;
}

interface Middleware {
    process<T>(
        input: T,
        next: (input: T, token?: AbortToken) => Promise<any>,
        token?: AbortToken
    ): Promise<any>;
}

const execFileAsync = promisify(execFile);
const toFileInput = (filePath: string): string => `file:${filePath}`;
const AI_ROOT = path.join(process.cwd(), "data", "ai");
const ensureDirectory = (dir: string): void => {
    fs.mkdirSync(dir, {recursive: true});
};
const ensureAiDir = (name: string): string => {
    const dir = path.join(AI_ROOT, name);
    ensureDirectory(dir);
    return dir;
};

type ProviderKind = "openai" | "gemini" | "doubao" | "openai-compatible";

type AuthMode = "bearer" | "query-key";

type ImageDefaults = {
    size?: string;
    quality?: string;
    responseFormat?: "b64_json" | "url";
    extraParams?: Record<string, any>;
};

type VideoDefaults = {
    responseFormat?: "b64_json" | "url";
    extraParams?: Record<string, any>;
};

type VideoImageMode = "auto" | "reference" | "first" | "firstlast";

type ProviderMeta = {
    id: string;
    kind: ProviderKind;
    authMode?: AuthMode;
    capabilities?: {
        chat?: boolean;
        image?: boolean;
        edit?: boolean;
        video?: boolean;
    };
    imageDefaults?: ImageDefaults;
    videoDefaults?: VideoDefaults;
    imageGenerationEndpoint?: string;
    videoGenerationEndpoint?: string;
};

const PROVIDER_ENDPOINTS: Record<string, ProviderMeta> = {
    "generativelanguage.googleapis.com": {
        id: "gemini",
        kind: "gemini",
        authMode: "query-key",
        capabilities: {chat: true, image: true, edit: false, video: true},
        imageGenerationEndpoint: "/v1beta/models/{model}:generateImages",
        videoGenerationEndpoint: "/v1beta/models/{model}:generateVideos",
    },
    "ark.cn-beijing.volces.com": {
        id: "doubao",
        kind: "doubao",
        authMode: "bearer",
        capabilities: {chat: true, image: true, edit: true, video: true},
        imageDefaults: {
            size: "2K",
            responseFormat: "url",
            extraParams: {
                sequential_image_generation: "disabled",
                watermark: true,
            },
        },
        videoDefaults: {
            extraParams: {},
        },
    },
    "api.openai.com": {
        id: "openai",
        kind: "openai",
        authMode: "bearer",
        capabilities: {chat: true, image: true, edit: true, video: false},
    },
    "api.moonshot.cn": {
        id: "moonshot",
        kind: "openai-compatible",
        authMode: "bearer",
        capabilities: {chat: true, image: false, edit: false, video: false},
    },
};

const getProviderHost = (url: string): string | null => {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
};

const getProviderMeta = (url: string): ProviderMeta | undefined => {
    const host = getProviderHost(url);
    if (!host) return undefined;
    return PROVIDER_ENDPOINTS[host];
};

const getMessageText = (m?: MessageContext | Message | null): string => {
    if (!m) return "";
    const text = (m as any).text ?? "";
    return typeof text === "string" ? text : "";
};

const htmlEscape = (text: string): string =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const markdownToHtml = (markdown: string, _options?: { collapseSafe?: boolean }): string => {
    let text = htmlEscape(markdown);
    text = text.replace(/```([\s\S]*?)```/g, (_match, code) => `<pre><code>${code}</code></pre>`);
    text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    text = text.replace(/__([^_]+)__/g, "<u>$1</u>");
    text = text.replace(/\*([^*\n]+)\*/g, "<i>$1</i>");
    text = text.replace(/_([^_\n]+)_/g, "<i>$1</i>");
    return text;
};

const markdownToTelegraphNodes = (markdown: string): Array<{ tag: string; children: string[] }> => {
    const parts = markdown
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);
    return parts.map((part) => ({
        tag: "p",
        children: [part],
    }));
};

const buildUserContent = (text: string, images: AIContentPart[]): string | AIContentPart[] => {
    if (images.length === 0) return text;
    const parts: AIContentPart[] = [];
    if (text.trim()) parts.push({type: "text", text});
    parts.push(...images);
    return parts;
};

const extractErrorMessage = (error: any): string => {
    const msgText = typeof error?.message === "string" ? error.message : "";
    const reasonText =
        typeof error?.cause === "string"
            ? error.cause
            : error?.cause
                ? String(error.cause)
                : error?.config?.signal?.reason
                    ? String(error.config.signal.reason)
                    : "";

    if ((msgText + reasonText).includes("请求超时")) return "请求超时";
    if (error?.name === "AbortError" || msgText.toLowerCase().includes("aborted")) return "操作已取消";
    if (error?.code === "ECONNABORTED") return "请求超时";
    if (error?.response?.status === 429) return "请求过于频繁，请稍后重试";
    return error?.response?.data?.error?.message || error?.response?.data?.message || msgText || "未知错误";
};

class UserError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UserError";
    }
}

const requireUser = (condition: any, message: string): void => {
    if (!condition) throw new UserError(message);
};

type ProcessingKind = "chat" | "image" | "video";

const PROCESSING_TEXT: Record<ProcessingKind, string> = {
    chat: "💬 <b>正在处理chat任务</b>",
    image: "🖼️ <b>正在处理image任务</b>",
    video: "🎬 <b>正在处理video任务</b>",
};

const formatErrorForDisplay = (error: any): string => {
    if (
        error instanceof UserError ||
        error?.name === "AbortError" ||
        (typeof error?.message === "string" && error.message.toLowerCase().includes("aborted"))
    ) {
        const extracted = extractErrorMessage(error);
        if (extracted === "请求超时") return `❌ <b>错误:</b> 请求超时`;
        const msg = error instanceof UserError ? error.message : "操作已取消";
        return `🚫 ${msg}`;
    }
    return `❌ <b>错误:</b> ${extractErrorMessage(error)}`;
};

const sendProcessing = async (msg: MessageContext, kind: ProcessingKind): Promise<void> => {
    await MessageSender.sendOrEdit(msg, PROCESSING_TEXT[kind]);
};

const sendErrorMessage = async (msg: MessageContext, error: any, trigger?: MessageContext): Promise<void> => {
    await MessageSender.sendOrEdit(trigger || msg, formatErrorForDisplay(error));
};

const parseDataUrl = (url: string): { mimeType: string; data: Buffer } | null => {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {mimeType: match[1], data: Buffer.from(match[2], "base64")};
};

const downloadFileLocation = async (client: MessageContext["client"], location: FileLocation): Promise<Buffer | null> => {
    try {
        const data = await client.downloadAsBuffer(location);
        return Buffer.from(data);
    } catch {
        return null;
    }
};

const getImageExtensionForMime = (mimeType: string): string => {
    if (mimeType === "image/png") return ".png";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "image/gif") return ".gif";
    return ".jpg";
};

const extractFirstFrame = async (buffer: Buffer): Promise<Buffer | null> => {
    try {
        return await sharp(buffer, {animated: true}).png().toBuffer();
    } catch {
        return null;
    }
};

const getBestThumbnail = (media: {
    thumbnails?: ReadonlyArray<FileLocation>
} | null | undefined): FileLocation | null => {
    const thumbs = media?.thumbnails ?? [];
    if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
    return thumbs[thumbs.length - 1] || null;
};

const resolveImageInputs = async (
    parts: AIContentPart[],
    httpClient: HttpClient,
    token?: AbortToken,
    options?: { allowFailures?: boolean }
): Promise<ResolvedImageData[]> => {
    const resolved: ResolvedImageData[] = [];
    const allowFailures = options?.allowFailures ?? false;
    for (const part of parts) {
        if (part.type !== "image_url") continue;
        const dataUrl = parseDataUrl(part.image_url.url);
        if (dataUrl) {
            resolved.push({data: dataUrl.data, mimeType: dataUrl.mimeType});
            if (!allowFailures) break;
            continue;
        }
        try {
            const image = await resolveAIImageData({
                url: part.image_url.url,
                mimeType: "image/jpeg"
            }, httpClient, token);
            if (image?.data) {
                resolved.push({data: image.data, mimeType: image.mimeType});
                if (!allowFailures) break;
            }
        } catch (error) {
            if (!allowFailures) throw error;
        }
    }
    return resolved;
};

const resolveImagePart = async (
    parts: AIContentPart[],
    httpClient: HttpClient,
    token?: AbortToken
): Promise<AIImage | null> => {
    const resolved = await resolveImageInputs(parts, httpClient, token, {allowFailures: false});
    if (!resolved.length) return null;
    return {data: resolved[0].data, mimeType: resolved[0].mimeType};
};

const collectImagePartsFromSingleMessage = async (
    client: MessageContext["client"],
    msg: MessageContext | Message,
    out: AIContentPart[]
): Promise<void> => {
    const media = (msg as Message).media;
    if (!media) return;

    if (media.type === "photo") {
        const buffer = await downloadFileLocation(client, media);
        if (!buffer) return;
        const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
        out.push({type: "image_url", image_url: {url: dataUrl}});
        return;
    }

    const mimeType = "mimeType" in media ? media.mimeType || "" : "";
    const isAnimatedDoc =
        media.type === "video" ||
        media.type === "sticker" ||
        (mimeType === "image/gif" || mimeType === "video/webm");

    if (!isAnimatedDoc && mimeType.startsWith("image/") && "fileId" in media) {
        const buffer = await downloadFileLocation(client, media as FileLocation);
        if (!buffer) return;
        const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        out.push({type: "image_url", image_url: {url: dataUrl}});
        return;
    }

    let frameBuffer: Buffer | null = null;
    const thumb =
        media.type === "video" && media.videoCover
            ? (media.videoCover as FileLocation)
            : getBestThumbnail(media as { thumbnails?: ReadonlyArray<FileLocation> });

    if (thumb) {
        const buffer = await downloadFileLocation(client, thumb);
        if (buffer) {
            try {
                frameBuffer = await sharp(buffer).png().toBuffer();
            } catch {
                frameBuffer = buffer;
            }
        }
    }

    if (!frameBuffer && "fileId" in media) {
        const buffer = await downloadFileLocation(client, media as FileLocation);
        if (buffer) {
            try {
                frameBuffer = await extractFirstFrame(buffer);
            } catch {
                frameBuffer = null;
            }
        }
    }

    if (!frameBuffer) return;

    const dataUrl = `data:image/png;base64,${frameBuffer.toString("base64")}`;
    out.push({type: "image_url", image_url: {url: dataUrl}});
};

const getMessageImageParts = async (
    client: MessageContext["client"],
    msg?: MessageContext | Message
): Promise<AIContentPart[]> => {
    if (!msg) return [];

    const parts: AIContentPart[] = [];
    const groupedId = (msg as Message).groupedIdUnique ?? (msg as Message).groupedId?.toString();

    if (!groupedId) {
        await collectImagePartsFromSingleMessage(client, msg, parts);
        return parts;
    }

    const sameGroupMessages: Message[] = [];
    for await (const m of client.iterHistory((msg as Message).chat, {limit: 50})) {
        const currentGroupId = m.groupedIdUnique ?? m.groupedId?.toString();
        if (!currentGroupId || currentGroupId !== groupedId) continue;
        sameGroupMessages.push(m);
    }

    sameGroupMessages.sort((a, b) => Number(a.id) - Number(b.id));
    for (const m of sameGroupMessages) {
        await collectImagePartsFromSingleMessage(client, m, parts);
    }

    return parts;
};

const getGroupedMessageIds = async (msg: MessageContext | Message): Promise<number[]> => {
    const groupedId = (msg as Message).groupedIdUnique ?? (msg as Message).groupedId?.toString();
    if (!groupedId) return [];
    const client = (msg as MessageContext).client;
    if (!client) return [];

    const ids: number[] = [];
    for await (const m of client.iterHistory((msg as Message).chat, {limit: 50})) {
        const currentGroupId = m.groupedIdUnique ?? m.groupedId?.toString();
        if (!currentGroupId || currentGroupId !== groupedId) continue;
        ids.push(Number(m.id));
    }

    if (!ids.includes(Number((msg as Message).id))) ids.push(Number((msg as Message).id));
    return Array.from(new Set(ids)).sort((a, b) => a - b);
};

const deleteMessageOrGroup = async (msg: MessageContext): Promise<void> => {
    try {
        const ids = await getGroupedMessageIds(msg);
        if (ids.length > 1) {
            const client = msg.client;
            const messages: Message[] = [];
            for await (const m of client.iterHistory(msg.chat, {limit: 50})) {
                if (ids.includes(m.id)) messages.push(m);
            }
            if (messages.length > 0) {
                await client.deleteMessages(messages, {revoke: true});
            }
            return;
        }
        await msg.delete();
    } catch {
    }
};

const resolveAIImageData = async (
    image: AIImage,
    httpClient: HttpClient,
    token?: AbortToken
): Promise<AIImage | null> => {
    if (image.data) return image;
    if (!image.url) return null;
    const response = await httpClient.request(
        {
            url: image.url,
            method: "GET",
            responseType: "arraybuffer",
        },
        token
    );
    const contentType = response.headers?.["content-type"]?.split(";")[0] || image.mimeType || "image/jpeg";
    return {data: Buffer.from(response.data), mimeType: contentType};
};

const getVideoExtensionForMime = (mimeType: string): string => {
    if (mimeType === "video/webm") return ".webm";
    if (mimeType === "video/quicktime") return ".mov";
    return ".mp4";
};

const resolveAIVideoData = async (
    video: AIVideo,
    httpClient: HttpClient,
    token?: AbortToken
): Promise<AIVideo | null> => {
    if (video.data) return video;
    if (!video.url) return null;
    const response = await httpClient.request(
        {
            url: video.url,
            method: "GET",
            responseType: "arraybuffer",
        },
        token
    );
    const contentType = response.headers?.["content-type"]?.split(";")[0] || video.mimeType || "video/mp4";
    return {data: Buffer.from(response.data), mimeType: contentType};
};

const videoHasAudioTrack = async (filePath: string): Promise<boolean> => {
    try {
        const {stdout} = await execFileAsync("ffprobe", [
            "-v",
            "error",
            "-show_streams",
            "-select_streams",
            "a",
            "-of",
            "json",
            filePath,
        ]);

        const info = JSON.parse(stdout);
        const streams = info.streams || [];
        return streams.length > 0;
    } catch {
        return false;
    }
};

const ensureVideoHasAudio = async (inputPath: string, outputPath: string): Promise<string> => {
    try {
        const hasAudio = await videoHasAudioTrack(inputPath);
        if (hasAudio) {
            return inputPath;
        }

        await execFileAsync("ffmpeg", [
            "-y",
            "-i",
            inputPath,
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-c:v",
            "copy",
            "-shortest",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            outputPath,
        ]);

        return outputPath;
    } catch {
        return inputPath;
    }
};

const createAbortToken = (): AbortToken => {
    const controller = new AbortController();
    return {
        get aborted() {
            return controller.signal.aborted;
        },
        get reason() {
            return controller.signal.reason?.toString();
        },
        get signal() {
            return controller.signal;
        },
        abort(reason?: string) {
            if (!controller.signal.aborted) controller.abort(reason);
        },
        throwIfAborted() {
            if (controller.signal.aborted) {
                throw new UserError(controller.signal.reason?.toString() || "操作已取消");
            }
        },
    };
};

const sleep = (ms: number, token?: AbortToken): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        token?.throwIfAborted();
        let settled = false;
        const cleanup = () => {
            if (!token?.signal) return;
            token.signal.removeEventListener("abort", abortHandler);
        };
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        }, ms);
        const abortHandler = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            cleanup();
            reject(new UserError(token?.reason?.toString() || "操作已取消"));
        };
        if (token?.signal) token.signal.addEventListener("abort", abortHandler, {once: true});
    });
};

const retryWithFixedDelay = async <T>(
    operation: () => Promise<T>,
    maxRetries: number = 2,
    delayMs: number = 1000,
    token?: AbortToken
): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
        token?.throwIfAborted();
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            if (token?.aborted) throw error;
            if (!isRetryableError(error)) throw error;
            if (i === maxRetries - 1) break;
            await sleep(delayMs, token);
        }
    }
    throw lastError;
};

const isRetryableError = (error: any): boolean => {
    if (!error) return false;
    if (error.name === "AbortError") return false;
    if (typeof error.message === "string" && error.message.toLowerCase().includes("aborted")) return false;

    const status = error.response?.status;
    if (typeof status === "number") {
        if (status === 429) return true;
        return status >= 500 && status <= 599;

    }

    if (error.isAxiosError && !error.response) return true;
    return typeof error.code === "string";
};

type TaskStatus = "pending" | "running" | "succeeded" | "failed";

interface TaskPollResult<T> {
    status: TaskStatus;
    result?: T;
    errorMessage?: string;
}

interface TaskPollOptions {
    maxAttempts?: number;
    intervalMs?: number;
}

type TaskFetchFn = (token?: AbortToken) => Promise<any>;
type TaskParseFn<T> = (data: any) => TaskPollResult<T>;

const pollTask = async <T>(
    fetchJob: TaskFetchFn,
    parseResult: TaskParseFn<T>,
    options: TaskPollOptions = {},
    token?: AbortToken
): Promise<T> => {
    const maxAttempts = options.maxAttempts ?? 303;
    const intervalMs = options.intervalMs ?? 2000;

    for (let i = 0; i < maxAttempts; i++) {
        token?.throwIfAborted();

        const data = await retryWithFixedDelay(() => fetchJob(token), 2, 1000, token);
        const result = parseResult(data);

        if (result.status === "failed") {
            throw new Error(result.errorMessage || "任务执行失败");
        }

        if (result.status === "succeeded") {
            if (result.result === undefined) {
                throw new Error("任务成功但未返回结果");
            }
            return result.result;
        }

        await sleep(intervalMs, token);
    }

    throw new Error("任务执行超时");
};

interface MessageOptions {
    linkPreview?: boolean;
}

class MessageSender {
    static async sendOrEdit(msg: MessageContext | Message, text: string, options?: MessageOptions): Promise<Message> {
        try {
            return await (msg as MessageContext).edit({
                text: html(text),
                ...(options?.linkPreview === undefined ? {} : {disableWebPreview: !options.linkPreview}),
            });
        } catch (error: any) {
            const msgText = typeof error?.message === "string" ? error.message : "";
            if (msgText.includes("MESSAGE_ID_INVALID") || msgText.includes("400")) {
                if ("replyText" in msg) {
                    return await msg.replyText(html(text));
                }
                return await (msg as MessageContext).client.sendText((msg as Message).chat, html(text));
            }
            throw error;
        }
    }

    static async sendNew(
        msg: MessageContext | Message,
        text: string,
        options?: MessageOptions,
        replyToId?: number
    ): Promise<Message> {
        return await (msg as MessageContext).client.sendText(
            (msg as Message).chat,
            html(text),
            {
                ...(replyToId ? {replyTo: replyToId} : {}),
                ...(options?.linkPreview === undefined ? {} : {disableWebPreview: !options.linkPreview}),
            }
        );
    }
}

class MessageUtils {
    private configManagerPromise: Promise<ConfigManager>;
    private httpClient: HttpClient;
    private telegraphTokenPromise: Promise<string> | null = null;

    constructor(configManagerPromise: Promise<ConfigManager>, httpClient: HttpClient) {
        this.configManagerPromise = configManagerPromise;
        this.httpClient = httpClient;
    }

    async createTelegraphPage(markdown: string, titleSource?: string, token?: AbortToken): Promise<TelegraphItem> {
        const configManager = await this.configManagerPromise;
        const config = configManager.getConfig();

        const tgToken = await this.ensureTGToken(config, token);
        const rawTitle = (titleSource || "").replace(/\s+/g, " ").trim();
        const shortTitle = rawTitle.length > 24 ? `${rawTitle.slice(0, 24)}…` : rawTitle;
        const title = shortTitle || `Telegraph - ${new Date().toLocaleString()}`;
        const nodes = markdownToTelegraphNodes(markdown);

        const response = await this.httpClient.request(
            {
                url: "https://api.telegra.ph/createPage",
                method: "POST",
                data: {
                    access_token: tgToken,
                    title,
                    content: nodes,
                    return_content: false,
                },
            },
            token
        );

        const url = response.data?.result?.url;
        if (!url) throw new Error(response.data?.error || "Telegraph页面创建失败");

        return {url, title, createdAt: new Date().toISOString()};
    }

    async sendLongMessage(
        msg: MessageContext,
        text: string,
        replyToId?: number,
        token?: AbortToken
    ): Promise<Message> {
        token?.throwIfAborted();

        const configManager = await this.configManagerPromise;
        const config = configManager.getConfig();
        const poweredByText = `</br></br><i>🍀Powered by ${config.currentChatTag}</i>`;

        if (text.length <= 4050) {
            token?.throwIfAborted();

            const parts = text.split(/(?=A:\n)/);
            if (parts.length === 2) {
                const questionPart = parts[0];
                const answerPart = parts[1];
                const cleanAnswer = answerPart.replace(/^A:\n/, "");
                const cleanQuestion = questionPart.replace(/^Q:\n/, "").replace(/\n\n$/, "");
                const questionBlock = `Q:</br>${this.wrapHtmlWithCollapseIfNeeded(cleanQuestion, config.collapse)}</br></br>`;
                const answerBlock = `A:</br>${this.wrapHtmlWithCollapseIfNeeded(cleanAnswer, config.collapse)}`;
                const finalText = questionBlock + answerBlock + poweredByText;

                return await this.sendHtml(msg, finalText, replyToId, false);
            }
            const finalText = this.wrapHtmlWithCollapseIfNeeded(text, config.collapse) + poweredByText;
            return await this.sendHtml(msg, finalText, replyToId, false);
        }

        const qa = text.match(/Q:\n([\s\S]+?)\n\nA:\n([\s\S]+)/);
        if (!qa) {
            token?.throwIfAborted();
            const finalText = this.wrapHtmlWithCollapseIfNeeded(text, config.collapse) + poweredByText;
            return await this.sendHtml(msg, finalText, replyToId, false);
        }

        const [, question, answer] = qa;
        const answerText = answer.replace(/^A:\n/, "");
        const chunks: string[] = [];
        let current = "";

        for (const line of answerText.split("\n")) {
            token?.throwIfAborted();
            const testLength = (current + line + "\n").length;
            if (testLength > 4050 && current) {
                chunks.push(current);
                current = line;
            } else {
                current += (current ? "\n" : "") + line;
            }
        }
        if (current) chunks.push(current);

        token?.throwIfAborted();

        const firstMessageContent =
            `Q:</br>${this.wrapHtmlWithCollapseIfNeeded(question, config.collapse)}</br></br>` +
            `A:</br>${this.wrapHtmlWithCollapseIfNeeded(chunks[0], config.collapse)}`;

        const firstMessage = await this.sendHtml(msg, firstMessageContent, replyToId);

        for (let idx = 1; idx < chunks.length; idx++) {
            if (token?.aborted) break;
            await sleep(500, token);
            if (token?.aborted) break;

            const isLast = idx === chunks.length - 1;
            const wrapped = this.wrapHtmlWithCollapseIfNeeded(chunks[idx], config.collapse);
            const prefix = `📋 <b>续 (${idx}/${chunks.length - 1}):</b></br></br>`;
            const finalMessage = prefix + wrapped + (isLast ? poweredByText : "");

            await this.sendHtml(msg, finalMessage, firstMessage.id, false);
        }

        return firstMessage;
    }

    async sendImages(
        msg: MessageContext,
        images: AIImage[],
        prompt: string,
        replyToId?: number,
        token?: AbortToken
    ): Promise<void> {
        const config = (await this.configManagerPromise).getConfig();
        await this.sendMedia(msg, images, prompt, replyToId, token, {
            mediaKind: "image",
            previewEnabled: config.imagePreview,
            poweredByTag: config.currentImageTag,
            collapse: config.collapse,
            directory: "ai_images",
            filePrefix: "ai",
            getExtension: getImageExtensionForMime,
            resolve: (image, mediaToken) => resolveAIImageData(image, this.httpClient, mediaToken),
        });
    }

    async sendVideos(
        msg: MessageContext,
        videos: AIVideo[],
        prompt: string,
        replyToId?: number,
        token?: AbortToken
    ): Promise<void> {
        const config = (await this.configManagerPromise).getConfig();
        await this.sendMedia(msg, videos, prompt, replyToId, token, {
            mediaKind: "video",
            previewEnabled: config.videoPreview,
            poweredByTag: config.currentVideoTag,
            collapse: config.collapse,
            directory: "ai_videos",
            filePrefix: "ai_video",
            rawFilePrefix: "ai_video_raw",
            getExtension: getVideoExtensionForMime,
            resolve: (video, mediaToken) => resolveAIVideoData(video, this.httpClient, mediaToken),
            prepareForSend: (rawPath, finalPath) => ensureVideoHasAudio(rawPath, finalPath),
        });
    }

    private async sendMedia<T extends AIImage | AIVideo>(
        msg: MessageContext,
        mediaItems: T[],
        prompt: string,
        replyToId: number | undefined,
        token: AbortToken | undefined,
        options: {
            mediaKind: "image" | "video";
            previewEnabled: boolean;
            poweredByTag: string;
            collapse: boolean;
            directory: string;
            filePrefix: string;
            rawFilePrefix?: string;
            getExtension: (mimeType: string) => string;
            resolve: (item: T, mediaToken?: AbortToken) => Promise<{ data?: Buffer; mimeType: string } | null>;
            prepareForSend?: (rawPath: string, finalPath: string) => Promise<string>;
        }
    ): Promise<void> {
        if (!mediaItems.length) return;

        const promptText = htmlEscape(prompt);
        const promptBlock = options.collapse ? `<blockquote expandable>${promptText}</blockquote>` : promptText;
        const poweredByText = `</br></br><i>🍀Powered by ${options.poweredByTag}</i>`;
        const caption = promptBlock + poweredByText;
        const mediaDir = ensureAiDir(options.directory);
        const timestamp = Date.now();

        for (let i = 0; i < mediaItems.length; i++) {
            const item = mediaItems[i];
            token?.throwIfAborted();

            const resolved = await options.resolve(item, token);
            if (!resolved?.data) continue;

            const extension = options.getExtension(resolved.mimeType);
            const rawPrefix = options.rawFilePrefix ?? options.filePrefix;
            const rawName = `${rawPrefix}_${timestamp}_${i}${extension}`;
            const finalName = `${options.filePrefix}_${timestamp}_${i}${extension}`;
            const rawPath = path.join(mediaDir, rawName);
            const finalPath = path.join(mediaDir, finalName);

            try {
                await fs.promises.writeFile(rawPath, resolved.data);
                const pathToSend = options.prepareForSend
                    ? await options.prepareForSend(rawPath, finalPath)
                    : rawPath;

                const captionText = html(caption);
                const mediaInput = !options.previewEnabled
                    ? InputMedia.document(toFileInput(pathToSend), {caption: captionText})
                    : options.mediaKind === "video"
                        ? InputMedia.video(toFileInput(pathToSend), {caption: captionText})
                        : InputMedia.photo(toFileInput(pathToSend), {caption: captionText});

                await msg.client.sendMedia(msg.chat, mediaInput, {
                    ...(replyToId ? {replyTo: replyToId} : {}),
                });
            } finally {
                const cleanupTargets = options.prepareForSend ? [rawPath, finalPath] : [rawPath];
                for (const p of cleanupTargets) {
                    fs.unlink(p, () => {
                    });
                }
            }
        }
    }

    private async ensureTGToken(config: DB, token?: AbortToken): Promise<string> {
        if (config.telegraphToken) return config.telegraphToken;
        if (this.telegraphTokenPromise) return this.telegraphTokenPromise;

        this.telegraphTokenPromise = (async () => {
            const response = await this.httpClient.request(
                {
                    url: "https://api.telegra.ph/createAccount",
                    method: "POST",
                    data: {short_name: "UTGBOXAI", author_name: "TeleBox"},
                },
                token
            );

            const tgToken = response.data?.result?.access_token;
            if (!tgToken) throw new Error("Telegraph账户创建失败");

            const configManager = await this.configManagerPromise;
            await configManager.updateConfig((cfg) => {
                cfg.telegraphToken = tgToken;
            });

            return tgToken;
        })();

        try {
            return await this.telegraphTokenPromise;
        } finally {
            this.telegraphTokenPromise = null;
        }
    }

    private wrapHtmlWithCollapseIfNeeded(html: string, collapse: boolean): string {
        return collapse ? `<blockquote expandable>${html}</blockquote>` : html;
    }

    private async sendHtml(
        msg: MessageContext,
        html: string,
        replyToId?: number,
        linkPreview?: boolean
    ): Promise<Message> {
        return await MessageSender.sendNew(msg, html, {linkPreview}, replyToId);
    }
}

interface ConfigChangeListener {
    onConfigChanged(config: DB): void | Promise<void>;
}

class ConfigManager {
    private static instancePromise: Promise<ConfigManager> | null = null;
    private listeners: ConfigChangeListener[] = [];
    private currentConfig: DB;
    private db: Low<DB> | null = null;
    private baseDir: string = "";
    private file: string = "";

    private writeQueue: Promise<void> = Promise.resolve();

    private constructor() {
        this.currentConfig = this.getDefaultConfig();
    }

    private getDefaultConfig(): DB {
        return {
            configs: {},
            currentChatTag: "",
            currentChatModel: "",
            currentImageTag: "",
            currentImageModel: "",
            currentVideoTag: "",
            currentVideoModel: "",
            imagePreview: true,
            videoPreview: true,
            videoAudio: false,
            videoDuration: 5,
            prompt: "",
            collapse: true,
            timeout: 30,
            telegraphToken: "",
            telegraph: {enabled: false, limit: 5, list: []},
        };
    }

    static getInstance(): Promise<ConfigManager> {
        if (ConfigManager.instancePromise) {
            return ConfigManager.instancePromise;
        }

        ConfigManager.instancePromise = (async () => {
            const instance = new ConfigManager();
            await instance.init();
            return instance;
        })();

        return ConfigManager.instancePromise;
    }

    private async init(): Promise<void> {
        if (this.db) return;

        ensureDirectory(AI_ROOT);
        this.baseDir = AI_ROOT;
        this.file = path.join(this.baseDir, "config.json");
        this.db = await JSONFilePreset<DB>(this.file, this.getDefaultConfig());

        await this.writeQueue;
        await this.db.read();
        this.currentConfig = {...this.db.data};
        const before = JSON.stringify(this.currentConfig);
        this.ensureDefaults();
        const after = JSON.stringify(this.currentConfig);
        if (before !== after) {
            this.db.data = {...this.currentConfig};
            await this.db.write();
        }
    }

    getConfig(): DB {
        return {...this.currentConfig};
    }

    async updateConfig(updater: (config: DB) => void): Promise<void> {
        this.writeQueue = this.writeQueue.then(async () => {
            const oldSnapshot: DB = JSON.parse(JSON.stringify(this.currentConfig));
            updater(this.currentConfig);

            const hasChanged = JSON.stringify(oldSnapshot) !== JSON.stringify(this.currentConfig);

            if (!hasChanged) {
                return;
            }

            if (this.db) {
                this.db.data = {...this.currentConfig};
                await this.db.write();
            }
            await this.notifyListeners(this.currentConfig);
        });
        return this.writeQueue;
    }

    registerListener(listener: ConfigChangeListener): void {
        this.listeners.push(listener);
    }

    unregisterListener(listener: ConfigChangeListener): void {
        const idx = this.listeners.indexOf(listener);
        if (idx > -1) this.listeners.splice(idx, 1);
    }

    async destroy(): Promise<void> {
        this.listeners = [];
        ConfigManager.instancePromise = null;
        this.db = null;
    }

    private ensureDefaults(): void {
        const cfg = this.currentConfig;

        if (!cfg.currentImageTag && cfg.currentChatTag) cfg.currentImageTag = cfg.currentChatTag;
        if (!cfg.currentImageModel && cfg.currentChatModel) cfg.currentImageModel = cfg.currentChatModel;
        if (!cfg.currentVideoTag && cfg.currentChatTag) cfg.currentVideoTag = cfg.currentChatTag;
        if (!cfg.currentVideoModel && cfg.currentChatModel) cfg.currentVideoModel = cfg.currentChatModel;

        if (typeof cfg.imagePreview !== "boolean") cfg.imagePreview = true;
        if (typeof cfg.videoPreview !== "boolean") cfg.videoPreview = true;
        if (typeof cfg.videoAudio !== "boolean") cfg.videoAudio = false;
        if (typeof cfg.videoDuration !== "number" || !Number.isFinite(cfg.videoDuration)) cfg.videoDuration = 5;
        if (cfg.videoDuration < 5 || cfg.videoDuration > 20) cfg.videoDuration = 5;
        if (typeof cfg.collapse !== "boolean") cfg.collapse = true;
        if (typeof cfg.timeout !== "number" || !Number.isFinite(cfg.timeout) || cfg.timeout <= 0) {
            cfg.timeout = 30;
        }

        if (!cfg.telegraph || typeof cfg.telegraph !== "object") {
            cfg.telegraph = {enabled: false, limit: 5, list: []};
        } else {
            if (typeof cfg.telegraph.enabled !== "boolean") cfg.telegraph.enabled = false;
            if (typeof cfg.telegraph.limit !== "number" || cfg.telegraph.limit <= 0) cfg.telegraph.limit = 5;
            if (!Array.isArray(cfg.telegraph.list)) {
                cfg.telegraph.list = [];
            } else {
                cfg.telegraph.list = cfg.telegraph.list.filter(
                    (item): item is TelegraphItem =>
                        !!item && typeof item.url === "string" && typeof item.title === "string" && typeof item.createdAt === "string"
                );
            }
        }
    }

    private async notifyListeners(newConfig: DB): Promise<void> {
        for (const listener of this.listeners) await listener.onConfigChanged(newConfig);
    }

}

const applyAuthConfig = (
    config: ProviderConfig,
    url: string,
    headers: Record<string, string>
): { url: string; headers: Record<string, string> } => {
    const provider = getProviderMeta(config.url);
    if (provider?.authMode === "query-key") {
        try {
            const u = new URL(url);
            if (!u.searchParams.has("key")) u.searchParams.set("key", config.key);
            return {url: u.toString(), headers};
        } catch {
            return {url, headers};
        }
    }
    return {
        url,
        headers: {
            ...headers,
            Authorization: `Bearer ${config.key}`,
        },
    };
};

const getProviderKind = (url: string): ProviderKind => {
    const provider = getProviderMeta(url);
    return provider?.kind ?? "openai-compatible";
};

const normalizeOpenAIBaseUrl = (url: string): string => {
    try {
        const u = new URL(url);

        if (u.hostname.includes("gateway.ai.cloudflare.com")) {
            const openAiIndex = u.pathname.indexOf("/openai");
            if (openAiIndex >= 0) {
                u.pathname = u.pathname.slice(0, openAiIndex + "/openai".length);
            }
            u.search = "";
            return u.toString();
        }

        const stripSuffixes = [
            "/chat/completions",
            "/completions",
            "/responses",
            "/messages",
            "/images/generations",
        ];
        for (const s of stripSuffixes) {
            if (u.pathname.endsWith(s)) {
                u.pathname = u.pathname.slice(0, -s.length);
                break;
            }
        }

        const apiV1Index = u.pathname.indexOf("/api/v1");
        if (apiV1Index >= 0) {
            u.pathname = u.pathname.slice(0, apiV1Index + "/api/v1".length);
            u.search = "";
            return u.toString();
        }

        const v1Index = u.pathname.indexOf("/v1");
        if (v1Index >= 0) {
            u.pathname = u.pathname.slice(0, v1Index + "/v1".length);
            u.search = "";
            return u.toString();
        }

        u.pathname = "/v1";
        u.search = "";
        return u.toString();
    } catch {
        return url;
    }
};

const normalizeGeminiBaseUrl = (url: string): string => {
    try {
        const u = new URL(url);
        return u.origin;
    } catch {
        return url;
    }
};

const buildChatContentParts = async (
    question: string,
    images: AIContentPart[],
    httpClient: HttpClient,
    token?: AbortToken
): Promise<Array<{ type: "text"; text: string } | { type: "image"; image: string | Uint8Array }>> => {
    const parts: Array<{ type: "text"; text: string } | { type: "image"; image: string | Uint8Array }> = [];
    if (question.trim()) {
        parts.push({type: "text", text: question});
    }

    const resolvedImages = await resolveImageInputs(images, httpClient, token, {allowFailures: true});
    for (const image of resolvedImages) {
        parts.push({type: "image", image: image.data});
    }

    return parts;
};

const parseOpenAIChatResponse = (data: any): { text: string; images: AIImage[] } => {
    const message = data?.choices?.[0]?.message;
    if (!message) return {text: "AI回复为空", images: []};

    if (typeof message.content === "string") {
        return {text: message.content || "AI回复为空", images: []};
    }

    if (Array.isArray(message.content)) {
        const textSegments: string[] = [];
        const images: AIImage[] = [];
        for (const part of message.content as AIContentPart[]) {
            if (part.type === "text") textSegments.push(part.text);
            if (part.type === "image_url") {
                const dataUrl = parseDataUrl(part.image_url.url);
                if (dataUrl) images.push({data: dataUrl.data, mimeType: dataUrl.mimeType});
                else images.push({url: part.image_url.url, mimeType: "image/jpeg"});
            }
        }
        const text = textSegments.join("\n").trim();
        return {text, images};
    }

    return {text: "AI回复为空", images: []};
};

const normalizeGeneratedImages = (result: any): AIImage[] => {
    const output: AIImage[] = [];
    const images = result?.images ?? (result?.image ? [result.image] : []);
    for (const item of images) {
        if (!item) continue;
        if (item.base64) {
            output.push({data: Buffer.from(item.base64, "base64"), mimeType: item.mimeType || "image/png"});
        } else if (item.uint8Array) {
            output.push({data: Buffer.from(item.uint8Array), mimeType: item.mimeType || "image/png"});
        } else if (item.url) {
            output.push({url: item.url, mimeType: item.mimeType || "image/png"});
        }
    }
    return output;
};

const resolveGeneratedText = (result: any): string => {
    const text = result?.text ?? "";
    return typeof text === "string" && text.trim() ? text : "AI回复为空";
};

const extractImagesFromContentPart = (part: any, images: AIImage[]): void => {
    if (!part) return;
    if (part.type === "image" && part.image) {
        if (Buffer.isBuffer(part.image) || part.image instanceof Uint8Array) {
            images.push({data: Buffer.from(part.image), mimeType: part.mimeType || "image/png"});
        } else if (typeof part.image === "string") {
            const dataUrl = parseDataUrl(part.image);
            if (dataUrl) images.push({data: dataUrl.data, mimeType: dataUrl.mimeType});
            else images.push({url: part.image, mimeType: "image/png"});
        }
    }

    if (part.type === "image_url" && part.image_url?.url) {
        const dataUrl = parseDataUrl(part.image_url.url);
        if (dataUrl) images.push({data: dataUrl.data, mimeType: dataUrl.mimeType});
        else images.push({url: part.image_url.url, mimeType: "image/png"});
    }

    const inline = part.inlineData || part.inline_data || part.inline;
    if (inline?.data) {
        const mimeType = inline.mimeType || inline.mime_type || "image/png";
        images.push({data: Buffer.from(inline.data, "base64"), mimeType});
    }
};

const extractSdkImages = (result: any): AIImage[] => {
    const images: AIImage[] = [];
    const candidates: any[] = [];
    if (Array.isArray(result?.response?.messages)) candidates.push(...result.response.messages);
    if (Array.isArray(result?.responseMessages)) candidates.push(...result.responseMessages);
    if (Array.isArray(result?.messages)) candidates.push(...result.messages);

    for (const message of candidates) {
        const content = message?.content ?? message?.parts ?? message?.message?.content;
        if (Array.isArray(content)) {
            for (const part of content) extractImagesFromContentPart(part, images);
        } else if (content) {
            extractImagesFromContentPart(content, images);
        }
    }
    return images;
};

const parseOpenAIStyleImageResponse = (data: any): AIImage[] => {
    const images: AIImage[] = [];
    const list = data?.data || [];
    for (const item of list) {
        if (item?.b64_json) {
            images.push({data: Buffer.from(item.b64_json, "base64"), mimeType: "image/png"});
        } else if (item?.url) {
            images.push({url: item.url, mimeType: "image/png"});
        }
    }
    return images;
};

const buildDoubaoVideoUrl = (data: any): string | null => {
    return (
        data?.data?.result?.video_url ||
        data?.data?.output?.video_url ||
        data?.data?.video_url ||
        data?.video_url ||
        data?.content?.video_url ||
        data?.data?.content?.video_url ||
        null
    );
};

const buildGeminiVideoApiUrl = (url: string, model: string, key: string): string => {
    const urlObj = new URL(url);
    const provider = getProviderMeta(url);
    const finalModel = model || "veo-2.0-generate-001";
    if (provider?.videoGenerationEndpoint) {
        urlObj.pathname = provider.videoGenerationEndpoint.replace("{model}", finalModel);
    } else {
        urlObj.pathname = `/v1beta/models/${finalModel}:generateVideos`;
    }
    urlObj.searchParams.set("key", key);
    return urlObj.toString();
};

const buildGeminiOperationUrl = (baseOrigin: string, name: string, key: string): string => {
    const urlObj = new URL(baseOrigin);
    const cleanName = name.replace(/^\/+/, "");
    const path = cleanName.startsWith("v1beta/") ? cleanName : `v1beta/${cleanName}`;
    urlObj.pathname = `/${path}`;
    urlObj.searchParams.set("key", key);
    return urlObj.toString();
};

const extractGeminiOperationError = (data: any): string => {
    const err = data?.error || data?.data?.error;
    if (!err) return "";
    if (typeof err === "string") return err;
    if (typeof err.message === "string") return err.message;
    if (typeof err.status === "string") return err.status;
    if (Array.isArray(err.details) && err.details.length > 0) {
        const detail = err.details[0];
        if (typeof detail?.message === "string") return detail.message;
    }
    return "视频生成失败";
};

const extractGeminiVideoResult = (data: any): { uri?: string; bytes?: string } | null => {
    const response = data?.response ?? data?.data?.response ?? data;
    const sampleUri =
        response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
        response?.generate_video_response?.generated_samples?.[0]?.video?.uri;
    if (sampleUri) return {uri: sampleUri};

    const videoBytes =
        response?.generatedVideos?.[0]?.video?.videoBytes ||
        response?.generated_videos?.[0]?.video?.video_bytes ||
        response?.generatedVideos?.[0]?.video?.video_bytes ||
        response?.generated_videos?.[0]?.video?.videoBytes;
    if (videoBytes) return {bytes: videoBytes};

    return null;
};

const buildGeminiParts = async (
    prompt: string,
    images: AIContentPart[],
    httpClient: HttpClient,
    token?: AbortToken
): Promise<Array<Record<string, any>>> => {
    const parts: Array<Record<string, any>> = [];
    if (prompt.trim()) parts.push({text: prompt});

    const resolvedImages = await resolveImageInputs(images, httpClient, token, {allowFailures: true});
    for (const image of resolvedImages) {
        parts.push({
            inlineData: {
                data: image.data.toString("base64"),
                mimeType: image.mimeType,
            },
        });
    }

    return parts;
};

class FeatureRegistry {
    private features = new Map<string, FeatureHandler>();

    register(handler: FeatureHandler): void {
        this.features.set(handler.command.toLowerCase(), handler);
    }

    getHandler(command: string): FeatureHandler | undefined {
        return this.features.get(command.toLowerCase());
    }
}

class MiddlewarePipeline {
    private middlewares: Middleware[] = [];

    use(middleware: Middleware): void {
        this.middlewares.push(middleware);
    }

    async execute<T>(
        input: T,
        finalHandler: (input: T, token?: AbortToken) => Promise<any>,
        token?: AbortToken
    ): Promise<any> {
        const exec = async (idx: number, curInput: T, curToken?: AbortToken): Promise<any> => {
            if (idx >= this.middlewares.length) return await finalHandler(curInput, curToken);
            const mw = this.middlewares[idx];
            return await mw.process(curInput, (nextInput, nextToken) => exec(idx + 1, nextInput, nextToken), curToken);
        };
        return await exec(0, input, token);
    }
}

class TimeoutMiddleware implements Middleware {
    private configManagerPromise: Promise<ConfigManager>;

    constructor(configManagerPromise: Promise<ConfigManager>) {
        this.configManagerPromise = configManagerPromise;
    }

    async process<T>(
        input: T,
        next: (input: T, token?: AbortToken) => Promise<any>,
        token?: AbortToken
    ): Promise<any> {
        const config = (await this.configManagerPromise).getConfig();
        const timeoutMs = config.timeout * 1000;

        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(`请求超时: ${timeoutMs}ms`), timeoutMs);

        try {
            const combined = this.combine(timeoutController, token);
            combined.signal.addEventListener("abort", () => clearTimeout(timeoutId), {once: true});
            return await next(input, combined);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private combine(timeoutController: AbortController, externalToken?: AbortToken): AbortToken {
        const controller = new AbortController();

        if (timeoutController.signal.aborted) controller.abort(timeoutController.signal.reason);
        else
            timeoutController.signal.addEventListener("abort", () => controller.abort(timeoutController.signal.reason), {
                once: true,
            });

        if (externalToken) {
            if (externalToken.aborted) controller.abort(externalToken.reason);
            else
                externalToken.signal.addEventListener("abort", () => controller.abort(externalToken.reason), {
                    once: true,
                });
        }

        return {
            get aborted() {
                return controller.signal.aborted;
            },
            get reason() {
                return controller.signal.reason?.toString();
            },
            get signal() {
                return controller.signal;
            },
            abort(reason?: string) {
                controller.abort(reason);
            },
            throwIfAborted() {
                if (controller.signal.aborted) {
                    throw new UserError(controller.signal.reason?.toString() || "操作已取消");
                }
            },
        };
    }
}

class HttpClient {
    private axiosInstance: AxiosInstance;
    private middlewarePipeline: MiddlewarePipeline;

    constructor(configManagerPromise: Promise<ConfigManager>) {
        const keepAliveAgent = {
            httpAgent: new http.Agent({keepAlive: true}),
            httpsAgent: new https.Agent({keepAlive: true}),
        };
        this.axiosInstance = axios.create(keepAliveAgent);

        this.middlewarePipeline = new MiddlewarePipeline();
        this.middlewarePipeline.use(new TimeoutMiddleware(configManagerPromise));
    }

    async request<T = any>(requestConfig: AxiosRequestConfig, token?: AbortToken): Promise<AxiosResponse<T>> {
        return await this.middlewarePipeline.execute(
            requestConfig,
            async (config: AxiosRequestConfig, pipelineToken?: AbortToken) => {
                const finalConfig: AxiosRequestConfig = {
                    ...config,
                    signal: pipelineToken?.signal ?? config.signal,
                };
                return await this.axiosInstance(finalConfig);
            },
            token
        );
    }
}

class AIService implements ConfigChangeListener {
    private configManager?: ConfigManager;
    private readonly configManagerPromise: Promise<ConfigManager>;
    private readonly activeTokens: Set<AbortToken> = new Set();
    private readonly httpClient: HttpClient;

    constructor(configManagerPromise: Promise<ConfigManager>, httpClient: HttpClient) {
        this.configManagerPromise = configManagerPromise;
        this.httpClient = httpClient;

        this.initConfigListener();
    }

    private async initConfigListener(): Promise<void> {
        this.configManager = await this.configManagerPromise;
        this.configManager.registerListener(this);
    }

    private async getConfigManager(): Promise<ConfigManager> {
        if (this.configManager) return this.configManager;
        this.configManager = await this.configManagerPromise;
        return this.configManager;
    }

    async onConfigChanged(_config: DB): Promise<void> {
    }

    private async getCurrentProviderConfig(
        type: "chat" | "image" | "video"
    ): Promise<{ providerConfig: ProviderConfig; model: string; config: DB }> {
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();

        const tag =
            type === "chat" ? config.currentChatTag : type === "image" ? config.currentImageTag : config.currentVideoTag;
        const model =
            type === "chat"
                ? config.currentChatModel
                : type === "image"
                    ? config.currentImageModel
                    : config.currentVideoModel;

        if (!tag || !model || !config.configs[tag]) {
            throw new UserError("请先配置API并设置模型");
        }

        return {providerConfig: config.configs[tag], model, config};
    }

    private createOpenAIProvider(config: ProviderConfig, baseURL: string) {
        return createOpenAI({apiKey: config.key, baseURL});
    }

    private createGeminiProvider(config: ProviderConfig) {
        return createGoogleGenerativeAI({apiKey: config.key, baseURL: normalizeGeminiBaseUrl(config.url)});
    }

    private buildTextModel(config: ProviderConfig, model: string) {
        const providerMeta = getProviderMeta(config.url);
        if (providerMeta?.kind === "gemini") {
            const provider = this.createGeminiProvider(config);
            return provider(model);
        }

        const baseURL = normalizeOpenAIBaseUrl(config.url);
        const provider = this.createOpenAIProvider(config, baseURL);

        const host = getProviderHost(config.url) || "";

        if (host === "api.openai.com") {
            return provider(model);
        }

        return (provider as any).chat(model);
    }

    private buildImageModel(config: ProviderConfig, model: string) {
        const providerMeta = getProviderMeta(config.url);
        if (providerMeta?.kind === "gemini") {
            const provider = this.createGeminiProvider(config);
            return typeof (provider as any).image === "function" ? (provider as any).image(model) : provider(model);
        }

        const provider = this.createOpenAIProvider(config, normalizeOpenAIBaseUrl(config.url));
        return typeof (provider as any).image === "function" ? (provider as any).image(model) : provider(model);
    }

    private getSdkOptions(config: DB, token?: AbortToken): {
        maxRetries: number;
        timeout: number;
        abortSignal?: AbortSignal
    } {
        return {
            maxRetries: 0,
            timeout: config.timeout * 1000,
            ...(token ? {abortSignal: token.signal} : {}),
        };
    }

    private applyImageDefaults(request: Record<string, any>, providerConfig: ProviderConfig, model: string): void {
        const provider = getProviderMeta(providerConfig.url);
        if (provider?.imageDefaults?.size) request.size = provider.imageDefaults.size;
        if (provider?.imageDefaults?.quality) request.quality = provider.imageDefaults.quality;
        if (provider?.imageDefaults?.responseFormat) {
            request.responseFormat = provider.imageDefaults.responseFormat;
            request.response_format = provider.imageDefaults.responseFormat;
        }
        if (provider?.imageDefaults?.extraParams) Object.assign(request, provider.imageDefaults.extraParams);

        const host = getProviderHost(providerConfig.url);
        if (host === "api.openai.com") {
            if (!model.startsWith("gpt-") && !model.startsWith("chatgpt-image")) {
                request.responseFormat = "b64_json";
                request.response_format = "b64_json";
            }
            if (!request.size) request.size = "1024x1024";
            if (model.startsWith("dall-e-3")) {
                request.quality = "hd";
            } else if (model.startsWith("gpt-image")) {
                request.quality = "high";
            }
        }
    }

    private async generateImageWithDoubao(
        providerConfig: ProviderConfig,
        model: string,
        prompt: string,
        image?: AIImage,
        token?: AbortToken
    ): Promise<AIImage[]> {
        const baseUrl = new URL(providerConfig.url).origin;
        const provider = getProviderMeta(providerConfig.url);

        const data: Record<string, any> = {
            prompt,
            model,
        };
        if (image) {
            if (!image.data) throw new Error("无法解析图片数据");
            data.image = `data:${image.mimeType};base64,${image.data.toString("base64")}`;
        }
        if (provider?.imageDefaults?.size) data.size = provider.imageDefaults.size;
        if (provider?.imageDefaults?.responseFormat) data.response_format = provider.imageDefaults.responseFormat;
        if (provider?.imageDefaults?.extraParams) Object.assign(data, provider.imageDefaults.extraParams);

        const endpoint = "/api/v3/images/generations";
        const authConfig = applyAuthConfig(providerConfig, `${baseUrl}${endpoint}`, {
            "Content-Type": "application/json",
        });
        const response = await this.httpClient.request(
            {
                url: authConfig.url,
                method: "POST",
                headers: authConfig.headers,
                data,
            },
            token
        );

        return parseOpenAIStyleImageResponse(response.data);
    }

    private buildDoubaoVideoContent(
        prompt: string,
        images: AIContentPart[],
        imageMode: VideoImageMode
    ): Array<Record<string, any>> {
        const content: Array<Record<string, any>> = [];
        const trimmedPrompt = prompt.trim();
        if (trimmedPrompt) {
            content.push({type: "text", text: trimmedPrompt});
        }

        const imageParts = images.filter((part) => part.type === "image_url" && !!parseDataUrl(part.image_url.url));
        const imageCount = imageParts.length;

        for (const [index, part] of imageParts.entries()) {
            if (part.type !== "image_url") continue;
            const item: Record<string, any> = {
                type: "image_url",
                image_url: {url: part.image_url.url},
            };
            if (imageMode === "first") {
                item.role = "first_frame";
            } else if (imageMode === "firstlast") {
                item.role = index === 0 ? "first_frame" : "last_frame";
            } else if (imageMode === "reference") {
                item.role = "reference_image";
            } else if (imageCount === 2) {
                item.role = index === 0 ? "first_frame" : "last_frame";
            } else if (imageCount > 2) {
                item.role = "reference_image";
            }
            content.push(item);
        }

        return content;
    }

    private async generateGeminiVideo(
        providerConfig: ProviderConfig,
        model: string,
        prompt: string,
        images: AIContentPart[],
        videoAudio: boolean,
        videoDuration: number,
        token?: AbortToken
    ): Promise<AIVideo[]> {
        const apiUrl = buildGeminiVideoApiUrl(providerConfig.url, model, providerConfig.key);
        const parts = await buildGeminiParts(prompt, images, this.httpClient, token);

        const response = await this.httpClient.request(
            {
                url: apiUrl,
                method: "POST",
                headers: {"Content-Type": "application/json"},
                data: {
                    contents: [
                        {
                            parts,
                        },
                    ],
                    videoGenerationConfig: {
                        numberOfVideos: 1,
                        durationSeconds: videoDuration,
                        enableAudio: videoAudio,
                    },
                },
            },
            token
        );

        const directResult = extractGeminiVideoResult(response.data);
        if (directResult?.bytes) {
            return [{data: Buffer.from(directResult.bytes, "base64"), mimeType: "video/mp4"}];
        }

        if (directResult?.uri) {
            const download = await this.httpClient.request(
                {
                    url: directResult.uri,
                    method: "GET",
                    responseType: "arraybuffer",
                },
                token
            );
            const contentType = download.headers?.["content-type"]?.split(";")[0] || "video/mp4";
            return [{data: Buffer.from(download.data), mimeType: contentType}];
        }

        const operationName = response.data?.name;
        if (!operationName || typeof operationName !== "string") {
            throw new Error("视频生成失败");
        }

        const baseOrigin = normalizeGeminiBaseUrl(providerConfig.url);
        const operation = await pollTask<any>(
            async (abortToken) => {
                const url = buildGeminiOperationUrl(baseOrigin, operationName, providerConfig.key);
                const opResponse = await this.httpClient.request(
                    {
                        url,
                        method: "GET",
                        headers: {"Content-Type": "application/json"},
                    },
                    abortToken
                );
                return opResponse.data;
            },
            (data): TaskPollResult<any> => {
                if (!data || data.done !== true) {
                    return {status: "pending"};
                }
                if (data.error) {
                    return {status: "failed", errorMessage: extractGeminiOperationError(data)};
                }
                return {status: "succeeded", result: data};
            },
            {
                maxAttempts: 303,
                intervalMs: 2000,
            },
            token
        );

        const finalResult = extractGeminiVideoResult(operation);
        if (finalResult?.bytes) {
            return [{data: Buffer.from(finalResult.bytes, "base64"), mimeType: "video/mp4"}];
        }
        if (finalResult?.uri) {
            const download = await this.httpClient.request(
                {
                    url: finalResult.uri,
                    method: "GET",
                    responseType: "arraybuffer",
                },
                token
            );
            const contentType = download.headers?.["content-type"]?.split(";")[0] || "video/mp4";
            return [{data: Buffer.from(download.data), mimeType: contentType}];
        }

        throw new Error("视频生成失败");
    }

    private async generateVideoWithDoubao(
        providerConfig: ProviderConfig,
        model: string,
        prompt: string,
        images: AIContentPart[],
        imageMode: VideoImageMode,
        videoAudio: boolean,
        videoDuration: number,
        token?: AbortToken
    ): Promise<AIVideo[]> {
        const baseUrl = new URL(providerConfig.url).origin;
        const provider = getProviderMeta(providerConfig.url);

        const content = this.buildDoubaoVideoContent(prompt, images, imageMode);
        const contentImageCount = content.filter((item) => item.type === "image_url").length;
        const data: Record<string, any> = {
            model,
            content,
            generateAudio: videoAudio,
            duration: videoDuration,
        };
        if (provider?.videoDefaults?.extraParams) Object.assign(data, provider.videoDefaults.extraParams);
        if (contentImageCount === 0 && (data.ratio === undefined || data.ratio === null)) {
            data.ratio = "3:4";
        }

        const authConfig = applyAuthConfig(providerConfig, `${baseUrl}/api/v3/contents/generations/tasks`, {
            "Content-Type": "application/json",
        });
        const response = await this.httpClient.request(
            {
                url: authConfig.url,
                method: "POST",
                headers: authConfig.headers,
                data,
            },
            token
        );

        const taskId =
            response.data?.task_id ||
            response.data?.data?.task_id ||
            response.data?.data?.id ||
            response.data?.id;
        if (!taskId) throw new Error("视频生成任务创建失败");

        const videoUrl = await pollTask<string>(
            async (abortToken) => {
                const pollUrl = `${baseUrl}/api/v3/contents/generations/tasks/${taskId}`;
                const authConfig = applyAuthConfig(providerConfig, pollUrl, {});
                const pollResponse = await this.httpClient.request(
                    {
                        url: authConfig.url,
                        method: "GET",
                        headers: authConfig.headers,
                    },
                    abortToken
                );
                return pollResponse.data;
            },
            (data): TaskPollResult<string> => {
                const statusRaw = data?.status || data?.data?.status;
                if (statusRaw === "failed") {
                    return {status: "failed", errorMessage: "视频生成失败"};
                }

                const url = buildDoubaoVideoUrl(data);
                if (url) {
                    return {status: "succeeded", result: url};
                }

                return {status: "pending"};
            },
            {
                maxAttempts: 303,
                intervalMs: 2000,
            },
            token
        );

        return [{url: videoUrl, mimeType: "video/mp4"}];
    }

    createAbortToken(): AbortToken {
        const token = createAbortToken();
        this.activeTokens.add(token);
        token.signal.addEventListener("abort", () => this.activeTokens.delete(token), {once: true});
        return token;
    }

    releaseToken(token: AbortToken): void {
        this.activeTokens.delete(token);
    }

    cancelAllOperations(reason?: string): void {
        const tokens = Array.from(this.activeTokens);
        this.activeTokens.clear();
        for (const token of tokens) {
            if (!token.aborted) token.abort(reason || "操作已取消");
        }
    }

    async destroy(): Promise<void> {
        this.cancelAllOperations("服务已停止");
        if (this.configManager) this.configManager.unregisterListener(this);
    }

    async callAI(
        question: string,
        images: AIContentPart[] = [],
        token?: AbortToken
    ): Promise<{ text: string; images: AIImage[] }> {
        const {providerConfig, model, config} = await this.getCurrentProviderConfig("chat");
        const providerMeta = getProviderMeta(providerConfig.url);
        if (providerMeta?.capabilities?.chat === false) {
            throw new UserError(`当前${providerMeta.id}提供商不支持聊天`);
        }

        const providerKind = getProviderKind(providerConfig.url);
        if (providerKind === "doubao") {
            const baseUrl = new URL(providerConfig.url).origin;
            const safeImages = images.filter((part) => {
                if (part.type !== "image_url") return false;
                return !!parseDataUrl(part.image_url.url);
            });
            const authConfig = applyAuthConfig(
                providerConfig,
                `${baseUrl}/api/v3/chat/completions`,
                {"Content-Type": "application/json"}
            );
            const response = await this.httpClient.request(
                {
                    url: authConfig.url,
                    method: "POST",
                    headers: authConfig.headers,
                    data: {
                        model,
                        messages: [
                            {
                                role: "user",
                                content: buildUserContent(question, safeImages),
                            },
                        ],
                        stream: false,
                    },
                },
                token
            );
            return parseOpenAIChatResponse(response.data);
        }

        const contentParts = await buildChatContentParts(question, images, this.httpClient, token);
        const result = await generateText({
            model: this.buildTextModel(providerConfig, model),
            ...(contentParts.length > 0 ? {messages: [{role: "user", content: contentParts}]} : {prompt: question}),
            ...this.getSdkOptions(config, token),
        } as any);

        return {text: resolveGeneratedText(result), images: extractSdkImages(result)};
    }

    async generateImage(prompt: string, token?: AbortToken): Promise<AIImage[]> {
        const {providerConfig, model, config} = await this.getCurrentProviderConfig("image");
        const providerMeta = getProviderMeta(providerConfig.url);
        if (providerMeta?.capabilities?.image === false) {
            throw new UserError(`当前${providerMeta.id}提供商不支持图片生成`);
        }

        const providerKind = getProviderKind(providerConfig.url);
        if (providerKind === "doubao") {
            return await this.generateImageWithDoubao(providerConfig, model, prompt, undefined, token);
        }

        const request: Record<string, any> = {
            model: this.buildImageModel(providerConfig, model),
            prompt,
            ...this.getSdkOptions(config, token),
        };
        this.applyImageDefaults(request, providerConfig, model);

        const result = await generateImage(request as any);
        return normalizeGeneratedImages(result);
    }

    async editImage(prompt: string, image: AIImage, token?: AbortToken): Promise<AIImage[]> {
        const {providerConfig, model, config} = await this.getCurrentProviderConfig("image");
        const providerMeta = getProviderMeta(providerConfig.url);
        if (providerMeta?.capabilities?.edit === false) {
            throw new UserError(`当前${providerMeta.id}提供商不支持图片编辑`);
        }

        const providerKind = getProviderKind(providerConfig.url);
        if (providerKind === "doubao") {
            return await this.generateImageWithDoubao(providerConfig, model, prompt, image, token);
        }

        if (!image.data) {
            throw new Error("无法解析图片数据");
        }
        const request: Record<string, any> = {
            model: this.buildImageModel(providerConfig, model),
            prompt: {
                text: prompt,
                images: [image.data],
            },
            ...this.getSdkOptions(config, token),
        };
        this.applyImageDefaults(request, providerConfig, model);

        const result = await generateImage(request as any);
        return normalizeGeneratedImages(result);
    }

    async generateVideo(
        prompt: string,
        images: AIContentPart[],
        imageMode: VideoImageMode = "auto",
        token?: AbortToken
    ): Promise<AIVideo[]> {
        const {providerConfig, model, config} = await this.getCurrentProviderConfig("video");
        const providerMeta = getProviderMeta(providerConfig.url);
        if (providerMeta?.capabilities?.video === false) {
            throw new UserError(`当前${providerMeta.id}提供商不支持视频生成`);
        }

        const providerKind = getProviderKind(providerConfig.url);
        if (providerKind === "doubao") {
            return await this.generateVideoWithDoubao(
                providerConfig,
                model,
                prompt,
                images,
                imageMode,
                config.videoAudio,
                config.videoDuration,
                token
            );
        }

        if (providerKind === "gemini") {
            return await this.generateGeminiVideo(
                providerConfig,
                model,
                prompt,
                images,
                config.videoAudio,
                config.videoDuration,
                token
            );
        }

        throw new UserError("当前提供商不支持视频生成");
    }
}

abstract class BaseFeatureHandler implements FeatureHandler {
    abstract readonly name: string;
    abstract readonly command: string;
    abstract readonly description: string;

    abstract execute(msg: MessageContext, args: string[], prefixes: string[]): Promise<void>;

    protected configManagerPromise: Promise<ConfigManager>;

    protected constructor(configManagerPromise: Promise<ConfigManager>) {
        this.configManagerPromise = configManagerPromise;
    }

    protected async getConfigManager(): Promise<ConfigManager> {
        return await this.configManagerPromise;
    }

    protected async getConfig(): Promise<DB> {
        const configManager = await this.getConfigManager();
        return configManager.getConfig();
    }

    protected async editMessage(msg: MessageContext, text: string): Promise<void> {
        await MessageSender.sendOrEdit(msg, text);
    }
}

class ConfigFeature extends BaseFeatureHandler {
    readonly name = "配置管理";
    readonly command = "config";
    readonly description = "管理API配置";

    constructor(configManagerPromise: Promise<ConfigManager>) {
        super(configManagerPromise);
    }

    async execute(msg: MessageContext, args: string[], _prefixes: string[]): Promise<void> {
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();

        if (args.length < 2) {
            const list =
                Object.values(config.configs)
                    .map((c) => `🏷️ <code>${c.tag}</code> - ${c.url}`)
                    .join("</br>") || "暂无配置";
            await this.editMessage(msg, `📋 <b>API配置列表:</b></br></br>⚙️ 配置:</br>${list}`);
            return;
        }

        const action = args[1].toLowerCase();
        if (action === "add") {
            requireUser(args.length >= 5, "参数格式错误");
            await this.addConfig(msg, args, configManager);
            return;
        }
        if (action === "del") {
            requireUser(args.length >= 3, "参数格式错误");
            await this.deleteConfig(msg, args, configManager);
            return;
        }
        throw new UserError("参数格式错误");
    }

    private async addConfig(msg: MessageContext, args: string[], configManager: ConfigManager): Promise<void> {
        requireUser(!!(msg as any).savedPeerId, "出于安全考虑，禁止在公开场景添加/修改API密钥");
        const key = args[args.length - 1];
        const url = args[args.length - 2];
        const tag = args.slice(2, -2).join(" ").trim();
        requireUser(!!tag, "参数格式错误");

        try {
            const u = new URL(url);
            if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad protocol");
        } catch {
            throw new UserError("无效的URL格式");
        }

        requireUser(!!key.trim(), "API密钥不能为空");
        requireUser(key.length >= 10, "API密钥长度过短");

        await configManager.updateConfig((cfg) => {
            cfg.configs[tag] = {tag, url, key};
        });

        await this.editMessage(
            msg,
            "✅ API配置已添加:</br></br>" +
            `🏷️ 标签: <code>${tag}</code></br>` +
            `🔗 地址: <code>${url}</code></br>` +
            `🔑 密钥: <code>${key}</code>`
        );
    }

    private async deleteConfig(msg: MessageContext, args: string[], configManager: ConfigManager): Promise<void> {
        const delTag = args[2];
        const config = configManager.getConfig();

        requireUser(!!config.configs[delTag], "配置不存在");

        await configManager.updateConfig((cfg) => {
            delete cfg.configs[delTag];
            if (cfg.currentChatTag === delTag) {
                cfg.currentChatTag = "";
                cfg.currentChatModel = "";
            }
            if (cfg.currentImageTag === delTag) {
                cfg.currentImageTag = "";
                cfg.currentImageModel = "";
            }
            if (cfg.currentVideoTag === delTag) {
                cfg.currentVideoTag = "";
                cfg.currentVideoModel = "";
            }
        });

        await this.editMessage(msg, `✅ 已删除配置: ${delTag}`);
    }
}

class ModelFeature extends BaseFeatureHandler {
    readonly name = "模型管理";
    readonly command = "model";
    readonly description = "设置AI模型";

    constructor(configManagerPromise: Promise<ConfigManager>) {
        super(configManagerPromise);
    }

    async execute(msg: MessageContext, args: string[], _prefixes: string[]): Promise<void> {
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();

        if (args.length < 2) {
            await this.editMessage(
                msg,
                `🤖 <b>当前AI配置:</b></br></br>` +
                `💬 chat配置: <code>${config.currentChatTag || "未设置"}</code></br>` +
                `🧠 chat模型: <code>${config.currentChatModel || "未设置"}</code></br>` +
                `🖼️ image配置: <code>${config.currentImageTag || "未设置"}</code></br>` +
                `🎨 image模型: <code>${config.currentImageModel || "未设置"}</code></br>` +
                `🎬 video配置: <code>${config.currentVideoTag || "未设置"}</code></br>` +
                `📹 video模型: <code>${config.currentVideoModel || "未设置"}</code>`
            );
            return;
        }

        const mode = args[1]?.toLowerCase();
        requireUser(mode === "chat" || mode === "image" || mode === "video", "参数格式错误");
        requireUser(args.length >= 4, "参数不足");

        const model = args[args.length - 1];
        const tag = args.slice(2, -1).join(" ").trim();
        requireUser(!!config.configs[tag], `配置标签 "${tag}" 不存在`);

        await configManager.updateConfig((cfg) => {
            if (mode === "chat") {
                cfg.currentChatTag = tag;
                cfg.currentChatModel = model;
            } else if (mode === "video") {
                cfg.currentVideoTag = tag;
                cfg.currentVideoModel = model;
            } else {
                cfg.currentImageTag = tag;
                cfg.currentImageModel = model;
            }
        });

        const modeLabel = mode === "chat" ? "chat模型" : mode === "image" ? "image模型" : "video模型";
        await this.editMessage(
            msg,
            `✅ ${modeLabel}已切换到:</br></br>🏷️ 配置: <code>${tag}</code></br>🧠 模型: <code>${model}</code>`
        );
    }
}

class PromptFeature extends BaseFeatureHandler {
    readonly name = "提示词管理";
    readonly command = "prompt";
    readonly description = "管理提示词";

    constructor(configManagerPromise: Promise<ConfigManager>) {
        super(configManagerPromise);
    }

    async execute(msg: MessageContext, args: string[], _prefixes: string[]): Promise<void> {
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();

        if (args.length < 2) {
            await this.editMessage(msg, `💭 <b>当前提示词:</b></br></br>📝 内容: <code>${config.prompt || "未设置"}</code>`);
            return;
        }

        const action = args[1].toLowerCase();
        if (action === "set") {
            requireUser(args.length >= 3, "参数格式错误");
            await configManager.updateConfig((cfg) => {
                cfg.prompt = args.slice(2).join(" ");
            });
            await this.editMessage(msg, `✅ 提示词已设置:</br></br><code>${args.slice(2).join(" ")}</code>`);
            return;
        }

        if (action === "del") {
            await configManager.updateConfig((cfg) => {
                cfg.prompt = "";
            });
            await this.editMessage(msg, "✅ 提示词已删除");
            return;
        }

        throw new UserError("参数格式错误");
    }
}

class CollapseFeature extends BaseFeatureHandler {
    readonly name = "折叠设置";
    readonly command = "collapse";
    readonly description = "设置消息折叠";

    constructor(configManagerPromise: Promise<ConfigManager>) {
        super(configManagerPromise);
    }

    async execute(msg: MessageContext, args: string[], _prefixes: string[]): Promise<void> {
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();

        if (args.length < 2) {
            await this.editMessage(
                msg,
                `📖 <b>消息折叠状态:</b></br></br>📄 当前状态: ${config.collapse ? "开启" : "关闭"}`
            );
            return;
        }

        const state = args[1].toLowerCase();
        requireUser(state === "on" || state === "off", "参数必须是 on 或 off");

        await configManager.updateConfig((cfg) => {
            cfg.collapse = state === "on";
        });

        await this.editMessage(msg, `✅ 引用折叠已${state === "on" ? "开启" : "关闭"}`);
    }
}

class TelegraphFeature extends BaseFeatureHandler {
    readonly name = "Telegraph管理";
    readonly command = "telegraph";
    readonly description = "管理Telegraph";

    constructor(configManagerPromise: Promise<ConfigManager>) {
        super(configManagerPromise);
    }

    async execute(msg: MessageContext, args: string[], _prefixes: string[]): Promise<void> {
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();

        if (args.length < 2) {
            await this.showTelegraphStatus(msg, config);
            return;
        }

        const action = args[1].toLowerCase();
        if (action === "on") {
            await this.enableTelegraph(msg, configManager);
            return;
        }
        if (action === "off") {
            await this.disableTelegraph(msg, configManager);
            return;
        }
        if (action === "limit") {
            requireUser(args.length >= 3, "参数格式错误");
            await this.setTelegraphLimit(msg, args, configManager);
            return;
        }
        if (action === "del") {
            requireUser(args.length >= 3, "参数格式错误");
            await this.deleteTelegraphItem(msg, args, configManager);
            return;
        }
        await this.showTelegraphStatus(msg, config);
    }

    private async showTelegraphStatus(msg: MessageContext, config: DB): Promise<void> {
        let status =
            `📰 <b>Telegraph状态:</b></br></br>` +
            `🌐 当前状态: ${config.telegraph.enabled ? "开启" : "关闭"}</br>` +
            `📊 限制数量: <code>${config.telegraph.limit}</code></br>` +
            `📈 记录数量: <code>${config.telegraph.list.length}/${config.telegraph.limit}</code>`;

        if (config.telegraph.list.length > 0) {
            status += "</br></br>";
            config.telegraph.list.forEach((item, index) => {
                status += `${index + 1}. <a href="${item.url}">🔗 ${item.title}</a></br>`;
            });
        }

        await this.editMessage(msg, status);
    }

    private async enableTelegraph(msg: MessageContext, configManager: ConfigManager): Promise<void> {
        await configManager.updateConfig((cfg) => {
            cfg.telegraph.enabled = true;
        });
        await this.editMessage(msg, "✅ Telegraph已开启");
    }

    private async disableTelegraph(msg: MessageContext, configManager: ConfigManager): Promise<void> {
        await configManager.updateConfig((cfg) => {
            cfg.telegraph.enabled = false;
        });
        await this.editMessage(msg, "✅ Telegraph已关闭");
    }

    private async setTelegraphLimit(msg: MessageContext, args: string[], configManager: ConfigManager): Promise<void> {
        const limit = parseInt(args[2]);
        requireUser(!isNaN(limit) && limit > 0, "限制数量必须大于0");

        await configManager.updateConfig((cfg) => {
            cfg.telegraph.limit = limit;
        });

        await this.editMessage(msg, `✅ Telegraph限制已设置为 ${limit}`);
    }

    private async deleteTelegraphItem(msg: MessageContext, args: string[], configManager: ConfigManager): Promise<void> {
        const del = args[2];
        const config = configManager.getConfig();

        if (del.toLowerCase() === "all") {
            await configManager.updateConfig((cfg) => {
                cfg.telegraph.list = [];
            });
            await this.editMessage(msg, "✅ 已删除所有记录");
            return;
        }

        const idx = parseInt(del) - 1;
        requireUser(
            !isNaN(idx) && idx >= 0 && idx < config.telegraph.list.length,
            `序号超出范围 (1-${config.telegraph.list.length})`
        );

        await configManager.updateConfig((cfg) => {
            cfg.telegraph.list.splice(idx, 1);
        });

        await this.editMessage(msg, `✅ 已删除第 ${idx + 1} 项`);
    }
}

class TimeoutFeature extends BaseFeatureHandler {
    readonly name = "超时设置";
    readonly command = "timeout";
    readonly description = "设置请求超时";

    constructor(configManagerPromise: Promise<ConfigManager>) {
        super(configManagerPromise);
    }

    async execute(msg: MessageContext, args: string[], _prefixes: string[]): Promise<void> {
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();

        if (args.length < 2) {
            await this.editMessage(
                msg,
                `⏱️ <b>当前超时设置:</b></br></br>⏰ 超时时间: <code>${config.timeout} 秒</code>`
            );
            return;
        }

        const timeout = parseInt(args[1]);
        requireUser(!isNaN(timeout) && timeout >= 1 && timeout <= 600, "超时时间必须在1-600秒之间");

        await configManager.updateConfig((cfg) => {
            cfg.timeout = timeout;
        });

        await this.editMessage(msg, `✅ 超时时间已设置为 ${timeout} 秒`);
    }
}

class QuestionFeature extends BaseFeatureHandler {
    readonly name = "AI提问";
    readonly command = "";
    readonly description = "向AI提问";

    private aiService: AIService;
    private messageUtils: MessageUtils;
    private activeToken?: AbortToken;

    constructor(aiService: AIService, configManagerPromise: Promise<ConfigManager>, httpClient: HttpClient) {
        super(configManagerPromise);
        this.aiService = aiService;
        this.messageUtils = new MessageUtils(configManagerPromise, httpClient);
    }

    cancelCurrentOperation(): void {
        if (this.activeToken && !this.activeToken.aborted) this.activeToken.abort("操作被取消");
        this.activeToken = undefined;
    }

    private async runQuestion(
        msg: MessageContext,
        question: string,
        trigger?: MessageContext,
        prefixes: string[] = []
    ): Promise<void> {
        this.cancelCurrentOperation();

        const token = this.aiService.createAbortToken();
        this.activeToken = token;

        try {
            await this.handleQuestion(msg, question, trigger, token, prefixes);
        } finally {
            this.activeToken = undefined;
            this.aiService.releaseToken(token);
        }
    }

    async execute(msg: MessageContext, args: string[], _prefixes: string[]): Promise<void> {
        const question = args.join(" ").trim();
        await this.runQuestion(msg, question, undefined, _prefixes);
    }

    async askFromReply(msg: MessageContext, trigger?: MessageContext, prefixes: string[] = []): Promise<void> {
        const replyMsg = await msg.getReplyTo();
        requireUser(!!replyMsg, "至少需要一条提示");
        const question = getMessageText(replyMsg).trim();
        await this.runQuestion(msg, question, trigger, prefixes);
    }

    async handleQuestion(
        msg: MessageContext,
        question: string,
        trigger?: MessageContext,
        token?: AbortToken,
        prefixes: string[] = []
    ): Promise<void> {
        const config = await this.getConfig();

        if (!config.currentChatTag || !config.currentChatModel || !config.configs[config.currentChatTag]) {
            throw new UserError(
                `请先配置API并设置模型</br>使用 ${prefixes[0]}ai config add <tag> <url> <key> 和 ${prefixes[0]}ai model chat <tag> <model-path>`
            );
        }

        token?.throwIfAborted();

        await sendProcessing(msg, "chat");

        const replyMsg = await msg.getReplyTo();
        let context = getMessageText(replyMsg);
        const replyToId = replyMsg?.id;
        const imageParts = [
            ...(await getMessageImageParts(msg.client, replyMsg ?? undefined)),
            ...(await getMessageImageParts(msg.client, msg)),
        ];

        const normalizedQuestion = question.trim();
        const normalizedContext = context.trim();
        if (normalizedQuestion && normalizedContext && normalizedQuestion === normalizedContext) {
            context = "";
        }

        let fullQuestion = config.prompt ? config.prompt + "\n\n" : "";
        fullQuestion += context ? `上下文:\n${context}\n\n问题:\n${question}` : question;

        const response = await this.aiService.callAI(fullQuestion, imageParts, token);
        const answer = response.text || "AI回复为空";

        const collapseSafe = config.collapse;
        const htmlAnswer = markdownToHtml(answer, {collapseSafe});
        const safeQuestion = htmlEscape(question);
        const formattedAnswer = `Q:\n${safeQuestion}\n\nA:\n${htmlAnswer}`;

        token?.throwIfAborted();

        if (config.telegraph.enabled && formattedAnswer.length > 4050) {
            await this.handleLongContentWithTelegraph(msg, question, answer, replyToId, token);
        } else {
            await this.messageUtils.sendLongMessage(msg, formattedAnswer, replyToId, token);
        }
        await deleteMessageOrGroup(msg);
    }

    private async handleLongContentWithTelegraph(
        msg: MessageContext,
        question: string,
        rawAnswer: string,
        replyToId?: number,
        token?: AbortToken
    ): Promise<void> {
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();

        const telegraphMarkdown = `**Q:**\n${question}\n\n**A:**\n${rawAnswer}\n`;
        const telegraphResult = await this.messageUtils.createTelegraphPage(telegraphMarkdown, question, token);

        const poweredByText = `</br></br><i>🍀Powered by ${config.currentChatTag}</i>`;
        const safeQuestion = htmlEscape(question);
        const questionBlock = config.collapse
            ? `Q:</br><blockquote expandable>${safeQuestion}</blockquote></br></br>`
            : `Q:</br>${safeQuestion}</br></br>`;
        const answerBlock = config.collapse
            ? `A:</br><blockquote expandable>📰内容比较长，Telegraph观感更好喔:</br></br>🔗 <a href="${telegraphResult.url}">点我阅读内容</a></blockquote>${poweredByText}`
            : `A:</br>📰内容比较长，Telegraph观感更好喔:</br></br>🔗 <a href="${telegraphResult.url}">点我阅读内容</a>${poweredByText}`;

        await MessageSender.sendNew(msg, questionBlock + answerBlock, {linkPreview: false}, replyToId);

        await configManager.updateConfig((cfg) => {
            cfg.telegraph.list.push(telegraphResult);
            if (cfg.telegraph.list.length > cfg.telegraph.limit) cfg.telegraph.list.shift();
        });
    }
}

class ImageFeature extends BaseFeatureHandler {
    readonly name = "图片生成";
    readonly command = "image";
    readonly description = "生成图片";

    private aiService: AIService;
    private messageUtils: MessageUtils;
    private httpClient: HttpClient;

    constructor(aiService: AIService, configManagerPromise: Promise<ConfigManager>, httpClient: HttpClient) {
        super(configManagerPromise);
        this.aiService = aiService;
        this.messageUtils = new MessageUtils(configManagerPromise, httpClient);
        this.httpClient = httpClient;
    }

    async execute(msg: MessageContext, args: string[], _prefixes: string[]): Promise<void> {
        const prefixes = _prefixes;
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();
        const replyMsg = await msg.getReplyTo();
        const replyToId = replyMsg?.id;

        const subCommand = args[1]?.toLowerCase();
        if (subCommand === "preview") {
            const state = args[2]?.toLowerCase();
            if (!state) {
                await this.editMessage(
                    msg,
                    `🖼️ <b>图片预览状态:</b></br></br>📄 当前状态: ${config.imagePreview ? "开启" : "关闭"}`
                );
                return;
            }
            requireUser(state === "on" || state === "off", "参数必须是 on 或 off");
            await configManager.updateConfig((cfg) => {
                cfg.imagePreview = state === "on";
            });
            await this.editMessage(msg, `✅ 图片预览已${state === "on" ? "开启" : "关闭"}`);
            return;
        }

        const promptInput = args.slice(1).join(" ").trim();
        const replyText = getMessageText(replyMsg).trim();
        const replyImageParts = await getMessageImageParts(msg.client, replyMsg ?? undefined);
        const messageImageParts = await getMessageImageParts(msg.client, msg);
        const imageParts = [...replyImageParts, ...messageImageParts];

        const hasPrompt = !!promptInput || !!replyText;
        requireUser(hasPrompt, "至少需要一条文字提示");

        if (!config.currentImageTag || !config.currentImageModel || !config.configs[config.currentImageTag]) {
            throw new UserError(
                `请先配置API并设置模型</br>使用 ${prefixes[0]}ai config add <tag> <url> <key> 和 ${prefixes[0]}ai model image <tag> <model-path>`
            );
        }

        const token = this.aiService.createAbortToken();
        await sendProcessing(msg, "image");

        try {
            let prompt = "";
            if (promptInput && replyText && replyImageParts.length === 0) {
                prompt = `${replyText}\n\n${promptInput}`;
            } else if (promptInput && replyImageParts.length > 0) {
                prompt = promptInput;
            } else if (promptInput) {
                prompt = promptInput;
            } else {
                prompt = replyText;
            }

            let images: AIImage[] = [];
            if (imageParts.length > 0) {
                let inputImage = await resolveImagePart(imageParts, this.httpClient, token);
                if (!inputImage?.data) throw new Error("无法解析图片数据");
                if (inputImage.data && inputImage.mimeType !== "image/png") {
                    try {
                        const pngBuffer = await sharp(inputImage.data).png().toBuffer();
                        inputImage = {data: pngBuffer, mimeType: "image/png"};
                    } catch {
                    }
                }
                images = await this.aiService.editImage(prompt, inputImage, token);
            } else {
                images = await this.aiService.generateImage(prompt, token);
            }
            if (images.length === 0) throw new Error("AI回复为空");
            await this.messageUtils.sendImages(msg, images, prompt, replyToId, token);
            await deleteMessageOrGroup(msg);
        } finally {
            this.aiService.releaseToken(token);
        }
    }
}

class VideoFeature extends BaseFeatureHandler {
    readonly name = "视频生成";
    readonly command = "video";
    readonly description = "生成视频";

    private aiService: AIService;
    private messageUtils: MessageUtils;

    constructor(aiService: AIService, configManagerPromise: Promise<ConfigManager>, httpClient: HttpClient) {
        super(configManagerPromise);
        this.aiService = aiService;
        this.messageUtils = new MessageUtils(configManagerPromise, httpClient);
    }

    async execute(msg: MessageContext, args: string[], _prefixes: string[]): Promise<void> {
        const prefixes = _prefixes;
        const configManager = await this.getConfigManager();
        const config = configManager.getConfig();
        const replyMsg = await msg.getReplyTo();
        const replyToId = replyMsg?.id;

        const subCommand = args[1]?.toLowerCase();
        let imageMode: VideoImageMode = "auto";
        let promptStartIndex = 1;
        if (subCommand === "preview") {
            const state = args[2]?.toLowerCase();
            if (!state) {
                await this.editMessage(
                    msg,
                    `🎬 <b>视频预览状态:</b></br></br>📄 当前状态: ${config.videoPreview ? "开启" : "关闭"}`
                );
                return;
            }
            requireUser(state === "on" || state === "off", "参数必须是 on 或 off");
            await configManager.updateConfig((cfg) => {
                cfg.videoPreview = state === "on";
            });
            await this.editMessage(msg, `✅ 视频预览已${state === "on" ? "开启" : "关闭"}`);
            return;
        }
        if (subCommand === "audio") {
            const state = args[2]?.toLowerCase();
            if (!state) {
                await this.editMessage(
                    msg,
                    `🔊 <b>视频音频状态:</b></br></br>📄 当前状态: ${config.videoAudio ? "开启" : "关闭"}`
                );
                return;
            }
            requireUser(state === "on" || state === "off", "参数必须是 on 或 off");
            await configManager.updateConfig((cfg) => {
                cfg.videoAudio = state === "on";
            });
            await this.editMessage(msg, `✅ 视频音频已${state === "on" ? "开启" : "关闭"}`);
            return;
        }
        if (subCommand === "duration") {
            const duration = parseInt(args[2]);
            if (!args[2]) {
                await this.editMessage(
                    msg,
                    `⏱️ <b>视频时长:</b></br></br>⏰ 当前时长: <code>${config.videoDuration} 秒</code>`
                );
                return;
            }
            requireUser(!isNaN(duration) && duration >= 5 && duration <= 20, "时长必须是 5-20 的整数");
            await configManager.updateConfig((cfg) => {
                cfg.videoDuration = duration;
            });
            await this.editMessage(msg, `✅ 视频时长已设置为 ${duration} 秒`);
            return;
        }
        if (subCommand === "first") {
            imageMode = "first";
            promptStartIndex = 2;
        } else if (subCommand === "firstlast") {
            imageMode = "firstlast";
            promptStartIndex = 2;
        }

        const promptInput = args.slice(promptStartIndex).join(" ").trim();
        const replyText = getMessageText(replyMsg).trim();

        const replyImageParts = await getMessageImageParts(msg.client, replyMsg ?? undefined);
        const messageImageParts = await getMessageImageParts(msg.client, msg);

        let finalPrompt = "";
        if (promptInput && replyText && replyImageParts.length === 0) {
            finalPrompt = `${replyText}\n\n${promptInput}`;
        } else if (promptInput && replyImageParts.length > 0) {
            finalPrompt = promptInput;
        } else if (promptInput) {
            finalPrompt = promptInput;
        } else {
            finalPrompt = replyText;
        }

        const allImageParts = [...replyImageParts, ...messageImageParts];
        const hasPrompt = !!finalPrompt.trim();

        requireUser(hasPrompt || allImageParts.length > 0, "至少需要一条提示");

        if (!config.currentVideoTag || !config.currentVideoModel || !config.configs[config.currentVideoTag]) {
            throw new UserError(
                `请先配置API并设置模型</br>使用 ${prefixes[0]}ai config add <tag> <url> <key> 和 ${prefixes[0]}ai model video <tag> <model-path>`
            );
        }

        const token = this.aiService.createAbortToken();
        await sendProcessing(msg, "video");

        try {
            let imageParts = allImageParts;

            if (imageMode === "firstlast" && allImageParts.length < 2) {
                if (allImageParts.length === 1) {
                    imageMode = "first";
                } else if (hasPrompt) {
                    imageMode = "auto";
                    imageParts = [];
                }
            }

            if (imageMode === "first" && allImageParts.length < 1) {
                if (hasPrompt) {
                    imageMode = "auto";
                    imageParts = [];
                }
            }
            if (imageMode === "first") {
                imageParts = allImageParts.slice(0, 1);
            } else if (imageMode === "firstlast") {
                imageParts = allImageParts.slice(0, 2);
            } else if (allImageParts.length > 0) {
                imageMode = "reference";
                imageParts = allImageParts.slice(0, 4);
            }

            const videos = await this.aiService.generateVideo(finalPrompt, imageParts, imageMode, token);
            if (videos.length === 0) throw new Error("AI回复为空");
            await this.messageUtils.sendVideos(msg, videos, finalPrompt, replyToId, token);
            await deleteMessageOrGroup(msg);
        } finally {
            this.aiService.releaseToken(token);
        }
    }
}

class AIPlugin extends BasePlugin {
    command = "ai";
    name = "AI";
    description = "🤖 智能AI助手";
    scope = "new_message" as PluginScope;

    private aiService: AIService;
    private httpClient: HttpClient;
    private featureRegistry: FeatureRegistry;
    private questionFeature: QuestionFeature;
    private configManagerPromise: Promise<ConfigManager>;

    constructor(context: PluginContext) {
        super(context);
        this.configManagerPromise = ConfigManager.getInstance();
        this.httpClient = new HttpClient(this.configManagerPromise);
        this.aiService = new AIService(this.configManagerPromise, this.httpClient);
        this.featureRegistry = new FeatureRegistry();
        this.questionFeature = new QuestionFeature(this.aiService, this.configManagerPromise, this.httpClient);
        this.registerFeatures();
    }

    private getMainPrefix(): string {
        const prefixes = this.context.env.COMMAND_PREFIXES;
        return prefixes[0] || "";
    }

    private registerFeatures(): void {
        this.featureRegistry.register(new ConfigFeature(this.configManagerPromise));
        this.featureRegistry.register(new ModelFeature(this.configManagerPromise));
        this.featureRegistry.register(new PromptFeature(this.configManagerPromise));
        this.featureRegistry.register(new CollapseFeature(this.configManagerPromise));
        this.featureRegistry.register(new TelegraphFeature(this.configManagerPromise));
        this.featureRegistry.register(new TimeoutFeature(this.configManagerPromise));
        this.featureRegistry.register(new ImageFeature(this.aiService, this.configManagerPromise, this.httpClient));
        this.featureRegistry.register(new VideoFeature(this.aiService, this.configManagerPromise, this.httpClient));
    }

    private async buildHelpText(): Promise<string> {
        const mainPrefix = this.getMainPrefix();
        const config = (await this.configManagerPromise).getConfig();

    const baseDescription = `<b>🤖 智能AI助手</b></br></br>
<b>⚙️ API配置:</b></br>
• <code>${mainPrefix}ai config add &lt;tag&gt; &lt;url&gt; &lt;key&gt;</code> - 添加API配置</br>
• <code>${mainPrefix}ai config del &lt;tag&gt;</code> - 删除API配置</br></br>
<b>🧠 模型设置:</b></br>
• <code>${mainPrefix}ai model chat &lt;tag&gt; &lt;model-path&gt;</code> - 设置聊天模型</br>
• <code>${mainPrefix}ai model image &lt;tag&gt; &lt;model-path&gt;</code> - 设置图片模型</br>
• <code>${mainPrefix}ai model video &lt;tag&gt; &lt;model-path&gt;</code> - 设置视频模型</br></br>
<b>💬 提问:</b></br>
• <code>${mainPrefix}ai &lt;input&gt;</code> - 向AI发起提问</br>
• <code>${mainPrefix}ai image &lt;prompt&gt;</code> - 文生图</br>
• <code>${mainPrefix}ai video &lt;prompt&gt;</code> - 文生/参考图生成视频</br>
• <code>${mainPrefix}ai video first &lt;prompt&gt;</code> - 首帧生成视频</br>
• <code>${mainPrefix}ai video firstlast &lt;prompt&gt;</code> - 首尾帧生成视频</br></br>
<b>✍️ 提示词:</b></br>
• <code>${mainPrefix}ai prompt set &lt;input&gt;</code> - 设置提示词</br>
• <code>${mainPrefix}ai prompt del</code> - 删除提示词</br></br>
<b>🧩 消息设置:</b></br>
• <code>${mainPrefix}ai image preview on|off</code> - 设置图片预览</br>
• <code>${mainPrefix}ai video preview on|off</code> - 设置视频预览</br>
• <code>${mainPrefix}ai video audio on|off</code> - 开/关视频音频</br>
• <code>${mainPrefix}ai collapse on|off</code> - 开/关消息折叠</br>
• <code>${mainPrefix}ai video duration &lt;sec&gt;</code> - 视频输出时长</br>
• <code>${mainPrefix}ai timeout &lt;sec&gt;</code> - 设置超时时间</br></br>
<b>📰 Telegraph:</b></br>
• <code>${mainPrefix}ai telegraph on</code> - 开启Telegraph</br>
• <code>${mainPrefix}ai telegraph off</code> - 关闭Telegraph</br>
• <code>${mainPrefix}ai telegraph limit &lt;integer&gt;</code> - 设置容量</br>
• <code>${mainPrefix}ai telegraph del &lt;number/all&gt;</code> - 删除记录</br></br>
<b>📌 使用说明:</b></br>
• 不携带参数可进行查询</br>
• 回复消息可进行补充提问</br>`;
        if (!config.collapse) return baseDescription;
        return `<blockquote expandable>${baseDescription}</blockquote>`;
    }

    protected async handlerCommand(message: MessageContext, command: string, args: string[]): Promise<void> {
        try {
            console.log('收到了AI命令', command, args, JSON.stringify(message));
            const prefixes = this.context.env.COMMAND_PREFIXES;
            const rawArgs = [command, ...args].filter(Boolean);

            if (rawArgs.length === 0) {
                await this.questionFeature.askFromReply(message, undefined, prefixes);
                return;
            }

            const sub = rawArgs[0].toLowerCase();
            if (sub === "help" || sub === "?") {
                const description = await this.buildHelpText();
                await MessageSender.sendOrEdit(message, description);
                return;
            }

            const handler = this.featureRegistry.getHandler(sub);
            if (handler) {
                await handler.execute(message, rawArgs, prefixes);
            } else {
                await this.questionFeature.execute(message, rawArgs, prefixes);
            }
        } catch (error) {
            await sendErrorMessage(message, error);
        }
    }

    protected async handleMessage(_message: MessageContext): Promise<void> {
    }

    async onUnload(): Promise<void> {
        this.questionFeature.cancelCurrentOperation();
        await this.aiService.destroy();
        const configManager = await this.configManagerPromise;
        await configManager.destroy();
    }
}

export const Plugin = AIPlugin;
