const backend = require('../../services/backend')
const auth = require('../../utils/auth')
const billing = require('../../utils/billing')

function localDateKey(date) {
  const source = date || new Date()
  const year = source.getFullYear()
  const month = String(source.getMonth() + 1).padStart(2, '0')
  const day = String(source.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMeterMonth(value) {
  const parts = String(value || '').split('-').map(Number)
  return parts.length === 2 && parts.every((part) => Number.isFinite(part)) ? `${parts[0]}年${parts[1]}月` : value
}

function getMeterRoom(roomId) {
  const room = backend.listMeterRooms().find((item) => item.id === roomId)
  return room ? Object.assign({}, room, { monthDisplay: formatMeterMonth(room.month), previousMonthDisplay: formatMeterMonth(room.previousMonth) }) : null
}

Page({
  data: {
    id: '',
    roomId: '',
    property: null,
    selectedRoom: null,
    showRoomEdit: false,
    roomEditError: '',
    roomEditInvalidKey: '',
    showBind: false,
    showOccupantEdit: false,
    meterRoom: null,
    meterSaving: false,
    form: { name: '', mobile: '', rent: '', moveInDate: '', moveInDateDisplay: '', wechatBound: true },
    roomEditForm: { locationName: '', address: '', name: '', rent: '', deposit: '', waterRate: '', electricRate: '' },
    occupantForm: { tenantId: '', occupantId: '', name: '', mobile: '', idCard: '' }
  },

  onLoad(options) {
    if (!auth.requireRole('landlord')) return
    this.setData({ id: options.id || '', roomId: options.room || '' })
    this.load()
  },

  onShow() {
    if (this.data.id && auth.requireRole('landlord')) this.load()
  },

  load() {
    const property = backend.getProperty(this.data.id)
    if (!property) return wx.showToast({ title: '房间不存在', icon: 'none' })
    const selectedRoom = property.rooms.find((item) => item.id === this.data.roomId) || property.rooms[0] || null
    if (!selectedRoom) return wx.showToast({ title: '房间不存在', icon: 'none' })
    const meterRoom = selectedRoom.status === 'occupied' ? getMeterRoom(selectedRoom.id) : null
    this.setData({ property, selectedRoom, roomId: selectedRoom.id, meterRoom })
    wx.setNavigationBarTitle({ title: `${selectedRoom.name} 房间` })
  },

  refreshRoom(roomId) {
    const property = backend.getProperty(this.data.id)
    const selectedRoom = property.rooms.find((item) => item.id === roomId)
    const meterRoom = selectedRoom && selectedRoom.status === 'occupied' ? getMeterRoom(roomId) : null
    this.setData({ property, selectedRoom, meterRoom })
  },

  openRoomEdit() {
    const property = this.data.property
    const room = this.data.selectedRoom
    this.setData({
      showRoomEdit: true,
      roomEditError: '',
      roomEditInvalidKey: '',
      roomEditForm: {
        locationName: property.name || '',
        address: property.address || '',
        name: room.name || '',
        rent: String(room.rent),
        deposit: String(room.deposit),
        waterRate: String(room.waterRate),
        electricRate: String(room.electricRate)
      }
    })
  },

  closeRoomEdit() { this.setData({ showRoomEdit: false, roomEditError: '', roomEditInvalidKey: '' }) },
  updateRoomEdit(event) {
    const key = event.currentTarget.dataset.key
    const updates = { [`roomEditForm.${key}`]: event.detail.value }
    if (this.data.roomEditInvalidKey === key) Object.assign(updates, { roomEditError: '', roomEditInvalidKey: '' })
    this.setData(updates)
  },

  showRoomEditError(message, key) {
    this.setData({ roomEditError: message, roomEditInvalidKey: key || '' })
  },

  saveRoomEdit() {
    const form = this.data.roomEditForm
    if (!String(form.locationName || '').trim()) return this.showRoomEditError('请填写小区或楼栋', 'locationName')
    if (!String(form.name || '').trim()) return this.showRoomEditError('请填写房间号', 'name')
    for (const key of ['rent', 'deposit', 'waterRate', 'electricRate']) {
      if (form[key] === '' || !Number.isFinite(Number(form[key])) || Number(form[key]) < 0) {
        return this.showRoomEditError('收费金额不能留空或小于 0', key)
      }
    }
    try {
      const result = backend.updateRoom(this.data.selectedRoom.id, form)
      this.setData({ id: result.propertyId, roomId: result.room.id, showRoomEdit: false, roomEditError: '', roomEditInvalidKey: '' })
      this.load()
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: '房间信息已更新', icon: 'success' })
    } catch (error) {
      this.showRoomEditError(error.message || '房间信息保存失败，请检查后重试')
    }
  },

  changeRoomMoveInDate(event) {
    try {
      backend.updateRoomMoveInDate(this.data.selectedRoom.id, event.detail.value)
      this.refreshRoom(this.data.selectedRoom.id)
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: '入住日期已更新', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  },

  editOccupant(event) {
    const occupant = this.data.selectedRoom.tenant.occupants.find((item) => item.id === event.currentTarget.dataset.occupantId)
    if (!occupant) return
    this.setData({
      showOccupantEdit: true,
      occupantForm: {
        tenantId: this.data.selectedRoom.tenant.id,
        occupantId: occupant.id,
        name: occupant.name,
        mobile: occupant.mobile,
        idCard: occupant.idCard
      }
    })
  },

  closeOccupantEdit() { this.setData({ showOccupantEdit: false }) },
  updateOccupantForm(event) { this.setData({ [`occupantForm.${event.currentTarget.dataset.key}`]: event.detail.value }) },

  saveOccupant() {
    const form = this.data.occupantForm
    try {
      backend.updateTenantOccupant(form.tenantId, form.occupantId, form)
      this.refreshRoom(this.data.selectedRoom.id)
      this.setData({ showOccupantEdit: false })
      wx.showToast({ title: '住户资料已更新', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  },

  openManualBind() {
    const selectedRoom = this.data.selectedRoom
    const moveInDate = selectedRoom.moveInDate || localDateKey()
    this.setData({ showBind: true, form: { name: '', mobile: '', rent: selectedRoom.rent || '', moveInDate, moveInDateDisplay: billing.formatMonthDay(moveInDate), wechatBound: true } })
  },
  closeBind() { this.setData({ showBind: false }) },
  stop() {},
  updateForm(event) { this.setData({ [`form.${event.currentTarget.dataset.key}`]: event.detail.value }) },
  changeBindMoveInDate(event) { this.setData({ 'form.moveInDate': event.detail.value, 'form.moveInDateDisplay': billing.formatMonthDay(event.detail.value) }) },
  toggleWechat(event) { this.setData({ 'form.wechatBound': event.detail.value }) },

  submitBind() {
    const form = this.data.form
    if (!form.name.trim() || !form.mobile.trim()) return wx.showToast({ title: '请填写租客姓名和手机号', icon: 'none' })
    if (!form.moveInDate) return wx.showToast({ title: '请选择入住日期', icon: 'none' })
    try {
      backend.bindTenant(this.data.selectedRoom.id, form)
      this.setData({ showBind: false })
      this.load()
      wx.showToast({ title: '租客已入住', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  },

  updateMeterValue(event) {
    this.setData({ [`meterRoom.${event.currentTarget.dataset.key}`]: event.detail.value })
  },

  saveMeterReading() {
    if (this.data.meterSaving || !this.data.meterRoom) return
    const room = this.data.meterRoom
    if (!room.previousSaved && (room.previousWater === '' || room.previousElectric === '')) {
      return wx.showToast({ title: '首次使用请填写上期水电读数', icon: 'none' })
    }
    if (room.water === '' || room.electric === '') return wx.showToast({ title: '请填写本期水电读数', icon: 'none' })
    this.setData({ meterSaving: true })
    try {
      const bill = backend.saveMeterReadings({
        roomId: room.id,
        month: room.month,
        previousWater: room.previousWater,
        previousElectric: room.previousElectric,
        water: room.water,
        electric: room.electric,
        otherFee: room.otherFee
      })
      this.refreshRoom(room.id)
      this.setData({ meterSaving: false })
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: bill ? '读数已保存，账单已生成' : '读数已保存', icon: 'success' })
    } catch (error) {
      this.setData({ meterSaving: false })
      wx.showToast({ title: error.message || '水电读数保存失败', icon: 'none' })
    }
  },

  onShareAppMessage(options) {
    const roomId = options.from === 'button' && options.target.dataset.roomId
      ? options.target.dataset.roomId
      : this.data.selectedRoom.id
    const property = backend.getProperty(this.data.id)
    const selectedRoom = property.rooms.find((item) => item.id === roomId)
    if (options.from !== 'button') {
      return {
        title: `${property.name} · ${selectedRoom.name} 房间资料`,
        path: `/pages/property/detail?id=${this.data.id}&room=${roomId}`
      }
    }
    const invite = backend.createTenantInvite(roomId)
    this.setData({ property, selectedRoom })
    return {
      title: `${property.name} ${selectedRoom.name} · 请填写入住资料`,
      path: `/pages/login/index?role=tenant&invite=${invite.id}`
    }
  }
})
