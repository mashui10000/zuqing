// 这里只能填写 Supabase 的公开客户端密钥（Publishable key 或旧版 anon key）。
// 禁止把 Secret key / service_role key 放进小程序源码。
module.exports = {
  url: 'https://jrtweiulrjgoesovshoi.supabase.co',
  publishableKey: 'sb_publishable_vctYheWStIfmNlZ2-7og_A_Cx7TPdez',
  table: 'app_states',
  wechatLoginFunction: 'wechat-login',
  requestTimeout: 15000,
  pushDebounce: 500
}
