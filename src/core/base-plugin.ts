import {Dispatcher, MessageContext, PropagationAction} from "@mtcute/dispatcher";
import {env} from "../config/env.js";
import {TelegramClient, tl, User} from "@mtcute/node";
import type {Env} from "../config/env.js";
import type {PluginManager} from "./plugin-manager.js";
import RawMessageEntityMentionName = tl.RawMessageEntityMentionName;

export type PluginContext = {
    client: TelegramClient;
    dispatcher: Dispatcher;
    user: User;
    env: Env;
    pluginManager?: PluginManager;
};

export type PluginScope = "new_message" | "edit_message" | "both";

export abstract class BasePlugin {
    /**
     * 命令
     */
    abstract command: string | null;

    /**
     * 插件名称
     */
    abstract name: string;

    /**
     * 插件描述
     */
    abstract description: string;

    /**
     * 插件范围
     */
    abstract scope: PluginScope;

    /**
     * 插件上下文
     * @protected
     */
    protected readonly context: PluginContext;

    /**
     * 处理命令
     * @param message
     * @param command
     * @param args
     */
    protected abstract handlerCommand(message: MessageContext, command: string | '', args: string[]): Promise<void>;

    /**
     * 处理消息
     * @param message
     */
    protected abstract handleMessage(message: MessageContext): Promise<void>;

    /**
     * 插件加载时函数
     */
    async onLoad(): Promise<void> {

    }

    /**
     * 插件卸载函数
     */
    async onUnload(): Promise<void> {

    }

    /**
     * 构造函数
     * @param context
     * @protected
     */
    protected constructor(context: PluginContext) {
        this.context = context;
    }

    /**
     * 输出日志方法
     * @param message
     * @protected
     */
    protected log(message: string): void {
        console.log(`[plugin:${this.name}] ${message}`);
    }

    /**
     * 获取聊天id
     * @param message
     * @protected
     */
    protected getChatId(message: MessageContext): number {
        return message.chat.id;
    }

    /**
     * 获取用户id
     * @param message
     * @protected
     */
    protected getUserId(message: MessageContext): number {
        return message.sender.id;
    }

    /**
     * 获取消息实体提及名称
     * @param message
     */
    protected getMessageEntityMentionNameEntities(message: MessageContext): RawMessageEntityMentionName[] {
        const results: RawMessageEntityMentionName[] = [];
        const entities = message?.entities || [];
        entities.forEach((entity) => {
            if (entity.is('text_mention')) {
                const raw = entity.raw;
                if (raw._ === 'messageEntityMentionName') {
                    results.push(raw);
                }
            }
        });
        return results;
    }


    /**
     * 执行处理消息
     * @param message
     * @private
     */
    private async doHandlerMessage(message: MessageContext): Promise<void> {
        const text = message.text?.trim() ?? '';
        // 监听消息排除命令
        const isCommand = env.COMMAND_PREFIXES.some((prefix) =>
            text.startsWith(prefix + this.command)
        );
        // 不是命令，并且不是自己发的消息才做处理
        if (!isCommand && !message.isOutgoing) {
            await this.handleMessage(message);
        }
    }

    /**
     * 执行处理命令
     * @param message
     * @private
     */
    private async doHandlerCommand(message: MessageContext): Promise<void> {
        const text = message.text?.trim() ?? "";
        const tokens = text.match(/\S+/g) ?? [];
        const [command, subCommand, ...args] = tokens;
        // 只处理自己发送的命令
        if (message.isOutgoing) {
            await this.handlerCommand(message, subCommand ?? '', args);
        }
    }

    static async invokeHandlerMessage(plugin: BasePlugin, message: MessageContext) {
        await plugin.doHandlerMessage(message);
        return PropagationAction.Continue;
    }

    static async invokeHandlerCommand(plugin: BasePlugin, message: MessageContext) {
        await plugin.doHandlerCommand(message);
        return PropagationAction.Continue;
    }

}
