const backend = require('../../../services/backend')
const auth = require('../../../utils/auth')
const billing = require('../../../utils/billing')
const roomNumbering = require('../../../utils/rooms')

function parseRoomNames(value) {
  return String(value || '').split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean)
}

function roomEditorHeight(count) {
  return Math.min(540, Math.max(210, count * 52 + 44))
}

Page({
  data: {
    form: { propertyId: '', locationName: '', address: '', roomNames: '', moveInDate: '', moveInDateDisplay: '', rent: '', deposit: '', waterRate: '', electricRate: '' },
    floorPlan: { startFloor: '1', floorCount: '', roomsPerFloor: '' },
    roomCount: 0,
    roomEditorHeight: 210,
    floorPreview: '',
    firstPayment: '0.00',
    submitting: false
  },

  onLoad(options) {
    if (!auth.requireRole('landlord')) return
    if (!options.property) return
    const location = backend.listProperties().find((item) => item.id === options.property)
    if (location) {
      this.setData({
        'form.propertyId': location.id,
        'form.locationName': location.name,
        'form.address': location.address || ''
      })
    }
  },

  updateForm(event) {
    const key = event.currentTarget.dataset.key
    const value = event.detail.value
    this.setData({ [`form.${key}`]: value })
    if (key === 'roomNames') {
      const names = parseRoomNames(value)
      this.setData({
        roomCount: new Set(names.map((item) => item.toLowerCase())).size,
        roomEditorHeight: roomEditorHeight(names.length),
        floorPreview: ''
      })
    }
    if (key === 'rent' || key === 'deposit') {
      const next = Object.assign({}, this.data.form, { [key]: value })
      this.setData({ firstPayment: (Number(next.rent || 0) + Number(next.deposit || 0)).toFixed(2) })
    }
  },

  updateFloorPlan(event) {
    this.setData({
      [`floorPlan.${event.currentTarget.dataset.key}`]: event.detail.value,
      floorPreview: ''
    })
  },

  generateRoomNames() {
    try {
      const names = roomNumbering.generateFloorRoomNames(this.data.floorPlan)
      this.setData({
        'form.roomNames': names.join('\n'),
        roomCount: names.length,
        roomEditorHeight: roomEditorHeight(names.length),
        floorPreview: `已生成 ${names.length} 间房：${names[0]} — ${names[names.length - 1]}`
      })
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: `已生成 ${names.length} 间`, icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  },

  changeMoveInDate(event) {
    this.setData({ 'form.moveInDate': event.detail.value, 'form.moveInDateDisplay': billing.formatMonthDay(event.detail.value) })
  },

  clearMoveInDate() {
    this.setData({ 'form.moveInDate': '', 'form.moveInDateDisplay': '' })
  },

  submit() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      const result = backend.addRooms(this.data.form)
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: `已新增 ${result.count} 间房`, icon: 'success' })
      const firstRoom = result.rooms[0]
      setTimeout(() => wx.redirectTo({ url: `/pages/property/detail?id=${result.propertyId}&room=${firstRoom.id}` }), 500)
    } catch (error) {
      this.setData({ submitting: false })
      wx.showToast({ title: error.message, icon: 'none' })
    }
  }
})
