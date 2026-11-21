# 部署交付说明

项目已经整理为前端和 Node 后端两个进程。可以把仓库交给其他 AI 或部署平台处理；当前不需要数据库，但房间数据只保存在后端内存中，后端重启会清空。

## 构建检查

```powershell
npm ci
npm run check
```

`npm run check` 会运行全部测试并构建前端。前端构建目录是 `dist/`。

## 前端部署

前端可以部署到 EdgeOne 静态站点或其他静态托管：

- 构建命令：`npm run build`
- 输出目录：`dist`
- Node 版本：22.12 或更高
- `VITE_BAIDU_MAP_AK`：百度浏览器端 AK
- `VITE_API_BASE_URL`：后端公开 HTTPS 地址；如果后端和前端同域反代，可留空，前端请求 `/api`

只有 `VITE_` 开头的变量会进入浏览器构建。浏览器端 AK 本来就会出现在地图请求中，必须在百度控制台限制 Referer；正式域名和本地 `http://localhost:5173` 要分别配置。

本地和生产不需要两套代码。你可以自己切换：

```text
本地：VITE_API_BASE_URL=http://localhost:8787
生产：VITE_API_BASE_URL=https://你的后端域名
同域反代：VITE_API_BASE_URL 留空
```

改完 `VITE_*` 后要重新运行 `npm run build`，因为它们会在构建时写入 `dist/`。只改服务器上的变量不会改变已经生成的前端文件；后端变量则在重启 `npm start` 后生效。

## 后端部署

后端需要部署到能够运行 Node 常驻进程的平台，不能只把 `dist` 上传到静态站点：

- 启动命令：`npm start`
- 健康检查：`GET /api/health`
- 监听端口：使用平台注入的 `PORT`
- 云平台通常需要 `HOST=0.0.0.0`
- `WEB_ORIGIN`：前端正式地址；多个地址用逗号分隔

后端变量：

```env
HOST=0.0.0.0
PORT=平台提供的端口
WEB_ORIGIN=https://你的前端域名
BAIDU_MAP_SERVER_AK=百度服务端AK
DEEPSEEK_API_KEY=DeepSeek密钥
DEEPSEEK_MODEL=deepseek-flash
```

`BAIDU_MAP_SERVER_AK` 和 `DEEPSEEK_API_KEY` 只能放后端。`BAIDU_MAP_AUTH_TOKEN` 当前保留为配置位，但本版路线生成使用百度 Web 服务 API AK，不依赖 Agent Token。

## 前后端连通方式

推荐先使用两个公开 HTTPS 地址：

```text
浏览器 → EdgeOne 前端 → VITE_API_BASE_URL → Node 后端 → 百度/DeepSeek
```

部署后按顺序检查：

```text
1. 打开前端首页
2. 打开 https://后端域名/api/health
3. 检查 providers.baiduWebApi.configured 和 providers.llm.configured
4. 创建房间并等待真实候选路线
5. 测试成员邀请、投票、留言
```

如果前端报跨域错误，检查后端 `WEB_ORIGIN` 是否精确包含前端协议、域名和端口，不要写路径或末尾 `/`。如果生产前端仍请求 `localhost`，说明 `VITE_API_BASE_URL` 没有在重新构建前端时注入。

## 当前限制

- 数据存储为内存 `Map`；重启丢失，多实例不共享。暂不接数据库时只适合个人测试或短时演示。
- 地点和步行/骑行/公交路线来自百度真实接口；未知的预算、营业时间、完整活动日程和指定日期末班车不会被伪装成已验证。
- 20 秒目标目前是路线查询阶段的优化目标，实际耗时受百度接口、候选数量和服务器网络影响。
- `scripts/smoke-live.mjs` 会真实消耗百度和 DeepSeek 配额，仅在需要联调时运行。
- Agent Token 没有进入前端，也不是本版网页路线生成的必需依赖。
