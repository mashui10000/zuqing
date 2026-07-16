const backend = require('../../services/backend')
const billing = require('../../utils/billing')
const auth = require('../../utils/auth')

Page({
  data: {
    rooms: [], roomLabels: [], selectedIndex: 0,
    form: { date: '', deposit: '', deduction: '', note: '' }, refund: 0
  },
  onLoad() {
    if (!auth.requireRole('landlord')) return
    const month = billing.monthKey()
    const rooms = backend.listMeterRooms(month)
    const deposit = rooms.length ? String(rooms[0].deposit || 0) : ''
    this.setData({ rooms, roomLabels: rooms.map((item) => `${item.propertyName} · ${item.roomName} · ${item.tenantName}`), 'form.date': new Date().toISOString().slice(0, 10), 'form.deposit': deposit, refund: Number(deposit || 0).toFixed(2) })
  },
  selectRoom(event) {
    const selectedIndex = Number(event.detail.value)
    const deposit = String(this.data.rooms[selectedIndex].deposit || 0)
    this.setData({ selectedIndex, 'form.deposit': deposit, 'form.deduction': '', refund: Number(deposit).toFixed(2) })
  },
  updateForm(event) {
    this.setData({ [`form.${event.currentTarget.dataset.key}`]: event.detail.value })
    if (event.currentTarget.dataset.key === 'deposit' || event.currentTarget.dataset.key === 'deduction') {
      const form = Object.assign({}, this.data.form, { [event.currentTarget.dataset.key]: event.detail.value })
      this.setData({ refund: Math.max(0, Number(form.deposit || 0) - Number(form.deduction || 0)).toFixed(2) })
    }
  },
  changeDate(event) { this.setData({ 'form.date': event.detail.value }) },
  submit() {
    if (!this.data.rooms.length) return wx.showToast({ title: '暂无在租房间', icon: 'none' })
    const room = this.data.rooms[this.data.selectedIndex]
    wx.showModal({
      title: `确认 ${room.roomName} 退租`,
      content: `将退还押金 ¥${this.data.refund}，房间状态会改为空置。`,
      confirmText: '完成退租',
      success: (result) => {
        if (!result.confirm) return
        backend.checkoutRoom(Object.assign({ roomId: room.id }, this.data.form))
        wx.showToast({ title: '退租已完成', icon: 'success' })
        setTimeout(() => wx.switchTab({ url: '/pages/properties/index' }), 500)
      }
    })
  }
})
