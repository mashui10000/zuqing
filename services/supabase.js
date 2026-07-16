const config = require('./supabase.config')

const SESSION_STORAGE_KEY = 'rentflow_supabase_session_v2'
const LEGACY_SESSION_STORAGE_KEY = 'rentflow_supabase_session_v1'
const DEFAULT_TABLE = 'app_states'

let remoteRevision = 0
let pendingState = null
let pendingWaiters = []
let pushTimer = null
let pushRunning = false

function normalizedUrl() {
  return String(config.url || '').trim().replace(/\/+$/, '')
}

function publicKey() {
  return String(config.publishableKey || '').trim()
}

function isConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(normalizedUrl()) && publicKey().length > 20
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function errorMessage(payload, fallback) {
  if (!payload) return fallback
  if (typeof payload === 'string') return payload
  return payload.message || payload.msg || payload.error_description || payload.error || fallback
}

function request(options) {
  if (!isConfigured()) return Promise.reject(new Error('Supabase 尚未配置'))
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${normalizedUrl()}${options.path}`,
      method: options.method || 'GET',
      data: options.data,
      timeout: Number(config.requestTimeout) || 15000,
      header: Object.assign({
        apikey: publicKey(),
        'Content-Type': 'application/json'
      }, options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}, options.headers || {}),
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data)
          return
        }
        const message = errorMessage(response.data, `Supabase 请求失败（${response.statusCode}）`)
        const error = new Error(message)
        error.statusCode = response.statusCode
        error.payload = response.data
        error.code = response.data && response.data.code ? response.data.code : ''
        reject(error)
      },
      fail(error) {
        reject(new Error(error && error.errMsg ? error.errMsg : '无法连接 Supabase'))
      }
    })
  })
}

function readSession() {
  const session = wx.getStorageSync(SESSION_STORAGE_KEY)
  return session && session.accessToken && session.refreshToken && session.userId ? session : null
}

function hasSession() {
  return Boolean(readSession())
}

function persistSession(payload) {
  const source = payload && payload.session ? payload.session : payload
  const user = (payload && payload.user) || (source && source.user) || {}
  if (!source || !source.access_token || !source.refresh_token || !user.id) throw new Error('Supabase 未返回有效会话')
  const session = {
    accessToken: source.access_token,
    refreshToken: source.refresh_token,
    expiresAt: Date.now() + Math.max(60, Number(source.expires_in) || 3600) * 1000,
    userId: user.id,
    provider: 'wechat'
  }
  wx.setStorageSync(SESSION_STORAGE_KEY, session)
  wx.removeStorageSync(LEGACY_SESSION_STORAGE_KEY)
  return session
}

function authRequiredError(message) {
  const error = new Error(message || '请先使用微信登录')
  error.code = 'AUTH_REQUIRED'
  return error
}

function refreshSession(session) {
  return request({
    path: '/auth/v1/token?grant_type=refresh_token',
    method: 'POST',
    data: { refresh_token: session.refreshToken }
  }).then(persistSession)
}

function signInWithWechat(code) {
  const loginCode = String(code || '').trim()
  const functionName = /^[a-z0-9-]+$/i.test(String(config.wechatLoginFunction || '')) ? config.wechatLoginFunction : 'wechat-login'
  if (!loginCode) return Promise.reject(new Error('微信登录凭证为空，请重试'))
  return request({
    path: `/functions/v1/${functionName}`,
    method: 'POST',
    data: { code: loginCode }
  }).then(persistSession)
}

function ensureSession() {
  const session = readSession()
  if (!session) return Promise.reject(authRequiredError())
  if (session.expiresAt > Date.now() + 60000) return Promise.resolve(session)
  return refreshSession(session).catch((error) => {
    if (error.statusCode !== 400 && error.statusCode !== 401) throw error
    clearSession()
    throw authRequiredError('微信登录已过期，请重新登录')
  })
}

function tableName() {
  const value = String(config.table || DEFAULT_TABLE).trim()
  return /^[a-z_][a-z0-9_]*$/i.test(value) ? value : DEFAULT_TABLE
}

function pullState(session) {
  const path = `/rest/v1/${tableName()}?select=state,revision,updated_at&user_id=eq.${encodeURIComponent(session.userId)}&limit=1`
  return request({ path, accessToken: session.accessToken }).then((rows) => {
    const record = Array.isArray(rows) ? rows[0] : null
    if (!record || !record.state) return null
    remoteRevision = Number(record.revision) || 0
    return { state: record.state, revision: remoteRevision, updatedAt: record.updated_at || '' }
  })
}

function pushStateNow(state, session) {
  const revision = Math.max(remoteRevision + 1, Date.now())
  const path = `/rest/v1/${tableName()}?on_conflict=user_id`
  return request({
    path,
    method: 'POST',
    accessToken: session.accessToken,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    data: { user_id: session.userId, state: clone(state), revision }
  }).then((rows) => {
    const record = Array.isArray(rows) ? rows[0] : null
    remoteRevision = Number(record && record.revision) || revision
    return { revision: remoteRevision, updatedAt: record && record.updated_at ? record.updated_at : '' }
  })
}

async function bootstrap(localState, providedSession) {
  if (!isConfigured()) return { configured: false, source: 'local', state: localState }
  const session = providedSession || await ensureSession()
  const remote = await pullState(session)
  if (remote && remote.state) return { configured: true, source: 'remote', state: remote.state, session, revision: remote.revision }
  const saved = await pushStateNow(localState, session)
  return { configured: true, source: 'local', state: localState, session, revision: saved.revision }
}

function settleWaiters(waiters, error, result) {
  waiters.forEach((waiter) => {
    if (error) waiter.reject(error)
    else waiter.resolve(result)
  })
}

async function flushPushQueue() {
  if (pushRunning || !pendingState) return
  pushRunning = true
  const state = pendingState
  const waiters = pendingWaiters
  pendingState = null
  pendingWaiters = []
  try {
    const session = await ensureSession()
    const result = await pushStateNow(state, session)
    settleWaiters(waiters, null, result)
  } catch (error) {
    settleWaiters(waiters, error)
  } finally {
    pushRunning = false
    if (pendingState) {
      clearTimeout(pushTimer)
      pushTimer = setTimeout(flushPushQueue, Number(config.pushDebounce) || 500)
    }
  }
}

function schedulePush(state) {
  if (!isConfigured()) return Promise.resolve({ skipped: true })
  if (!hasSession()) return Promise.resolve({ skipped: true, reason: 'auth-required' })
  pendingState = clone(state)
  clearTimeout(pushTimer)
  pushTimer = setTimeout(flushPushQueue, Number(config.pushDebounce) || 500)
  return new Promise((resolve, reject) => pendingWaiters.push({ resolve, reject }))
}

function clearSession() {
  wx.removeStorageSync(SESSION_STORAGE_KEY)
  wx.removeStorageSync(LEGACY_SESSION_STORAGE_KEY)
  remoteRevision = 0
}

function signOut() {
  const session = readSession()
  clearSession()
  if (!session) return Promise.resolve()
  return request({ path: '/auth/v1/logout', method: 'POST', accessToken: session.accessToken }).catch(() => {})
}

module.exports = {
  isConfigured,
  hasSession,
  signInWithWechat,
  bootstrap,
  ensureSession,
  pullState,
  schedulePush,
  clearSession,
  signOut,
  _request: request,
  _flushPushQueue: flushPushQueue
}
