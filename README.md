# 飞书组织架构巡查器（feishu-orgwatch）

<p align="center">
  <img src="./apps/web/public/logo.svg" height="112" alt="飞书组织架构巡查器图标" />
</p>

<p align="center">
  把飞书组织变化变成可追踪的知情闭环
</p>

<p align="center">
  中文 ·
  <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/HawkonS/feishu-orgwatch/actions/workflows/checks.yml"><img src="https://github.com/HawkonS/feishu-orgwatch/actions/workflows/checks.yml/badge.svg" alt="Checks" /></a>
  <a href="https://github.com/HawkonS/feishu-orgwatch/actions/workflows/codeql-analysis.yml"><img src="https://github.com/HawkonS/feishu-orgwatch/actions/workflows/codeql-analysis.yml/badge.svg" alt="CodeQL" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

## 简介

组织架构变化通常散落在飞书后台的操作记录里：有人入职、离职、调岗，某个部门被改名或换了负责人。人工定期核对费时且容易漏，事后也很难说清谁在什么时候知道过哪次变更。

飞书组织架构巡查器把这件事做成一条闭环：定时抓取通讯录快照，与上一份快照做字段级差异，在平台内圈选知情人，发送飞书卡片，并记录每个人的发送与知情状态。

交付形态是一个自托管的 Web 服务，后端 NestJS + Fastify，前端 React + Vite + TypeScript，数据保存在单个 SQLite 文件中，前后端同端口部署，适合企业内部单实例运行。

## 功能

- **组织快照**：按根部门抓取部门树、人员与在职状态
- **差异巡查**：只比较追踪字段，忽略头像、排序、大小写等噪音
- **知情卡片**：选择个人或群聊，发送带摘要与详情深链的飞书卡片
- **自动通知**：在「通知」页启用后，巡查发现新差异会自动发送给指定的人或群
- **回执闭环**：收件人确认知情，管理员可代确认，全过程留痕
- **架构浏览**：部门树与人员表联动，支持搜索和变更历史
- **定时任务**：可视化配置巡查频率、时区、补跑与运行记录
- **权限与安全**：三级角色同时校验界面与接口，App Secret 加密保存
- **运维能力**：支持 PWA、系统更新、在线日志与快照备份

## 快速开始

环境要求：macOS / Linux、Git、Bash、Node.js **22.12+**、npm 10+。SQLite 原生依赖没有预编译包时，还需要 Python 3、make 和 C/C++ 编译工具。

```bash
git clone https://github.com/HawkonS/feishu-orgwatch.git
cd feishu-orgwatch
./run.sh
```

打开 <http://127.0.0.1:18080/login>，使用默认管理员 `hawkon` 登录；首次启动会随机生成初始密码并写入 `.runtime/default-admin.txt`，同时生成 `feishu-orgwatch.properties`、`data/` 与 `.runtime/`。请登录后立即修改密码，再填写飞书应用凭据，参考 [飞书应用配置](./docs/feishu-app-setup.md)。

启动后先点「测试连接」，再执行一次巡查。停止服务使用 `./stop.sh`。

## 配置

配置集中在根目录 `feishu-orgwatch.properties`，首次启动自动生成并补齐缺失项。日常修改建议在「设置」页完成，页面上带有每项的说明和默认值；环境变量使用 `ORGWATCH_<KEY>` 覆盖配置，数据在 `data/`，日志在 `.runtime/logs/`。

环境变量 `ORGWATCH_<KEY>` 会覆盖同名配置，例如 `ORGWATCH_APP_PORT` 覆盖 `app.port`。该文件包含飞书凭据和管理配置，不要提交到 Git。数据库、密钥、日志和更新状态分别位于 `data/`、`data/secret.key` 与 `.runtime/`。

## 常见问题

**巡查失败或提示无权限？**

先在「设置」页点「测试连接」，按返回的错误码补齐通讯录权限，并确认应用可见范围覆盖根部门。

**飞书卡片收不到？**

确认应用已发布、机器人已加入目标群，并检查发送方与收件人的 `open_id` 是否来自同一个飞书应用。

**知情回执对不上人？**

确认平台账号与飞书身份的关联方式（union_id、open_id 或邮箱）。运营管理员可以在知情记录里代确认。

**误报太多？**

关闭「追踪部门排序变化」，或在差异详情页将本次差异标记为忽略并填写理由。

**忘记管理员密码？**

```bash
./tools/reset_admin_password.sh
```

## 开发

```bash
npm ci
./run.sh --dev
npm run check
```

开发模式同时启动后端与 Vite，前端访问 <http://127.0.0.1:5173>，API 仍监听 `18080`。`npm run check` 覆盖 lint、类型检查、服务端与前端测试、构建和仓库审查；端到端冒烟使用 `npm run test:e2e`。

启用本地提交检查：

```bash
git config core.hooksPath .githooks
```

贡献说明、模块边界和提交信息规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 安全说明

- 飞书通讯录数据、差异、回执与审计只保存在本机 SQLite；除调用飞书开放平台发送卡片和读取通讯录外，不向其他第三方发送数据；飞书开放平台受其自身服务条款约束。
- 不要提交 `feishu-orgwatch.properties`、`data/`、`.runtime/`、备份文件和日志；App Secret 一旦暴露应立即在飞书开放平台轮换。
- 更换 `security.secret-key` 会导致已保存的飞书凭据无法解密，备份时必须同时保留数据库、properties 和 `data/secret.key`。
- 部署到公网前必须完成初始化、设置强密码、启用 HTTPS，并放在可信网络或反向代理之后。
- 员工信息属于个人信息，请在企业内部告知与授权范围内使用，按需缩短快照保留期并及时清理不再需要的数据。

## License

Copyright 2026 HawkonS.

本项目依据 [Apache License 2.0](./LICENSE) 发布。
