import { useState, useEffect, useCallback } from 'react'
import './App.css'

// Security constants
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB limit
const MAX_NOTE_LENGTH = 5000
const MAX_ITEMS = 100
const SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes

// Allowed file types for security
const ALLOWED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv', 'text/html', 'text/css', 'text/javascript',
  'application/json',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-rar-compressed',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
  'video/mp4', 'video/webm', 'video/ogg'
]

// Simple hash function for password (client-side only)
const hashPassword = async (password) => {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'life_goes_on_salt_2024')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Sanitize text to prevent XSS
const sanitizeText = (text) => {
  if (typeof text !== 'string') return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
}

// Generate secure unique ID
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

// Safe JSON parse with validation
const safeJSONParse = (data, fallback = []) => {
  try {
    const parsed = JSON.parse(data)
    if (!Array.isArray(parsed)) return fallback
    return parsed.filter(item =>
      item &&
      typeof item === 'object' &&
      typeof item.id !== 'undefined' &&
      typeof item.type === 'string'
    )
  } catch {
    return fallback
  }
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [hasPassword, setHasPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authError, setAuthError] = useState('')

  const [items, setItems] = useState([])
  const [noteText, setNoteText] = useState('')
  const [filter, setFilter] = useState('all')
  const [notification, setNotification] = useState(null)

  // Show notification
  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }, [])

  // Check if password exists on mount
  useEffect(() => {
    const storedHash = localStorage.getItem('lifeGoesOnPasswordHash')
    const sessionTime = sessionStorage.getItem('lifeGoesOnSession')

    if (storedHash) {
      setHasPassword(true)
      // Check if session is still valid
      if (sessionTime && Date.now() - parseInt(sessionTime) < SESSION_TIMEOUT) {
        setIsAuthenticated(true)
      }
    }
    setIsLoading(false)
  }, [])

  // Update session time on activity
  useEffect(() => {
    if (isAuthenticated) {
      const updateSession = () => {
        sessionStorage.setItem('lifeGoesOnSession', Date.now().toString())
      }
      updateSession()

      const interval = setInterval(updateSession, 60000) // Update every minute
      return () => clearInterval(interval)
    }
  }, [isAuthenticated])

  // Handle password setup
  const handleSetupPassword = async (e) => {
    e.preventDefault()
    setAuthError('')

    if (password.length < 4) {
      setAuthError('Password must be at least 4 characters')
      return
    }

    if (password !== confirmPassword) {
      setAuthError('Passwords do not match')
      return
    }

    try {
      const hash = await hashPassword(password)
      localStorage.setItem('lifeGoesOnPasswordHash', hash)
      sessionStorage.setItem('lifeGoesOnSession', Date.now().toString())
      setHasPassword(true)
      setIsAuthenticated(true)
      setPassword('')
      setConfirmPassword('')
      showNotification('Password set successfully!', 'success')
    } catch (error) {
      setAuthError('Error setting password. Please try again.')
    }
  }

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault()
    setAuthError('')

    if (!password) {
      setAuthError('Please enter your password')
      return
    }

    try {
      const hash = await hashPassword(password)
      const storedHash = localStorage.getItem('lifeGoesOnPasswordHash')

      if (hash === storedHash) {
        sessionStorage.setItem('lifeGoesOnSession', Date.now().toString())
        setIsAuthenticated(true)
        setPassword('')
        showNotification('Welcome back!', 'success')
      } else {
        setAuthError('Incorrect password')
      }
    } catch (error) {
      setAuthError('Error logging in. Please try again.')
    }
  }

  // Handle logout
  const handleLogout = () => {
    sessionStorage.removeItem('lifeGoesOnSession')
    setIsAuthenticated(false)
    showNotification('Logged out successfully', 'info')
  }

  // Load items from localStorage securely
  useEffect(() => {
    if (isAuthenticated) {
      try {
        const savedItems = localStorage.getItem('myImportantItems')
        if (savedItems) {
          const parsed = safeJSONParse(savedItems, [])
          setItems(parsed)
        }
      } catch (error) {
        console.error('Error loading saved items:', error)
        showNotification('Error loading saved items', 'error')
      }
    }
  }, [isAuthenticated, showNotification])

  // Save items to localStorage
  useEffect(() => {
    if (isAuthenticated) {
      try {
        localStorage.setItem('myImportantItems', JSON.stringify(items))
      } catch (error) {
        console.error('Error saving items:', error)
        if (error.name === 'QuotaExceededError') {
          showNotification('Storage full! Please delete some items.', 'error')
        }
      }
    }
  }, [items, isAuthenticated, showNotification])

  // Validate file before upload
  const validateFile = (file) => {
    if (file.size > MAX_FILE_SIZE) {
      showNotification(`File "${file.name}" is too large. Max size is 10MB.`, 'error')
      return false
    }

    if (file.type && !ALLOWED_FILE_TYPES.includes(file.type)) {
      showNotification(`File type "${file.type}" is not allowed.`, 'error')
      return false
    }

    if (items.length >= MAX_ITEMS) {
      showNotification(`Maximum ${MAX_ITEMS} items allowed. Please delete some items.`, 'error')
      return false
    }

    return true
  }

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files)
    let uploadedCount = 0

    files.forEach(file => {
      if (!validateFile(file)) return

      const reader = new FileReader()

      reader.onerror = () => {
        showNotification(`Error reading file "${file.name}"`, 'error')
      }

      reader.onload = (event) => {
        const newItem = {
          id: generateId(),
          type: 'file',
          name: sanitizeText(file.name),
          size: file.size,
          fileType: file.type || 'application/octet-stream',
          data: event.target.result,
          important: false,
          createdAt: new Date().toISOString()
        }
        setItems(prev => [newItem, ...prev])
        uploadedCount++
        if (uploadedCount === files.length) {
          showNotification(`${uploadedCount} file(s) uploaded successfully!`, 'success')
        }
      }

      reader.readAsDataURL(file)
    })

    e.target.value = ''
  }

  const handleAddNote = () => {
    const trimmedNote = noteText.trim()

    if (!trimmedNote) {
      showNotification('Please enter a note', 'error')
      return
    }

    if (trimmedNote.length > MAX_NOTE_LENGTH) {
      showNotification(`Note is too long. Max ${MAX_NOTE_LENGTH} characters.`, 'error')
      return
    }

    if (items.length >= MAX_ITEMS) {
      showNotification(`Maximum ${MAX_ITEMS} items allowed. Please delete some items.`, 'error')
      return
    }

    const newItem = {
      id: generateId(),
      type: 'note',
      content: trimmedNote,
      important: false,
      createdAt: new Date().toISOString()
    }
    setItems(prev => [newItem, ...prev])
    setNoteText('')
    showNotification('Note added successfully!', 'success')
  }

  const toggleImportant = (id) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, important: !item.important } : item
    ))
  }

  const deleteItem = (id) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      setItems(prev => prev.filter(item => item.id !== id))
      showNotification('Item deleted', 'success')
    }
  }

  const downloadFile = (item) => {
    try {
      const link = document.createElement('a')
      link.href = item.data
      link.download = item.name
      link.rel = 'noopener noreferrer'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      showNotification('Error downloading file', 'error')
    }
  }

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const filteredItems = items.filter(item => {
    if (filter === 'important') return item.important
    if (filter === 'files') return item.type === 'file'
    if (filter === 'notes') return item.type === 'note'
    return true
  })

  // Loading screen
  if (isLoading) {
    return (
      <div className="app">
        <div className="auth-container">
          <div className="auth-card">
            <div className="loading-spinner"></div>
            <p>Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  // Password setup screen
  if (!hasPassword) {
    return (
      <div className="app">
        {notification && (
          <div className={`notification ${notification.type}`}>
            {notification.message}
          </div>
        )}
        <div className="auth-container">
          <div className="auth-card">
            <h1 className="auth-title">✨ Life Goes On ✨</h1>
            <p className="auth-subtitle">Set up a password to protect your files</p>

            <form onSubmit={handleSetupPassword} className="auth-form">
              <div className="input-group">
                <label htmlFor="password">Create Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="new-password"
                />
              </div>

              <div className="input-group">
                <label htmlFor="confirm-password">Confirm Password</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                />
              </div>

              {authError && <p className="auth-error">{authError}</p>}

              <button type="submit" className="auth-button">
                Set Password
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="app">
        {notification && (
          <div className={`notification ${notification.type}`}>
            {notification.message}
          </div>
        )}
        <div className="auth-container">
          <div className="auth-card">
            <h1 className="auth-title">✨ Life Goes On ✨</h1>
            <p className="auth-subtitle">Enter your password to continue</p>

            <form onSubmit={handleLogin} className="auth-form">
              <div className="input-group">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>

              {authError && <p className="auth-error">{authError}</p>}

              <button type="submit" className="auth-button">
                Unlock
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // Main app (authenticated)
  return (
    <div className="app">
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}

      <header className="header">
        <h1>✨ Life Goes On ✨</h1>
        <p>Store and organize everything important to you</p>
        <button onClick={handleLogout} className="logout-btn" title="Logout">
          Lock
        </button>
      </header>

      <div className="controls">
        <div className="upload-section">
          <label htmlFor="file-upload" className="upload-button">
            📤 Upload Files
            <input
              id="file-upload"
              type="file"
              multiple
              onChange={handleFileUpload}
              accept={ALLOWED_FILE_TYPES.join(',')}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        <div className="note-section">
          <input
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
            onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
            placeholder="Add a note or important item..."
            className="note-input"
            maxLength={MAX_NOTE_LENGTH}
            aria-label="Add a note"
          />
          <button
            onClick={handleAddNote}
            className="add-button"
            aria-label="Add note"
          >
            ➕ Add Note
          </button>
        </div>
      </div>

      <div className="filters" role="tablist" aria-label="Filter items">
        <button
          className={filter === 'all' ? 'filter-btn active' : 'filter-btn'}
          onClick={() => setFilter('all')}
          role="tab"
          aria-selected={filter === 'all'}
        >
          All ({items.length})
        </button>
        <button
          className={filter === 'files' ? 'filter-btn active' : 'filter-btn'}
          onClick={() => setFilter('files')}
          role="tab"
          aria-selected={filter === 'files'}
        >
          Files ({items.filter(i => i.type === 'file').length})
        </button>
      </div>

      <div className="items-container" role="main">
        {filteredItems.length === 0 ? (
          <div className="empty-state">
            <p>No items yet. Upload files or add notes to get started!</p>
          </div>
        ) : (
          filteredItems.map(item => (
            <article
              key={item.id}
              className={`item-card ${item.important ? 'important' : ''}`}
              aria-label={item.type === 'file' ? `File: ${item.name}` : 'Note'}
            >
              <div className="item-header">
                <div className="item-type-badge" aria-hidden="true">
                  {item.type === 'file' ? '📁' : '📝'}
                </div>
                <div className="item-actions">
                  <button
                    onClick={() => toggleImportant(item.id)}
                    className="action-btn"
                    title={item.important ? 'Remove from important' : 'Mark as important'}
                    aria-label={item.important ? 'Remove from important' : 'Mark as important'}
                  >
                    {item.important ? '⭐' : '☆'}
                  </button>
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="action-btn delete"
                    title="Delete"
                    aria-label="Delete item"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {item.type === 'file' ? (
                <div className="file-content">
                  <h3 className="item-title">{item.name}</h3>
                  <p className="file-info">
                    {formatFileSize(item.size)} • {item.fileType || 'Unknown type'}
                  </p>
                  <button
                    onClick={() => downloadFile(item)}
                    className="download-btn"
                    aria-label={`Download ${item.name}`}
                  >
                    ⬇️ Download
                  </button>
                </div>
              ) : (
                <div className="note-content">
                  <p className="note-text">{item.content}</p>
                </div>
              )}

              <div className="item-footer">
                <time className="timestamp" dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleDateString()} at {new Date(item.createdAt).toLocaleTimeString()}
                </time>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

export default App
