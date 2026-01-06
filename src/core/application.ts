import {Dispatcher} from "@mtcute/dispatcher";
import {TelegramClient, User} from "@mtcute/node";
import {env} from "../config/env.js";
import path from "node:path";
import fs from "node:fs";

/**
 * 调度器
 */
let dispatcher: Dispatcher;

/**
 * TG 客户端
 */
let client: TelegramClient;

/**
 * 当前登陆用户
 */
let user: User;

/**
 * 获取调度器
 */
const getDispatcher = async (): Promise<Dispatcher> => {
    if (!dispatcher) {
        await login();
        dispatcher = Dispatcher.for(client);
    }
    return dispatcher;
}

/**
 * 登陆
 */
const login = async (): Promise<User> => {
    if (!client && !user) {
        ensureStorageDir(env.storagePath);
        client = new TelegramClient({
            apiId: env.apiId,
            apiHash: env.apiHash,
            storage: env.storagePath,
            updates: {
                catchUp: true,
                messageGroupingInterval: 150
            }
        });
        user = await client.start({
            phone: () => client.input("Phone > "),
            code: () => client.input("Code > "),
            password: () => client.input("Password > ")
        });
    }
    return user
}

/**
 * 获取当前登陆用户
 */
const getCurrentUser = async (): Promise<User> => {
    await login();
    return user;
}

/**
 * 确认数据保存路径
 * @param storagePath
 */
const ensureStorageDir = (storagePath: string) => {
    const dir = path.dirname(storagePath);
    if (dir && dir !== ".") {
        fs.mkdirSync(dir, {recursive: true});
    }
};

export {
    login,
    getDispatcher,
    getCurrentUser,
}