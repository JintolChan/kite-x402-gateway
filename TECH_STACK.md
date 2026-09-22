# 技术栈与实现

| 模块 | 选型 |
| --- | --- |
| 语言/运行环境 | TypeScript 严格模式，Node.js 22+；本地使用 24 |
| API | Express 5、Zod、Pino |
| 支付 | @x402/core、@x402/evm、@x402/express 2.25.0 |
| 浏览器 | Playwright 1.63.0 + Chromium |
| 执行管理 | 每任务一个子进程，默认 30 秒，单任务并发 |
| 出口策略 | HTTP/CONNECT 代理，DNS 检查后固定连接 IP，ipaddr.js |
| 产物 | JSON、JPEG 截图、自包含 HTML |
| 验证 | Vitest、Supertest、真实 Chromium、Ajv Schema 校验 |
| 部署 | Dockerfile、GitHub Actions、锁定依赖 |

## 链路

输入校验 → 公网地址预检 → 官方 x402 验证 → 浏览器子进程 → 生成报告 → 官方 x402 结算 → 返回结果。

src/app.ts 管理路由；src/payment/ 管理支付；src/audit/ 管理执行；src/security/ 管理出口策略；src/report.ts 生成安全转义的 HTML。

首版不使用数据库、Redis 或付费模型。静态检查使用 TypeScript，暂未引入 ESLint。单进程并发标记不支持多副本。

浏览器子进程便于清理，但不是完整的租户隔离。Linux 开启 Chromium sandbox，公网运行还需要主机级出口策略、容器资源限制和入口限流。详见 README。

## 官方来源

核对了 [Kite 官方仓库](https://github.com/gokite-ai/kite-x402-services) 的 TypeScript 模板源码、CONTRIBUTING.md 和 Schema，固定版本为 893a27509648b660bbba626b0da59619a94f04ab。

kite.ts 与 Schema 原样保留，来源及开源许可见 NOTICE。
