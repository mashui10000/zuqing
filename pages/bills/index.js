const backend = require('../../services/backend')
const auth = require('../../utils/auth')

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'due', label: '待收' },
  { value: 'overdue', label: '逾期' },
  { value: 'paid', label: '已收' }
]

const SCOPES = [
  { value: 'current', label: '本月账单' },
  { value: 'history', label: '历史账单' }
]

function currentBillIds(bills) {
  const ids = new Set()
  const roomIds = new Set()
  bills.forEach((bill) => {
    if (roomIds.has(bill.roomId)) return
    roomIds.add(bill.roomId)
    ids.add(bill.id)
  })
  return ids
}

function groupBillsByCollectionDay(bills) {
  const groups = {}
  bills.forEach((bill) => {
    const day = Number(bill.collectionDay) || Number(String(bill.dueDate || '').slice(-2)) || 0
    const key = `day-${String(day).padStart(2, '0')}`
    if (!groups[key]) groups[key] = { key, day, title: day ? `每月${day}日收租` : '待设置收租日', bills: [], outstanding: 0 }
    groups[key].bills.push(bill)
    if (bill.status === 'due' || bill.status === 'overdue') groups[key].outstanding += Number(bill.total) || 0
  })
  return Object.keys(groups).map((key) => {
    const group = groups[key]
    group.bills.sort((a, b) => b.dueDate.localeCompare(a.dueDate))
    group.summary = `${group.bills.length} 笔${group.outstanding ? ` · 待收 ¥${group.outstanding.toFixed(2)}` : ''}`
    return group
  }).sort((a, b) => a.day - b.day)
}

Page({
  data: { scopes: SCOPES, scope: 'current', filters: FILTERS, active: 'all', bills: [], billGroups: [], total: 0, emptyText: '' },
  onShow() { if (auth.requireRole('landlord')) this.load() },
  onPullDownRefresh() { if (auth.requireRole('landlord')) this.load(); wx.stopPullDownRefresh() },
  load() {
    const allBills = backend.listBills('all')
    const currentIds = currentBillIds(allBills)
    const bills = allBills.filter((item) => {
      const inScope = this.data.scope === 'current' ? currentIds.has(item.id) : !currentIds.has(item.id)
      const matchesStatus = this.data.active === 'all' || item.status === this.data.active
      return inScope && matchesStatus
    }).map((item) => Object.assign({}, item, {
      statusText: { paid: '已收', due: '待收', overdue: '逾期', draft: '草稿' }[item.status],
      statusClass: `status-${item.status}`
    }))
    const total = bills.filter((item) => item.status === 'due' || item.status === 'overdue').reduce((sum, item) => sum + item.total, 0).toFixed(2)
    const emptyText = this.data.scope === 'current' ? '本月没有符合筛选的账单。' : '历史账单中没有符合筛选的记录。'
    this.setData({ bills, billGroups: groupBillsByCollectionDay(bills), total, emptyText })
  },
  chooseScope(event) { this.setData({ scope: event.currentTarget.dataset.value, active: 'all' }); this.load() },
  chooseFilter(event) { this.setData({ active: event.currentTarget.dataset.value }); this.load() },
  openBill(event) { wx.navigateTo({ url: `/pages/bill/detail?id=${event.currentTarget.dataset.id}` }) },
  goRooms() { wx.switchTab({ url: '/pages/properties/index' }) }
})
