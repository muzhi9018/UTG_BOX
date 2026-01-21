import {MessageContext} from "@mtcute/dispatcher";
import {html} from "@mtcute/html-parser";
import {BasePlugin, PluginScope} from "../../core/base-plugin.js";
import {exec} from "node:child_process";
import {promisify} from "node:util";
import {createConnection} from "node:net";
import http from "node:http";
import https from "node:https";
import * as dns from "node:dns";
import {performance} from "node:perf_hooks";

const execAsync = promisify(exec);

// 数据中心IP地址映射
const DCs = {
    1: "149.154.175.53", // DC1 Miami
    2: "149.154.167.51", // DC2 Amsterdam
    3: "149.154.175.100", // DC3 Miami
    4: "149.154.167.91", // DC4 Amsterdam
    5: "91.108.56.130" // DC5 Singapore
};

function htmlEscape(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

async function tcpPing(
    hostname: string,
    port: number = 80,
    timeout: number = 3000
): Promise<number> {
    return new Promise((resolve) => {
        const start = performance.now();
        const socket = createConnection(port, hostname);

        socket.setTimeout(timeout);

        socket.on("connect", () => {
            const end = performance.now();
            socket.end();
            resolve(Math.round(end - start));
        });

        function handleError() {
            socket.destroy();
            resolve(-1);
        }

        socket.on("timeout", handleError);
        socket.on("error", handleError);
    });
}

async function httpPing(hostname: string, useHttps: boolean = false): Promise<number> {
    return new Promise((resolve) => {
        const start = performance.now();
        const protocol = useHttps ? https : http;
        const port = useHttps ? 443 : 80;

        const req = protocol.request(
            {
                hostname,
                port,
                path: "/",
                method: "HEAD",
                timeout: 5000,
                headers: {
                    "User-Agent": "UTGBOX-Ping/1.0"
                }
            },
            () => {
                const end = performance.now();
                req.destroy();
                resolve(Math.round(end - start));
            }
        );

        req.on("error", () => {
            resolve(-1);
        });

        req.on("timeout", () => {
            req.destroy();
            resolve(-1);
        });

        req.end();
    });
}

async function dnsLookupTime(
    hostname: string
): Promise<{ time: number; ip: string }> {
    return new Promise((resolve) => {
        const start = performance.now();
        dns.lookup(hostname, (err, address) => {
            const end = performance.now();
            if (err) {
                resolve({time: -1, ip: ""});
            } else {
                resolve({time: Math.round(end - start), ip: address});
            }
        });
    });
}

function parsePingOutput(output: string): { avg: number; loss: number } {
    let avgTime = -1;
    let packetLoss = 100;

    const avgMatch =
        output.match(/(?:round-trip|rtt)[^=]*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/) ??
        output.match(/Average = (\d+)(?:ms)?/i);
    const lossMatch = output.match(/(\d+(?:\.\d+)?)% packet loss/i) ??
        output.match(/\((\d+)% loss\)/i);

    if (avgMatch) {
        if (avgMatch[2]) {
            avgTime = Math.round(parseFloat(avgMatch[2]));
        } else if (avgMatch[1]) {
            avgTime = Math.round(parseFloat(avgMatch[1]));
        }
    }
    if (lossMatch) {
        packetLoss = Math.round(parseFloat(lossMatch[1]));
    }

    return {avg: avgTime, loss: packetLoss};
}

function buildPingCommand(target: string, count: number): string {
    const platform = process.platform;
    if (platform === "win32") {
        return `ping -n ${count} -w 5000 ${target}`;
    }
    if (platform === "darwin") {
        return `ping -c ${count} -W 5000 ${target}`;
    }
    return `ping -c ${count} -W 5 ${target}`;
}

async function systemPing(
    target: string,
    count: number = 3
): Promise<{ avg: number; loss: number; output: string }> {
    try {
        const pingCmd = buildPingCommand(target, count);
        const {stdout} = await execAsync(pingCmd, {timeout: 10000});
        const {avg, loss} = parsePingOutput(stdout);
        return {
            avg,
            loss,
            output: stdout
        };
    } catch (error: any) {
        if (error?.code === "ETIMEDOUT") {
            throw new Error("执行超时");
        }
        if (error?.killed) {
            throw new Error("命令被终止");
        }
        throw new Error(`Ping失败: ${error?.message ?? "未知错误"}`);
    }
}

async function pingDataCenters(): Promise<string[]> {
    const results: string[] = [];

    for (let dc = 1; dc <= 5; dc += 1) {
        const ip = DCs[dc as keyof typeof DCs];
        const dcLocation =
            dc === 1 || dc === 3
                ? "Miami"
                : dc === 2 || dc === 4
                    ? "Amsterdam"
                    : "Singapore";

        try {
            const pingResult = await systemPing(ip, 1);
            const pingTime =
                pingResult.avg >= 0 ? String(pingResult.avg) : "0";
            results.push(
                `🌐 <b>DC${dc} (${dcLocation}):</b> <code>${pingTime}ms</code>`
            );
        } catch {
            results.push(`🌐 <b>DC${dc} (${dcLocation}):</b> <code>超时</code>`);
        }
    }

    return results;
}

function parseTarget(input: string): {
    type: "ip" | "domain" | "dc";
    value: string;
} {
    if (/^dc[1-5]$/i.test(input)) {
        const dcNum = parseInt(input.slice(2), 10) as keyof typeof DCs;
        return {type: "dc", value: DCs[dcNum]};
    }

    const ipRegex =
        /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (ipRegex.test(input)) {
        return {type: "ip", value: input};
    }

    return {type: "domain", value: input};
}

export default class PingPlugin extends BasePlugin {
    command = "ping";
    name = "Ping";
    description =
        "网络延迟测试工具：.ping / .ping <IP/域名> / .ping dc1-dc5 / .ping all";
    scope = "new_message" as PluginScope;

    protected async handlerCommand(message: MessageContext, command: string, args: string[]): Promise<void> {
        const target = command?.toLowerCase();

        try {
            if (!target) {
                const apiStart = Date.now();
                await this.context.client.getMe();
                const apiEnd = Date.now();
                const apiLatency = apiEnd - apiStart;

                const msgStart = Date.now();
                await message.edit({text: "🏓 Pong!"});
                const msgEnd = Date.now();
                const msgLatency = msgEnd - msgStart;

                await message.edit({
                    text: html(`🏓 <b>Pong!</b>

📡 <b>API延迟:</b> <code>${apiLatency}ms</code>
✏️ <b>消息延迟:</b> <code>${msgLatency}ms</code>

⏰ <i>${new Date().toLocaleString("zh-CN")}</i>`)
                });
                return;
            }

            if (target === "all" || target === "dc") {
                await message.edit({text: "🔍 正在测试所有数据中心延迟..."});
                const dcResults = await pingDataCenters();
                await message.edit({
                    text: html(`🌐 <b>Telegram数据中心延迟</b>

${dcResults.join("\n")}

⏰ <i>${new Date().toLocaleString("zh-CN")}</i>`)
                });
                return;
            }

            if (target === "help" || target === "h") {
                await message.edit({
                    text: html(`🏓 <b>Ping工具使用说明</b>

<b>基础用法:</b>
• <code>.ping</code> - Telegram延迟测试
• <code>.ping all</code> - 所有数据中心延迟

<b>网络测试:</b>
• <code>.ping 8.8.8.8</code> - IP地址ping
• <code>.ping google.com</code> - 域名ping
• <code>.ping dc1</code> - 指定数据中心

<b>数据中心:</b>
• DC1-DC5: 分别对应不同地区服务器

💡 <i>支持ICMP和TCP连接测试</i>`)
                });
                return;
            }

            await message.edit({
                text: html(`🔍 正在测试 <code>${htmlEscape(target)}</code>...`)
            });

            const parsed = parseTarget(target);
            const testTarget = parsed.value;
            const results: string[] = [];

            const dnsResult = await dnsLookupTime(testTarget);
            if (dnsResult.time > 0) {
                results.push(
                    `🔍 <b>DNS解析:</b> <code>${dnsResult.time}ms</code> → <code>${dnsResult.ip}</code>`
                );
            }

            try {
                const pingResult = await systemPing(testTarget, 3);
                if (pingResult.avg >= 0 && pingResult.loss < 100) {
                    const avgText = pingResult.avg === 0 ? "<1" : pingResult.avg.toString();
                    results.push(
                        `🏓 <b>ICMP Ping:</b> <code>${avgText}ms</code> (丢包: ${pingResult.loss}%)`
                    );
                } else {
                    const httpResult = await httpPing(testTarget, false);
                    if (httpResult > 0) {
                        results.push(`🏓 <b>HTTP Ping:</b> <code>${httpResult}ms</code> (ICMP不可用)`);
                    } else {
                        results.push("🏓 <b>ICMP Ping:</b> <code>不可用</code>");
                    }
                }
            } catch (error) {
                const httpResult = await httpPing(testTarget, false);
                if (httpResult > 0) {
                    results.push(`🏓 <b>HTTP Ping:</b> <code>${httpResult}ms</code> (ICMP受限)`);
                } else {
                    results.push("🏓 <b>网络测试:</b> <code>ICMP/HTTP均不可用</code>");
                }
            }

            const tcp80 = await tcpPing(testTarget, 80, 5000);
            const tcp443 = await tcpPing(testTarget, 443, 5000);

            if (tcp80 > 0) {
                results.push(`🌐 <b>TCP连接 (80):</b> <code>${tcp80}ms</code>`);
            }
            if (tcp443 > 0) {
                results.push(`🔒 <b>TCP连接 (443):</b> <code>${tcp443}ms</code>`);
            }

            const httpsResult = await httpPing(testTarget, true);
            if (httpsResult > 0) {
                results.push(`📡 <b>HTTPS请求:</b> <code>${httpsResult}ms</code>`);
            }

            if (results.length === 0) {
                results.push("❌ 所有测试均失败，目标可能不可达");
            }

            const targetType =
                parsed.type === "dc"
                    ? "数据中心"
                    : parsed.type === "ip"
                        ? "IP地址"
                        : "域名";

            let displayText = `🎯 <b>${targetType}延迟测试</b>\n`;
            if (target === testTarget) {
                displayText += `<code>${htmlEscape(target)}</code>\n\n`;
            } else {
                displayText += `<code>${htmlEscape(target)}</code> → <code>${htmlEscape(testTarget)}</code>\n\n`;
            }

            await message.edit({
                text: html(`${displayText}${results.join("\n")}

⏰ <i>${new Date().toLocaleString("zh-CN")}</i>`)
            });
        } catch (error: any) {
            await message.edit({
                text: html(`❌ 测试失败: ${htmlEscape(error?.message ?? "未知错误")}`)
            });
        }
    }

    protected async handleMessage(_message: MessageContext): Promise<void> {
    }
}
