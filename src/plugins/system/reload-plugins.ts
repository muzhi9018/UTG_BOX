import type {MessageContext} from "@mtcute/dispatcher";
import {BasePlugin, PluginScope} from "../../core/base-plugin.js";

export default class ReloadPlugins extends BasePlugin {
    command = 'pg';
    name = '插件';
    description = '用于插件操作';
    scope = 'both' as PluginScope;

    async handlerCommand(message: MessageContext, subCommand: string, args: string[]): Promise<void> {

    }

    async handleMessage(message: MessageContext): Promise<void> {

    }

}
