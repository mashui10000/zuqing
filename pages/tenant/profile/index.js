const backend = require('../../../services/backend')

function emptyOccupant(index) {
  return { id: `occupant-new-${Date.now()}-${index}`, name: '', mobile: '', idCard: '' }
}

function validateForm(form) {
  const occupantCount = Math.max(1, Math.min(6, Number(form.occupantCount) || 1))
  const occupants = Array.isArray(form.occupants) ? form.occupants : []
  if (occupants.length !== occupantCount) {
    return { message: `入住 ${occupantCount} 人，需要填写 ${occupantCount} 份住户资料`, index: 0, key: 'name' }
  }
  for (let index = 0; index < occupants.length; index += 1) {
    const item = occupants[index]
    const name = String(item.name || '').trim()
    const mobile = String(item.mobile || '').trim()
    const idCard = String(item.idCard || '').trim().toUpperCase()
    if (!name) return { message: `请填写第 ${index + 1} 位住户姓名`, index, key: 'name' }
    if (mobile && !/^1\d{10}$/.test(mobile)) return { message: `第 ${index + 1} 位住户手机号格式不正确`, index, key: 'mobile' }
    if (!/^\d{17}[\dX]$/.test(idCard)) return { message: `请填写第 ${index + 1} 位住户的正确身份证号`, index, key: 'idCard' }
  }
  if (!occupants.some((item) => /^1\d{10}$/.test(String(item.mobile || '').trim()))) {
    return { message: '至少填写一位住户的 11 位手机号', index: 0, key: 'mobile' }
  }
  return null
}

Page({
  data: {
    inviteId: '',
    context: null,
    form: { occupantCount: 1, occupants: [emptyOccupant(0)] },
    occupantOptions: [1, 2, 3, 4, 5, 6],
    occupantIndex: 0,
    error: '',
    invalidIndex: -1,
    invalidKey: '',
    saving: false
  },

  onLoad(options) {
    const inviteId = options.invite || ''
    const session = backend.getSession()
    if (!session.loggedIn) {
      wx.reLaunch({ url: `/pages/login/index?role=tenant${inviteId ? `&invite=${inviteId}` : ''}` })
      return
    }
    if (session.role !== 'tenant') {
      wx.reLaunch({ url: '/pages/home/home' })
      return
    }
    this.setData({ inviteId })
    this.load()
  },

  load() {
    const session = backend.getSession()
    const context = backend.getTenantProfile(this.data.inviteId, session.tenantId)
    if (!context) {
      wx.showToast({ title: '暂无可填写的入住资料', icon: 'none' })
      setTimeout(() => wx.reLaunch({ url: '/pages/tenant/home' }), 500)
      return
    }
    const occupantCount = Math.max(1, Math.min(6, Number(context.form.occupantCount) || 1))
    const occupants = (context.form.occupants || []).slice(0, occupantCount)
    while (occupants.length < occupantCount) occupants.push(emptyOccupant(occupants.length))
    this.setData({ context, form: { occupantCount, occupants }, occupantIndex: occupantCount - 1, error: '', invalidIndex: -1, invalidKey: '' })
    wx.setNavigationBarTitle({ title: context.room ? `${context.room.name} 入住资料` : '入住资料' })
  },

  updateOccupant(event) {
    const index = Number(event.currentTarget.dataset.index)
    const key = event.currentTarget.dataset.key
    const patch = { [`form.occupants[${index}].${key}`]: event.detail.value }
    if (this.data.invalidIndex === index && this.data.invalidKey === key) {
      Object.assign(patch, { error: '', invalidIndex: -1, invalidKey: '' })
    }
    this.setData(patch)
  },

  changeOccupants(event) {
    const occupantIndex = Number(event.detail.value)
    const occupantCount = this.data.occupantOptions[occupantIndex]
    const occupants = this.data.form.occupants.slice(0, occupantCount)
    while (occupants.length < occupantCount) occupants.push(emptyOccupant(occupants.length))
    this.setData({ occupantIndex, form: { occupantCount, occupants }, error: '', invalidIndex: -1, invalidKey: '' })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  submit() {
    if (this.data.saving) return
    const validation = validateForm(this.data.form)
    if (validation) {
      this.setData({
        error: validation.message,
        invalidIndex: validation.index,
        invalidKey: validation.key,
        saving: false
      })
      wx.pageScrollTo({ selector: `#tenant-occupant-card-${validation.index}`, duration: 220 })
      if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' })
      return
    }
    this.setData({ saving: true, error: '', invalidIndex: -1, invalidKey: '' })
    try {
      const session = backend.getSession()
      backend.submitTenantProfile(Object.assign({}, this.data.form, { inviteId: this.data.inviteId, tenantId: session.tenantId }))
      const nextSession = backend.getSession()
      getApp().setSession(nextSession)
      wx.showToast({ title: `${this.data.form.occupantCount} 份资料已提交`, icon: 'success' })
      setTimeout(() => wx.reLaunch({ url: '/pages/tenant/home' }), 600)
    } catch (error) {
      this.setData({ error: error.message || '提交失败，请检查资料后重试', saving: false })
    }
  }
})
