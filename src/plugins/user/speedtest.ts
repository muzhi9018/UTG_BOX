/**
 * Speedtest plugin - Network Speed Test
 * Converted from external speedtest plugin
 */

import {MessageContext} from "@mtcute/dispatcher";
import {html} from "@mtcute/html-parser";
import {InputMedia} from "@mtcute/core";
import {BasePlugin, PluginScope} from "../../core/base-plugin.js";
import {exec} from "node:child_process";
import {promisify} from "node:util";
import * as fs from "node:fs";
import path from "node:path";
import axios from "axios";
import sharp from "sharp";
import {PingPlugin} from "./ping.js";

const execAsync = promisify(exec);
const toFileInput = (filePath: string): string => `file:${filePath}`;

const SPEEDTEST_VERSION = "1.2.0";
const SPEEDTEST_ROOT = path.join(process.cwd(), "data", "speedtest");
const ASSETS_DIR = path.join(SPEEDTEST_ROOT, "assets");
const TEMP_DIR = path.join(SPEEDTEST_ROOT, "temp");

// 根据平台确定可执行文件名
function getSpeedtestExecutableName(): string {
    return process.platform === "win32" ? "speedtest.exe" : "speedtest";
}

const SPEEDTEST_PATH = path.join(ASSETS_DIR, getSpeedtestExecutableName());
const SPEEDTEST_JSON = path.join(ASSETS_DIR, "speedtest.json");

type MessageType = "photo" | "sticker" | "file" | "txt";
const DEFAULT_ORDER: MessageType[] = ["photo", "sticker", "file", "txt"];

interface SpeedtestConfig {
    default_server_id?: number | null;
    preferred_type?: MessageType;
}

interface SpeedtestResult {
    isp: string;
    server: {
        id: number;
        name: string;
        location: string;
    };
    interface: {
        externalIp: string;
        name: string;
    };
    ping: {
        latency: number;
        jitter: number;
    };
    download: {
        bandwidth: number;
        bytes: number;
    };
    upload: {
        bandwidth: number;
        bytes: number;
    };
    timestamp: string;
    result: {
        url: string;
    };
}

interface ServerInfo {
    id: number;
    name: string;
    location: string;
    distance?: number;
    ping?: number;
    available?: boolean;
    error?: string;
}

function ensureDirectories(): void {
    fs.mkdirSync(ASSETS_DIR, {recursive: true});
    fs.mkdirSync(TEMP_DIR, {recursive: true});
}

function buildHelpText(commandName: string): string {
    return `<b>使用方法:</b></br>
<code>${commandName}</code> - 开始速度测试</br>
<code>${commandName} [服务器ID]</code> - 使用指定服务器测试</br>
<code>${commandName} list</code> - 显示可用服务器列表</br>
<code>${commandName} test [服务器ID]</code> - 测试指定服务器可用性</br>
<code>${commandName} best</code> - 查找最佳可用服务器</br>
<code>${commandName} set [ID]</code> - 设置默认服务器</br>
<code>${commandName} type photo/sticker/file/txt</code> - 设置优先使用的消息类型</br>
<code>${commandName} clear</code> - 清除默认服务器</br>
<code>${commandName} config</code> - 显示配置信息</br>
<code>${commandName} check</code> - 检查网络连接状态</br>
<code>${commandName} diagnose</code> - 诊断speedtest可执行文件问题</br>
<code>${commandName} fix</code> - 自动修复speedtest安装问题</br>
<code>${commandName} update</code> - 更新 Speedtest CLI</br>
</br>
<b>系统speedtest支持:</b></br>
在任何测试命令中添加 <code>--system</code> 或 <code>-s</code> 标志使用系统已安装的speedtest</br>
例: <code>${commandName} --system</code> 或 <code>${commandName} -s 12345</code>`;
}

function htmlEscape(text: unknown): string {
    const textStr = typeof text === "string" ? text : String(text ?? "");
    return textStr
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/\'/g, "&#x27;");
}

async function fillRoundedCorners(
    inputPath: string,
    outPath?: string,
    bgColor: string = "#212338",
    borderPx: number = 14
) {
    const meta = await sharp(inputPath).metadata();

    const output =
        outPath ??
        (() => {
            const dir = path.dirname(inputPath);
            const ext =
                meta.format === "jpeg" || meta.format === "jpg" ? ".jpg" : ".png";
            const base = path.basename(inputPath, path.extname(inputPath));
            return path.join(dir, `${base}.filled${ext}`);
        })();

    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
        throw new Error("Unable to read image dimensions");
    }

    const maxInset = Math.floor((Math.min(width, height) - 1) / 2);
    const inset = Math.max(0, Math.min(borderPx, maxInset));
    const cropW = width - inset * 2;
    const cropH = height - inset * 2;

    const background = sharp({
        create: {
            width,
            height,
            channels: 4,
            background: bgColor
        }
    });

    const innerBuf = await sharp(inputPath)
        .extract({left: inset, top: inset, width: cropW, height: cropH})
        .toBuffer();

    const left = Math.floor((width - cropW) / 2);
    const top = Math.floor((height - cropH) / 2);

    let composed = background.composite([{input: innerBuf, left, top}]);

    if (meta.format === "jpeg" || meta.format === "jpg") {
        composed = composed.jpeg({quality: 95});
    } else if (meta.format === "png" || !meta.format) {
        composed = composed.png({compressionLevel: 9});
    }

    await composed.toFile(output);
    return {output};
}

function readConfig(): SpeedtestConfig {
    try {
        if (fs.existsSync(SPEEDTEST_JSON)) {
            const data = JSON.parse(fs.readFileSync(SPEEDTEST_JSON, "utf8"));
            return data as SpeedtestConfig;
        }
    } catch (error: any) {
        console.error("Failed to read config:", error);
    }
    return {};
}

