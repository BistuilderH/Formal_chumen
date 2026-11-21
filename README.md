# 出门见

同城多人约见路线规划项目。前端使用 Vite，后端使用 Node.js，提供百度地图地点与路线查询、DeepSeek 偏好解析、临时房间、投票和计划版本管理。

## 本地运行

需要 Node.js 22.12 或更新版本。首次运行先安装依赖并复制配置模板：

```powershell
npm install
Copy-Item .env.example .env
```

在 `.env` 中填写所需接口配置，再分别启动后端与前端：

```powershell
npm run server
npm run dev
```

浏览器访问 `http://localhost:5173/`。如需确认配置项含义、接口密钥申请位置和部署方式，请阅读 [BACKEND_SETUP.md](BACKEND_SETUP.md)。

## API 配置入口

- 浏览器端百度地图 AK：`.env` 的 `VITE_BAIDU_MAP_AK`，由 `src/map.js` 读取。它会进入浏览器，需在百度控制台限制允许的 Referer 域名。
- 服务端百度地图 AK：`.env` 的 `BAIDU_MAP_SERVER_AK`，由 `server/config.js` 读取并供 `server/map-provider.js` 调用。
- DeepSeek API Key：`.env` 的 `DEEPSEEK_API_KEY`，由 `server/config.js` 读取并供 `server/llm-provider.js` 调用。
- 前端后端地址：`.env` 的 `VITE_API_BASE_URL`，由 `src/main.js` 读取。本地可留空并使用 Vite 代理，部署时填写公开 HTTPS API 地址或配置同域 `/api` 反向代理。

真实密钥只填写在本地 `.env` 或部署平台的环境变量中。`.env` 已加入 Git 忽略规则，仓库中的 `.env.example` 只提供空值模板。切勿把服务端密钥改成 `VITE_` 开头。

## 开发检查

```powershell
npm test
npm run build
```
