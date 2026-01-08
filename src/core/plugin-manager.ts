import fs from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {filters, MessageContext, UpdateHandler} from "@mtcute/dispatcher";
import {
    BasePlugin,
    type PluginContext
} from "./base-plugin.js";
import {env} from "../config/env.js";
import {getClient, getCurrentUser, getDispatcher} from "./application.js";

type PluginRecord = {
    name: string;
    filePath: string;
    kind: "system" | "user";
    handlerIds: Array<{ handler: UpdateHandler; group?: number }>;
    instance: BasePlugin;
};

type LoadOptions = {
    forceReload?: boolean;
};

const isPluginFile = (fileName: string): boolean => {
    if (fileName.endsWith(".d.ts")) {
        return false;
    }
    return (
        fileName.endsWith(".ts") ||
        fileName.endsWith(".js") ||
        fileName.endsWith(".mjs")
    );
};

export class PluginManager {
    private readonly plugins = new Map<string, PluginRecord>();
    private readonly pluginsByFile = new Map<string, PluginRecord>();
    private readonly systemPluginDir: string;
    private readonly userPluginDir: string;
    private readonly context: PluginContext;

    constructor(systemPluginDir: string, userPluginDir: string, context: PluginContext) {
        this.systemPluginDir = systemPluginDir;
        this.userPluginDir = userPluginDir;
        this.context = context;
    }

    /**
     * 获取已加载插件列表
     */
    list(): PluginRecord[] {
        return Array.from(this.plugins.values());
    }

    /**
     * 加载系统插件与用户插件
     */
    async loadAll(): Promise<void> {
        // 保证用户插件可热重载，系统插件始终保留
        await this.unloadUserAll();
        await this.loadSystem();
        await this.loadUser();
    }

    /**
     * 加载系统插件
     */
    async loadSystem(): Promise<void> {
        await this.loadDir(this.systemPluginDir, "system");
    }

    /**
     * 加载用户插件
     */
    async loadUser(options: LoadOptions = {}): Promise<void> {
        if (options.forceReload) {
            await this.unloadUserAll();
        }
        await this.loadDir(this.userPluginDir, "user", options);
    }

    /**
     * 重新加载用户插件
     */
    async reloadUser(): Promise<void> {
        await this.loadUser({forceReload: true});
    }

    /**
     * 卸载所有用户插件
     */
    async unloadUserAll(): Promise<void> {
        for (const record of this.plugins.values()) {
            if (record.kind !== "user") {
                continue;
            }
            this.unregisterHandlers(record.handlerIds);
            await record.instance.onUnload();
            this.plugins.delete(record.name);
            this.pluginsByFile.delete(record.filePath);
        }
    }

    /**
     * 卸载指定用户插件
     * @param name
     */
    async unloadUser(name: string): Promise<void> {
        const record = this.plugins.get(name);
        if (!record) {
            throw new Error(`Plugin not found: ${name}`);
        }
        if (record.kind !== "user") {
            throw new Error(`System plugin cannot be unloaded: ${name}`);
        }
        this.unregisterHandlers(record.handlerIds);
        await record.instance.onUnload();
        this.plugins.delete(record.name);
        this.pluginsByFile.delete(record.filePath);
    }

    /**
     * 从文件安装用户插件
     * @param sourcePath
     */
    async installUserPluginFromFile(sourcePath: string): Promise<string> {
        await fs.mkdir(this.userPluginDir, {recursive: true});
        const fileName = path.basename(sourcePath);
        if (!isPluginFile(fileName)) {
            throw new Error(`Invalid plugin file: ${fileName}`);
        }
        const targetPath = path.join(this.userPluginDir, fileName);
        await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
        await this.loadFromFile(targetPath, {forceReload: false}, "user");
        return targetPath;
    }

