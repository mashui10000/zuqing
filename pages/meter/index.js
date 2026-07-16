const backend = require('../../services/backend')
const auth = require('../../utils/auth')

Page({
  data: { rooms: [], activeId: '', completed: 0 },
  onLoad(options) {
    if (!auth.requireRole('landlord')) return
    this.setData({ activeId: options.roomId || '' })
    this.load()
  },
  load() {
    const rooms = backend.listMeterRooms()
    this.setData({ rooms, completed: rooms.filter((item) => item.saved).length })
  },
  updateValue(event) {
    const index = Number(event.currentTarget.dataset.index)
    const key = event.currentTarget.dataset.key
    this.setData({ [`rooms[${index}].${key}`]: event.detail.value })
  },
  saveRoom(event) {
    const index = Number(event.currentTarget.dataset.index)
    const room = this.data.rooms[index]
    if (!room.previousSaved && (room.previousWater === '' || room.previousElectric === '')) return wx.showToast({ title: '首次使用请填写上月水电读数', icon: 'none' })
    if (room.water === '' || room.electric === '') return wx.showToast({ title: '请填写本月水电读数', icon: 'none' })
    try {
      const bill = backend.saveMeterReadings({ roomId: room.id, month: room.month, previousWater: room.previousWater, previousElectric: room.previousElectric, water: room.water, electric: room.electric, otherFee: room.otherFee })
      this.load()
      wx.showToast({ title: bill ? '读数已保存，账单已生成' : '读数已保存', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  }
})
