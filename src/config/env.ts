import path from "node:path";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NODE_ENV = process.env.NODE_ENV ?? "development";
const ENV_FILE = path.resolve(__dirname, "../../.env." + NODE_ENV);

dotenv.config({path: ENV_FILE});

const requireEnv = (name: string): string => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`缺少环境变量: ${name}`);
    }
    return value;
};

const requireNumber = (name: string): number => {
    const value = requireEnv(name);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`环境变量${name} 不是有效的数字类型: ${value}`);
    }
    return parsed;
};

const getEnvNumber = (name: string, value: number): number => {
    try {
        return requireNumber(name);
    } catch (e) {
        return value;
    }
}

const parseBool = (value: string): boolean => {
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

// API ID
const API_ID = requireNumber('API_ID');
// API HASH
const API_HASH = requireEnv('API_HASH');
// 会话保存地址
const SESSION_PATH = requireEnv('SESSION_PATH');
// 是否生产环境
const IS_PRODUCTION = NODE_ENV === 'production';
// 是否执行测试模型
const IS_TEST_MODE = IS_PRODUCTION ? false : parseBool(process.env.IS_TEST_MODE ? process.env.IS_TEST_MODE : 'false');
// DC HOST
const DC_HOST = IS_TEST_MODE ? requireEnv('DC_HOST') : process.env.DC_HOST;
// DC 端口
const DC_PORT = DC_HOST ? requireNumber("DC_PORT") : getEnvNumber('DC_PORT', 443);
// DC ID
const DC_ID = DC_HOST ? requireNumber("DC_ID") : getEnvNumber('DC_ID', 2);

const ALLOWED_CHAT_IDS = (process.env.ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

const COMMAND_PREFIXES = (process.env.COMMAND_PREFIXES ?? "/")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

export const env = {
    NODE_ENV,
    API_ID,
    API_HASH,
    SESSION_PATH,
    IS_PRODUCTION,
    DC_HOST,
    DC_PORT,
    DC_ID,
    IS_TEST_MODE,
    ALLOWED_CHAT_IDS: new Set<number>(ALLOWED_CHAT_IDS),
    PLUGINS_PATH: process.env.PLUGINS_PATH ?? (IS_PRODUCTION ? 'dist/plugins' : 'src/plugins'),
    COMMAND_PREFIXES,
};

if (DC_HOST) {
    const dcInfo = `host=${DC_HOST}, port=${DC_PORT}, id=${DC_ID}`;
    if (IS_PRODUCTION) {
        console.warn(`当前生产环境检测到自定义 DC 数据（${dcInfo}），请确认DC参数为正式环境 DC。`);
    } else if (IS_TEST_MODE) {
        console.warn(`当前测试模式检测到自定义 DC 数据（${dcInfo}），请确认DC参数为测试环境 DC。`);
    }
    if (!IS_TEST_MODE && !IS_PRODUCTION) {
        console.warn(`当前非正式环境执行正式环境的 DC 数据; ${dcInfo}`)
    }
}

export type Env = typeof env;