function writeConfig(patch: Partial<SpeedtestConfig>): void {
    try {
        ensureDirectories();
        const current = readConfig();
        const next = {...current, ...patch};
        fs.writeFileSync(SPEEDTEST_JSON, JSON.stringify(next));
    } catch (error: any) {
        console.error("Failed to write config:", error);
    }
}

function getDefaultServer(): number | null {
    const cfg = readConfig();
    return cfg.default_server_id ?? null;
}

function saveDefaultServer(serverId: number | null): void {
    writeConfig({default_server_id: serverId});
}

function removeDefaultServer(): void {
    try {
        const cfg = readConfig();
        delete cfg.default_server_id;
        fs.writeFileSync(SPEEDTEST_JSON, JSON.stringify(cfg));
    } catch (error: any) {
        console.error("Failed to remove default server:", error);
    }
}

function getPreferredType(): MessageType | null {
    const cfg = readConfig();
    return (cfg.preferred_type as MessageType) || null;
}

function savePreferredType(t: MessageType): void {
    writeConfig({preferred_type: t});
}

function getMessageOrder(): MessageType[] {
    const preferred = getPreferredType();
    if (!preferred) return DEFAULT_ORDER.slice();
    return [preferred, ...DEFAULT_ORDER.filter((x) => x !== preferred)];
}

async function downloadCli(): Promise<void> {
    try {
        ensureDirectories();

        if (fs.existsSync(SPEEDTEST_PATH)) {
            console.log(`Speedtest CLI already exists at: ${SPEEDTEST_PATH}`);
            return;
        }

        const platform = process.platform;
        const arch = process.arch;
        console.log(`Downloading speedtest CLI for platform: ${platform}, arch: ${arch}`);

        let filename: string;

        if (platform === "linux") {
            const archMap: { [key: string]: string } = {
                x64: "x86_64",
                arm64: "aarch64",
                arm: "armhf"
            };
            const mappedArch = archMap[arch] || "x86_64";
            filename = `ookla-speedtest-${SPEEDTEST_VERSION}-linux-${mappedArch}.tgz`;
        } else if (platform === "win32") {
            filename = `ookla-speedtest-${SPEEDTEST_VERSION}-win64.zip`;
        } else if (platform === "darwin") {
            filename = `ookla-speedtest-${SPEEDTEST_VERSION}-macosx-universal.tgz`;
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        const url = `https://install.speedtest.net/app/cli/${filename}`;
        console.log(`Downloading from: ${url}`);

        const response = await axios.get(url, {responseType: "arraybuffer"});
        const tempFile = path.join(ASSETS_DIR, filename);

        console.log(`Saving to temp file: ${tempFile}`);
        fs.writeFileSync(tempFile, response.data);

        if (!fs.existsSync(tempFile)) {
            throw new Error(`Failed to save downloaded file: ${tempFile}`);
        }

        if (platform === "linux" || platform === "darwin") {
            console.log(`Extracting tar.gz file: ${tempFile}`);
            await execAsync(`tar -xzf "${tempFile}" -C "${ASSETS_DIR}"`);

            if (!fs.existsSync(SPEEDTEST_PATH)) {
                throw new Error(`Speedtest executable not found after extraction: ${SPEEDTEST_PATH}`);
            }

            await execAsync(`chmod +x "${SPEEDTEST_PATH}"`);
            console.log(`Set executable permissions for: ${SPEEDTEST_PATH}`);
        } else if (platform === "win32") {
            console.log(`Extracting zip file: ${tempFile}`);
            const {default: AdmZip} = await import("adm-zip");
            const zip = new AdmZip(tempFile);
            zip.extractAllTo(ASSETS_DIR, true);

            if (!fs.existsSync(SPEEDTEST_PATH)) {
                throw new Error(`Speedtest executable not found after extraction: ${SPEEDTEST_PATH}`);
            }
        }

        try {
            fs.unlinkSync(tempFile);
            console.log(`Cleaned up temp file: ${tempFile}`);
        } catch (cleanupError) {
            console.warn(`Failed to cleanup temp file: ${tempFile}`, cleanupError);
        }

        const extraFiles = ["speedtest.5", "speedtest.md"];
        for (const file of extraFiles) {
            const filePath = path.join(ASSETS_DIR, file);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    console.log(`Cleaned up extra file: ${filePath}`);
                } catch (cleanupError) {
                    console.warn(`Failed to cleanup extra file: ${filePath}`, cleanupError);
                }
            }
        }

        console.log(`Speedtest CLI successfully installed at: ${SPEEDTEST_PATH}`);
    } catch (error: any) {
        console.error("Failed to download speedtest CLI:", error);

        try {
            if (fs.existsSync(SPEEDTEST_PATH)) {
                fs.unlinkSync(SPEEDTEST_PATH);
            }
        } catch (cleanupError) {
            console.warn("Failed to cleanup damaged speedtest file:", cleanupError);
        }

        throw error;
    }
}

async function unitConvert(bytes: number, isBytes: boolean = false): Promise<string> {
    const power = 1000;
    let value = bytes;
    let unitIndex = 0;

    const units = isBytes
        ? ["B", "KB", "MB", "GB", "TB"]
        : ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];

    if (!isBytes) {
        value *= 8;
    }

    while (value >= power && unitIndex < units.length - 1) {
        value /= power;
        unitIndex++;
    }

    return `${Math.round(value * 100) / 100}${units[unitIndex]}`;
}

