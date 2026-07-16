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
  copyBackup() {
    const backup = backend.exportBackup()
    wx.setClipboardData({
      data: backup,
      success: () => wx.showToast({ title: '备份已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    })
  },
  openImport() { this.setData({ showImport: true, backupText: '' }) },
  closeImport() { this.setData({ showImport: false }) },
  stop() {},
  updateBackup(event) { this.setData({ backupText: event.detail.value }) },
  readBackupFromClipboard() {
    wx.getClipboardData({
      success: (result) => {
        const backupText = String(result.data || '').trim()
        if (!backupText) {
          wx.showToast({ title: '剪贴板没有备份', icon: 'none' })
          return
        }
        this.setData({ backupText })
        wx.showToast({ title: '已读取备份', icon: 'success' })
      },
      fail: () => wx.showToast({ title: '读取剪贴板失败', icon: 'none' })
    })
  },
  importBackup() {
    const backupText = String(this.data.backupText || '').trim()
    if (!backupText) {
      wx.showToast({ title: '请先粘贴备份', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认恢复备份',
      content: '备份会覆盖当前设备上的房间、租客、读数和账单，当前登录身份保持不变。',
      confirmText: '确认恢复',
      success: (result) => {
        if (!result.confirm) return
        try {
          backend.importBackup(backupText)
          getApp().setSession(backend.getSession())
          this.setData({ showImport: false, backupText: '' })
          this.load()
          wx.showToast({ title: '数据已恢复', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error.message || '备份恢复失败', icon: 'none' })
        }
      }
    })
  },
  reset() {
    wx.showModal({ title: '清空全部数据', content: '房间、租客、读数、账单和收款记录将全部删除，此操作不可撤销。', confirmText: '确认清空', confirmColor: '#D70015', success: (result) => { if (result.confirm) { backend.reset(); getApp().setSession(backend.getSession()); wx.reLaunch({ url: '/pages/login/index' }) } } })
  }
})
