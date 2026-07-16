# Supabase 接入

当前接入采用“小程序本地即时响应 + Supabase 云端持久化”：页面不需等待网络，每次写操作会合并后自动上传，启动时先读取云端数据。

## 1. 创建表和 RLS

在 Supabase Dashboard 的 SQL Editor 执行：

`migrations/202607160001_create_app_states.sql`

该脚本会启用 Row Level Security，每个登录用户只能读写自己的数据行。

## 2. 启用匿名登录

在 Supabase Dashboard 的 Authentication 设置中启用 Anonymous Sign-Ins。小程序会将 Supabase Auth 会话保存在微信本地存储中，并用用户 JWT 访问数据库。

## 3. 填写客户端配置

编辑 `services/supabase.config.js`：

```js
module.exports = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  publishableKey: 'sb_publishable_xxx',
  table: 'app_states',
  requestTimeout: 15000,
  pushDebounce: 500
}
```

可以使用 Publishable key，也兼容旧版 anon key。禁止填写 Secret key 或 `service_role` key。

## 4. 微信请求域名

开发者工具中已关闭域名校验，可直接联调。正式发布前，在微信公众平台的小程序服务器域名中，将下列地址加入 `request` 合法域名：

`https://YOUR_PROJECT_REF.supabase.co`

## 运行状态

“我的 → 数据与迁移 → Supabase 同步”会显示待配置、连接中、正在同步、已同步或错误原因。