async function getIpApi(ip: string): Promise<{
    asInfo: string;
    ccName: string;
    ccCode: string;
    ccFlag: string;
    ccLink: string;
}> {
    try {
        const response = await axios.get(
            `http://ip-api.com/json/${ip}?fields=as,country,countryCode`
        );
        const data = response.data;

        const asInfo = data.as?.split(" ")[0] || "";
        const ccName =
            data.country === "Netherlands" ? "Netherlands" : data.country || "";
        const ccCode = data.countryCode || "";
        const ccFlag = ccCode
            ? String.fromCodePoint(
                ...ccCode
                    .toUpperCase()
                    .split("")
                    .map((c: string) => 127397 + c.charCodeAt(0))
            )
            : "";

        let ccLink = "https://www.submarinecablemap.com/country/";
        if (["Hong Kong", "Macao", "Macau"].includes(ccName)) {
            ccLink += "china";
        } else {
            ccLink += ccName.toLowerCase().replace(" ", "-");
        }

        return {asInfo, ccName, ccCode, ccFlag, ccLink};
    } catch (error: any) {
        console.error("Failed to get IP info:", error);
        return {asInfo: "", ccName: "", ccCode: "", ccFlag: "", ccLink: ""};
    }
}

async function getInterfaceTraffic(interfaceName: string): Promise<{
    rxBytes: number;
    txBytes: number;
    mtu: number;
}> {
    try {
        if (process.platform === "linux") {
            const rxBytes = parseInt(
                fs.readFileSync(
                    `/sys/class/net/${interfaceName}/statistics/rx_bytes`,
                    "utf8"
                )
            );
            const txBytes = parseInt(
                fs.readFileSync(
                    `/sys/class/net/${interfaceName}/statistics/tx_bytes`,
                    "utf8"
                )
            );
            const mtu = parseInt(
                fs.readFileSync(`/sys/class/net/${interfaceName}/mtu`, "utf8")
            );
            return {rxBytes, txBytes, mtu};
        }
    } catch (error: any) {
        console.error("Failed to get interface traffic:", error);
    }
    return {rxBytes: 0, txBytes: 0, mtu: 0};
}

async function diagnoseSpeedtestExecutable(): Promise<{ canRun: boolean; error?: string; needsReinstall: boolean }> {
    try {
        if (!fs.existsSync(SPEEDTEST_PATH)) {
            return {canRun: false, error: "可执行文件不存在", needsReinstall: true};
        }

        if (process.platform !== "win32") {
            try {
                const stats = fs.statSync(SPEEDTEST_PATH);
                if (!(stats.mode & parseInt("111", 8))) {
                    console.log("Fixing executable permissions...");
                    await execAsync(`chmod +x "${SPEEDTEST_PATH}"`);
                }
            } catch (permError) {
                return {canRun: false, error: "权限检查失败", needsReinstall: true};
            }
        }

        try {
            const {stdout} = await execAsync(`"${SPEEDTEST_PATH}" --version`, {timeout: 10000});
            if (stdout && stdout.includes("Speedtest")) {
                return {canRun: true, needsReinstall: false};
            }
        } catch (versionError) {
            console.log("Version check failed:", versionError);
        }

        try {
            const {stdout} = await execAsync(`"${SPEEDTEST_PATH}" --help`, {timeout: 10000});
            if (stdout && (stdout.includes("Speedtest") || stdout.includes("usage"))) {
                return {canRun: true, needsReinstall: false};
            }
        } catch (helpError) {
            console.log("Help check failed:", helpError);
        }

        return {canRun: false, error: "可执行文件无法运行，可能是架构不匹配或文件损坏", needsReinstall: true};
    } catch (error: any) {
        return {canRun: false, error: error.message || "诊断失败", needsReinstall: true};
    }
}

async function autoFixSpeedtest(): Promise<void> {
    console.log("Starting auto-fix for speedtest...");

    const filesToClean = [
        SPEEDTEST_PATH,
        path.join(ASSETS_DIR, "speedtest.exe"),
        path.join(ASSETS_DIR, "speedtest")
    ];

    for (const file of filesToClean) {
        if (fs.existsSync(file)) {
            try {
                fs.unlinkSync(file);
                console.log(`Cleaned up file: ${file}`);
            } catch (cleanupError) {
                console.warn(`Failed to cleanup file: ${file}`, cleanupError);
            }
        }
    }

    try {
        const tempFiles = fs.readdirSync(ASSETS_DIR).filter(file =>
            file.endsWith(".tgz") || file.endsWith(".zip")
        );
        for (const tempFile of tempFiles) {
            try {
                fs.unlinkSync(path.join(ASSETS_DIR, tempFile));
                console.log(`Cleaned up temp file: ${tempFile}`);
            } catch (cleanupError) {
                console.warn(`Failed to cleanup temp file: ${tempFile}`, cleanupError);
            }
        }
    } catch (readDirError) {
        console.warn("Failed to read assets directory:", readDirError);
    }

    await downloadCli();

    const diagnosis = await diagnoseSpeedtestExecutable();
    if (!diagnosis.canRun) {
        throw new Error(`自动修复失败: ${diagnosis.error}`);
    }

    console.log("Auto-fix completed successfully");
}

