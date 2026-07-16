const billing = require('../utils/billing')

const STORAGE_KEY = 'rentflow_state_v1'
const DATA_VERSION = 2

function initialState() {
  return {
    version: DATA_VERSION,
    cloudUserId: '',
    currentRole: 'landlord',
    auth: {
      loggedIn: false,
      role: '',
      displayName: '',
      avatarUrl: '',
      tenantId: ''
    },
    profile: { name: '', mobile: '' },
    settings: { dueDay: 5, autoBill: true, reminderDays: 2 },
    properties: [],
    tenants: [],
    readings: [],
    bills: [],
    checkouts: [],
    tenantInvites: [],
    pendingMessages: []
  }
}

function save(state) {
  wx.setStorageSync(STORAGE_KEY, state)
  return state
}

function initialize() {
  const saved = wx.getStorageSync(STORAGE_KEY)
  if (saved && saved.version === DATA_VERSION) {
    let changed = false
    if (typeof saved.cloudUserId !== 'string') {
      saved.cloudUserId = ''
      changed = true
    }
    if (!saved.auth) {
      saved.auth = { loggedIn: false, role: '', displayName: '', avatarUrl: '', tenantId: '' }
      changed = true
    }
    if (typeof saved.auth.loggedIn !== 'boolean') {
      saved.auth.loggedIn = false
      changed = true
    }
    if (!saved.auth.role) {
      saved.auth.role = saved.currentRole || ''
      changed = true
    }
    if (!Array.isArray(saved.tenantInvites)) {
      saved.tenantInvites = []
      changed = true
    }
    if (!Array.isArray(saved.properties)) { saved.properties = []; changed = true }
    if (!Array.isArray(saved.tenants)) { saved.tenants = []; changed = true }
    if (!Array.isArray(saved.readings)) { saved.readings = []; changed = true }
    if (!Array.isArray(saved.bills)) { saved.bills = []; changed = true }
    if (!Array.isArray(saved.checkouts)) { saved.checkouts = []; changed = true }
    if (!Array.isArray(saved.pendingMessages)) { saved.pendingMessages = []; changed = true }
    saved.properties.forEach((property) => {
      if (!Array.isArray(property.rooms)) { property.rooms = []; changed = true }
      property.rooms.forEach((room) => {
        if (typeof room.deposit !== 'number') {
          room.deposit = 0
          changed = true
        }
        if (typeof room.moveInDate !== 'string' || (room.moveInDate && !isValidDateValue(room.moveInDate))) {
          room.moveInDate = ''
          changed = true
        }
      })
    })
    saved.tenants.forEach((tenant) => {
      if (typeof tenant.idCard !== 'string') { tenant.idCard = ''; changed = true }
      if (typeof tenant.moveInDate !== 'string' || (tenant.moveInDate && !isValidDateValue(tenant.moveInDate))) {
        tenant.moveInDate = ''
        changed = true
      }
      if (!tenant.occupantCount) { tenant.occupantCount = 1; changed = true }
      if (!tenant.profileStatus) { tenant.profileStatus = tenant.idCard ? 'completed' : 'pending'; changed = true }
      if (!tenant.moveInDate && tenant.profileStatus === 'completed') { tenant.profileStatus = 'pending'; changed = true }
      if (!Array.isArray(tenant.occupants) || !tenant.occupants.length) {
        tenant.occupants = [{ id: `occupant-${tenant.id}-1`, name: tenant.name || '', mobile: tenant.mobile && !tenant.mobile.includes('*') ? tenant.mobile : '', idCard: tenant.idCard && !tenant.idCard.includes('*') ? tenant.idCard : '' }]
        tenant.occupantCount = tenant.occupants.length
        tenant.profileStatus = 'pending'
        changed = true
      }
    })
    saved.properties.forEach((property) => property.rooms.forEach((room) => {
      const tenant = saved.tenants.find((item) => item.id === room.tenantId)
      if (!tenant) return
      if (!room.moveInDate && tenant.moveInDate) { room.moveInDate = tenant.moveInDate; changed = true }
      if (!tenant.moveInDate && room.moveInDate) { tenant.moveInDate = room.moveInDate; syncTenantSummary(tenant); changed = true }
    }))
    const today = billing.dateKey()
    saved.bills.forEach((bill) => {
      const context = roomContext(saved, bill.roomId)
      if (context && applyBillSchedule(saved, bill, context.room)) changed = true
      if (!bill.reminderDate) {
        const dueDate = bill.dueDate || billing.dueDate(bill.month, saved.settings && saved.settings.dueDay)
        bill.reminderDate = billing.addDays(dueDate, -Math.max(0, Number(saved.settings && saved.settings.reminderDays) || 0))
        changed = true
      }
      if (bill.messageStatus === 'queued' && bill.reminderDate > today) {
        bill.messageStatus = 'scheduled'
        changed = true
      }
    })
    const queuedIds = new Set(saved.bills.filter((bill) => bill.messageStatus === 'queued').map((bill) => bill.id))
    const nextPendingMessages = saved.pendingMessages.filter((id) => queuedIds.has(id))
    if (nextPendingMessages.length !== saved.pendingMessages.length) {
      saved.pendingMessages = nextPendingMessages
      changed = true
    }
    return changed ? save(saved) : saved
  }
  return save(initialState())
}

function getState() { return initialize() }

function bindCloudUser(userId) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) throw new Error('云端用户身份无效')
  const state = initialize()
  if (state.cloudUserId && state.cloudUserId !== normalizedUserId) {
    const nextState = initialState()
    nextState.cloudUserId = normalizedUserId
    return save(nextState)
  }
  if (!state.cloudUserId) {
    state.cloudUserId = normalizedUserId
    return save(state)
  }
  return state
}

