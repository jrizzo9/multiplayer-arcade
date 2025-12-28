import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Disable browser/system notifications - only UI notifications allowed
if (typeof window !== 'undefined') {
  // Override Notification constructor to prevent browser notifications
  if (window.Notification) {
    window.Notification = function() {
      console.warn('Browser notifications are disabled. Use UI notifications instead.')
      throw new Error('Browser notifications are not allowed. Use UI notifications instead.')
    }
    window.Notification.requestPermission = function() {
      return Promise.resolve('denied')
    }
    window.Notification.permission = 'denied'
  }
  
  // Prevent service worker registration for notifications
  if (navigator.serviceWorker) {
    const originalRegister = navigator.serviceWorker.register
    navigator.serviceWorker.register = function() {
      console.warn('Service worker registration is disabled to prevent notification permissions.')
      return Promise.reject(new Error('Service workers are disabled'))
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

