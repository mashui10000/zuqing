const config = require('./supabase.config')

const SESSION_STORAGE_KEY = 'rentflow_supabase_session_v1'
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

function persistSession(payload) {
  const source = payload && payload.session ? payload.session : payload
  const user = (payload && payload.user) || (source && source.user) || {}
  if (!source || !source.access_token || !source.refresh_token || !user.id) throw new Error('Supabase 未返回有效会话')
  const session = {
    accessToken: source.access_token,
    refreshToken: source.refresh_token,
    expiresAt: Date.now() + Math.max(60, Number(source.expires_in) || 3600) * 1000,
    userId: user.id,
    isAnonymous: Boolean(user.is_anonymous)
  }
  wx.setStorageSync(SESSION_STORAGE_KEY, session)
  return session
}

function refreshSession(session) {
  return request({
    path: '/auth/v1/token?grant_type=refresh_token',
    method: 'POST',
    data: { refresh_token: session.refreshToken }
  }).then(persistSession)
}

function createAnonymousSession() {
  return request({
    path: '/auth/v1/signup',
    method: 'POST',
    data: { data: { client: 'wechat-mini-program', app: 'rentflow' } }
  }).then(persistSession)
}

function ensureSession() {
  const session = readSession()
  if (session && session.expiresAt > Date.now() + 60000) return Promise.resolve(session)
  if (session) {
    return refreshSession(session).catch((error) => {
      if (error.statusCode !== 400 && error.statusCode !== 401) throw error
      wx.removeStorageSync(SESSION_STORAGE_KEY)
      return createAnonymousSession()
    })
  }
  return createAnonymousSession()
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

async function bootstrap(localState) {
  if (!isConfigured()) return { configured: false, source: 'local', state: localState }
  const session = await ensureSession()
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
  pendingState = clone(state)
  clearTimeout(pushTimer)
  pushTimer = setTimeout(flushPushQueue, Number(config.pushDebounce) || 500)
  return new Promise((resolve, reject) => pendingWaiters.push({ resolve, reject }))
}

function clearSession() {
  wx.removeStorageSync(SESSION_STORAGE_KEY)
  remoteRevision = 0
}

module.exports = {
  isConfigured,
  bootstrap,
  ensureSession,
  pullState,
  schedulePush,
  clearSession,
  _request: request,
  _flushPushQueue: flushPushQueue
}