function mutate(callback) {
  const state = getState()
  callback(state)
  return save(state)
}

function roomContext(state, roomId) {
  for (const property of state.properties) {
    const room = property.rooms.find((item) => item.id === roomId)
    if (room) {
      const tenant = state.tenants.find((item) => item.id === room.tenantId) || null
      return { property, room, tenant }
    }
  }
  return null
}

function roomMoveInDate(state, room, tenantId) {
  const tenant = state.tenants.find((item) => item.id === (tenantId || room.tenantId))
  if (tenantId && tenant && tenant.moveInDate) return tenant.moveInDate
  return room.moveInDate || (tenant ? tenant.moveInDate || '' : '')
}

function billSchedule(state, room, month, tenantId) {
  const fallbackDay = state.settings && state.settings.dueDay
  const cycle = billing.billingCycle(month, roomMoveInDate(state, room, tenantId), fallbackDay)
  return {
    cycleStartDate: cycle.startDate,
    cycleEndDate: cycle.endDate,
    dueDate: cycle.dueDate,
    reminderDate: billing.addDays(cycle.dueDate, -Math.max(0, Number(state.settings && state.settings.reminderDays) || 0)),
    collectionDay: cycle.collectionDay
  }
}

function applyBillSchedule(state, bill, room) {
  const schedule = billSchedule(state, room, bill.month, bill.tenantId)
  const changed = Object.keys(schedule).some((key) => bill[key] !== schedule[key])
  Object.assign(bill, schedule)
  return changed
}

function presentBill(state, bill, context) {
  const schedule = context ? billSchedule(state, context.room, bill.month, bill.tenantId) : {
    cycleStartDate: bill.cycleStartDate || '',
    cycleEndDate: bill.cycleEndDate || '',
    dueDate: bill.dueDate || '',
    collectionDay: bill.collectionDay || Number(String(bill.dueDate || '').slice(-2)) || 0
  }
  const cycleStartDate = bill.cycleStartDate || schedule.cycleStartDate
  const cycleEndDate = bill.cycleEndDate || schedule.cycleEndDate
  const dueDate = bill.dueDate || schedule.dueDate
  return Object.assign({}, bill, {
    cycleStartDate,
    cycleEndDate,
    dueDate,
    collectionDay: bill.collectionDay || schedule.collectionDay,
    periodDisplay: billing.formatPeriod(cycleStartDate, cycleEndDate),
    dueDateDisplay: billing.formatMonthDay(dueDate),
    paidAtDisplay: billing.formatMonthDay(bill.paidAt)
  })
}

function maskIdCard(value) {
  if (!value) return '待租客填写'
  if (value.includes('*')) return value
  return value.length === 18 ? `${value.slice(0, 6)}********${value.slice(-4)}` : value
}

