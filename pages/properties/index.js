const backend = require('../../services/backend')
const auth = require('../../utils/auth')

function groupRoomsByLocation(rooms) {
  const groups = []
  const byId = {}
  rooms.forEach((room) => {
    const key = room.propertyId || room.locationName
    if (!byId[key]) {
      byId[key] = {
        id: key,
        locationName: room.locationName,
        address: room.address,
        rooms: [],
        occupiedCount: 0,
        vacantCount: 0
      }
      groups.push(byId[key])
    }
    const group = byId[key]
    group.rooms.push(room)
    if (room.status === 'occupied') group.occupiedCount += 1
    else group.vacantCount += 1
  })
  return groups
}

function filterRooms(rooms, locationId, status) {
  return rooms.filter((room) => {
    const roomLocationId = room.propertyId || room.locationName
    const matchesLocation = locationId === 'all' || roomLocationId === locationId
    const matchesStatus = status === 'all' || (status === 'occupied' ? room.status === 'occupied' : room.status !== 'occupied')
    return matchesLocation && matchesStatus
  })
}

Page({
  data: {
    rooms: [],
    locationFilters: [],
    selectedLocationId: 'all',
    statusFilters: [],
    activeRoomStatus: 'all',
    visibleRooms: [],
    occupiedCount: 0,
    vacantCount: 0
  },

  onShow() {
    if (auth.requireRole('landlord')) this.load()
  },

  onPullDownRefresh() {
    if (auth.requireRole('landlord')) this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const rooms = backend.listRooms().map((room) => Object.assign({}, room, {
      statusText: room.status === 'occupied' ? '在租' : '空置'
    }))
    const groups = groupRoomsByLocation(rooms)
    const occupiedCount = rooms.filter((item) => item.status === 'occupied').length
    const vacantCount = rooms.length - occupiedCount
    const locationFilters = [
      { value: 'all', label: '全部房间', count: rooms.length },
      ...groups.map((item) => ({ value: item.id, label: item.locationName, count: item.rooms.length }))
    ]
    const selectedLocationId = locationFilters.some((item) => item.value === this.data.selectedLocationId)
      ? this.data.selectedLocationId
      : 'all'
    const activeRoomStatus = ['all', 'occupied', 'vacant'].includes(this.data.activeRoomStatus)
      ? this.data.activeRoomStatus
      : 'all'
    this.setData({
      rooms,
      locationFilters,
      selectedLocationId,
      statusFilters: [
        { value: 'all', label: '全部', count: rooms.length },
        { value: 'occupied', label: '在租', count: occupiedCount },
        { value: 'vacant', label: '空置', count: vacantCount }
      ],
      activeRoomStatus,
      visibleRooms: filterRooms(rooms, selectedLocationId, activeRoomStatus),
      occupiedCount,
      vacantCount
    })
  },

  chooseLocation(event) {
    const selectedLocationId = event.currentTarget.dataset.value || 'all'
    this.setData({
      selectedLocationId,
      visibleRooms: filterRooms(this.data.rooms, selectedLocationId, this.data.activeRoomStatus)
    })
  },

  chooseRoomStatus(event) {
    const activeRoomStatus = event.currentTarget.dataset.value || 'all'
    this.setData({
      activeRoomStatus,
      visibleRooms: filterRooms(this.data.rooms, this.data.selectedLocationId, activeRoomStatus)
    })
  },

  resetRoomFilters() {
    this.setData({
      selectedLocationId: 'all',
      activeRoomStatus: 'all',
      visibleRooms: this.data.rooms
    })
  },

  openRoomCreate() {
    wx.navigateTo({ url: '/pages/room/form/index' })
  },

  openRoom(event) {
    const room = this.data.rooms.find((item) => item.id === event.currentTarget.dataset.id)
    if (!room) return wx.showToast({ title: '房间不存在', icon: 'none' })
    wx.navigateTo({ url: `/pages/property/detail?id=${room.propertyId}&room=${room.id}` })
  }
})