async function runSystemSpeedtest(serverId?: number, retryCount: number = 0): Promise<SpeedtestResult> {
    const MAX_RETRIES = 1;
    try {
        const candidates = process.platform === "win32"
            ? ["speedtest.exe", "speedtest-cli.exe"]
            : ["speedtest", "speedtest-cli"];
        let exe: string | null = null;

        for (const name of candidates) {
            try {
                const {stdout} = await execAsync(`which ${name}`, {timeout: 5000});
                if (stdout && stdout.trim()) {
                    exe = stdout.trim();
                    break;
                }
            } catch {
            }
        }

        if (!exe) {
            if (process.platform === "win32") {
                for (const name of ["speedtest", "speedtest-cli"]) {
                    try {
                        const {stdout} = await execAsync(`where ${name}`, {timeout: 5000});
                        if (stdout && stdout.trim()) {
                            exe = stdout.split(/\r?\n/)[0].trim();
                            break;
                        }
                    } catch {
                    }
                }
            }
        }

        if (!exe) {
            throw new Error("系统未安装 speedtest，可使用不带 --system 的默认行为或运行 speedtest update 安装内置 CLI");
        }

        const serverArg = serverId ? ` -s ${serverId}` : "";
        const command = `${exe} --accept-license --accept-gdpr -f json${serverArg}`;

        const {stdout, stderr} = await execAsync(command, {timeout: 120000});

        if (stderr && stderr.trim()) {
            console.log("System speedtest stderr:", stderr);
        }

        let result: any;
        try {
            result = JSON.parse(stdout);

            if (result.error) {
                if (result.error.includes("Cannot read")) {
                    throw new Error(`网络连接错误: ${result.error}\n\n这是网络环境问题，不是程序问题。建议：\n1. 检查网络连接稳定性\n2. 尝试其他测试服务器\n3. 稍后重试`);
                }
                throw new Error(`测试失败: ${result.error}`);
            }
        } catch (parseError) {
            if (stdout.includes("\"error\":\"Cannot read")) {
                throw new Error("网络连接错误: Cannot read\n\n这是网络环境问题，不是程序问题。建议：\n1. 检查网络连接稳定性\n2. 尝试其他测试服务器\n3. 稍后重试");
            }
            throw new Error("系统 speedtest 返回非 JSON 输出");
        }

        if (!result.upload || result.upload.bandwidth === undefined) {
            result.upload = {bandwidth: 0, bytes: 0, elapsed: 0};
            result.uploadFailed = true;
        }

        return result;
    } catch (error: any) {
        console.error("runSystemSpeedtest failed:", error);
        if (retryCount < MAX_RETRIES && (error.message?.includes("系统未安装") || error.message?.includes("Command failed"))) {
            console.log("System speedtest failed, falling back to built-in speedtest...");
            return await runSpeedtest(serverId, retryCount + 1, false);
        }
        throw error;
    }
}

async function runSpeedtest(serverId?: number, retryCount: number = 0, useSystem: boolean = false): Promise<SpeedtestResult> {
    const MAX_RETRIES = 1;

    try {
        if (useSystem) {
            return await runSystemSpeedtest(serverId, retryCount);
        }

        if (!fs.existsSync(SPEEDTEST_PATH)) {
            console.log("Speedtest executable not found, downloading...");
            await downloadCli();
        }

        if (retryCount === 0) {
            const diagnosis = await diagnoseSpeedtestExecutable();
            if (!diagnosis.canRun) {
                console.log(`Speedtest executable issue detected: ${diagnosis.error}`);
                if (diagnosis.needsReinstall) {
                    console.log("Attempting auto-fix...");
                    await autoFixSpeedtest();
                }
            }
        }

        const serverArg = serverId ? ` -s ${serverId}` : "";
        const command = `"${SPEEDTEST_PATH}" --accept-license --accept-gdpr -f json${serverArg}`;

        const {stdout, stderr} = await execAsync(command, {timeout: 120000});

        if (stderr) {
            console.log("Speedtest stderr:", stderr);
            if (stderr.includes("NoServersException")) {
                if (serverId) {
                    console.log(`Server ${serverId} not available, trying auto selection...`);
                    return await runSpeedtest(undefined, retryCount, useSystem);
                }
                throw new Error("指定的服务器不可用，请尝试其他服务器或使用自动选择");
            }
            if (stderr.includes("Timeout occurred")) {
                throw new Error("网络连接超时，请检查网络状况或稍后重试");
            }
            if (stderr.includes("Cannot read from socket")) {
                throw new Error("网络连接中断，可能是网络不稳定或防火墙阻止");
            }
        }

        let result: any;
        try {
            result = JSON.parse(stdout);

            if (result.error) {
                if (result.error.includes("Cannot read")) {
                    throw new Error(`网络连接错误: ${result.error}\n\n这是网络环境问题，不是程序问题。建议：\n1. 检查网络连接稳定性\n2. 尝试其他测试服务器\n3. 稍后重试`);
                }
                throw new Error(`测试失败: ${result.error}`);
            }
        } catch (parseError) {
            console.log("JSON parse failed, checking for partial results...");

            if (stdout.includes("Download:") && stdout.includes("Upload: FAILED")) {
                throw new Error("上传测试失败，网络环境可能不支持上传测试。下载测试正常完成，但无法获取完整结果。\n\n建议：\n1. 尝试其他测试服务器\n2. 检查网络防火墙设置\n3. 稍后重试");
            }

            if (stdout.includes("\"error\":\"Cannot read")) {
                throw new Error("网络连接错误: Cannot read\n\n这是网络环境问题，不是程序问题。建议：\n1. 检查网络连接稳定性\n2. 尝试其他测试服务器\n3. 稍后重试");
            }

            throw parseError;
        }

        if (!result.upload || result.upload.bandwidth === undefined) {
            console.log("Upload test failed, but download succeeded");
            result.upload = {
                bandwidth: 0,
                bytes: 0,
                elapsed: 0
            };
            result.uploadFailed = true;
        }

        return result;
    } catch (error: any) {
        console.error("Speedtest failed:", error);

        const isNetworkError = error.message?.includes("Cannot read") ||
            error.message?.includes("Upload: FAILED") ||
            error.message?.includes("网络连接错误") ||
            error.message?.includes("网络环境问题");

        const isExecutableIssue = error.message?.includes("Command failed") &&
            error.message?.includes(SPEEDTEST_PATH) &&
            !isNetworkError &&
            retryCount < MAX_RETRIES;

        if (isExecutableIssue) {
            console.log(`Detected executable issue, attempting auto-fix... (retry ${retryCount + 1}/${MAX_RETRIES})`);
            try {
                await autoFixSpeedtest();
                return await runSpeedtest(serverId, retryCount + 1, useSystem);
            } catch (fixError: any) {
                throw new Error(`speedtest可执行文件问题，自动修复失败: ${fixError.message || String(fixError)}\n\n请尝试手动执行 'speedtest update' 命令`);
            }
        }

        if (retryCount >= MAX_RETRIES && error.message?.includes("Command failed")) {
            throw new Error(`speedtest执行失败，已达到最大重试次数 (${MAX_RETRIES})。\n\n错误信息: ${error.message}\n\n建议:\n1. 检查网络连接\n2. 手动执行 'speedtest update' 重新安装\n3. 检查系统权限和防火墙设置`);
        }

        if (serverId && (error.message?.includes("NoServersException") ||
            error.message?.includes("Server not found") ||
            error.message?.includes("不可用"))) {
            console.log(`Server ${serverId} failed, trying auto selection...`);
            try {
                return await runSpeedtest(undefined, retryCount, useSystem);
            } catch {
                throw error;
            }
        }

        if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
            throw new Error("测试超时，可能网络较慢或服务器繁忙，建议：\n1. 检查网络连接\n2. 尝试其他测试服务器\n3. 稍后重试");
        }

        if (error.code === "ENOENT") {
            throw new Error("speedtest 程序未找到，请使用 'speedtest update' 重新下载");
        }

        if (error instanceof SyntaxError) {
            throw new Error("测试结果格式错误，可能服务器返回了异常数据");
        }

        throw error;
    }
}