    /**
     * 扫描目录并加载插件
     * @param pluginDir
     * @param kind
     * @param options
     */
    private async loadDir(
        pluginDir: string,
        kind: "system" | "user",
        options: LoadOptions = {}
    ): Promise<void> {
        // 目录存在才尝试读取
        const exists = await fs
            .access(pluginDir)
            .then(() => true)
            .catch(() => false);
        if (!exists) {
            return;
        }

        const entries = await fs.readdir(pluginDir, {withFileTypes: true});
        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }
            if (!isPluginFile(entry.name)) {
                continue;
            }
            const filePath = path.join(pluginDir, entry.name);
            if (this.pluginsByFile.has(filePath)) {
                // 已加载过的文件跳过
                continue;
            }
            await this.loadFromFile(filePath, options, kind);
        }
    }

    /**
     * 按文件加载插件
     * @param filePath
     * @param options
     * @param kind
     */
    private async loadFromFile(
        filePath: string,
        options: LoadOptions,
        kind: "system" | "user"
    ): Promise<void> {
        const baseUrl = pathToFileURL(filePath).href;
        const moduleUrl = options.forceReload
            ? `${baseUrl}?t=${Date.now()}`
            : baseUrl;
        const mod = await import(moduleUrl);
        const PluginCtor = mod.default ?? mod.Plugin;
        if (!PluginCtor) {
            throw new Error(`Plugin file has no export: ${filePath}`);
        }

        const instance = new PluginCtor(this.context);
        if (!(instance instanceof BasePlugin)) {
            throw new Error(`Plugin must extend BasePlugin: ${filePath}`);
        }

        if (this.plugins.has(instance.name)) {
            throw new Error(`Duplicate plugin name: ${instance.name}`);
        }

        // 注册监听器后再执行 onLoad，失败时回滚监听器
        const handlerIds = this.registerHandlers(instance);
        try {
            await instance.onLoad();
        } catch (error) {
            this.unregisterHandlers(handlerIds);
            throw error;
        }
        const record = {
            name: instance.name,
            filePath,
            kind,
            handlerIds,
            instance
        };
        this.plugins.set(instance.name, record);
        this.pluginsByFile.set(filePath, record);
    }

    /**
     * 注册插件消息监听
     * @param instance
     */
    private registerHandlers(instance: BasePlugin): PluginRecord["handlerIds"] {
        const dispatcher = this.context.dispatcher;
        const handlerIds: PluginRecord["handlerIds"] = [];
        // 命令监听
        if (instance.command) {
            const commandHandler = (message: MessageContext) => BasePlugin.invokeHandlerCommand(instance, message);
            const handler: UpdateHandler = {
                name: "new_message" as const,
                callback: commandHandler,
                check: filters.command(instance.command, {prefixes: env.COMMAND_PREFIXES})
            };
            dispatcher.addUpdateHandler(handler);
            handlerIds.push({handler});
        }

        // 根据 scope 绑定对应的监听消息
        const messageHandler = (message: MessageContext) => BasePlugin.invokeHandlerMessage(instance, message);
        if (instance.scope === "new_message" || instance.scope === "both") {
            const handler: UpdateHandler = {
                name: "new_message" as const,
                callback: messageHandler
            };
            dispatcher.addUpdateHandler(handler);
            handlerIds.push({handler});
        }
        if (instance.scope === "edit_message" || instance.scope === "both") {
            const handler: UpdateHandler = {
                name: "edit_message" as const,
                callback: messageHandler
            };
            dispatcher.addUpdateHandler(handler);
            handlerIds.push({handler});
        }
        return handlerIds;
    }

    /**
     * 注销插件消息监听
     * @param handlerIds
     */
    private unregisterHandlers(handlerIds: PluginRecord["handlerIds"]): void {
        for (const entry of handlerIds) {
            this.context.dispatcher.removeUpdateHandler(entry.handler, entry.group);
        }
    }
}

/**
 * 插件管理器
 */
let pluginManager: PluginManager;

/**
 * 初始化插件管理器
 * @param pluginDir
 */
export const createPluginManager = async (pluginDir = env.PLUGINS_PATH): Promise<PluginManager> => {
    // 复用单例，避免重复创建与重复注册
    if (!pluginManager) {
        const [client, dispatcher, user] = await Promise.all([
            getClient(),
            getDispatcher(),
            getCurrentUser()
        ]);
        const context: PluginContext = {client, dispatcher, user, env};
        const resolvedDir = path.resolve(process.cwd(), pluginDir);
        const systemDir = path.join(resolvedDir, "system");
        const userDir = path.join(resolvedDir, "user");
        const manager = new PluginManager(systemDir, userDir, context);
        context.pluginManager = manager;
        pluginManager = manager;
    }
    return pluginManager;
}
