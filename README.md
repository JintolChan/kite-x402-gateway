# Kite Web Check

面向 AI Agent 的按次付费 Web 验收服务。提交公开网址，获得桌面/手机检查、截图及结构化报告，通过 x402 在 Kite 上支付。


## 无钱包演示

需要 Node.js 22+（本地验证使用 24）及 npm。以下命令在本项目目录运行，适用于 macOS/Linux。

```sh
npm ci
npm run browser:install
npm run demo
```

演示仅访问受控的本地网页，不付款、不访问第三方网站。生成 artifacts/demo/report.html、report.json、desktop.jpg 和 mobile.jpg。网页故意包含图片失效、手机溢出及脚本错误，便于复核。

Linux 如果缺少系统依赖，按 Playwright 文档运行 `npx playwright install-deps chromium`。Linux 运行环境必须支持 Chromium sandbox；项目不会在失败时降级为关闭 sandbox。

## 启动支付 API

复制 .env.example 为 .env，填写自己的 PAY_TO 收款地址。只需要公开地址，不需要私钥。默认测试网 pieUSD，0.01 美元/次。

```sh
cp .env.example .env
# 编辑 .env 的 PAY_TO
npm run build
npm start
```

GET / 返回服务说明和示例；GET /healthz 是存活检查，不代表 facilitator 和浏览器已就绪。

```sh
curl -i http://127.0.0.1:8080/v1/audits -H 'Content-Type: application/json' -d '{"url":"https://example.com","viewports":["desktop","mobile"],"checks":{"text":["Example Domain"],"selectors":["h1"]}}'
```

未付款的有效请求返回 HTTP 402 和 PAYMENT-REQUIRED。需要 facilitator 可用且目标地址通过公网 DNS 校验。由支持 x402 的客户端完成授权，携带 PAYMENT-SIGNATURE 重发。测试代码中的合成签名不适用于真实付款。

成功响应包含 report、html 和 PAYMENT-RESPONSE 响应头。截图位于 report.viewports[].screenshot.base64。HTML 内嵌截图，保存后可以独立打开；API 不提供公开下载链接，也不存储报告。

## 检查与计费

| 检查 | 口径 |
| --- | --- |
| HTTP 状态 | 最终页面是否返回 2xx/3xx |
| 布局 | 内容是否超出布局视口宽度 |
| 图片 | 是否损坏；仍在加载的图片标记无法确定 |
| 控制台 | console.error 和未处理脚本错误 |
| 网络 | 失败请求、HTTP 错误和策略拦截 |
| 文字 | 第一个匹配文本是否可见 |
| CSS 选择器 | 匹配数量及第一个匹配元素是否可见 |

**发现缺陷仍然收费**，因为报告已经成功交付。无法导航、浏览器崩溃或超时导致报告未完成时返回 502，不请求结算。目标网页返回 HTTP 404/500 可生成缺陷报告，但错误页面的其他检查标记为无法确定。

执行顺序：verify → browser execution → report → settle → response。官方中间件缓冲成功响应，结算失败时不交付报告。结算超时可能意味着链上结果尚未确认；不要自动重付，也不能把所有非 2xx 都理解为一定没扣款。第一版没有持久存储，付款后连接中断可能无法恢复报告，公开运营前应明确接受或补齐这一限制。

## 范围和限制

- 单任务并发，一个网页、最多两个视口；默认 30 秒，硬截止额外预留 2 秒清理。
- 最多 10 个文字断言和 10 个选择器；请求体 8KB、URL 2048 字符。
- 仅 HTTP(S) 80/443 端口，拒绝 URL 账户密码、私网、保留地址和混合公私网 DNS 结果。
- 浏览器出口在连接时重新解析并固定 IP，覆盖跳转和子资源；限制请求数及传输量。
- 禁用 WebSocket、Service Worker、非 GET/HEAD 请求及弹窗，可能影响依赖这些能力的页面。
- 不登录、不提交表单、不执行用户脚本；只截当前视口，不扫描整站。
- 固定观察窗口可能错过晚加载内容和视口外懒加载图片；手机模拟不替代真实手机或 Safari。
- 这是页面验收，不是完整功能测试、安全扫描或无障碍认证。
- 日志不保存付款签名或完整请求正文；截图和控制台仍可能含网页数据，调用者自行保管。

## 测试

```sh
npm run check
npm run test:browser
```

支付测试使用真实官方 x402 中间件和模拟 facilitator，覆盖验证、执行、结算顺序与失败分支，不广播交易。浏览器测试使用真实 Chromium 与本地固定网页，覆盖健康页、故意缺陷、错误页及私网资源拦截。

可选公网烟雾测试：`PLAYWRIGHT_BROWSERS_PATH=./.cache/ms-playwright node --import tsx scripts/smoke-public.ts`，通过真实子进程访问 example.com，不付款。当前本机 DNS 将该域名映射到 198.18.x.x 保留网段，因此此项被网络策略正确拒绝，尚未完成公网成功验收。请在正常公网 DNS 环境下运行，不要为兼容本机代理而放开私网访问限制。

## 部署

提供 Dockerfile，以非 root 用户运行，浏览器镜像与 Playwright 版本一致。当前机器没有运行中的 Docker daemon，尚未验证镜像构建和 Linux 容器运行。

```sh
docker build -t kite-web-check .
```

配置 PAY_TO、KITE_NETWORK、PRICE_USD。容器的 PLAYWRIGHT_BROWSERS_PATH 保持 /ms-playwright，不要用本地 .env 的相对路径覆盖。

公网部署前：

1. 按 [Playwright Docker 文档](https://playwright.dev/docs/docker) 配置支持 Chromium sandbox 的主机、seccomp 和 user namespaces。不要用 privileged 或关闭 sandbox 绕过失败。
2. 限制 CPU、内存、进程数，配置主机级出口策略和 HTTPS 入口限流；代理响应超时至少 75 秒。子进程和浏览器 context 不是完整租户隔离。
3. 单副本运行；扩容前增加统一队列、并发/重放控制与结果恢复。
4. 用本人 Kite Passport 钱包完成真实测试网付款，保留 2xx、响应头、报告和交易哈希，再按活动要求决定主网验证。

## 活动提交

npm run validate 校验官方 Schema，允许 draft 占位值；npm run validate -- --release 拒绝未完成的发布信息。Schema 通过不代表部署或真实支付已验收。

提交前填写 service.yaml 的维护者、钱包、自己部署的浏览器服务说明地址及 base_url；同步价格、网络和状态，使用已验证成功的请求示例。上游是我们自建的浏览器执行引擎，无需第三方付费 API。

模拟测试和演示不能当作真实付费证据。不要提交 .env、密钥、完整可重用付款签名或未脱敏报告。活动每周 Commit 和官方服务目录 PR 是两个流程，按活动方要求执行。

## 来源

网络参数和清单 Schema 来自 [Kite 官方仓库](https://github.com/gokite-ai/kite-x402-services) 固定版本，见 NOTICE。Apache-2.0 许可，独立社区项目。
