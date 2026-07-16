const BILL_TEMPLATE_ID = ''

function requestBillSubscription() {
  return new Promise((resolve) => {
    if (!BILL_TEMPLATE_ID || !wx.requestSubscribeMessage) {
      resolve({ configured: false, message: '订阅消息模板尚未配置，账单已加入待发送队列' })
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: [BILL_TEMPLATE_ID],
      success: (result) => resolve({ configured: true, result }),
      fail: () => resolve({ configured: true, denied: true })
    })
  })
}

module.exports = { requestBillSubscription }
