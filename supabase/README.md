# Supabase 与正式微信登录

当前流程为：小程序调用 `wx.login()` 获取一次性 code，Supabase Edge Function 使用微信 AppSecret 调用 `code2Session` 验证微信身份，再为该微信用户签发 Supabase Auth 会话。页面数据仍采用“本地即时响应 + Supabase 云端持久化”。

## 已部署资源

- `migrations/202607160001_create_app_states.sql`：用户业务状态与 RLS。
- `migrations/202607160002_create_wechat_identities.sql`：仅服务端可访问的微信身份哈希映射，不保存明文 openid。
- `functions/wechat-login/index.ts`：微信 code 换取 Supabase Auth 会话。

不需要、也不要启用 Supabase Anonymous Sign-Ins。

## 必须配置的云端密钥

在 Supabase Dashboard → Edge Functions → Secrets 中添加：

```text
WECHAT_APP_SECRET=微信公众平台中的小程序 AppSecret
```

可选添加 `WECHAT_APP_ID`；未填写时函数使用当前项目的 AppID `wxc429db1ed3014bf0`。

AppSecret 只能放在 Supabase Secrets，禁止写入 `services/supabase.config.js`、提交到 GitHub 或发送到聊天中。

## 客户端配置

`services/supabase.config.js` 只允许包含 Supabase URL 和 Publishable key。Secret key / `service_role` key 绝不能进入小程序源码。

## 微信请求域名

正式发布前，在微信公众平台 → 开发管理 → 开发设置 → 服务器域名中，把下面地址加入 `request` 合法域名：

```text
https://jrtweiulrjgoesovshoi.supabase.co
```

微信的 `api.weixin.qq.com` 由 Edge Function 服务端访问，无需加入小程序 request 合法域名。

## 登录行为

- “微信登录”会先请求昵称头像授权，再验证微信身份。
- “不授权昵称，仍用微信登录”不会读取昵称头像，但仍会执行正式微信身份验证。
- Supabase 会话过期后使用 refresh token 自动续期；失效时要求重新微信登录。
- 同一设备切换微信用户时会先隔离本地状态，避免不同用户串数据。
