const backend = require('../../services/backend')
const auth = require('../../utils/auth')

Page({
  data: { state: {}, session: {}, syncStatus: {}, displayName: '', avatarText: '', showImport: false, backupText: '' },
  onLoad() {
    this.stopSyncListener = backend.onSyncStatus((syncStatus) => this.setData({ syncStatus }))
  },
  onUnload() {
    if (this.stopSyncListener) this.stopSyncListener()
  },
  onShow() { if (auth.requireRole('landlord')) this.load() },
  load() {
    const state = backend.getState()
    const session = backend.getSession()
    const displayName = session.displayName || state.profile.name || '房东用户'
    this.setData({ state, session, syncStatus: backend.getSyncStatus(), displayName, avatarText: displayName.slice(0, 1) || '房' })
  },
  switchIdentity() {
    wx.showModal({
      title: '切换登录身份',
      content: '将退出当前房东端，并返回身份选择页。',
      confirmText: '继续切换',
      success: (result) => { if (result.confirm) auth.signOut() }
    })
  },
  openGuide() { wx.navigateTo({ url: '/pages/guide/index' }) },
  openRoomCreate() { wx.navigateTo({ url: '/pages/room/form/index' }) },
  copyBackup() {
    wx.setClipboardData({ data: backend.exportBackup(), success: () => wx.showToast({ title: '备份已复制', icon: 'success' }) })
  },
  openImport() { this.setData({ showImport: true, backupText: '' }) },
  closeImport() { this.setData({ showImport: false }) },
  stop() {},
  updateBackup(event) { this.setData({ backupText: event.detail.value }) },
  importBackup() {
    try { backend.importBackup(this.data.backupText); this.setData({ showImport: false }); this.load(); wx.showToast({ title: '数据已恢复', icon: 'success' }) }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
  },
  reset() {
    wx.showModal({ title: '清空全部数据', content: '房间、租客、读数、账单和收款记录将全部删除，此操作不可撤销。', confirmText: '确认清空', confirmColor: '#D70015', success: (result) => { if (result.confirm) { backend.reset(); getApp().setSession(backend.getSession()); wx.reLaunch({ url: '/pages/login/index' }) } } })
  }
})
