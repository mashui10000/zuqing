import { createClient } from 'npm:@supabase/supabase-js@2.110.6'

const WECHAT_APP_ID = Deno.env.get('WECHAT_APP_ID') || 'wxc429db1ed3014bf0'
const WECHAT_APP_SECRET = Deno.env.get('WECHAT_APP_SECRET') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''

const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type'
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders })
}

function namedKeys(name: string, legacyName: string) {
  const raw = Deno.env.get(name)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      return Object.values(parsed).filter((value): value is string => typeof value === 'string' && value.length > 0)
    } catch (_error) {}
  }
  const legacy = Deno.env.get(legacyName)
  return legacy ? [legacy] : []
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function exchangeWechatCode(code: string) {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', WECHAT_APP_ID)
  url.searchParams.set('secret', WECHAT_APP_SECRET)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')
  const response = await fetch(url)
  if (!response.ok) throw new Error('微信身份服务暂时不可用')
  const payload = await response.json()
  if (payload.errcode || !payload.openid) {
    const error = new Error(payload.errcode === 40029 || payload.errcode === 40163
      ? '微信登录凭证已失效，请重试'
      : '微信身份验证失败')
    ;(error as Error & { status?: number }).status = 401
    throw error
  }
  return String(payload.openid)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: responseHeaders })
  if (request.method !== 'POST') return json(405, { message: '仅支持 POST 请求' })

  const publishableKeys = namedKeys('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKeys = namedKeys('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPABASE_URL || !WECHAT_APP_SECRET || !publishableKeys.length || !secretKeys.length) {
    return json(503, { message: '服务端微信登录尚未配置完整' })
  }
  if (!publishableKeys.includes(request.headers.get('apikey') || '')) {
    return json(401, { message: '客户端密钥无效' })
  }

  try {
    const body = await request.json()
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!code || code.length > 256) return json(400, { message: '微信登录凭证无效' })

    const openid = await exchangeWechatCode(code)
    const identityHash = await sha256(`${WECHAT_APP_ID}:${openid}`)
    const email = `wechat-${identityHash.slice(0, 32)}@users.invalid`
    const admin = createClient(SUPABASE_URL, secretKeys[0], {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    })

    const { data: identity, error: identityError } = await admin
      .from('wechat_identities')
      .select('user_id,email')
      .eq('identity_hash', identityHash)
      .maybeSingle()
    if (identityError) throw identityError

    if (!identity) {
      const { error: createError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { provider: 'wechat' }
      })
      if (createError && createError.status !== 422) throw createError
    }

    const loginEmail = identity ? identity.email : email
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: loginEmail
    })
    if (linkError) throw linkError
    const tokenHash = linkData.properties && linkData.properties.hashed_token
    if (!tokenHash) throw new Error('无法签发登录凭证')

    const client = createClient(SUPABASE_URL, publishableKeys[0], {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    })
    const { data: authData, error: verifyError } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'email'
    })
    if (verifyError || !authData.session || !authData.user) throw verifyError || new Error('登录会话签发失败')
    if (identity && identity.user_id !== authData.user.id) throw new Error('微信身份映射校验失败')

    const { error: mappingError } = await admin.from('wechat_identities').upsert({
      identity_hash: identityHash,
      user_id: authData.user.id,
      email: loginEmail,
      last_login_at: new Date().toISOString()
    }, { onConflict: 'identity_hash' })
    if (mappingError) throw mappingError

    return json(200, {
      session: authData.session,
      user: { id: authData.user.id }
    })
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 500
    const message = status >= 500 ? '微信登录服务暂时不可用，请稍后重试' : (error as Error).message
    console.error('wechat-login failed', { status, name: (error as Error).name })
    return json(status, { message })
  }
})
