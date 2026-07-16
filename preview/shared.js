const q = (selector, root = document) => root.querySelector(selector)
const qa = (selector, root = document) => [...root.querySelectorAll(selector)]

function showToast(message) {
  const toast = q('.toast')
  if (!toast) return
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(window.__toastTimer)
  window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 1700)
}

let lastSheetTrigger = null

function openSheet(id) {
  const sheet = document.getElementById(id)
  if (!sheet) return
  lastSheetTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  sheet.classList.add('open')
  sheet.setAttribute('aria-hidden', 'false')
  requestAnimationFrame(() => q('input, textarea, select, button, [href]', sheet)?.focus())
}

function closeSheets() {
  let closed = false
  qa('.scrim.open').forEach((item) => {
    item.classList.remove('open')
    item.setAttribute('aria-hidden', 'true')
    closed = true
  })
  if (closed && lastSheetTrigger?.isConnected) lastSheetTrigger.focus()
  lastSheetTrigger = null
}

document.addEventListener('keydown', (event) => {
  const sheet = q('.scrim.open')
  if (!sheet) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSheets()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = qa('a[href], button:not(:disabled), input, textarea, select, [tabindex]:not([tabindex="-1"])', sheet)
    .filter((item) => item.getClientRects().length)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
})

let activePressable = null

function clearPressFeedback() {
  activePressable?.classList.remove('is-pressing')
  activePressable = null
}

document.addEventListener('pointerdown', (event) => {
  if (event.button !== undefined && event.button !== 0) return
  clearPressFeedback()
  activePressable = event.target.closest('button:not(:disabled), a.btn, .list-row, .icon-button, .role-choice, .setup-card, .guide-step-action, .room-date-control')
  activePressable?.classList.add('is-pressing')
}, { passive: true })

document.addEventListener('pointerup', clearPressFeedback, { passive: true })
document.addEventListener('pointercancel', clearPressFeedback, { passive: true })
document.addEventListener('scroll', clearPressFeedback, { passive: true, capture: true })

document.addEventListener('click', (event) => {
  if (event.target.classList.contains('scrim')) closeSheets()
  const filter = event.target.closest('[data-filter]')
  if (filter) {
    qa('[data-filter]').forEach((item) => {
      item.classList.remove('active')
      item.setAttribute('aria-selected', 'false')
    })
    filter.classList.add('active')
    filter.setAttribute('aria-selected', 'true')
    qa('[data-status]').forEach((row) => row.classList.toggle('hidden', filter.dataset.filter !== 'all' && row.dataset.status !== filter.dataset.filter))
  }
  const toastButton = event.target.closest('[data-toast]')
  if (toastButton) showToast(toastButton.dataset.toast)
})

