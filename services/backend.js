const store = require('../data/store')
const supabase = require('./supabase')

let started = false
let localMutationCount = 0
let readyPromise = null
let listeners = []
let syncStatus = {
  mode: supabase.isConfigured() ? 'supabase' : 'local',
  configured: supabase.isConfigured(),
  status: supabase.isConfigured() ? 'idle' : 'disabled',
  message: supabase.isConfigured() ? '待连接' : '未配置 Supabase',
  lastSyncedAt: '',
  error: ''
}

function emitStatus(patch) {
  syncStatus = Object.assign({}, syncStatus, patch)
  listeners.slice().forEach((listener) => {
    try { listener(Object.assign({}, syncStatus)) } catch (error) {}
  })
}

function initialize() {
  const localState = store.initialize()
  if (started) return localState
  started = true

  if (!supabase.isConfigured()) {
    readyPromise = Promise.resolve(localState)
    return localState
  }

  emitStatus({ status: 'connecting', message: '正在连接 Supabase', error: '' })
  readyPromise = supabase.bootstrap(localState).then((result) => {
    if (result.source === 'remote' && result.state && result.state.version === localState.version && localMutationCount === 0) {
      store.importBackup(JSON.stringify(result.state))
    } else if (result.source === 'remote' && localMutationCount > 0) {
      supabase.schedulePush(store.getState()).catch(() => {})
    } else if (result.source === 'remote' && result.state && result.state.version !== localState.version) {
      supabase.schedulePush(store.getState()).catch(() => {})
    }
    emitStatus({
      status: 'synced',
      message: '已同步',
      lastSyncedAt: new Date().toISOString(),
      error: ''
    })
    return store.getState()
  }).catch((error) => {
    emitStatus({ status: 'error', message: '云端连接失败', error: error.message || String(error) })
    return store.getState()
  })

  return localState
}

function whenReady() {
  if (!started) initialize()
  return readyPromise
}

function scheduleSync() {
  if (!supabase.isConfigured()) return Promise.resolve({ skipped: true })
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
  scheduleSync,
  getSyncStatus,
  onSyncStatus,
  getState: store.getState,
  getSession: store.getSession,
  login: mutate('login'),
  logout: mutate('logout'),
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