async function getAllServers(): Promise<ServerInfo[]> {
    try {
        if (!fs.existsSync(SPEEDTEST_PATH)) {
            await downloadCli();
        }

        const command = `"${SPEEDTEST_PATH}" -f json -L`;
        const {stdout} = await execAsync(command, {timeout: 30000});
        const result = JSON.parse(stdout);

        return result.servers || [];
    } catch (error: any) {
        console.error("Failed to get servers:", error);
        return [];
    }
}

async function testServerAvailability(serverId: number): Promise<{
    available: boolean;
    ping?: number;
    error?: string
}> {
    try {
        const allServers = await getAllServers();
        const serverExists = allServers.find(s => s.id === serverId);

        if (!serverExists) {
            return {available: false, error: "服务器不在可用列表中"};
        }

        return {available: true};
    } catch (error: any) {
        console.error(`Server ${serverId} availability test failed:`, error);
        return {available: false, error: error.message || "测试失败"};
    }
}

async function checkNetworkConnectivity(): Promise<{ connected: boolean; message: string }> {
    try {
        await axios.get("https://www.speedtest.net", {timeout: 10000});
        return {connected: true, message: "网络连接正常"};
    } catch (error: any) {
        if (error.code === "ENOTFOUND") {
            return {connected: false, message: "DNS解析失败，请检查DNS设置"};
        } else if (error.code === "ECONNREFUSED") {
            return {connected: false, message: "连接被拒绝，可能存在防火墙阻止"};
        } else if (error.code === "ETIMEDOUT") {
            return {connected: false, message: "连接超时，网络可能较慢或不稳定"};
        } else {
            return {connected: false, message: `网络连接异常: ${error.message}`};
        }
    }
}

async function saveSpeedtestImage(url: string): Promise<string | null> {
    try {
        const imageUrl = url + ".png";
        const response = await axios.get(imageUrl, {responseType: "arraybuffer"});
        const imagePath = path.join(TEMP_DIR, "speedtest.png");
        const filledImagePath = path.join(TEMP_DIR, "speedtest_filled.png");
        fs.writeFileSync(imagePath, response.data);

        const bgColor = "#212338";
        const borderPx = 14;
        try {
            await fillRoundedCorners(imagePath, filledImagePath, bgColor, borderPx);
            return filledImagePath;
        } catch (err) {
            console.error("Failed to fill rounded corners:", err);
        }

        return imagePath;
    } catch (error: any) {
        console.error("Failed to save speedtest image:", error);
        return null;
    }
}

async function convertImageToStickerWebp(srcPath: string): Promise<string | null> {
    try {
        if (!fs.existsSync(srcPath)) return null;
        const stickerPath = path.join(
            TEMP_DIR,
            `speedtest_sticker_${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 8)}.webp`
        );

        await sharp(srcPath)
            .resize(512, 512, {
                fit: "contain",
                background: {r: 0, g: 0, b: 0, alpha: 0}
            })
            .webp({quality: 85, effort: 5})
            .toFile(stickerPath);

        try {
            const {size} = fs.statSync(stickerPath);
            if (size > 512 * 1024) {
                await sharp(srcPath)
                    .resize(512, 512, {
                        fit: "contain",
                        background: {r: 0, g: 0, b: 0, alpha: 0}
                    })
                    .webp({quality: 65, effort: 6})
                    .toFile(stickerPath);
            }
        } catch {
        }

        return stickerPath;
    } catch (e) {
        console.error("Failed to convert image to sticker:", e);
        return null;
    }
}

