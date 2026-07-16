const store = require('../data/store')
const supabase = require('./supabase')

let started = false
let localMutationCount = 0
let readyPromise = null
let listeners = []
let syncStatus = {
  mode: supabase.isConfigured() ? 'supabase' : 'local',
  configured: supabase.isConfigured(),
  status: supabase.isConfigured() ? 'waiting-login' : 'disabled',
  message: supabase.isConfigured() ? '等待微信登录' : '未配置 Supabase',
  lastSyncedAt: '',
  error: ''
}

function emitStatus(patch) {
  syncStatus = Object.assign({}, syncStatus, patch)
  listeners.slice().forEach((listener) => {
    try { listener(Object.assign({}, syncStatus)) } catch (error) {}
  })
}

function importRemoteState(result, localState, userId) {
  if (result.source !== 'remote' || !result.state) return localState
  if (result.state.version !== localState.version || localMutationCount > 0) {
    supabase.schedulePush(store.getState()).catch(() => {})
    return store.getState()
  }
  if (result.state.cloudUserId && result.state.cloudUserId !== userId) {
    throw new Error('云端数据身份校验失败，请联系管理员')
  }
  const remoteState = JSON.parse(JSON.stringify(result.state))
  remoteState.cloudUserId = userId
  store.importBackup(JSON.stringify(remoteState))
  return store.getState()
}

async function connectCloudState(providedSession) {
  const cloudSession = providedSession || await supabase.ensureSession()
  const localState = store.bindCloudUser(cloudSession.userId)
  const result = await supabase.bootstrap(localState, cloudSession)
  const state = importRemoteState(result, localState, cloudSession.userId)
  emitStatus({
    status: 'synced',
    message: '已同步',
    lastSyncedAt: new Date().toISOString(),
    error: ''
  })
  return state
}

function initialize() {
  const localState = store.initialize()
  if (started) return localState
  started = true

  if (!supabase.isConfigured()) {
    readyPromise = Promise.resolve(localState)
    return localState
  }

  if (!supabase.hasSession()) {
    if (localState.auth && localState.auth.loggedIn) store.logout()
    emitStatus({ status: 'waiting-login', message: '等待微信登录', error: '' })
    readyPromise = Promise.resolve(store.getState())
    return store.getState()
  }

  emitStatus({ status: 'connecting', message: '正在恢复微信登录', error: '' })
  readyPromise = connectCloudState().catch((error) => {
    if (error.code === 'AUTH_REQUIRED') {
      store.logout()
      emitStatus({ status: 'waiting-login', message: '请重新微信登录', error: '' })
    } else {
      emitStatus({ status: 'error', message: '云端连接失败', error: error.message || String(error) })
    }
    return store.getState()
  })

  return localState
}

function whenReady() {
  if (!started) initialize()
  return readyPromise
}

async function loginWithWechat(payload) {
  if (!payload || !['landlord', 'tenant'].includes(payload.role)) throw new Error('请选择登录身份')
  emitStatus({ status: 'connecting', message: '正在验证微信身份', error: '' })
  try {
    const cloudSession = await supabase.signInWithWechat(payload.code)
    localMutationCount = 0
    readyPromise = connectCloudState(cloudSession)
    await readyPromise
    const session = store.login({
      role: payload.role,
      displayName: payload.displayName,
      avatarUrl: payload.avatarUrl,
      tenantId: payload.tenantId || ''
    })
    localMutationCount += 1
    await scheduleSync()
    return session
  } catch (error) {
    emitStatus({ status: 'error', message: '微信登录失败', error: error.message || String(error) })
    throw error
  }
}

function scheduleSync() {
  if (!supabase.isConfigured() || !supabase.hasSession()) return Promise.resolve({ skipped: true })
  emitStatus({ status: 'syncing', message: '正在同步', error: '' })
  return supabase.schedulePush(store.getState()).then((result) => {
    emitStatus({ status: 'synced', message: '已同步', lastSyncedAt: new Date().toISOString(), error: '' })
    return result
  }).catch((error) => {
    emitStatus({ status: 'error', message: '同步失败', error: error.message || String(error) })
    throw error
  })
}

function mutate(method) {
  return function wrappedMutation() {
    const result = store[method].apply(store, arguments)
    localMutationCount += 1
    scheduleSync().catch(() => {})
    return result
  }
}

function logout() {
  const session = store.logout()
  supabase.signOut().catch(() => {})
  emitStatus({ status: 'waiting-login', message: '等待微信登录', error: '' })
  return session
}

function getSyncStatus() {
  return Object.assign({}, syncStatus)
}

function onSyncStatus(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.push(listener)
  return () => { listeners = listeners.filter((item) => item !== listener) }
}

module.exports = {
  mode: supabase.isConfigured() ? 'supabase' : 'local',
  initialize,
  whenReady,
  loginWithWechat,
  scheduleSync,
  getSyncStatus,
  onSyncStatus,
  getState: store.getState,
  getSession: store.getSession,
  login: mutate('login'),
  logout,
  getDashboard: store.getDashboard,
  listProperties: store.listProperties,
  listRooms: store.listRooms,
  getProperty: store.getProperty,
  listBills: store.listBills,
  getBill: store.getBill,
  getStats: store.getStats,
  getTenantPortal: store.getTenantPortal,
  saveReading: mutate('saveReading'),
  saveMeterReadings: mutate('saveMeterReadings'),
  generateMonthlyBills: mutate('generateMonthlyBills'),
  queueDueReminders: mutate('queueDueReminders'),
  markBillPaid: mutate('markBillPaid'),
  addRoom: mutate('addRoom'),
  addRooms: mutate('addRooms'),
  updateRoom: mutate('updateRoom'),
  updateRoomMoveInDate: mutate('updateRoomMoveInDate'),
  bindTenant: mutate('bindTenant'),
  createTenantInvite: mutate('createTenantInvite'),
  getTenantProfile: store.getTenantProfile,
  submitTenantProfile: mutate('submitTenantProfile'),
  updateTenantOccupant: mutate('updateTenantOccupant'),
  removeTenantOccupant: mutate('removeTenantOccupant'),
  listMeterRooms: store.listMeterRooms,
  checkoutRoom: mutate('checkoutRoom'),
  setRole: mutate('setRole'),
  exportBackup: store.exportBackup,
  importBackup: mutate('importBackup'),
  reset: mutate('reset')
}
