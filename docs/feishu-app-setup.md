# 飞书应用配置

feishu-orgwatch 需要一个飞书**企业自建应用**，并用同一个应用完成通讯录读取、扫码登录和卡片发送。`open_id` 是应用维度的，混用多个应用会导致知情人无法匹配。

## 1. 创建应用

1. 打开[飞书开放平台](https://open.feishu.cn/app)，进入「开发者后台」。
2. 创建「企业自建应用」，填写名称与描述，例如 `feishu-orgwatch`。
3. 在「凭证与基础信息」中记录 `App ID` 与 `App Secret`。

## 2. 开通权限

在「权限管理」中按控制台实际提示勾选，目标集合：

| 权限 | 用途 |
| --- | --- |
| `contact:department.base:readonly` | 读取部门基础信息 |
| `contact:department.organize:readonly` | 读取部门层级关系 |
| `contact:user.base:readonly` | 读取人员基本信息 |
| `contact:user.email:readonly` | 读取人员邮箱 |
| `contact:user.employee_id:readonly` | 读取人员工号与 user_id |
| `im:message:send_as_bot` | 以机器人身份发送卡片 |
| `im:chat:readonly` | 可选，列出机器人所在群，便于选择群聊 |

登录复用 `contact:user.base:readonly` 与 `contact:user.email:readonly`。

> 若控制台要求更细粒度的权限，以接口提示为准；权限审批通过后再执行「测试连接」。

## 3. 配置应用能力

- **机器人**：在「应用能力」中启用机器人。
- **网页登录**：在「安全设置」中把 `${app.public-base-url}/api/auth/feishu/callback` 加入重定向 URL 白名单。本地默认是 `http://127.0.0.1:18080/api/auth/feishu/callback`。
- **可用范围**：在「版本管理与发布」中设置应用可用范围，确保覆盖需要巡查的部门与人员。

## 4. 发布并审批

创建版本并申请发布。企业管理员审批通过后，应用才会对成员可见；未发布时通常表现为 `99991672` 等权限错误。

## 5. 在平台中验证

1. 打开「设置」，填写 `App ID` 与 `App Secret`，保存。
2. 点击「测试连接」。成功时会返回根部门下读取到的部门数量；失败时会显示飞书错误码。
3. 回到概览，点击「立即巡查」。
4. 首次巡查完成后，在「组织架构」中确认部门树与人员是否符合预期。

## 常见错误码

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `99991672` | 无权限 | 检查权限是否审批、可用范围是否覆盖 |
| `99991663` / `99991668` | token 无效 | 服务会自动刷新；持续出现时检查 App Secret |
| `99991400` / `99991401` | 触发限流 | 服务会自动退避重试；大组织可降低并发 |
| `230001` / 消息相关错误 | 卡片发送失败 | 检查机器人是否可用、收件人是否在应用可见范围 |

## 安全建议

- 只开必要的通讯录权限，不要申请手机号等未使用字段。
- App Secret 只在平台设置页或 `feishu-orgwatch.properties` 中保存，不要提交到 Git。
- 定期轮换 App Secret；轮换后同步更新平台设置，旧 token 会自动失效。