export class SpeedtestPlugin extends BasePlugin {
    command = "speedtest";
    name = "Speedtest";
    description = "⚡️ 网络速度测试工具 | SpeedTest by Ookla";
    scope = "new_message" as PluginScope;

    protected async handlerCommand(message: MessageContext, subCommand: string, args: string[]): Promise<void> {
        const rawArgs = [subCommand, ...args].filter(Boolean);
        const flags = rawArgs.filter((arg) => arg.startsWith("--") || arg.startsWith("-"));
        const inputArgs = rawArgs.filter((arg) => !arg.startsWith("--") && !arg.startsWith("-"));
        const command = inputArgs[0] || "";
        const useSystem = flags.includes("--system") || flags.includes("-s");

        const mainPrefix = this.context.env.COMMAND_PREFIXES[0] ?? "/";
        const commandName = `${mainPrefix}speedtest`;
        const helpText = buildHelpText(commandName);

        try {
            ensureDirectories();
            if (command === "list") {
                await message.edit({text: html("🔍 正在获取服务器列表...")});

                const servers = await getAllServers();
                if (servers.length === 0) {
                    await message.edit({
                        text: html("❌ <b>错误</b></br></br>无可用服务器")
                    });
                    return;
                }

                const serverList = servers
                    .slice(0, 20)
                    .map(
                        (server) =>
                            `<code>${server.id}</code> - <code>${htmlEscape(
                                server.name
                            )}</code> - <code>${htmlEscape(server.location)}</code>`
                    )
                    .join("</br>");

                await message.edit({
                    text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>${serverList}`)
                });
            } else if (command === "set") {
                const serverId = parseInt(inputArgs[1]);
                if (!serverId || Number.isNaN(serverId)) {
                    await message.edit({
                        text: html(`❌ <b>参数错误</b></br></br>请指定有效的服务器ID</br>例: <code>${commandName} set 12345</code>`)
                    });
                    return;
                }

                saveDefaultServer(serverId);
                await message.edit({
                    text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br><code>默认服务器已设置为 ${serverId}</code>`)
                });
            } else if (command === "clear") {
                removeDefaultServer();
                await message.edit({
                    text: html("<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br><code>默认服务器已清除</code>")
                });
            } else if (command === "config") {
                const defaultServer = getDefaultServer() || "Auto";
                const typePref = getPreferredType() || "默认(photo→sticker→file→txt)";
                await message.edit({
                    text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br><code>默认服务器: ${defaultServer}</code></br><code>优先类型: ${typePref}</code></br><code>Speedtest® CLI: ${SPEEDTEST_VERSION}</code>`)
                });
            } else if (command === "type") {
                const t = (inputArgs[1] || "").toLowerCase();
                const valid: MessageType[] = ["photo", "sticker", "file", "txt"];
                if (!valid.includes(t as MessageType)) {
                    await message.edit({
                        text: html(`❌ <b>参数错误</b></br></br><code>${commandName} type photo/sticker/file/txt</code> - 设置优先使用的消息类型`)
                    });
                    return;
                }
                savePreferredType(t as MessageType);
                const order = getMessageOrder();
                await message.edit({
                    text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br><code>优先类型已设置为: ${t}</code></br><code>当前顺序: ${order.join(" → ")}</code>`)
                });
            } else if (command === "check") {
                await message.edit({
                    text: html("🔍 正在检查网络连接...")
                });

                try {
                    const networkStatus = await checkNetworkConnectivity();
                    const statusIcon = networkStatus.connected ? "✅" : "❌";

                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>${statusIcon} <b>网络状态:</b> <code>${networkStatus.message}</code></br></br><b>建议:</b></br>• 如果连接异常，请检查网络设置</br>• 尝试更换网络环境或DNS服务器</br>• 确认防火墙允许网络测试`)
                    });
                } catch (error) {
                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>❌ <code>网络检查失败: ${htmlEscape(String(error))}</code>`)
                    });
                }
            } else if (command === "test") {
                const serverId = parseInt(inputArgs[1]);
                if (!serverId || Number.isNaN(serverId)) {
                    await message.edit({
                        text: html(`❌ <b>参数错误</b></br></br>请指定有效的服务器ID</br>例: <code>${commandName} test 12345</code>`)
                    });
                    return;
                }

                await message.edit({
                    text: html(`🔍 正在测试服务器 ${serverId} 的可用性...`)
                });

                try {
                    const result = await testServerAvailability(serverId);
                    const statusIcon = result.available ? "✅" : "❌";
                    const statusText = result.available ? "可用" : "不可用";
                    const pingText = result.ping ? ` (延迟: ${result.ping}ms)` : "";
                    const errorText = result.error ? `</br><b>错误:</b> <code>${result.error}</code>` : "";

                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>${statusIcon} <b>服务器 ${serverId}:</b> <code>${statusText}</code>${pingText}${errorText}`)
                    });
                } catch (error) {
                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>❌ <code>测试失败: ${htmlEscape(String(error))}</code>`)
                    });
                }
            } else if (command === "best") {
                await message.edit({
                    text: html("🎯 正在查找推荐服务器...")
                });

                try {
                    const servers = await getAllServers();
                    if (servers.length > 0) {
                        const topServers = servers.slice(0, 3);
                        const serverList = topServers
                            .map((server, index) =>
                                `${index + 1}. <code>${server.id}</code> - <code>${htmlEscape(server.name)}</code> - <code>${htmlEscape(server.location)}</code>`
                            )
                            .join("</br>");

                        await message.edit({
                            text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>🎯 <b>推荐服务器 (按距离排序):</b></br></br>${serverList}</br></br>💡 使用 <code>${commandName} set [ID]</code> 设为默认服务器</br>💡 使用 <code>${commandName} [ID]</code> 直接测试`)
                        });
                    } else {
                        await message.edit({
                            text: html("<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>❌ <code>无法获取服务器列表</code></br></br>💡 <b>建议:</b></br>• 检查网络连接</br>• 稍后重试")
                        });
                    }
                } catch (error) {
                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>❌ <code>获取服务器列表失败: ${htmlEscape(String(error))}</code>`)
                    });
                }
            } else if (command === "diagnose") {
                await message.edit({
                    text: html("🔍 正在诊断speedtest可执行文件...")
                });

                try {
                    const diagnosis = await diagnoseSpeedtestExecutable();
                    const statusIcon = diagnosis.canRun ? "✅" : "❌";
                    const statusText = diagnosis.canRun ? "正常" : "异常";
                    const errorText = diagnosis.error ? `</br><b>问题:</b> <code>${diagnosis.error}</code>` : "";
                    const fixText = diagnosis.needsReinstall ? `</br></br>💡 <b>建议:</b> 使用 <code>${commandName} fix</code> 自动修复` : "";

                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>${statusIcon} <b>可执行文件状态:</b> <code>${statusText}</code>${errorText}</br><b>平台:</b> <code>${process.platform}</code></br><b>架构:</b> <code>${process.arch}</code></br><b>路径:</b> <code>${SPEEDTEST_PATH}</code></br><b>存在:</b> <code>${fs.existsSync(SPEEDTEST_PATH) ? "是" : "否"}</code>${fixText}`)
                    });
                } catch (error) {
                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>❌ <code>诊断失败: ${htmlEscape(String(error))}</code>`)
                    });
                }
            } else if (command === "fix") {
                await message.edit({
                    text: html("🔧 正在自动修复speedtest安装问题...")
                });

                try {
                    await autoFixSpeedtest();
                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>✅ <code>自动修复完成</code></br><b>平台:</b> <code>${process.platform}</code></br><b>路径:</b> <code>${SPEEDTEST_PATH}</code></br></br>💡 现在可以正常使用speedtest功能了`)
                    });
                } catch (error) {
                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>❌ <code>自动修复失败: ${htmlEscape(String(error))}</code></br></br>💡 <b>建议:</b></br>• 检查网络连接</br>• 确认有足够的磁盘空间</br>• 检查文件权限</br>• 尝试手动执行 <code>${commandName} update</code>`)
                    });
                }
            } else if (command === "update") {
                await message.edit({
                    text: html("🔄 正在更新 Speedtest CLI...")
                });

                try {
                    const filesToClean = [
                        SPEEDTEST_PATH,
                        path.join(ASSETS_DIR, "speedtest.exe"),
                        path.join(ASSETS_DIR, "speedtest")
                    ];

                    for (const file of filesToClean) {
                        if (fs.existsSync(file)) {
                            try {
                                fs.unlinkSync(file);
                                console.log(`Cleaned up existing file: ${file}`);
                            } catch (cleanupError) {
                                console.warn(`Failed to cleanup file: ${file}`, cleanupError);
                            }
                        }
                    }

                    const tempFiles = fs.readdirSync(ASSETS_DIR).filter(file =>
                        file.endsWith(".tgz") || file.endsWith(".zip")
                    );
                    for (const tempFile of tempFiles) {
                        try {
                            fs.unlinkSync(path.join(ASSETS_DIR, tempFile));
                            console.log(`Cleaned up temp file: ${tempFile}`);
                        } catch (cleanupError) {
                            console.warn(`Failed to cleanup temp file: ${tempFile}`, cleanupError);
                        }
                    }

                    await downloadCli();

                    if (fs.existsSync(SPEEDTEST_PATH)) {
                        await message.edit({
                            text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br><code>Speedtest® CLI 已更新到最新版本</code></br><code>平台: ${process.platform}</code></br><code>路径: ${SPEEDTEST_PATH}</code>`)
                        });
                    } else {
                        throw new Error(`安装验证失败，可执行文件不存在: ${SPEEDTEST_PATH}`);
                    }
                } catch (error) {
                    console.error("Update failed:", error);
                    await message.edit({
                        text: html(`<blockquote><b>⚡️SPEEDTEST by OOKLA</b></blockquote></br>❌ <code>更新失败: ${htmlEscape(
                            String(error)
                        )}</code></br></br>💡 <b>建议:</b></br>• 检查网络连接</br>• 确认有足够的磁盘空间</br>• 检查文件权限`)
                    });
                }
            } else if (command === "" || !Number.isNaN(parseInt(command))) {
                await message.edit({text: html("🔍 正在检查网络连接...")});

                const networkStatus = await checkNetworkConnectivity();
                if (!networkStatus.connected) {
                    await message.edit({
                        text: html(`❌ <b>网络连接异常，无法进行速度测试</b></br></br><b>检测结果:</b> <code>${networkStatus.message}</code></br></br>💡 <b>建议:</b></br>• 检查网络连接是否正常</br>• 尝试更换网络环境或DNS服务器</br>• 确认防火墙允许网络测试</br>• 使用 <code>${commandName} check</code> 重新检查连接`)
                    });
                    return;
                }

                await message.edit({text: html("⚡️ 网络连接正常，正在进行速度测试...")});

                const serverId =
                    command && !Number.isNaN(parseInt(command))
                        ? parseInt(command)
                        : getDefaultServer();

                try {
                    const result = await runSpeedtest(serverId || undefined, 0, useSystem);
                    const {asInfo, ccName, ccCode, ccFlag} = await getIpApi(
                        result.interface.externalIp
                    );
                    const {rxBytes, txBytes, mtu} = await getInterfaceTraffic(
                        result.interface.name
                    );

                    const uploadRate = (result as any).uploadFailed
                        ? "FAILED"
                        : await unitConvert(result.upload.bandwidth);
                    const uploadData = (result as any).uploadFailed
                        ? "FAILED"
                        : await unitConvert(result.upload.bytes, true);

                    const description = [
                        `<blockquote><b>⚡️SPEEDTEST by OOKLA @${ccCode}${ccFlag}</b></blockquote>`,
                        `<code>Name</code>  <code>${htmlEscape(result.isp)}</code> ${asInfo}`,
                        `<code>Node</code>  <code>${result.server.id
                        }</code> - <code>${htmlEscape(
                            result.server.name
                        )}</code> - <code>${htmlEscape(result.server.location)}</code>`,
                        `<code>Conn</code>  <code>${result.interface.externalIp.includes(":") ? "IPv6" : "IPv4"
                        }</code> - <code>${htmlEscape(
                            result.interface.name
                        )}</code> - <code>MTU</code> <code>${mtu}</code>`,
                        `<code>Ping</code>  <code>⇔${result.ping.latency}ms</code> <code>±${result.ping.jitter}ms</code>`,
                        `<code>Rate</code>  <code>↓${await unitConvert(
                            result.download.bandwidth
                        )}</code> <code>↑${uploadRate}</code>`,
                        `<code>Data</code>  <code>↓${await unitConvert(
                            result.download.bytes,
                            true
                        )}</code> <code>↑${uploadData}</code>`,
                        `<code>Stat</code>  <code>RX ${await unitConvert(
                            rxBytes,
                            true
                        )}</code> <code>TX ${await unitConvert(txBytes, true)}</code>`,
                        `<code>Time</code>  <code>${result.timestamp
                            .replace("T", " ")
                            .split(".")[0]
                            .replace("Z", "")}</code>`
                    ];

                    if ((result as any).uploadFailed) {
                        description.push("<code>Note</code>  <code>上传测试失败，可能是网络环境限制</code>");
                    }

                    const finalDescription = description.join("</br>");

                    const order = getMessageOrder();
                    const trySend = async (type: MessageType): Promise<boolean> => {
                        try {
                            if (type === "txt") {
                                await message.edit({text: html(finalDescription)});
                                return true;
                            }

                            if (!result.result?.url) return false;
                            const imagePath = await saveSpeedtestImage(result.result.url);
                            if (!imagePath || !fs.existsSync(imagePath)) return false;

                            if (type === "photo") {
                                await this.context.client.sendMedia(
                                    message.chat,
                                    InputMedia.photo(toFileInput(imagePath), {caption: html(finalDescription)})
                                );
                                try {
                                    await message.delete();
                                } catch {
                                }
                                try {
                                    fs.unlinkSync(imagePath);
                                } catch {
                                }
                                return true;
                            }
                            if (type === "file") {
                                await this.context.client.sendMedia(
                                    message.chat,
                                    InputMedia.document(toFileInput(imagePath), {caption: html(finalDescription)})
                                );
                                try {
                                    await message.delete();
                                } catch {
                                }
                                try {
                                    fs.unlinkSync(imagePath);
                                } catch {
                                }
                                return true;
                            }
                            if (type === "sticker") {
                                const stickerPath = await convertImageToStickerWebp(imagePath);
                                if (stickerPath && fs.existsSync(stickerPath)) {
                                    await this.context.client.sendMedia(
                                        message.chat,
                                        InputMedia.sticker(toFileInput(stickerPath), {alt: "speedtest"})
                                    );
                                    try {
                                        fs.unlinkSync(imagePath);
                                    } catch {
                                    }
                                    try {
                                        fs.unlinkSync(stickerPath);
                                    } catch {
                                    }
                                    await message.edit({text: html(finalDescription)});
                                    return true;
                                }
                            }
                        } catch (e) {
                            console.error(`Send as ${type} failed:`, e);
                        }
                        return false;
                    };

                    for (const t of order) {
                        const ok = await trySend(t);
                        if (ok) return;
                    }

                    await message.edit({text: html(finalDescription)});
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    const isKnownNetworkError = errorMsg.includes("超时") ||
                        errorMsg.includes("连接") ||
                        errorMsg.includes("socket") ||
                        errorMsg.includes("Timeout") ||
                        errorMsg.includes("Cannot read");

                    let helpText = "";
                    if (isKnownNetworkError) {
                        helpText = `</br></br>💡 <b>解决建议:</b></br>• 检查网络连接是否正常</br>• 尝试使用 <code>${commandName} list</code> 查看可用服务器</br>• 使用 <code>${commandName} set [ID]</code> 选择其他服务器</br>• 如问题持续，请联系网络管理员`;
                    }

                    await message.edit({
                        text: html(`❌ <b>速度测试失败</b></br></br><code>${htmlEscape(errorMsg)}</code>${helpText}`)
                    });
                }
            } else {
                await message.edit({
                    text: html(`❌ <b>参数错误</b></br></br>${helpText}`)
                });
            }
        } catch (error: any) {
            console.error("Speedtest plugin error:", error);
            const errorMessage = error.message || String(error);
            const displayError =
                errorMessage.length > 100
                    ? errorMessage.substring(0, 100) + "..."
                    : errorMessage;
            await message.edit({
                text: html(`❌ <b>插件错误</b></br></br><b>错误信息:</b> <code>${htmlEscape(
                    displayError
                )}</code></br></br>💡 <b>建议:</b> 请检查网络连接或联系管理员`)
            });
        }
    }

    protected async handleMessage(_message: MessageContext): Promise<void> {
    }
}

export const Plugin = SpeedtestPlugin;
