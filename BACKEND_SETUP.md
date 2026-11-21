# 真实接口联调说明

当前已经接入百度 Web 服务的地点检索、步行/骑行/公交路线，以及 DeepSeek 偏好解析。网页调用本地 Node 后端，不再展示假商家或模拟耗时。百度 Agent Token 已配置但本次没有使用；无需数据库即可联调。

## 直接运行

需要 Node.js 22.12+（本机 24）。在两个终端分别运行：

```powershell
npm run server
npm run dev
```

打开 http://localhost:5173/ 。后端健康检查为 http://127.0.0.1:8787/api/health 。创建房间后自动启动查询，可以先预览已返回的候选，本轮完成后投票。选择或预览路线不会自动投票。刷新后成员凭证保留在当前浏览器；后端重启后房间会消失。

## 配置实际放在哪里

首次使用时将 `.env.example` 复制为项目根目录 `.env`，再填写所需配置。`.env` 已被 Git 忽略，不会提交到仓库。若本机已有 `.env`，继续保留它，不要用模板覆盖。后端自动读取项目根目录 `.env`，部署平台的环境变量优先。

| 变量 | 用途 | 代码位置 |
|---|---|---|
| VITE_BAIDU_MAP_AK | 百度浏览器端 AK，配置允许访问网页的 Referer 白名单 | src/map.js |
| VITE_API_BASE_URL | 本地可填 http://localhost:8787；留空时前端请求同域 /api，本地由 Vite 转发 | src/main.js、vite.config.js |
| BAIDU_MAP_SERVER_AK | 百度服务端 AK，只用于后端调用地点和路线 | server/map-provider.js |
| DEEPSEEK_API_KEY | 模型偏好解析密钥 | server/llm-provider.js |
| DEEPSEEK_MODEL | 可选，默认 deepseek-chat | server/config.js |
| WEB_ORIGIN | 允许访问后端的前端来源，可用逗号分隔，不带路径或末尾斜线 | server/index.js |
| PORT | 后端端口，默认 8787 | server/config.js |
| HOST | 本地默认 127.0.0.1，云服务器按平台要求设置监听地址 | server/config.js |
| BAIDU_MAP_AUTH_TOKEN | 暂未接入，本次使用百度 Web 服务 AK | 保留配置，不参与调用 |
| DATABASE_URL | 暂未使用，可留空 | 当前房间为内存存储 |

只有 `VITE_` 开头的两项进入前端。后端密钥不进入浏览器构建。更改 `.env` 后重启后端和 Vite；线上前端环境变量需重新构建才生效。

## 你可以自己切换本地和部署接口

不需要让代码在“本地版”和“部署版”之间来回修改。只改环境变量即可。

本地开发可以这样设置：

```env
VITE_API_BASE_URL=http://localhost:8787
WEB_ORIGIN=http://localhost:5173
HOST=127.0.0.1
PORT=8787
```

也可以把 `VITE_API_BASE_URL` 留空，让前端请求同域 `/api`，由 Vite 代理到 `8787`。改完后在两个终端重新启动：

```powershell
npm run server
npm run dev
```

部署前端时，把 `VITE_API_BASE_URL` 改成公开的后端 HTTPS 地址，或者使用同域反代并留空，然后重新执行 `npm run build`。

部署后端时，只设置服务器环境变量：

```env
HOST=0.0.0.0
PORT=平台提供的端口
WEB_ORIGIN=https://你的前端域名
```

`VITE_*` 会在构建时写入 `dist/`，所以必须在构建前设置；后端变量在服务器启动时读取。你可以直接编辑本地 `.env`，也可以在部署平台的环境变量页面填写。不要把服务端 AK 或模型密钥改名为 `VITE_*`，否则会进入浏览器。

## 本次调试和部署的区别

本次完成本地真实 API 联调，没有发布或改动 EdgeOne 线上站点。仅将 Vite 的 dist 上传 EdgeOne 不会运行 server/index.js。仍需支持常驻 Node 的后端部署，或另外实现适合 EdgeOne 云函数的后端。

线上 `VITE_API_BASE_URL` 不能填 localhost：那会指向每位访问者自己的电脑。应填公开 HTTPS 后端地址，或在 EdgeOne 配置同域 /api 转发到后端。后端 WEB_ORIGIN 填前端正式域名，百度浏览器 AK 配置该域名白名单。

目前内存房间只适合单个后端进程。重启丢失、多实例不共享是已知限制；按当前要求暂不接数据库。

## 核验边界

- 真实地点和道路来自百度，全部坐标统一为 BD-09。
- 活动间步行/骑行上限分别校验；公交接驳校验当前接口返回的步行段，尚未组合骑行接驳。
- 公交通勤为查询时估算，不保证指定日期及 22:00 返程的末班车。
- 预算、营业状态和完整日程不会标记为已验证；未知价格不填零。
- 首版从出发地中心附近搜索有限候选，再比较真实往返耗时；还不是全上海最优解搜索。
- 上海交大有多个校区，当前示例明确使用徐汇校区，请按实际位置修改。
- 支持必去店铺检索并保留，需在结果中核对分店地址。
- DeepSeek 仅抽取活动词和偏好摘要，不提供店铺事实，不自动替换指定店铺。氛围等主观偏好暂不能可靠筛选。
- 成员凭证保存在当前浏览器，邀请链接不包含局主凭证；清除浏览器数据或换设备后需重新加入。
- 回溯会按历史输入重新查询真实服务并产生新版本，不保证商家结果逐项不变。
- 页面地图使用 JSAPI 4.0，白模展示仍需浏览器端实测和正确的 AK 白名单。

## 接口

创建和加入返回 `{room, token, memberId}`；后续请求携带 `Authorization: Bearer <token>`，成员 ID 不能代替凭证。

- GET /api/health：配置状态（不返回密钥，也不代表已成功调用）
- POST /api/preferences：`{text}` → DeepSeek 偏好
- POST /api/rooms：`{nickname, city, origins, activities, ...}` → 创建空房间
- POST /api/rooms/:id/members：`{inviteToken,nickname,origin}` → 加入房间
- GET /api/rooms/:id：当前版本、生成进度、最多五个历史版本，按成员裁剪隐私
- POST /api/rooms/:id/generate 或 regenerate：`{baseVersionNo,input?}` → 202，轮询房间读取增量候选
- POST /api/rooms/:id/votes：`{versionNo,candidateId}`，candidateId=null 撤票
- POST /api/rooms/:id/comments：`{versionNo,candidateId?,body}`
- POST /api/rooms/:id/rollback：`{baseVersionNo,versionNo}` → 重新查询历史输入

## 检查命令

```powershell
npm test
npm run build
# 后端已启动时；此项会实际消耗少量地图与模型额度
node scripts/smoke-live.mjs
```

HTTP 测试覆盖权限、隐私、换票、撤票、旧版本冲突和历史回溯。浏览器自动化本机环境曾因沙箱初始化失败不可用，不能用构建通过替代地图视觉验证。
