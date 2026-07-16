const backend = require('../../services/backend')
const auth = require('../../utils/auth')
const billing = require('../../utils/billing')

Page({
  data: { month: billing.monthKey(), stats: {} },
  onShow() { if (auth.requireRole('landlord')) this.load() },
  load() { this.setData({ stats: backend.getStats(this.data.month) }) },
  changeMonth(event) { this.setData({ month: event.detail.value }); this.load() }
})
