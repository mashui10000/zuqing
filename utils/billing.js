function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function calculateBill(room, previous, current) {
  const waterUsage = Math.max(0, Number(current.water) - Number(previous.water))
  const electricUsage = Math.max(0, Number(current.electric) - Number(previous.electric))
  const rent = roundMoney(room.rent)
  const waterFee = roundMoney(waterUsage * Number(room.waterRate))
  const electricFee = roundMoney(electricUsage * Number(room.electricRate))
  const otherFee = roundMoney(current.otherFee || 0)
  return {
    rent,
    waterUsage: roundMoney(waterUsage),
    electricUsage: roundMoney(electricUsage),
    waterFee,
    electricFee,
    otherFee,
    total: roundMoney(rent + waterFee + electricFee + otherFee)
  }
}

function monthKey(date) {
  const value = date ? new Date(date) : new Date()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  return `${value.getFullYear()}-${month}`
}

function addMonths(month, offset) {
  const parts = String(month || '').split('-').map(Number)
  return monthKey(new Date(parts[0], parts[1] - 1 + Number(offset || 0), 1))
}

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate()
}

function dueDate(month, day) {
  const parts = month.split('-').map(Number)
  const safeDay = Math.min(Math.max(1, Number(day) || 5), daysInMonth(parts[0], parts[1]))
  return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

function dateKey(date) {
  const value = date ? new Date(date) : new Date()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

function addDays(value, offset) {
  const parts = String(value || '').split('-').map(Number)
  const date = new Date(parts[0], parts[1] - 1, parts[2])
  date.setDate(date.getDate() + Number(offset || 0))
  return dateKey(date)
}

function addCalendarMonths(value, offset, anchorDay) {
  const parts = String(value || '').split('-').map(Number)
  const target = new Date(parts[0], parts[1] - 1 + Number(offset || 0), 1)
  const day = Math.min(Math.max(1, Number(anchorDay) || parts[2] || 1), daysInMonth(target.getFullYear(), target.getMonth() + 1))
  target.setDate(day)
  return dateKey(target)
}

function rentDay(moveInDate, fallbackDay) {
  const parts = String(moveInDate || '').split('-').map(Number)
  return Math.min(31, Math.max(1, parts[2] || Number(fallbackDay) || 5))
}

function billingCycle(month, moveInDate, fallbackDay) {
  const collectionDay = rentDay(moveInDate, fallbackDay)
  const startDate = dueDate(month, collectionDay)
  const collectionDate = addCalendarMonths(startDate, 1, collectionDay)
  return {
    startDate,
    endDate: addDays(collectionDate, -1),
    dueDate: collectionDate,
    collectionDay
  }
}

function formatMonthDay(value) {
  const parts = String(value || '').split('-').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return ''
  return `${parts[1]}月${parts[2]}日`
}

function formatPeriod(startDate, endDate) {
  const start = formatMonthDay(startDate)
  const end = formatMonthDay(endDate)
  return start && end ? `${start}—${end}` : ''
}

function reminderDate(month, day, daysBefore) {
  return addDays(dueDate(month, day), -Math.max(0, Number(daysBefore) || 0))
}

module.exports = { roundMoney, calculateBill, monthKey, addMonths, daysInMonth, dueDate, dateKey, addDays, addCalendarMonths, rentDay, billingCycle, formatMonthDay, formatPeriod, reminderDate }
