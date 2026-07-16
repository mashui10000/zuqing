const backend = require('./services/backend')

App({
  globalData: {
    role: 'landlord',
    session: null,
    initialized: false,
    syncStatus: null
  },

  onLaunch() {
    const state = backend.initialize()
    this.globalData.role = state.currentRole
    this.globalData.session = backend.getSession()
    this.globalData.syncStatus = backend.getSyncStatus()
    this.globalData.initialized = true

    backend.onSyncStatus((status) => { this.globalData.syncStatus = status })
    backend.whenReady().then(() => {
      backend.queueDueReminders()
      this.globalData.role = backend.getState().currentRole
      this.globalData.session = backend.getSession()
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      const current = pages[pages.length - 1]
      if (current && typeof current.load === 'function') current.load()
    })
  },

  setSession(session) {
    this.globalData.session = session
    this.globalData.role = session && session.role ? session.role : ''
  }
})
