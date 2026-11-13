import {MtInvalidPeerTypeError, MtPeerNotFoundError, type FullUser} from "@mtcute/core";
import type {MessageContext} from "@mtcute/dispatcher";
import {BasePlugin, type PluginContext, type PluginScope} from "../../core/base-plugin.js";

export default class UserInfoPlugin extends BasePlugin {
  command = "userinfo";
  name = "用户信息";
  description: string;
  scope: PluginScope = "new_message";

  constructor(context: PluginContext) {
    super(context);
    this.description = `查询 Telegram 用户资料</br><code>${this.usage}</code>`;
  }

  private get usage(): string {
    const prefix = this.context.env.COMMAND_PREFIXES[0] ?? "/";
    return `${prefix}${this.command} @用户名`;
  }

  protected async handlerCommand(message: MessageContext): Promise<void> {
    const targetOffset = /^\s*\S+\s*/.exec(message.text)?.[0].length ?? 0;
    const target = message.text.slice(targetOffset).trimEnd();
    const mention = this.getMessageEntityMentionNameEntities(message).find(
      ({offset, length}) => offset === targetOffset && length === target.length
    );

    if (!mention && !/^@[a-z0-9_]+$/i.test(target)) {
      await message.edit({text: `用法：${this.usage}`});
      return;
    }

    const {client} = this.context;
    let user: FullUser;
    try {
      // 用户名可以变更或被重新分配，每次按用户名向 Telegram 查询。
      const peer = mention ? mention.userId : await client.resolveUser(target, true);
      user = await client.getFullUser(peer);
    } catch (error) {
      let text = "暂时无法获取用户信息，请稍后再试。";
      if (error instanceof MtPeerNotFoundError) {
        text = "未找到该用户，请检查用户名。";
      } else if (error instanceof MtInvalidPeerTypeError) {
        text = "该用户名属于群组或频道，请输入用户的 @用户名。";
      } else {
        this.log(`获取用户资料失败：${error instanceof Error ? error.message : String(error)}`);
      }
      await message.edit({text});
      return;
    }

    const text = [
      `用户 ID：${user.id}`,
      `昵称：${user.displayName}`,
      `用户名：${user.username ? `@${user.username}` : "无"}`,
      `类型：${user.isBot ? "机器人" : "用户"}`,
      `简介：${user.bio.trim() || "无"}`
    ].join("\n");
    await message.edit({text, disableWebPreview: true});
  }

  protected async handleMessage(): Promise<void> {}
}