function setupMeter() {
  const dynamicList = q('[data-preview-meter-list]')
  if (dynamicList) {
    const empty = q('[data-preview-meter-empty]')
    const summary = q('[data-meter-summary]')
    const progress = q('[data-meter-progress]')
    const month = previewMonthKey()
    const rooms = getPreviewRooms().filter((room) => room.tenantProfile)
    const readings = getPreviewReadings()
    const bills = getPreviewBills()
    const savedCount = rooms.filter((room) => readings.some((item) => item.roomId === room.id && item.month === month)).length
    if (summary) summary.textContent = `${savedCount} / ${rooms.length} 间已录入；保存读数即生成账单，到提醒日才通知租客。`
    if (progress) progress.style.width = `${rooms.length ? savedCount / rooms.length * 100 : 0}%`
    empty?.classList.toggle('hidden', rooms.length > 0)
    dynamicList.classList.toggle('hidden', rooms.length === 0)
    dynamicList.innerHTML = rooms.map((room) => {
      const history = readings.filter((item) => item.roomId === room.id && item.month < month).sort((a, b) => b.month.localeCompare(a.month))
      const previous = history[0] || { water: 0, electric: 0, month: '首次录入' }
      const current = readings.find((item) => item.roomId === room.id && item.month === month)
      return `<article class="surface form-card" data-preview-meter-room="${escapeHtml(room.id)}" data-od-id="preview-meter-${escapeHtml(room.id)}">
        <div class="between"><div><strong>${escapeHtml(room.locationName)} · ${escapeHtml(room.name)}</strong><small>${escapeHtml(room.tenantProfile.occupants?.[0]?.name || '住户')} · 上次 ${escapeHtml(previous.month)}</small></div><span class="status ${current ? 'paid' : 'draft'}">${current ? '已出账' : '待录入'}</span></div>
        <div class="field-grid"><div class="field"><label>水表 · 上次 ${escapeHtml(previous.water)}</label><input data-reading="water" data-previous="${escapeHtml(previous.water)}" inputmode="decimal" value="${current ? escapeHtml(current.water) : ''}" placeholder="本次读数"/></div><div class="field"><label>电表 · 上次 ${escapeHtml(previous.electric)}</label><input data-reading="electric" data-previous="${escapeHtml(previous.electric)}" inputmode="decimal" value="${current ? escapeHtml(current.electric) : ''}" placeholder="本次读数"/></div></div>
        <div class="usage-preview"><span>用水 0.0 吨</span><span>用电 0.0 度</span></div>
        <div class="preview-other-fee"><label>其他费用</label><input data-reading="otherFee" inputmode="decimal" value="${current ? escapeHtml(current.otherFee || 0) : '0'}"/></div>
        <button class="btn btn-secondary btn-block" data-save type="button">保存并生成账单</button>
      </article>`
    }).join('')
    qa('[data-preview-meter-room]', dynamicList).forEach((card) => {
      const water = q('[data-reading="water"]', card)
      const electric = q('[data-reading="electric"]', card)
      const otherFee = q('[data-reading="otherFee"]', card)
      const usage = q('.usage-preview', card)
      const update = () => {
        const waterUsage = Math.max(0, Number(water.value || 0) - Number(water.dataset.previous || 0))
        const electricUsage = Math.max(0, Number(electric.value || 0) - Number(electric.dataset.previous || 0))
        usage.innerHTML = `<span>用水 ${waterUsage.toFixed(1)} 吨</span><span>用电 ${electricUsage.toFixed(1)} 度</span>`
      }
      ;[water, electric].forEach((input) => input.addEventListener('input', update))
      update()
      q('[data-save]', card).addEventListener('click', () => {
        if (water.value === '' || electric.value === '') return showToast('请填写水表和电表读数')
        if (Number(water.value) < Number(water.dataset.previous) || Number(electric.value) < Number(electric.dataset.previous)) return showToast('本次读数不能小于上次读数')
        const room = rooms.find((item) => item.id === card.dataset.previewMeterRoom)
        const waterUsage = Number(water.value) - Number(water.dataset.previous)
        const electricUsage = Number(electric.value) - Number(electric.dataset.previous)
        const total = Number(room.rent) + waterUsage * Number(room.waterRate) + electricUsage * Number(room.electricRate) + Number(otherFee.value || 0)
        const reading = { roomId: room.id, month, water: Number(water.value), electric: Number(electric.value), otherFee: Number(otherFee.value || 0) }
        savePreviewReadings(readings.filter((item) => !(item.roomId === room.id && item.month === month)).concat(reading))
        const bill = { id: `preview-bill-${room.id}-${month}`, roomId: room.id, roomName: `${room.locationName} · ${room.name}`, tenantName: room.tenantProfile.occupants?.[0]?.name || '住户', month, total: Math.round(total * 100) / 100, status: 'due', dueDate: `${month}-05`, messageStatus: 'scheduled' }
        savePreviewBills(bills.filter((item) => item.id !== bill.id).concat(bill))
        q('.status', card).textContent = '已出账'
        q('.status', card).className = 'status paid'
        showToast('读数已保存，账单已生成')
      })
    })
    return
  }
  qa('.form-card').forEach((card) => {
    const inputs = qa('input[data-reading]', card)
    const preview = q('.usage-preview', card)
    const update = () => {
      const water = Math.max(0, Number(inputs[0].value || 0) - Number(inputs[0].dataset.previous || 0))
      const electric = Math.max(0, Number(inputs[1].value || 0) - Number(inputs[1].dataset.previous || 0))
      preview.innerHTML = `<span>用水 ${water.toFixed(1)} 吨</span><span>用电 ${electric.toFixed(1)} 度</span>`
    }
    inputs.forEach((input) => input.addEventListener('input', update))
    q('[data-save]', card)?.addEventListener('click', () => {
      if (inputs.some((input) => input.value === '')) return showToast('请填写水表和电表读数')
      if (inputs.some((input) => Number(input.value) < Number(input.dataset.previous))) return showToast('本次读数不能小于上次读数')
      card.querySelector('.status').textContent = '已出账'
      card.querySelector('.status').className = 'status paid'
      showToast('读数已保存，账单已生成')
    })
  })
}

function setupPayment() {
  const confirm = q('[data-confirm-pay]')
  if (!confirm) return
  confirm.addEventListener('click', () => {
    closeSheets()
    q('[data-due-card]')?.classList.add('hidden')
    q('[data-paid-success]')?.classList.remove('hidden')
    const status = q('[data-current-status]')
    if (status) { status.textContent = '已支付'; status.className = 'status paid' }
    showToast('支付成功，房东已收到通知')
  })
}

