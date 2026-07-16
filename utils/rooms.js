function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`请填写正确的${label}`)
  return number
}

function generateFloorRoomNames(payload) {
  const startFloor = positiveInteger(payload.startFloor, '起始楼层')
  const floorCount = positiveInteger(payload.floorCount, '楼层数量')
  const roomsPerFloor = positiveInteger(payload.roomsPerFloor, '每层房间数')
  if (floorCount > 100) throw new Error('楼层数量不能超过 100')
  if (roomsPerFloor > 99) throw new Error('每层房间数不能超过 99')
  if (startFloor + floorCount - 1 > 999) throw new Error('最高楼层不能超过 999')
  if (floorCount * roomsPerFloor > 999) throw new Error('一次最多生成 999 个房间')

  const names = []
  for (let floorOffset = 0; floorOffset < floorCount; floorOffset += 1) {
    const floor = startFloor + floorOffset
    for (let room = 1; room <= roomsPerFloor; room += 1) {
      names.push(`${floor}${String(room).padStart(2, '0')}`)
    }
  }
  return names
}

module.exports = { generateFloorRoomNames }
