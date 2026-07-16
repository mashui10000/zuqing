const auth = require('../../utils/auth')

Page({
  onLoad() { auth.requireRole('landlord') },
  openRoomCreate() { wx.navigateTo({ url: '/pages/room/form/index' }) },
  openRooms() { wx.switchTab({ url: '/pages/properties/index' }) },
  openBills() { wx.switchTab({ url: '/pages/bills/index' }) },
  openCheckout() { wx.navigateTo({ url: '/pages/checkout/index' }) }
})