function setupRoleLogin() {
  const choices = qa('[data-role-choice]')
  const enter = q('[data-role-enter]')
  if (!choices.length || !enter) return
  const note = q('[data-role-note]')
  const update = (choice) => {
    choices.forEach((item) => item.classList.toggle('selected', item === choice))
    const role = choice.dataset.roleChoice
    const label = role === 'tenant' ? '租客' : '房东'
    enter.textContent = `微信快捷登录 · ${label}`
    enter.href = role === 'tenant' ? enter.dataset.tenantUrl : enter.dataset.landlordUrl
    if (note) note.textContent = role === 'tenant'
      ? '将进入租客端 · 查看本人账单、水电明细与支付记录'
      : '将进入房东端 · 管理房间、抄表、账单与收款'
  }
  choices.forEach((choice) => choice.addEventListener('click', () => update(choice)))
}

function setupTenantProfile() {
  const form = q('[data-tenant-profile-form]')
  if (!form) return
  const error = q('[data-profile-error]')
  const success = q('[data-profile-success]')
  const countSelect = q('[name="occupants"]', form)
  const list = q('[data-occupant-form-list]', form)
  const submit = q('[type="submit"]', form)
  const clearError = () => {
    if (error) error.textContent = ''
    qa('.is-invalid', form).forEach((item) => item.classList.remove('is-invalid'))
    qa('[aria-invalid="true"]', form).forEach((item) => item.removeAttribute('aria-invalid'))
    qa('.field-error-message', form).forEach((item) => item.remove())
  }
  const clearFieldError = (input) => {
    if (!input || !input.matches('input')) return
    input.classList.remove('is-invalid')
    input.removeAttribute('aria-invalid')
    input.closest('[data-occupant-card]')?.classList.remove('is-invalid')
    input.closest('label')?.querySelector('.field-error-message')?.remove()
    if (error && !q('input.is-invalid', form)) error.textContent = ''
  }
  const showError = (message, input) => {
    clearError()
    if (error) error.textContent = message
    if (!input) return
    input.classList.add('is-invalid')
    input.setAttribute('aria-invalid', 'true')
    const card = input.closest('[data-occupant-card]')
    if (card) card.classList.add('is-invalid')
    const inlineError = document.createElement('small')
    inlineError.className = 'field-error-message'
    inlineError.textContent = message
    input.closest('label')?.appendChild(inlineError)
    input.focus({ preventScroll: true })
    const rect = input.getBoundingClientRect()
    const top = Math.max(0, window.scrollY + rect.top - 104)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' })
    if (navigator.vibrate) navigator.vibrate(28)
  }
  const createCard = (index) => {
    const card = document.createElement('article')
    card.className = 'occupant-form-block'
    card.dataset.occupantCard = ''
    card.dataset.odId = `tenant-occupant-${index + 1}`
    card.innerHTML = `<div class="occupant-form-head"><strong>住户 ${index + 1}</strong><span>姓名、身份证必填</span></div><label>姓名<input name="occupantName" placeholder="请输入真实姓名"/></label><label>电话号码 <span class="optional-label">选填</span><input class="mono-input" name="occupantMobile" inputmode="numeric" maxlength="11" placeholder="无手机号可留空"/></label><label>身份证号<input class="mono-input" name="occupantIdCard" maxlength="18" placeholder="18 位身份证号"/></label>`
    if (index === 0) {
      q('[name="occupantName"]', card).value = form.dataset.defaultName || ''
      q('[name="occupantMobile"]', card).value = form.dataset.defaultMobile || ''
    }
    return card
  }
  const renderCount = () => {
    const count = Number(countSelect.value)
    while (list.children.length < count) list.appendChild(createCard(list.children.length))
    while (list.children.length > count) list.lastElementChild.remove()
    qa('[data-occupant-card]', list).forEach((card, index) => {
      q('.occupant-form-head strong', card).textContent = `住户 ${index + 1}`
      card.dataset.odId = `tenant-occupant-${index + 1}`
    })
    submit.textContent = `提交 ${count} 份资料给房东`
    clearError()
  }
  form.addEventListener('input', (event) => clearFieldError(event.target))
  countSelect.addEventListener('change', () => { renderCount(); showToast(`已生成 ${countSelect.value} 份资料卡`) })
  renderCount()
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const count = Number(countSelect.value)
    const cards = qa('[data-occupant-card]', list)
    const phones = []
    const occupants = []
    for (let index = 0; index < cards.length; index += 1) {
      const name = q('[name="occupantName"]', cards[index]).value.trim()
      const mobile = q('[name="occupantMobile"]', cards[index]).value.trim()
      const idCard = q('[name="occupantIdCard"]', cards[index]).value.trim().toUpperCase()
      if (!name) return showError(`请填写第 ${index + 1} 位住户姓名`, q('[name="occupantName"]', cards[index]))
      if (mobile && !/^1\d{10}$/.test(mobile)) return showError(`第 ${index + 1} 位住户手机号格式不正确`, q('[name="occupantMobile"]', cards[index]))
      if (!/^\d{17}[\dX]$/.test(idCard)) return showError(`请填写第 ${index + 1} 位住户的正确身份证号`, q('[name="occupantIdCard"]', cards[index]))
      if (mobile) phones.push(mobile)
      occupants.push({ name, mobile, idCard })
    }
    if (!phones.length) return showError('至少填写一位住户的 11 位手机号', q('[name="occupantMobile"]', cards[0]))
    const rooms = getPreviewRooms()
    if (rooms.length && !/^\d{4}-\d{2}-\d{2}$/.test(String(rooms[0].moveInDate || ''))) return showError('房东尚未设置入住日期，请联系房东确认')
    const profile = { occupants }
    submit.disabled = true
    submit.setAttribute('aria-busy', 'true')
    submit.textContent = '正在安全提交…'
    savePreviewTenantProfile(profile)
    if (rooms.length) {
      rooms[0].tenantProfile = profile
      savePreviewRooms(rooms)
    }
    form.classList.add('hidden')
    if (success) {
      success.classList.remove('hidden')
      q('[data-success-count]', success).textContent = count
    }
    showToast('资料已安全提交给房东')
  })
}

