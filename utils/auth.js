const backend = require('../services/backend')

function destination(role) {
  return role === 'tenant' ? '/pages/tenant/home' : '/pages/home/home'
}

function requireRole(role) {
  const session = backend.getSession()
  if (!session.loggedIn) {
    wx.reLaunch({ url: '/pages/login/index' })
    return null
  }
  if (role && session.role !== role) {
    wx.reLaunch({ url: destination(session.role) })
    return null
  }
  return session
}

function signOut() {
  const session = backend.logout()
  getApp().setSession(session)
  wx.reLaunch({ url: '/pages/login/index' })
}

module.exports = { requireRole, signOut, destination }