function normalizeOccupant(item, index) {
  return {
    id: item && item.id ? item.id : `occupant-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    name: String(item && item.name || '').trim(),
    mobile: String(item && item.mobile || '').trim(),
    idCard: String(item && item.idCard || '').trim().toUpperCase()
  }
}

function isValidDateValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function readMoveInDate(value) {
  const moveInDate = String(value || '').trim()
  if (!isValidDateValue(moveInDate)) throw new Error('请选择正确的入住日期')
  return moveInDate
}

function syncTenantSummary(tenant) {
  tenant.occupants = (tenant.occupants || []).map(normalizeOccupant)
  tenant.occupantCount = tenant.occupants.length
  const primary = tenant.occupants[0] || { name: '', mobile: '', idCard: '' }
  const contact = tenant.occupants.find((item) => /^1\d{10}$/.test(item.mobile)) || primary
  tenant.name = primary.name
  tenant.mobile = contact.mobile || ''
  tenant.idCard = primary.idCard
  tenant.profileStatus = Boolean(tenant.moveInDate) && tenant.occupants.length > 0 && tenant.occupants.every((item) => item.name && /^\d{17}[\dX]$/.test(item.idCard)) && tenant.occupants.some((item) => /^1\d{10}$/.test(item.mobile)) ? 'completed' : 'pending'
  return tenant
}

function validateOccupants(rawOccupants, expectedCount) {
  const count = Math.max(1, Math.min(6, Number(expectedCount) || 1))
  const occupants = Array.isArray(rawOccupants) ? rawOccupants.slice(0, count).map(normalizeOccupant) : []
  if (occupants.length !== count) throw new Error(`入住 ${count} 人，需要填写 ${count} 份住户资料`)
  occupants.forEach((item, index) => {
    if (!item.name) throw new Error(`请填写第 ${index + 1} 位住户姓名`)
    if (!/^\d{17}[\dX]$/.test(item.idCard)) throw new Error(`请填写第 ${index + 1} 位住户的正确身份证号`)
    if (item.mobile && !/^1\d{10}$/.test(item.mobile)) throw new Error(`第 ${index + 1} 位住户手机号格式不正确`)
  })
  if (!occupants.some((item) => /^1\d{10}$/.test(item.mobile))) throw new Error('至少填写一位住户的 11 位手机号')
  return occupants
}

function getDashboard() {
  const state = getState()
  const rooms = state.properties.reduce((all, item) => all.concat(item.rooms), [])
  const occupied = rooms.filter((item) => item.status === 'occupied')
  const latestMonth = billing.monthKey()
  const bills = state.bills.filter((item) => item.month === latestMonth)
  const received = bills.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.total, 0)
  const receivable = bills.filter((item) => item.status !== 'draft').reduce((sum, item) => sum + item.total, 0)
  const recentBills = bills.slice().reverse().slice(0, 3).map((bill) => {
    const context = roomContext(state, bill.roomId)
    return Object.assign({}, presentBill(state, bill, context), { roomName: context ? `${context.property.name} · ${context.room.name}` : bill.roomId })
  })
  return {
    latestMonth,
    propertyCount: state.properties.length,
    roomCount: rooms.length,
    occupiedCount: occupied.length,
    received: billing.roundMoney(received),
    receivable: billing.roundMoney(receivable),
    overdueCount: bills.filter((item) => item.status === 'overdue').length,
    dueCount: bills.filter((item) => item.status === 'due').length,
    unboundCount: state.tenants.filter((item) => !item.wechatBound).length,
    recentBills
  }
}

function listProperties() {
  const state = getState()
  return state.properties.map((property) => {
    const occupied = property.rooms.filter((room) => room.status === 'occupied').length
    return Object.assign({}, property, { occupied, vacant: property.rooms.length - occupied })
  })
}

function listRooms() {
  const state = getState()
  return state.properties.reduce((rows, property) => {
    property.rooms.forEach((room) => {
      const tenant = state.tenants.find((item) => item.id === room.tenantId) || null
      rows.push(Object.assign({}, room, {
        propertyId: property.id,
        locationName: property.name,
        address: property.address,
        tenantName: tenant ? tenant.name : '',
        occupantCount: tenant ? tenant.occupantCount : 0,
        moveInDate: room.moveInDate || (tenant ? tenant.moveInDate || '' : ''),
        moveInDateDisplay: billing.formatMonthDay(room.moveInDate || (tenant ? tenant.moveInDate || '' : '')),
        collectionDay: billing.rentDay(room.moveInDate || (tenant ? tenant.moveInDate || '' : ''), state.settings && state.settings.dueDay)
      }))
    })
    return rows
  }, [])
}

function getProperty(id) {
  const state = getState()
  if (!state.auth || !state.auth.loggedIn || state.auth.role !== 'landlord') return null
  const property = state.properties.find((item) => item.id === id)
  if (!property) return null
  return Object.assign({}, property, {
    initial: property.name.slice(0, 1),
    rooms: property.rooms.map((room) => {
      const tenant = state.tenants.find((item) => item.id === room.tenantId) || null
      const pendingInvite = state.tenantInvites.find((item) => item.roomId === room.id && item.status === 'pending') || null
      const moveInDate = room.moveInDate || (tenant ? tenant.moveInDate || '' : '')
      const firstCycle = moveInDate ? billing.billingCycle(moveInDate.slice(0, 7), moveInDate, state.settings && state.settings.dueDay) : null
      return Object.assign({}, room, {
        moveInDate,
        moveInDateDisplay: billing.formatMonthDay(moveInDate) || '待设置',
        firstPeriodDisplay: firstCycle ? billing.formatPeriod(firstCycle.startDate, firstCycle.endDate) : '',
        firstDueDateDisplay: firstCycle ? billing.formatMonthDay(firstCycle.dueDate) : '',
        collectionDay: firstCycle ? firstCycle.collectionDay : 0,
        tenant: tenant ? Object.assign({}, tenant, {
          occupants: (tenant.occupants || []).map((item) => Object.assign({}, item, { mobileDisplay: item.mobile || '未填写', idCardDisplay: item.idCard || '待填写' })),
          profileComplete: tenant.profileStatus === 'completed'
        }) : null,
        pendingInvite
      })
    })
  })
}

function parseRoomNames(value) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[\n,，、;；]+/)
  return rows.map((item) => String(item || '').trim()).filter(Boolean)
}

function readRoomFees(payload) {
  const fields = [
    ['rent', '月租'],
    ['deposit', '押金'],
    ['waterRate', '水费单价'],
    ['electricRate', '电费单价']
  ]
  const values = {}
  fields.forEach(([key, label]) => {
    const value = Number(payload[key])
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label}不能小于 0`)
    values[key] = value
  })
  return values
}

function findLocation(state, locationName, address) {
  const normalizedName = locationName.toLowerCase()
  const normalizedAddress = address.toLowerCase()
  return state.properties.find((item) => {
    const sameName = String(item.name || '').trim().toLowerCase() === normalizedName
    const itemAddress = String(item.address || '').trim().toLowerCase()
    return sameName && (!normalizedAddress || !itemAddress || itemAddress === normalizedAddress)
  }) || null
}

function createLocation(state, locationName, address) {
  const property = {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: locationName,
    address,
    rooms: []
  }
  state.properties.unshift(property)
  return property
}