function setupLandlordOccupants() {
  const list = q('[data-landlord-occupant-list]')
  const editor = q('[data-occupant-editor]')
  if (!list || !editor) return
  const editorForm = q('form', editor)
  let currentCard = null
  const updateCount = () => { const count = q('[data-landlord-count]'); if (count) count.textContent = `${qa('[data-landlord-occupant]', list).length} 人` }
  list.addEventListener('click', (event) => {
    const card = event.target.closest('[data-landlord-occupant]')
    if (!card) return
    if (event.target.closest('[data-edit-occupant]')) {
      currentCard = card
      q('[name="editName"]', editorForm).value = q('[data-person-name]', card).textContent
      q('[name="editMobile"]', editorForm).value = q('[data-person-mobile]', card).textContent === '未填写' ? '' : q('[data-person-mobile]', card).textContent
      q('[name="editIdCard"]', editorForm).value = q('[data-person-id]', card).textContent
      editor.classList.add('open')
    }
    if (event.target.closest('[data-remove-occupant]')) {
      const cards = qa('[data-landlord-occupant]', list)
      if (cards.length <= 1) return showToast('最后一位住户请通过退租处理')
      if (!window.confirm(`确认删减 ${q('[data-person-name]', card).textContent}？`)) return
      card.remove()
      updateCount()
      showToast('已删减住户')
    }
  })
  editorForm.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!currentCard) return
    const name = q('[name="editName"]', editorForm).value.trim()
    const mobile = q('[name="editMobile"]', editorForm).value.trim()
    const idCard = q('[name="editIdCard"]', editorForm).value.trim().toUpperCase()
    if (!name) return showToast('请填写住户姓名')
    if (mobile && !/^1\d{10}$/.test(mobile)) return showToast('手机号格式不正确')
    if (!/^\d{17}[\dX]$/.test(idCard)) return showToast('身份证号格式不正确')
    const otherPhones = qa('[data-person-mobile]', list).filter((node) => node !== q('[data-person-mobile]', currentCard)).map((node) => node.textContent)
    if (!mobile && !otherPhones.some((value) => /^1\d{10}$/.test(value))) return showToast('至少保留一位有效手机号')
    q('[data-person-name]', currentCard).textContent = name
    q('[data-person-mobile]', currentCard).textContent = mobile || '未填写'
    q('[data-person-id]', currentCard).textContent = idCard
    closeSheets()
    showToast('住户资料已更新')
  })
  updateCount()
}

const PREVIEW_ROOMS_KEY = 'rentflow_preview_rooms_v1'
const PREVIEW_TENANT_PROFILE_KEY = 'rentflow_preview_tenant_profile_v1'
const PREVIEW_READINGS_KEY = 'rentflow_preview_readings_v1'
const PREVIEW_BILLS_KEY = 'rentflow_preview_bills_v1'

function previewMonthKey() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function getPreviewCollection(key) {
  try {
    const rows = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(rows) ? rows : []
  } catch (error) {
    return []
  }
}

function savePreviewCollection(key, rows) {
  try { localStorage.setItem(key, JSON.stringify(rows)) } catch (error) {}
}

function getPreviewReadings() { return getPreviewCollection(PREVIEW_READINGS_KEY) }
function savePreviewReadings(rows) { savePreviewCollection(PREVIEW_READINGS_KEY, rows) }
function getPreviewBills() { return getPreviewCollection(PREVIEW_BILLS_KEY) }
function savePreviewBills(rows) { savePreviewCollection(PREVIEW_BILLS_KEY, rows) }

function getPreviewTenantProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PREVIEW_TENANT_PROFILE_KEY) || 'null')
    return profile && typeof profile === 'object' ? profile : null
  } catch (error) {
    return null
  }
}

function savePreviewTenantProfile(profile) {
  try { localStorage.setItem(PREVIEW_TENANT_PROFILE_KEY, JSON.stringify(profile)) } catch (error) {}
}

function getPreviewRooms() {
  try {
    const rows = JSON.parse(localStorage.getItem(PREVIEW_ROOMS_KEY) || '[]')
    return Array.isArray(rows) ? rows.map((room) => Object.assign({}, room, {
      moveInDate: /^\d{4}-\d{2}-\d{2}$/.test(String(room.moveInDate || '')) ? room.moveInDate : (room.tenantProfile && room.tenantProfile.moveInDate || '')
    })) : []
  } catch (error) {
    return []
  }
}

function savePreviewRooms(rooms) {
  try { localStorage.setItem(PREVIEW_ROOMS_KEY, JSON.stringify(rooms)) } catch (error) {}
}

function parseRoomNames(value) {
  return String(value || '').split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean)
}

function generateFloorRoomNames(startFloorValue, floorCountValue, roomsPerFloorValue) {
  const values = [
    [Number(startFloorValue), '起始楼层'],
    [Number(floorCountValue), '楼层数量'],
    [Number(roomsPerFloorValue), '每层房间数']
  ]
  values.forEach(([value, label]) => {
    if (!Number.isInteger(value) || value < 1) throw new Error(`请填写正确的${label}`)
  })
  const [startFloor, floorCount, roomsPerFloor] = values.map(([value]) => value)
  if (floorCount > 100) throw new Error('楼层数量不能超过 100')
  if (roomsPerFloor > 99) throw new Error('每层房间数不能超过 99')
  if (startFloor + floorCount - 1 > 999) throw new Error('最高楼层不能超过 999')
  if (floorCount * roomsPerFloor > 999) throw new Error('一次最多生成 999 个房间')
  const names = []
  for (let floorOffset = 0; floorOffset < floorCount; floorOffset += 1) {
    const floor = startFloor + floorOffset
    for (let room = 1; room <= roomsPerFloor; room += 1) names.push(`${floor}${String(room).padStart(2, '0')}`)
  }
  return names
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function setupRoomCreate() {
  const form = q('[data-room-create-form]')
  if (!form) return
  const success = q('[data-room-create-success]')
  const successTitle = q('[data-room-success-title]', success)
  const payment = q('[data-first-payment]', form)
  const count = q('[data-room-count]', form)
  const submit = q('[data-room-submit]', form)
  const generatorButton = q('[data-generate-floor-rooms]', form)
  const floorPreview = q('[data-floor-preview]', form)
  const error = q('[data-room-create-error]', form)
  const moneyFields = ['rent', 'deposit']
  const allNumericFields = ['rent', 'deposit', 'waterRate', 'electricRate']
  const clearRoomError = (input) => {
    input?.classList.remove('is-invalid')
    input?.removeAttribute('aria-invalid')
    if (error && !q('[aria-invalid="true"]', form)) error.textContent = ''
  }
  const showRoomError = (message, input) => {
    if (error) error.textContent = message
    if (input) {
      input.classList.add('is-invalid')
      input.setAttribute('aria-invalid', 'true')
      input.focus({ preventScroll: true })
    }
    showToast(message)
  }
  const updateCount = () => {
    const names = parseRoomNames(form.elements.roomNames.value)
    const uniqueCount = new Set(names.map((item) => item.toLowerCase())).size
    count.textContent = `已识别 ${uniqueCount} 个`
    submit.textContent = uniqueCount ? `确认新增 ${uniqueCount} 个房间` : '确认新增房间'
  }
  const updatePayment = () => {
    const total = moneyFields.reduce((sum, name) => sum + Number(form.elements[name].value || 0), 0)
    payment.textContent = `¥${total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  form.addEventListener('input', (event) => {
    clearRoomError(event.target)
    if (moneyFields.includes(event.target.name)) updatePayment()
    if (event.target.name === 'roomNames') {
      updateCount()
      if (floorPreview) {
        floorPreview.textContent = '房间号已手动调整'
        floorPreview.classList.add('is-ready')
      }
    }
  })
  generatorButton?.addEventListener('click', () => {
    try {
      const names = generateFloorRoomNames(form.elements.startFloor.value, form.elements.floorCount.value, form.elements.roomsPerFloor.value)
      form.elements.roomNames.value = names.join('\n')
      updateCount()
      if (floorPreview) {
        floorPreview.textContent = `已生成 ${names.length} 个房间：${names[0]} — ${names[names.length - 1]}`
        floorPreview.classList.add('is-ready')
      }
      if (navigator.vibrate) navigator.vibrate(10)
      showToast(`已生成 ${names.length} 个房间`)
    } catch (error) {
      showToast(error.message)
    }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const locationName = form.elements.locationName
    const roomNames = form.elements.roomNames
    if (!locationName.value.trim()) {
      return showRoomError('请填写小区或楼栋', locationName)
    }
    const names = parseRoomNames(roomNames.value)
    if (!names.length) {
      return showRoomError('请至少填写一个房间号', roomNames)
    }
    const nameKeys = names.map((item) => item.toLowerCase())
    if (new Set(nameKeys).size !== nameKeys.length) {
      return showRoomError('房间号不能重复', roomNames)
    }
    for (const name of allNumericFields) {
      const input = form.elements[name]
      if (input.value === '' || !Number.isFinite(Number(input.value)) || Number(input.value) < 0) {
        return showRoomError('收费金额不能留空或小于 0', input)
      }
    }
    const location = locationName.value.trim()
    const address = form.elements.address.value.trim()
    const savedRooms = getPreviewRooms()
    const conflict = names.find((name) => savedRooms.some((room) => room.locationName.toLowerCase() === location.toLowerCase() && room.name.toLowerCase() === name.toLowerCase()))
    if (conflict) {
      return showRoomError(`该位置已有 ${conflict} 房间`, roomNames)
    }
    const stamp = Date.now()
    const shared = {
      locationName: location,
      address,
      rent: Number(form.elements.rent.value),
      deposit: Number(form.elements.deposit.value),
      waterRate: Number(form.elements.waterRate.value),
      electricRate: Number(form.elements.electricRate.value)
    }
    const created = names.map((name, index) => ({ ...shared, id: `preview-room-${stamp}-${index}`, name, moveInDate: '' }))
    const tenantProfile = getPreviewTenantProfile()
    if (tenantProfile && !savedRooms.some((room) => room.tenantProfile) && created.length) created[0].tenantProfile = tenantProfile
    submit.disabled = true
    submit.setAttribute('aria-busy', 'true')
    submit.textContent = '正在保存…'
    savePreviewRooms(savedRooms.concat(created))
    form.classList.add('hidden')
    success?.classList.remove('hidden')
    if (successTitle) successTitle.textContent = `${created.length} 个房间已新增`
    showToast(`已新增 ${created.length} 个房间`)
  })
  updatePayment()
  updateCount()
}

function setupPreviewRoomList() {
  const list = q('[data-preview-room-list]')
  const empty = q('[data-preview-room-empty]')
  const filterEmpty = q('[data-preview-room-filter-empty]')
  const filters = q('[data-preview-room-filters]')
  const locationFilters = q('[data-preview-room-location-filters]')
  const statusFilters = q('[data-preview-room-status-filters]')
  const form = q('[data-preview-room-edit-form]')
  if (!list || !empty || !filterEmpty || !filters || !locationFilters || !statusFilters || !form) return
  let activeLocation = 'all'
  let activeStatus = 'all'
  const error = q('[data-room-edit-error]', form)
  const clearRoomEditError = (input) => {
    input?.classList.remove('is-invalid')
    input?.removeAttribute('aria-invalid')
    if (error && !q('[aria-invalid="true"]', form)) error.textContent = ''
  }
  const showRoomEditError = (message, input) => {
    if (error) error.textContent = message
    if (input) {
      input.classList.add('is-invalid')
      input.setAttribute('aria-invalid', 'true')
      input.focus({ preventScroll: true })
    }
    showToast(message)
  }

  const render = () => {
    const rooms = getPreviewRooms()
    const locationCounts = new Map()
    rooms.forEach((room) => locationCounts.set(room.locationName, (locationCounts.get(room.locationName) || 0) + 1))
    const locationOptions = [
      { value: 'all', label: '全部房间', count: rooms.length },
      ...Array.from(locationCounts, ([value, count]) => ({ value, label: value, count }))
    ]
    if (!locationOptions.some((item) => item.value === activeLocation)) activeLocation = 'all'
    const occupiedCount = rooms.filter((room) => Boolean(room.tenantProfile)).length
    const statusOptions = [
      { value: 'all', label: '全部', count: rooms.length },
      { value: 'occupied', label: '在租', count: occupiedCount },
      { value: 'vacant', label: '空置', count: rooms.length - occupiedCount }
    ]
    const visibleRooms = rooms.filter((room) => {
      const status = room.tenantProfile ? 'occupied' : 'vacant'
      return (activeLocation === 'all' || room.locationName === activeLocation) && (activeStatus === 'all' || status === activeStatus)
    })
    locationFilters.innerHTML = locationOptions.map((item, index) => `<button class="room-filter-hit${activeLocation === item.value ? ' active' : ''}" type="button" aria-pressed="${activeLocation === item.value}" data-room-location-filter="${escapeHtml(encodeURIComponent(item.value))}" data-od-id="room-location-filter-${index}"><span class="room-filter-pill location-filter"><span>${escapeHtml(item.label)}</span><span class="room-filter-count">${item.count}</span></span></button>`).join('')
    statusFilters.innerHTML = statusOptions.map((item) => `<button class="room-filter-hit${activeStatus === item.value ? ' active' : ''}" type="button" aria-pressed="${activeStatus === item.value}" data-room-status-filter="${item.value}" data-od-id="room-status-filter-${item.value}"><span class="room-filter-pill"><span>${item.label}</span><span class="room-filter-count">${item.count}</span></span></button>`).join('')
    filters.classList.toggle('hidden', rooms.length === 0)
    list.classList.toggle('hidden', visibleRooms.length === 0)
    empty.classList.toggle('hidden', rooms.length > 0)
    filterEmpty.classList.toggle('hidden', rooms.length === 0 || visibleRooms.length > 0)
    list.innerHTML = visibleRooms.map((room) => `
      <article class="surface room-preview-card" aria-labelledby="preview-room-title-${escapeHtml(room.id)}" data-od-id="preview-room-${escapeHtml(room.id)}">
        <div class="between"><div><span class="eyebrow">${escapeHtml(room.locationName)}</span><h2 id="preview-room-title-${escapeHtml(room.id)}">${escapeHtml(room.name)} 房间</h2></div><button class="room-edit-button" type="button" data-preview-room-edit="${escapeHtml(room.id)}" aria-label="修改 ${escapeHtml(room.name)} 房间">修改</button></div>
        <p>${escapeHtml(room.address || '未填写详细地址')}</p>
        <label class="room-date-control">入住日期 <small>由房东确认</small><input type="date" data-preview-room-date="${escapeHtml(room.id)}" value="${escapeHtml(room.moveInDate || '')}" aria-label="${escapeHtml(room.name)} 房间入住日期"/></label>
        ${room.tenantProfile ? `<div class="room-tenancy-summary"><span>住户资料</span><b>${escapeHtml(room.tenantProfile.occupants?.length || 0)} 人</b></div>` : ''}
        <div class="room-preview-fees"><span>月租 <b>¥${escapeHtml(room.rent)}</b></span><span>押金 <b>¥${escapeHtml(room.deposit)}</b></span><span>水费 <b>¥${escapeHtml(room.waterRate)} / 吨</b></span><span>电费 <b>¥${escapeHtml(room.electricRate)} / 度</b></span></div>
      </article>`).join('')
  }

  filters.addEventListener('click', (event) => {
    const locationButton = event.target.closest('[data-room-location-filter]')
    const statusButton = event.target.closest('[data-room-status-filter]')
    if (locationButton) activeLocation = decodeURIComponent(locationButton.dataset.roomLocationFilter)
    if (statusButton) activeStatus = statusButton.dataset.roomStatusFilter
    if (locationButton || statusButton) render()
  })

  q('[data-clear-room-filters]', filterEmpty)?.addEventListener('click', () => {
    activeLocation = 'all'
    activeStatus = 'all'
    render()
  })

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preview-room-edit]')
    if (!button) return
    const room = getPreviewRooms().find((item) => item.id === button.dataset.previewRoomEdit)
    if (!room) return
    form.dataset.roomId = room.id
    form.elements.locationName.value = room.locationName
    form.elements.address.value = room.address || ''
    form.elements.roomName.value = room.name
    ;['rent', 'deposit', 'waterRate', 'electricRate'].forEach((name) => { form.elements[name].value = room[name] })
    qa('[aria-invalid="true"]', form).forEach((input) => clearRoomEditError(input))
    openSheet('preview-room-edit-sheet')
  })

  list.addEventListener('change', (event) => {
    const input = event.target.closest('[data-preview-room-date]')
    if (!input) return
    const rooms = getPreviewRooms()
    const index = rooms.findIndex((item) => item.id === input.dataset.previewRoomDate)
    if (index < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return showToast('请选择正确的入住日期')
    rooms[index].moveInDate = input.value
    savePreviewRooms(rooms)
    showToast('入住日期已由房东更新')
  })

  form.addEventListener('input', (event) => {
    clearRoomEditError(event.target)
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const submit = q('[data-room-edit-submit]', form)
    const rooms = getPreviewRooms()
    const index = rooms.findIndex((item) => item.id === form.dataset.roomId)
    if (index < 0) return closeSheets()
    const locationName = form.elements.locationName.value.trim()
    const name = form.elements.roomName.value.trim()
    if (!locationName || !name) {
      const input = !locationName ? form.elements.locationName : form.elements.roomName
      return showRoomEditError('请填写位置和房间号', input)
    }
    const numericFields = ['rent', 'deposit', 'waterRate', 'electricRate']
    for (const field of numericFields) {
      const input = form.elements[field]
      if (input.value === '' || !Number.isFinite(Number(input.value)) || Number(input.value) < 0) {
        return showRoomEditError('收费金额不能留空或小于 0', input)
      }
    }
    const conflict = rooms.some((room, roomIndex) => roomIndex !== index && room.locationName.toLowerCase() === locationName.toLowerCase() && room.name.toLowerCase() === name.toLowerCase())
    if (conflict) return showRoomEditError(`该位置已有 ${name} 房间`, form.elements.roomName)
    rooms[index] = {
      ...rooms[index],
      locationName,
      address: form.elements.address.value.trim(),
      name,
      rent: Number(form.elements.rent.value),
      deposit: Number(form.elements.deposit.value),
      waterRate: Number(form.elements.waterRate.value),
      electricRate: Number(form.elements.electricRate.value)
    }
    if (submit) {
      submit.disabled = true
      submit.setAttribute('aria-busy', 'true')
      submit.textContent = '正在保存…'
    }
    try {
      savePreviewRooms(rooms)
      closeSheets()
      render()
      showToast('当前房间已更新')
    } finally {
      if (submit) {
        submit.disabled = false
        submit.removeAttribute('aria-busy')
        submit.textContent = '保存当前房间'
      }
    }
  })
  q('[data-close-sheet]', form)?.addEventListener('click', closeSheets)
  render()
}

function setupPreviewBills() {
  const list = q('[data-preview-bill-list]')
  const empty = q('[data-preview-bill-empty]')
  if (!list || !empty) return
  const totalNode = q('[data-preview-bills-total]')
  const subtitle = q('[data-preview-bills-subtitle]')
  const emptyTitle = q('h2', empty)
  const emptyCopy = q('p', empty)
  const emptyAction = q('.btn', empty)
  const currentMonth = previewMonthKey()
  let activeScope = 'current'
  const render = () => {
    const bills = getPreviewBills().slice().reverse().filter((bill) => activeScope === 'current' ? bill.month === currentMonth : bill.month !== currentMonth)
    const total = bills.filter((bill) => bill.status !== 'paid').reduce((sum, bill) => sum + Number(bill.total || 0), 0)
    const selectedFilter = q('[data-filter].active')?.dataset.filter || 'all'
    if (totalNode) totalNode.textContent = `¥${total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    if (subtitle) subtitle.textContent = bills.length ? `${bills.length} 笔${activeScope === 'current' ? '本月' : '历史'}账单；抄表保存后即时生成，到提醒日才通知租客。` : activeScope === 'current' ? '暂无本月账单。新增房间并完成抄表后，账单会自动生成。' : '暂无历史账单。'
    if (emptyTitle) emptyTitle.textContent = activeScope === 'current' ? '暂无本月账单' : '暂无历史账单'
    if (emptyCopy) emptyCopy.textContent = activeScope === 'current' ? '请先新增房间，登记租客并完成本月抄表。' : '已生成的往期账单会按月份显示在这里。'
    emptyAction?.classList.toggle('hidden', activeScope !== 'current')
    empty.classList.toggle('hidden', bills.length > 0)
    list.classList.toggle('hidden', bills.length === 0)
    list.innerHTML = bills.map((bill) => `<article class="surface preview-bill-card${selectedFilter !== 'all' && bill.status !== selectedFilter ? ' hidden' : ''}" data-status="${escapeHtml(bill.status)}" data-od-id="${escapeHtml(bill.id)}"><div><strong>${escapeHtml(bill.roomName)}</strong><small>${escapeHtml(bill.tenantName)} · ${escapeHtml(bill.month)} · ${escapeHtml(bill.dueDate)} 到期</small></div><span class="mono">¥${Number(bill.total).toFixed(2)}</span></article>`).join('')
  }
  qa('[data-bill-scope]').forEach((button) => button.addEventListener('click', () => {
    activeScope = button.dataset.billScope
    qa('[data-bill-scope]').forEach((item) => {
      const active = item === button
      item.classList.toggle('active', active)
      item.setAttribute('aria-selected', String(active))
    })
    render()
  }))
  render()
}

window.addEventListener('DOMContentLoaded', () => {
  qa('.toast').forEach((toast) => {
    toast.setAttribute('role', 'status')
    toast.setAttribute('aria-live', 'polite')
    toast.setAttribute('aria-atomic', 'true')
  })
  setupMeter()
  setupPayment()
  setupRoleLogin()
  setupTenantProfile()
  setupLandlordOccupants()
  setupRoomCreate()
  setupPreviewRoomList()
  setupPreviewBills()
})
Object.assign(window, { showToast, openSheet, closeSheets })
