const backend = require('../../services/backend')
const auth = require('../../utils/auth')

const ROLE_COPY = {
  landlord: {
    label: '房东',
    summary: '管理房间、租客、抄表、账单与收款',
    fallbackName: '房东用户'
  },
  tenant: {
    label: '租客',
    summary: '查看本人账单、水电明细与支付记录',
    fallbackName: '租客用户'
  }
}

Page({
  data: {
    role: 'landlord',
    roleLabel: ROLE_COPY.landlord.label,
    roleSummary: ROLE_COPY.landlord.summary,
    inviteId: '',
    inviteMode: false,
    loading: false,
    topInset: 56
  },

  onLoad(options) {
    this.updateSafeArea()
    if (options.invite) {
      this.setData({
        role: 'tenant',
        roleLabel: ROLE_COPY.tenant.label,
        roleSummary: ROLE_COPY.tenant.summary,
        inviteId: options.invite,
        inviteMode: true
      })
    }
  },

  updateSafeArea() {
    try {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
      const statusBarHeight = Number(windowInfo.statusBarHeight || 20)
      const topInset = menu && menu.bottom ? Math.ceil(menu.bottom + 12) : statusBarHeight + 44
      this.setData({ topInset: Math.max(statusBarHeight + 12, topInset) })
    } catch (error) {
      this.setData({ topInset: 56 })
    }
  },

  onShow() {
    const session = backend.getSession()
    if (!session.loggedIn) return
    if (this.data.inviteId && session.role === 'tenant') {
      wx.reLaunch({ url: `/pages/tenant/profile/index?invite=${this.data.inviteId}` })
      return
    }
    if (!this.data.inviteId) wx.reLaunch({ url: auth.destination(session.role) })
  },

  selectRole(event) {
    const role = event.currentTarget.dataset.role
    if (this.data.inviteMode && role !== 'tenant') return wx.showToast({ title: '该邀请仅供租客本人填写', icon: 'none' })
    const copy = ROLE_COPY[role]
    if (!copy || role === this.data.role) return
    this.setData({ role, roleLabel: copy.label, roleSummary: copy.summary })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  wechatLogin() {
    if (this.data.loading) return
    this.setData({ loading: true })
    wx.getUserProfile({
      desc: '用于显示登录昵称与确认当前身份',
      success: (result) => this.completeLogin(result.userInfo || {}),
      fail: () => {
        this.setData({ loading: false })
        wx.showToast({ title: '未授权，可选择“不授权昵称，继续”', icon: 'none' })
      }
    })
  },

  continueWithoutWechat() {
    if (this.data.loading) return
    this.setData({ loading: true })
    const copy = ROLE_COPY[this.data.role]
    this.completeLogin({ nickName: copy.fallbackName, avatarUrl: '' })
  },

  async completeLogin(userInfo) {
    try {
      await backend.whenReady()
      const session = backend.login({
        role: this.data.role,
        displayName: userInfo.nickName || ROLE_COPY[this.data.role].fallbackName,
        avatarUrl: userInfo.avatarUrl || '',
        tenantId: ''
      })
      getApp().setSession(session)
      const url = this.data.inviteId && session.role === 'tenant'
        ? `/pages/tenant/profile/index?invite=${this.data.inviteId}`
        : auth.destination(session.role)
      wx.reLaunch({ url })
    } catch (error) {
      wx.showToast({ title: error.message || '登录失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