function addRooms(payload) {
  let result = null
  mutate((state) => {
    if (!state.auth || !state.auth.loggedIn || state.auth.role !== 'landlord') throw new Error('仅房东可新增房间')
    const locationName = String(payload.locationName || '').trim()
    const address = String(payload.address || '').trim()
    if (!locationName) throw new Error('请填写小区或楼栋')

    const moveInDate = String(payload.moveInDate || '').trim()
    if (moveInDate && !isValidDateValue(moveInDate)) throw new Error('请选择正确的入住日期')

    let property = state.properties.find((item) => item.id === payload.propertyId)
    if (!property) property = findLocation(state, locationName, address)
    if (!property) property = createLocation(state, locationName, address)
    if (!property.address && address) property.address = address

    const names = parseRoomNames(payload.roomNames || payload.name)
    if (!names.length) throw new Error('请至少填写一个房间号')
    const seen = new Set()
    names.forEach((name) => {
      const key = name.toLowerCase()
      if (seen.has(key)) throw new Error(`房间号 ${name} 重复填写`)
      seen.add(key)
      if (property.rooms.some((room) => String(room.name).trim().toLowerCase() === key)) {
        throw new Error(`该位置已有 ${name} 房间`)
      }
    })

    const fees = readRoomFees(payload)
    const stamp = Date.now()
    const rooms = names.map((name, index) => ({
      id: `r-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      rent: fees.rent,
      deposit: fees.deposit,
      waterRate: fees.waterRate,
      electricRate: fees.electricRate,
      status: 'vacant',
      tenantId: '',
      moveInDate
    }))
    property.rooms.push(...rooms)
    result = { propertyId: property.id, rooms: rooms.map((room) => Object.assign({}, room)), count: rooms.length }
  })
  return result
}

function addRoom(payload) {
  const result = addRooms(Object.assign({}, payload, { roomNames: [payload.name] }))
  return Object.assign({ propertyId: result.propertyId }, result.rooms[0])
}

function updateRoom(roomId, payload) {
  let result = null
  mutate((state) => {
    if (!state.auth || !state.auth.loggedIn || state.auth.role !== 'landlord') throw new Error('仅房东可修改房间')
    const context = roomContext(state, roomId)
    if (!context) throw new Error('房间不存在')

    const locationName = String(payload.locationName || '').trim()
    const address = String(payload.address || '').trim()
    const name = String(payload.name || '').trim()
    if (!locationName) throw new Error('请填写小区或楼栋')
    if (!name) throw new Error('请填写房间号')
    const fees = readRoomFees(payload)

    const currentProperty = context.property
    const sameLocation = String(currentProperty.name || '').trim().toLowerCase() === locationName.toLowerCase()
      && String(currentProperty.address || '').trim().toLowerCase() === address.toLowerCase()
    let targetProperty = currentProperty
    if (!sameLocation) {
      const matchingProperty = findLocation(state, locationName, address)
      if (matchingProperty && matchingProperty.id !== currentProperty.id) {
        targetProperty = matchingProperty
      } else if (currentProperty.rooms.length === 1) {
        currentProperty.name = locationName
        currentProperty.address = address
      } else {
        targetProperty = createLocation(state, locationName, address)
      }
    }

    const duplicate = targetProperty.rooms.some((room) => room.id !== roomId && String(room.name).trim().toLowerCase() === name.toLowerCase())
    if (duplicate) throw new Error(`该位置已有 ${name} 房间`)

    if (targetProperty.id !== currentProperty.id) {
      currentProperty.rooms = currentProperty.rooms.filter((room) => room.id !== roomId)
      targetProperty.rooms.push(context.room)
      if (!currentProperty.rooms.length) {
        state.properties = state.properties.filter((item) => item.id !== currentProperty.id)
      }
    }

    Object.assign(context.room, { name }, fees)
    result = { propertyId: targetProperty.id, room: Object.assign({}, context.room) }
  })
  return result
}

function updateRoomMoveInDate(roomId, value) {
  const moveInDate = readMoveInDate(value)
  mutate((state) => {
    if (!state.auth || !state.auth.loggedIn || state.auth.role !== 'landlord') throw new Error('仅房东可设置入住日期')
    const context = roomContext(state, roomId)
    if (!context) throw new Error('房间不存在')
    context.room.moveInDate = moveInDate
    if (context.tenant) {
      context.tenant.moveInDate = moveInDate
      syncTenantSummary(context.tenant)
    }
    const today = billing.dateKey()
    state.bills.filter((bill) => bill.roomId === roomId && (!context.tenant || !bill.tenantId || bill.tenantId === context.tenant.id)).forEach((bill) => {
      applyBillSchedule(state, bill, context.room)
      if (bill.status === 'paid' || bill.status === 'draft') return
      if (!context.tenant || !context.tenant.wechatBound) {
        bill.messageStatus = 'unbound'
      } else if (bill.messageStatus !== 'sent') {
        bill.messageStatus = bill.reminderDate <= today ? 'queued' : 'scheduled'
      }
      state.pendingMessages = state.pendingMessages.filter((id) => id !== bill.id)
      if (bill.messageStatus === 'queued') state.pendingMessages.push(bill.id)
    })
  })
  return moveInDate
}

function bindTenant(roomId, payload) {
  return mutate((state) => {
    const context = roomContext(state, roomId)
    if (!context) throw new Error('房间不存在')
    const moveInDate = readMoveInDate(payload.moveInDate || context.room.moveInDate)
    const tenant = {
      id: `t-${Date.now()}`,
      name: payload.name.trim(),
      mobile: payload.mobile.trim(),
      idCard: payload.idCard ? payload.idCard.trim().toUpperCase() : '',
      occupantCount: 1,
      profileStatus: payload.idCard ? 'completed' : 'pending',
      wechatBound: Boolean(payload.wechatBound),
      moveInDate,
      roomId,
      occupants: [{ id: `occupant-${Date.now()}-1`, name: payload.name.trim(), mobile: payload.mobile.trim(), idCard: payload.idCard ? payload.idCard.trim().toUpperCase() : '' }]
    }
    syncTenantSummary(tenant)
    state.tenants.push(tenant)
    context.room.tenantId = tenant.id
    context.room.status = 'occupied'
    context.room.moveInDate = moveInDate
    context.room.rent = Number(payload.rent) || context.room.rent
  })
}

function createTenantInvite(roomId) {
  let result = null
  mutate((state) => {
    const context = roomContext(state, roomId)
    if (!context) throw new Error('房间不存在')
    readMoveInDate(context.room.moveInDate)
    const existing = state.tenantInvites.find((item) => item.roomId === roomId && item.status === 'pending')
    if (existing) {
      existing.updatedAt = new Date().toISOString()
      result = Object.assign({}, existing)
      return
    }
    const invite = {
      id: `invite-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      roomId,
      tenantId: context.tenant ? context.tenant.id : '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    state.tenantInvites.unshift(invite)
    result = Object.assign({}, invite)
  })
  return result
}

function getTenantProfile(inviteId, tenantId) {
  const state = getState()
  const invite = inviteId ? state.tenantInvites.find((item) => item.id === inviteId) : null
  let tenant = invite
    ? (invite.tenantId ? state.tenants.find((item) => item.id === invite.tenantId) : null)
    : (tenantId ? state.tenants.find((item) => item.id === tenantId) : null)
  const roomId = invite ? invite.roomId : (tenant ? tenant.roomId : '')
  const context = roomId ? roomContext(state, roomId) : null
  if (!tenant && context) tenant = context.tenant
  if (!invite && !tenant) return null
  return {
    invite: invite ? Object.assign({}, invite) : null,
    property: context ? Object.assign({}, context.property) : null,
    room: context ? Object.assign({}, context.room) : null,
    tenant: tenant ? Object.assign({}, tenant) : null,
    form: {
      occupantCount: tenant ? tenant.occupantCount || 1 : 1,
      occupants: tenant
        ? (tenant.occupants || []).map((item, index) => ({ id: item.id || `occupant-${tenant.id}-${index + 1}`, name: item.name || '', mobile: item.mobile && !item.mobile.includes('*') ? item.mobile : '', idCard: item.idCard && !item.idCard.includes('*') ? item.idCard : '' }))
        : [{ id: `occupant-new-1`, name: '', mobile: '', idCard: '' }]
    }
  }
}

function submitTenantProfile(payload) {
  const occupantCount = Math.max(1, Math.min(6, Number(payload.occupantCount) || 1))
  const occupants = validateOccupants(payload.occupants, occupantCount)

  let tenantId = payload.tenantId || ''
  mutate((state) => {
    const invite = payload.inviteId ? state.tenantInvites.find((item) => item.id === payload.inviteId) : null
    const existingTenant = tenantId ? state.tenants.find((item) => item.id === tenantId) : null
    const roomId = invite ? invite.roomId : (existingTenant ? existingTenant.roomId : '')
    const context = roomId ? roomContext(state, roomId) : null
    if (!context) throw new Error('邀请已失效，请联系房东重新发送')
    const moveInDate = readMoveInDate(context.room.moveInDate || (context.tenant && context.tenant.moveInDate))
    let tenant = context.tenant || (invite ? null : existingTenant)
    if (!tenant) {
      tenant = { id: `t-${Date.now()}`, roomId }
      state.tenants.push(tenant)
    }
    Object.assign(tenant, { occupants, moveInDate, wechatBound: true, roomId })
    syncTenantSummary(tenant)
    tenantId = tenant.id
    context.room.tenantId = tenant.id
    context.room.status = 'occupied'
    context.room.moveInDate = moveInDate
    if (invite) Object.assign(invite, { tenantId: tenant.id, status: 'completed', completedAt: new Date().toISOString() })
    if (state.auth && state.auth.loggedIn && state.auth.role === 'tenant') {
      state.auth.tenantId = tenant.id
      state.auth.displayName = tenant.name
    }
  })
  return getTenantPortal(tenantId)
}

function updateTenantOccupant(tenantId, occupantId, payload) {
  return mutate((state) => {
    if (!state.auth || !state.auth.loggedIn || state.auth.role !== 'landlord') throw new Error('仅房东可修改住户资料')
    const tenant = state.tenants.find((item) => item.id === tenantId)
    if (!tenant) throw new Error('租客档案不存在')
    const occupants = (tenant.occupants || []).map(normalizeOccupant)
    const index = occupants.findIndex((item) => item.id === occupantId)
    if (index < 0) throw new Error('住户资料不存在')
    occupants[index] = normalizeOccupant(Object.assign({}, occupants[index], payload), index)
    validateOccupants(occupants, occupants.length)
    tenant.occupants = occupants
    syncTenantSummary(tenant)
  })
}

function removeTenantOccupant(tenantId, occupantId) {
  return mutate((state) => {
    if (!state.auth || !state.auth.loggedIn || state.auth.role !== 'landlord') throw new Error('仅房东可删减住户资料')
    const tenant = state.tenants.find((item) => item.id === tenantId)
    if (!tenant) throw new Error('租客档案不存在')
    const occupants = (tenant.occupants || []).map(normalizeOccupant)
    if (occupants.length <= 1) throw new Error('最后一位住户请通过退租结算处理')
    const next = occupants.filter((item) => item.id !== occupantId)
    if (next.length === occupants.length) throw new Error('住户资料不存在')
    if (!next.some((item) => /^1\d{10}$/.test(item.mobile))) throw new Error('至少保留一位有手机号的住户')
    tenant.occupants = next
    syncTenantSummary(tenant)
  })
}

function latestReading(state, roomId) {
  return state.readings.filter((item) => item.roomId === roomId).sort((a, b) => b.month.localeCompare(a.month))[0] || { water: 0, electric: 0, month: '' }
}

function resolveMeterMonth(state, room, fixedMonth) {
  if (fixedMonth) return fixedMonth
  const bills = state.bills.filter((item) => item.roomId === room.id).sort((a, b) => b.month.localeCompare(a.month))
  const openBill = bills.find((item) => item.status !== 'paid')
  if (openBill) return openBill.month
  if (bills.length) return billing.addMonths(bills[0].month, 1)
  return billing.monthKey()
}

function listMeterRooms(month) {
  const state = getState()
  const result = []
  state.properties.forEach((property) => property.rooms.filter((room) => room.status === 'occupied').forEach((room) => {
    const meterMonth = resolveMeterMonth(state, room, month)
    const previousMonth = billing.addMonths(meterMonth, -1)
    const tenant = state.tenants.find((item) => item.id === room.tenantId)
    const previous = state.readings.find((item) => item.roomId === room.id && item.month === previousMonth)
    const current = state.readings.find((item) => item.roomId === room.id && item.month === meterMonth)
    const currentSaved = Boolean(current && !current.carriedForward)
    result.push({
      id: room.id,
      month: meterMonth,
      previousMonth,
      propertyName: property.name,
      roomName: room.name,
      tenantName: tenant ? tenant.name : '未绑定',
      deposit: Number(room.deposit || 0),
      previous: previous || { water: '', electric: '', month: previousMonth },
      previousWater: previous ? previous.water : '',
      previousElectric: previous ? previous.electric : '',
      water: currentSaved ? current.water : '',
      electric: currentSaved ? current.electric : '',
      otherFee: currentSaved ? current.otherFee || 0 : 0,
      previousSaved: Boolean(previous),
      currentSaved,
      saved: Boolean(previous && currentSaved)
    })
  }))
  return result
}

function saveReading(payload) {
  let result = null
  mutate((state) => {
    const context = roomContext(state, payload.roomId)
    if (!context || !context.tenant) throw new Error('请先绑定租客')
    const roomReadings = state.readings.filter((item) => item.roomId === payload.roomId)
    const previous = roomReadings.filter((item) => item.month < payload.month).sort((a, b) => b.month.localeCompare(a.month))[0] || { water: 0, electric: 0 }
    const next = roomReadings.filter((item) => item.month > payload.month).sort((a, b) => a.month.localeCompare(b.month))[0] || null
    const water = Number(payload.water)
    const electric = Number(payload.electric)
    const otherFee = Number(payload.otherFee || 0)
    if (!Number.isFinite(water) || !Number.isFinite(electric) || water < 0 || electric < 0) throw new Error('请填写正确的水表和电表读数')
    if (!Number.isFinite(otherFee) || otherFee < 0) throw new Error('其他费用不能小于 0')
    if (water < Number(previous.water) || electric < Number(previous.electric)) throw new Error('本期读数不能小于上期读数')
    if (next && (water > Number(next.water) || electric > Number(next.electric))) throw new Error(`本期读数不能大于 ${next.month} 的读数`)
    const record = { id: `rd-${Date.now()}`, roomId: payload.roomId, month: payload.month, water, electric, otherFee }
    state.readings = state.readings.filter((item) => !(item.roomId === payload.roomId && item.month === payload.month))
    state.readings.push(record)
    result = upsertBillForRoom(state, context.room, payload.month)
    state.readings.filter((item) => item.roomId === payload.roomId && item.month > payload.month).sort((a, b) => a.month.localeCompare(b.month)).forEach((item) => {
      upsertBillForRoom(state, context.room, item.month)
    })
  })
  return result
}

function saveMeterReadings(payload) {
  let result = null
  mutate((state) => {
    const context = roomContext(state, payload.roomId)
    if (!context || !context.tenant) throw new Error('请先绑定租客')
    const month = String(payload.month || '')
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('抄表月份不正确')
    const previousMonth = billing.addMonths(month, -1)
    const roomReadings = state.readings.filter((item) => item.roomId === payload.roomId)
    const existingPrevious = roomReadings.find((item) => item.month === previousMonth)
    const existingCurrent = roomReadings.find((item) => item.month === month)
    const previousWater = existingPrevious ? Number(existingPrevious.water) : Number(payload.previousWater)
    const previousElectric = existingPrevious ? Number(existingPrevious.electric) : Number(payload.previousElectric)
    const water = Number(payload.water)
    const electric = Number(payload.electric)
    const otherFee = Number(payload.otherFee || 0)
    const values = [previousWater, previousElectric, water, electric]
    if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('请填写正确的上月和本月水电读数')
    if (!Number.isFinite(otherFee) || otherFee < 0) throw new Error('其他费用不能小于 0')

    const beforePrevious = roomReadings.filter((item) => item.month < previousMonth).sort((a, b) => b.month.localeCompare(a.month))[0] || { water: 0, electric: 0 }
    const afterCurrent = roomReadings.filter((item) => item.month > month).sort((a, b) => a.month.localeCompare(b.month))[0] || null
    if (previousWater < Number(beforePrevious.water) || previousElectric < Number(beforePrevious.electric)) throw new Error('上月读数不能小于更早一期读数')
    if (water < previousWater || electric < previousElectric) throw new Error('本月读数不能小于上月读数')
    if (afterCurrent && (water > Number(afterCurrent.water) || electric > Number(afterCurrent.electric))) throw new Error(`本月读数不能大于 ${afterCurrent.month} 的读数`)

    const stamp = Date.now()
    const previousRecord = existingPrevious || { id: `rd-${stamp}-previous`, roomId: payload.roomId, month: previousMonth, water: previousWater, electric: previousElectric, otherFee: 0 }
    const currentRecord = { id: existingCurrent ? existingCurrent.id : `rd-${stamp}-current`, roomId: payload.roomId, month, water, electric, otherFee, carriedForward: false }
    state.readings = state.readings.filter((item) => !(item.roomId === payload.roomId && (item.month === previousMonth || item.month === month)))
    state.readings.push(previousRecord, currentRecord)

    result = upsertBillForRoom(state, context.room, month)
    state.readings.filter((item) => item.roomId === payload.roomId && item.month > month).sort((a, b) => a.month.localeCompare(b.month)).forEach((item) => {
      upsertBillForRoom(state, context.room, item.month)
    })
  })
  return result
}

function upsertBillForRoom(state, room, month) {
  const readings = state.readings.filter((item) => item.roomId === room.id).sort((a, b) => b.month.localeCompare(a.month))
  const current = readings.find((item) => item.month === month)
  if (!current || !room.tenantId) return null
  const previous = readings.find((item) => item.month < month) || { water: current.water, electric: current.electric }
  const tenant = state.tenants.find((item) => item.id === room.tenantId)
  if (!tenant) return null
  const summary = billing.calculateBill(room, previous, current)
  const billId = `b-${room.id}-${month}`
  const existing = state.bills.find((item) => item.id === billId)
  const schedule = billSchedule(state, room, month, room.tenantId)
  const { dueDate, reminderDate, cycleStartDate, cycleEndDate, collectionDay } = schedule
  const isReminderTime = reminderDate <= billing.dateKey()
  const messageStatus = tenant.wechatBound ? (isReminderTime ? 'queued' : 'scheduled') : 'unbound'
  const bill = Object.assign({ id: billId, roomId: room.id, tenantId: room.tenantId, month, cycleStartDate, cycleEndDate, dueDate, reminderDate, collectionDay, status: 'due', paidAt: '', messageStatus }, summary)
  if (existing) {
    const settled = existing.status === 'paid' ? { status: existing.status, paidAt: existing.paidAt, payMethod: existing.payMethod } : null
    const delivered = existing.messageStatus === 'sent' ? { messageStatus: 'sent' } : null
    Object.assign(existing, bill)
    if (settled) Object.assign(existing, settled)
    if (delivered) Object.assign(existing, delivered)
  } else {
    state.bills.unshift(bill)
  }
  const savedBill = existing || bill
  state.pendingMessages = state.pendingMessages.filter((id) => id !== billId)
  if (savedBill.messageStatus === 'queued') state.pendingMessages.push(billId)
  return Object.assign({}, savedBill)
}

function generateMonthlyBills(month) {
  return mutate((state) => {
    state.properties.forEach((property) => property.rooms.filter((room) => room.status === 'occupied').forEach((room) => {
      upsertBillForRoom(state, room, month)
    }))
  })
}

function queueDueReminders(today) {
  const date = today || billing.dateKey()
  return mutate((state) => {
    state.bills.forEach((bill) => {
      if (bill.status === 'paid' || bill.status === 'draft' || bill.messageStatus === 'unbound' || bill.messageStatus === 'sent') return
      const context = roomContext(state, bill.roomId)
      if (context && !bill.reminderDate) applyBillSchedule(state, bill, context.room)
      const fallbackDueDate = bill.dueDate || billing.dueDate(bill.month, state.settings.dueDay)
      const reminderDate = bill.reminderDate || billing.addDays(fallbackDueDate, -Math.max(0, Number(state.settings.reminderDays) || 0))
      bill.reminderDate = reminderDate
      if (reminderDate <= date) {
        bill.messageStatus = 'queued'
        if (!state.pendingMessages.includes(bill.id)) state.pendingMessages.push(bill.id)
      } else {
        bill.messageStatus = 'scheduled'
        state.pendingMessages = state.pendingMessages.filter((id) => id !== bill.id)
      }
    })
  })
}

function listBills(filter) {
  const state = getState()
  return state.bills.filter((bill) => !filter || filter === 'all' || bill.status === filter).map((bill) => {
    const context = roomContext(state, bill.roomId)
    const tenant = state.tenants.find((item) => item.id === bill.tenantId) || (context ? context.tenant : null)
    return Object.assign({}, presentBill(state, bill, context), { roomName: context ? `${context.property.name} · ${context.room.name}` : bill.roomId, tenantName: tenant ? tenant.name : '未绑定' })
  }).sort((a, b) => b.dueDate.localeCompare(a.dueDate) || b.month.localeCompare(a.month))
}

function getBill(id) {
  const state = getState()
  const bill = state.bills.find((item) => item.id === id)
  if (!bill) return null
  const context = roomContext(state, bill.roomId)
  if (!context) return presentBill(state, bill, null)
  const tenant = state.tenants.find((item) => item.id === bill.tenantId) || context.tenant
  return Object.assign({}, presentBill(state, bill, context), { propertyId: context.property.id, propertyName: context.property.name, roomName: context.room.name, tenant })
}

function getStats(month) {
  const bills = listBills('all').filter((item) => !month || item.month === month)
  const received = bills.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.total, 0)
  const outstanding = bills.filter((item) => item.status !== 'paid').reduce((sum, item) => sum + item.total, 0)
  const total = received + outstanding
  const groups = {}
  bills.forEach((bill) => {
    const name = bill.roomName.split(' · ')[0]
    if (!groups[name]) groups[name] = { name, received: 0, outstanding: 0 }
    groups[name][bill.status === 'paid' ? 'received' : 'outstanding'] += bill.total
  })
  const properties = Object.keys(groups).map((key) => {
    const item = groups[key]
    item.received = billing.roundMoney(item.received)
    item.outstanding = billing.roundMoney(item.outstanding)
    item.rate = item.received + item.outstanding ? Math.round(item.received / (item.received + item.outstanding) * 100) : 0
    return item
  })
  return { month, received: billing.roundMoney(received), outstanding: billing.roundMoney(outstanding), total: billing.roundMoney(total), rate: total ? Math.round(received / total * 100) : 0, paidCount: bills.filter((item) => item.status === 'paid').length, billCount: bills.length, properties }
}

function getTenantPortal(tenantId) {
  const state = getState()
  const tenant = state.tenants.find((item) => item.id === tenantId)
  if (!tenant) return null
  const context = roomContext(state, tenant.roomId)
  const bills = state.bills.filter((item) => item.tenantId === tenant.id).map((bill) => presentBill(state, bill, context)).sort((a, b) => b.dueDate.localeCompare(a.dueDate))
  const due = bills.filter((item) => item.status === 'due' || item.status === 'overdue').reduce((sum, item) => sum + item.total, 0)
  return { tenant: Object.assign({}, tenant, { idCardMasked: maskIdCard(tenant.idCard), profileComplete: tenant.profileStatus === 'completed', moveInDateDisplay: billing.formatMonthDay(tenant.moveInDate), collectionDay: billing.rentDay(tenant.moveInDate, state.settings && state.settings.dueDay) }), property: context ? context.property : null, room: context ? context.room : null, bills, due: billing.roundMoney(due) }
}

function createNextBillingCycle(state, bill) {
  const context = roomContext(state, bill.roomId)
  if (!context || !context.tenant) return null
  const currentReading = state.readings.find((item) => item.roomId === bill.roomId && item.month === bill.month)
  if (!currentReading) return null
  const nextMonth = billing.addMonths(bill.month, 1)
  let nextReading = state.readings.find((item) => item.roomId === bill.roomId && item.month === nextMonth)
  if (!nextReading) {
    nextReading = {
      id: `rd-${Date.now()}-carry`,
      roomId: bill.roomId,
      month: nextMonth,
      water: Number(currentReading.water),
      electric: Number(currentReading.electric),
      otherFee: 0,
      carriedForward: true
    }
    state.readings.push(nextReading)
  }
  const existingNextBill = state.bills.find((item) => item.roomId === bill.roomId && item.month === nextMonth)
  const nextBillWasDraft = Boolean(existingNextBill && existingNextBill.status === 'draft')
  upsertBillForRoom(state, context.room, nextMonth)
  const nextBill = state.bills.find((item) => item.roomId === bill.roomId && item.month === nextMonth)
  if (!nextBill) return null
  if (nextReading.carriedForward && (!existingNextBill || nextBillWasDraft)) {
    nextBill.status = 'draft'
    nextBill.messageStatus = 'draft'
    nextBill.paidAt = ''
    delete nextBill.payMethod
    state.pendingMessages = state.pendingMessages.filter((billId) => billId !== nextBill.id)
  }
  return Object.assign({}, nextBill)
}

function markBillPaid(id, method) {
  let nextBill = null
  mutate((state) => {
    const bill = state.bills.find((item) => item.id === id)
    if (!bill) throw new Error('账单不存在')
    bill.status = 'paid'
    bill.paidAt = new Date().toISOString().slice(0, 10)
    bill.payMethod = method || 'wechat'
    state.pendingMessages = state.pendingMessages.filter((billId) => billId !== id)
    nextBill = createNextBillingCycle(state, bill)
  })
  return nextBill
}

function checkoutRoom(payload) {
  return mutate((state) => {
    const context = roomContext(state, payload.roomId)
    if (!context || !context.tenant) throw new Error('房间或租客不存在')
    const checkout = { id: `co-${Date.now()}`, roomId: payload.roomId, tenantId: context.tenant.id, date: payload.date, deposit: Number(payload.deposit || 0), deduction: Number(payload.deduction || 0), refund: billing.roundMoney(Number(payload.deposit || 0) - Number(payload.deduction || 0)), note: payload.note || '', status: 'completed' }
    state.checkouts.unshift(checkout)
    context.room.status = 'vacant'
    context.room.tenantId = ''
    context.room.moveInDate = ''
    context.tenant.roomId = ''
  })
}

function getSession() {
  const state = getState()
  return Object.assign({}, state.auth, { role: state.auth.role || state.currentRole })
}

function login(payload) {
  if (!payload || !['landlord', 'tenant'].includes(payload.role)) throw new Error('请选择登录身份')
  const state = mutate((draft) => {
    draft.currentRole = payload.role
    draft.auth = {
      loggedIn: true,
      role: payload.role,
      displayName: payload.displayName || (payload.role === 'landlord' ? (draft.profile.name || '房东用户') : '租客用户'),
      avatarUrl: payload.avatarUrl || '',
      tenantId: payload.role === 'tenant' ? (payload.tenantId || '') : ''
    }
  })
  return Object.assign({}, state.auth)
}

function logout() {
  const state = mutate((draft) => {
    draft.auth = { loggedIn: false, role: '', displayName: '', avatarUrl: '', tenantId: '' }
  })
  return Object.assign({}, state.auth)
}

function setRole(role) {
  return mutate((state) => {
    state.currentRole = role
    if (state.auth && state.auth.loggedIn) state.auth.role = role
  })
}
function exportBackup() { return JSON.stringify(getState()) }
function importBackup(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text || '').trim())
  } catch (error) {
    throw new Error('备份内容不完整，请重新复制')
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.properties)) throw new Error('备份格式不正确')
  const sourceVersion = Number(parsed.version || 1)
  if (sourceVersion > DATA_VERSION) throw new Error('备份版本较新，请先更新小程序')

  const current = initialize()
  const defaults = initialState()
  const restored = Object.assign({}, defaults, parsed, {
    version: DATA_VERSION,
    profile: Object.assign({}, defaults.profile, parsed.profile || {}),
    settings: Object.assign({}, defaults.settings, parsed.settings || {}),
    auth: current.auth && current.auth.loggedIn ? current.auth : Object.assign({}, defaults.auth, parsed.auth || {}),
    currentRole: current.auth && current.auth.loggedIn ? current.currentRole : (parsed.currentRole || defaults.currentRole),
    cloudUserId: current.cloudUserId || String(parsed.cloudUserId || '')
  })
  ;['properties', 'tenants', 'readings', 'bills', 'checkouts', 'tenantInvites', 'pendingMessages'].forEach((key) => {
    if (!Array.isArray(restored[key])) restored[key] = []
  })
  save(restored)
  return restored
}
function reset() { return save(initialState()) }

module.exports = { initialize, getState, bindCloudUser, getSession, login, logout, getDashboard, listProperties, listRooms, getProperty, addRoom, addRooms, updateRoom, updateRoomMoveInDate, bindTenant, createTenantInvite, getTenantProfile, submitTenantProfile, updateTenantOccupant, removeTenantOccupant, listMeterRooms, saveReading, saveMeterReadings, generateMonthlyBills, queueDueReminders, listBills, getBill, getStats, getTenantPortal, markBillPaid, checkoutRoom, setRole, exportBackup, importBackup, reset }
