const backend = require('../../services/backend')
const notification = require('../../services/notification')
const auth = require('../../utils/auth')

Page({
  data: { id: '', bill: null, showPay: false, isLandlord: true },
  onLoad(options) {
    if (!auth.requireRole()) return
    this.setData({ id: options.id })
    this.load()
  },
  onShow() { if (this.data.id) this.load() },
  load() {
    const session = auth.requireRole()
    if (!session) return
    const bill = backend.getBill(this.data.id)
    if (!bill) return wx.showToast({ title: '账单不存在', icon: 'none' })
    const isLandlord = session.role === 'landlord'
    if (!isLandlord && session.tenantId && bill.tenant && bill.tenant.id !== session.tenantId) {
      wx.showToast({ title: '无权查看该账单', icon: 'none' })
      return wx.reLaunch({ url: '/pages/tenant/home' })
    }
    bill.statusText = isLandlord
      ? { paid: '已收款', due: '待收款', overdue: '已逾期', draft: '草稿' }[bill.status]
      : { paid: '已支付', due: '待支付', overdue: '已逾期', draft: '待确认' }[bill.status]
    bill.statusClass = `status-${bill.status}`
    this.setData({ bill, isLandlord })
  },
  openPay() { this.setData({ showPay: true }) },
  closePay() { this.setData({ showPay: false }) },
  stop() {},
  openRoomMeter() { wx.navigateTo({ url: `/pages/property/detail?id=${this.data.bill.propertyId}&room=${this.data.bill.roomId}` }) },
  markPaid(event) {
    const nextBill = backend.markBillPaid(this.data.id, event.currentTarget.dataset.method)
    this.setData({ showPay: false, id: nextBill ? nextBill.id : this.data.id })
    this.load()
    wx.showToast({ title: nextBill ? `已结转到 ${nextBill.month}` : '收款已确认', icon: 'success' })
  },
  payBill() {
    wx.showModal({
      title: `支付 ¥${this.data.bill.total}`,
      content: '当前为本地数据模式；确认后将模拟微信支付成功并通知房东。',
      confirmText: '确认支付',
      success: (result) => {
        if (!result.confirm) return
        const nextBill = backend.markBillPaid(this.data.id, 'wechat')
        if (nextBill) this.setData({ id: nextBill.id })
        this.load()
        wx.showToast({ title: nextBill ? `已结转到 ${nextBill.month}` : '支付成功', icon: 'success' })
      }
    })
  },
  async remind() {
    const result = await notification.requestBillSubscription()
    wx.showToast({ title: result.configured ? '提醒已发送' : '已加入待发送队列', icon: 'none' })
  },
  onShareAppMessage() {
    const bill = this.data.bill
    return { title: `${bill.propertyName} ${bill.roomName} · ${bill.periodDisplay} 账单 ¥${bill.total}`, path: `/pages/bill/detail?id=${bill.id}` }
  }
})
