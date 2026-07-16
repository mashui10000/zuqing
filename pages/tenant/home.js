const backend = require('../../services/backend')
const auth = require('../../utils/auth')

Page({
  data: { portal: null, bills: [], session: null },
  onShow() {
    const session = auth.requireRole('tenant')
    if (!session) return
    this.setData({ session })
    this.load()
  },
  load() {
    const session = this.data.session || backend.getSession()
    const portal = session.tenantId ? backend.getTenantPortal(session.tenantId) : null
    if (!portal) {
      this.setData({ portal: null, bills: [] })
      return
    }
    const bills = portal.bills.map((item) => Object.assign({}, item, { statusText: item.status === 'paid' ? '已支付' : item.status === 'overdue' ? '已逾期' : item.status === 'draft' ? '待抄表' : '待支付', statusClass: `status-${item.status}` }))
    this.setData({ portal, bills })
  },
  openBill(event) { wx.navigateTo({ url: `/pages/bill/detail?id=${event.currentTarget.dataset.id}` }) },
  editProfile() { wx.navigateTo({ url: '/pages/tenant/profile/index' }) },
  payNow() {
    const bill = this.data.bills.find((item) => item.status === 'due' || item.status === 'overdue')
    if (!bill) return wx.showToast({ title: '暂无待支付账单', icon: 'none' })
    wx.showModal({
      title: `支付 ¥${bill.total}`,
      content: '当前为本地数据模式；确认后将模拟微信支付成功并回写账单状态。',
      confirmText: '确认支付',
      success: (result) => { if (result.confirm) { backend.markBillPaid(bill.id, 'wechat'); this.load(); wx.showToast({ title: '支付成功', icon: 'success' }) } }
    })
  },
  switchIdentity() {
    wx.showModal({
      title: '切换登录身份',
      content: '将退出当前租客端，并返回身份选择页。',
      confirmText: '继续切换',
      success: (result) => { if (result.confirm) auth.signOut() }
    })
  }
})
