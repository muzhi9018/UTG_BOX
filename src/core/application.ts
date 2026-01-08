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
 * 当前登录用户
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
 * 获取客户端
 */
const getClient = async (): Promise<TelegramClient> => {
    if (!client) {
        await login();
    }
    return client;
}

/**
 * 登录
 */
const login = async (): Promise<User> => {
    if (!client && !user) {
        ensureStorageDir(env.SESSION_PATH);
        client = new TelegramClient({
            apiId: env.API_ID,
            apiHash: env.API_HASH,
            storage: env.SESSION_PATH,
            testMode: env.IS_TEST_MODE,
            defaultDcs: env.DC_HOST
                ? {
                    main: {
                        ipAddress: env.DC_HOST,
                        port: env.DC_PORT,
                        id: env.DC_ID,
                        testMode: env.IS_TEST_MODE
                    },
                    media: {
                        ipAddress: env.DC_HOST,
                        port: env.DC_PORT,
                        id: env.DC_ID,
                        testMode: env.IS_TEST_MODE,
                        mediaOnly: true
                    }
                }
                : undefined,
            updates: {
                catchUp: true,
                messageGroupingInterval: 250
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
 * 获取当前登录用户
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
    getClient,
    getDispatcher,
    getCurrentUser,
}
