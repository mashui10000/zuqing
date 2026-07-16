const backend = require('../../services/backend')
const auth = require('../../utils/auth')

Page({
  data: {
    dashboard: {},
    bills: [],
    toast: '',
    headerInset: 24,
    headerHeight: 40,
    headerRightInset: 104
  },

  onLoad() { this.updateHeaderInset() },

  onShow() {
    if (!auth.requireRole('landlord')) return
    this.load()
  },

  onPullDownRefresh() {
    if (!auth.requireRole('landlord')) return
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const dashboard = backend.getDashboard()
    const bills = dashboard.recentBills.map((item) => Object.assign({}, item, {
      statusText: { paid: '已收', due: '待收', overdue: '逾期', draft: '草稿' }[item.status],
      statusClass: `status-${item.status}`
    }))
    this.setData({
      dashboard,
      bills
    })
  },

  updateHeaderInset() {
    try {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
      const statusBarHeight = Number(windowInfo.statusBarHeight || 20)
      const windowWidth = Number(windowInfo.windowWidth || 375)
      const headerInset = menu && menu.top ? Math.ceil(menu.top) : statusBarHeight
      const headerHeight = menu && menu.height ? Math.ceil(menu.height) : 40
      const headerRightInset = menu && menu.left
        ? Math.ceil(windowWidth - menu.left + 12)
        : 104
      this.setData({
        headerInset: Math.max(statusBarHeight, headerInset),
        headerHeight: Math.max(32, headerHeight),
        headerRightInset: Math.max(96, headerRightInset)
      })
    } catch (error) {
      this.setData({ headerInset: 24, headerHeight: 40, headerRightInset: 104 })
    }
  },

  goCheckout() { wx.navigateTo({ url: '/pages/checkout/index' }) },
  goRooms() { wx.switchTab({ url: '/pages/properties/index' }) },
  goAddRoom() { wx.navigateTo({ url: '/pages/room/form/index' }) },
  goGuide() { wx.navigateTo({ url: '/pages/guide/index' }) },
  goBills() { wx.switchTab({ url: '/pages/bills/index' }) },
  goBill(event) { wx.navigateTo({ url: `/pages/bill/detail?id=${event.currentTarget.dataset.id}` }) },

  showToast(message) {
    this.setData({ toast: message })
    setTimeout(() => this.setData({ toast: '' }), 1800)
  }
})
