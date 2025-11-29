import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import {
  saveItemToCloud,
  loadItemsFromCloud,
  deleteItemFromCloud,
  subscribeToItems,
  checkFirebaseConfig
} from './firebase'

// Security constants
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB limit
const MAX_NOTE_LENGTH = 5000
const MAX_ITEMS = 500 // Increased limit with IndexedDB

// Secret password (hardcoded for reliability)
const SECRET_PASSWORD = 'prospee123@'

// IndexedDB configuration (for offline fallback)
const DB_NAME = 'LifeGoesOnDB'
const DB_VERSION = 1
const STORE_NAME = 'items'

// IndexedDB helper functions (kept for offline support)
const openDatabase = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

const saveItemsToDB = async (items, forceEmpty = false) => {
  console.log('=== SAVING TO LOCAL DB ===', { itemCount: items.length, forceEmpty })

  try {
    const db = await openDatabase()

    if (items.length === 0 && !forceEmpty) {
      const existingCount = await new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly')
        const store = transaction.objectStore(STORE_NAME)
        const countRequest = store.count()
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => resolve(0)
      })

      if (existingCount > 0) {
        console.log('Prevented saving empty array over existing data')
        db.close()
        return
      }
    }

    await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)

      const clearRequest = store.clear()

      clearRequest.onsuccess = () => {
        items.forEach(item => store.add(item))
      }

      transaction.oncomplete = () => {
        console.log('=== LOCAL SAVE COMPLETE ===', { savedCount: items.length })
        db.close()
        resolve()
      }
      transaction.onerror = () => {
        console.error('=== LOCAL SAVE ERROR ===', transaction.error)
        db.close()
        reject(transaction.error)
      }
    })
  } catch (error) {
    console.error('=== LOCAL SAVE FAILED ===', error)
    throw error
  }
}

const loadItemsFromDB = async () => {
  console.log('=== LOADING FROM LOCAL DB ===')
  try {
    const db = await openDatabase()
    const items = await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        db.close()
        const items = request.result.sort((a, b) =>
          new Date(b.createdAt) - new Date(a.createdAt)
        )
        console.log('=== LOCAL LOAD COMPLETE ===', { loadedCount: items.length })
        resolve(items)
      }
      request.onerror = () => {
        console.error('=== LOCAL LOAD ERROR ===', request.error)
        db.close()
        reject(request.error)
      }
    })
    return items
  } catch (error) {
    console.error('=== LOCAL LOAD FAILED ===', error)
    throw error
  }
}

const getStorageEstimate = async () => {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate()
    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0
    }
  }
  return { used: 0, quota: 0 }
}

const requestPersistentStorage = async () => {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted()
    if (!isPersisted) {
      const granted = await navigator.storage.persist()
      console.log('Persistent storage:', granted ? 'granted' : 'denied')
    }
  }
}

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
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')

  const initialLoadDone = useRef(false)

  const [items, setItems] = useState([])
  const [noteText, setNoteText] = useState('')
  const [filter, setFilter] = useState('all')
  const [notification, setNotification] = useState(null)
  const [storageInfo, setStorageInfo] = useState({ used: 0, quota: 0 })
  const [isSaving, setIsSaving] = useState(false)
  const [viewingItem, setViewingItem] = useState(null)
  const [cloudEnabled, setCloudEnabled] = useState(false)
  const [syncStatus, setSyncStatus] = useState('checking') // checking, synced, syncing, offline

  // Show notification
  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }, [])

  // Check if already unlocked this session
  useEffect(() => {
    const unlocked = sessionStorage.getItem('lifeGoesOnUnlocked')
    if (unlocked === 'true') {
      setIsUnlocked(true)
    }
  }, [])

  // Handle password submit
  const handleUnlock = (e) => {
    e.preventDefault()
    setAuthError('')

    if (password === SECRET_PASSWORD) {
      sessionStorage.setItem('lifeGoesOnUnlocked', 'true')
      setIsUnlocked(true)
      setPassword('')
      showNotification('Welcome back!', 'success')
    } else {
      setAuthError('Incorrect password')
    }
  }

  // Load items from cloud and/or IndexedDB on mount
  useEffect(() => {
    if (!isUnlocked) return

    const loadItems = async () => {
      try {
        await requestPersistentStorage()

        // Check if Firebase is configured
        const firebaseConfigured = checkFirebaseConfig()
        setCloudEnabled(firebaseConfigured)

        if (firebaseConfigured) {
          setSyncStatus('syncing')
          // Try to load from cloud first
          const cloudItems = await loadItemsFromCloud()

          if (cloudItems.length > 0) {
            setItems(cloudItems)
            // Also save to local for offline access
            await saveItemsToDB(cloudItems)
            setSyncStatus('synced')
            showNotification('Synced from cloud!', 'success')
          } else {
            // No cloud data, try local
            const dbItems = await loadItemsFromDB()
            if (dbItems.length > 0) {
              setItems(dbItems)
              // Upload local data to cloud
              for (const item of dbItems) {
                await saveItemToCloud(item)
              }
              setSyncStatus('synced')
              showNotification('Local data uploaded to cloud!', 'success')
            }
          }
        } else {
          setSyncStatus('offline')
          // Fall back to local storage
          const dbItems = await loadItemsFromDB()
          if (dbItems.length > 0) {
            setItems(dbItems)
          } else {
            // Migrate from localStorage if exists
            const savedItems = localStorage.getItem('myImportantItems')
            if (savedItems) {
              const parsed = safeJSONParse(savedItems, [])
              setItems(parsed)
              if (parsed.length > 0) {
                await saveItemsToDB(parsed)
                localStorage.removeItem('myImportantItems')
                showNotification('Data migrated to new storage!', 'success')
              }
            }
          }
        }

        const info = await getStorageEstimate()
        setStorageInfo(info)
      } catch (error) {
        console.error('Error loading items:', error)
        setSyncStatus('offline')
        showNotification('Error loading items', 'error')
      } finally {
        setTimeout(() => {
          initialLoadDone.current = true
        }, 100)
      }
    }
    loadItems()
  }, [isUnlocked, showNotification])

  // Subscribe to real-time updates from cloud
  useEffect(() => {
    if (!isUnlocked || !cloudEnabled) return

    const unsubscribe = subscribeToItems((cloudItems) => {
      if (initialLoadDone.current) {
        setItems(cloudItems)
        setSyncStatus('synced')
      }
    })

    return () => unsubscribe()
  }, [isUnlocked, cloudEnabled])

  // Helper function to save items - saves to both local and cloud
  const saveItems = useCallback(async (newItems) => {
    setIsSaving(true)
    setSyncStatus('syncing')
    try {
      await saveItemsToDB(newItems)
      const info = await getStorageEstimate()
      setStorageInfo(info)
      setSyncStatus(cloudEnabled ? 'synced' : 'offline')
    } catch (error) {
      console.error('Error saving items:', error)
      setSyncStatus('offline')
      showNotification('Error saving items. Please try again.', 'error')
    } finally {
      setIsSaving(false)
    }
  }, [showNotification, cloudEnabled])

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

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return

    setIsSaving(true)
    setSyncStatus('syncing')

    let currentItems = [...items]

    for (const file of files) {
      if (!validateFile(file)) continue

      try {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (event) => resolve(event.target.result)
          reader.onerror = () => reject(new Error('Failed to read file'))
          reader.readAsDataURL(file)
        })

        const newItem = {
          id: generateId(),
          type: 'file',
          name: sanitizeText(file.name),
          size: file.size,
          fileType: file.type || 'application/octet-stream',
          data: data,
          important: false,
          createdAt: new Date().toISOString()
        }

        // Save to cloud if enabled
        if (cloudEnabled) {
          try {
            const cloudItem = await saveItemToCloud(newItem)
            // Use cloud item (has download URL instead of base64 for files)
            currentItems = [cloudItem || newItem, ...currentItems]
          } catch (cloudError) {
            console.error('Cloud save failed, using local:', cloudError)
            currentItems = [newItem, ...currentItems]
          }
        } else {
          currentItems = [newItem, ...currentItems]
        }
      } catch (error) {
        console.error('Upload error:', error)
        showNotification(`Error uploading "${file.name}"`, 'error')
      }
    }

    setItems(currentItems)
    await saveItems(currentItems)
    showNotification(`${files.length} file(s) uploaded!`, 'success')
    setIsSaving(false)
    setSyncStatus(cloudEnabled ? 'synced' : 'offline')

    e.target.value = ''
  }

  const handleAddNote = async () => {
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

    // Save to cloud if enabled
    if (cloudEnabled) {
      try {
        await saveItemToCloud(newItem)
      } catch (cloudError) {
        console.error('Cloud save failed:', cloudError)
      }
    }

    const newItems = [newItem, ...items]
    setItems(newItems)
    await saveItems(newItems)
    setNoteText('')
    showNotification('Note added successfully!', 'success')
  }

  const toggleImportant = async (id) => {
    const newItems = items.map(item =>
      item.id === id ? { ...item, important: !item.important } : item
    )

    // Update in cloud if enabled
    if (cloudEnabled) {
      const updatedItem = newItems.find(item => item.id === id)
      if (updatedItem) {
        try {
          await saveItemToCloud(updatedItem)
        } catch (cloudError) {
          console.error('Cloud update failed:', cloudError)
        }
      }
    }

    setItems(newItems)
    await saveItems(newItems)
  }

  const deleteItem = async (id) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      const itemToDelete = items.find(item => item.id === id)

      // Delete from cloud if enabled
      if (cloudEnabled && itemToDelete) {
        try {
          await deleteItemFromCloud(itemToDelete)
        } catch (cloudError) {
          console.error('Cloud delete failed:', cloudError)
        }
      }

      const newItems = items.filter(item => item.id !== id)
      setItems(newItems)
      await saveItemsToDB(newItems, true)
      showNotification('Item deleted', 'success')
    }
  }

  const downloadFile = (item) => {
    try {
      if (!item.data) {
        showNotification('File data not available. File may be corrupted.', 'error')
        return
      }

      // Check if it's a cloud URL or base64
      if (item.isCloudStored && item.data.startsWith('http')) {
        // For cloud files, open in new tab or trigger download
        window.open(item.data, '_blank')
        showNotification('Opening file...', 'success')
        return
      }

      // Convert base64 to blob for reliable download
      const parts = item.data.split(',')
      const byteString = atob(parts[1])
      const mimeType = parts[0].match(/:(.*?);/)?.[1] || item.fileType

      const ab = new ArrayBuffer(byteString.length)
      const ia = new Uint8Array(ab)
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i)
      }

      const blob = new Blob([ab], { type: mimeType })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = item.name
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      setTimeout(() => URL.revokeObjectURL(url), 100)
      showNotification('Download started!', 'success')
    } catch (error) {
      console.error('Download error:', error)
      showNotification('Error downloading file.', 'error')
    }
  }

  const viewFile = (item) => {
    if (!item.data) {
      showNotification('File data not available', 'error')
      return
    }
    setViewingItem(item)
  }

  const closeViewer = () => {
    setViewingItem(null)
  }

  const shareFile = async (item) => {
    try {
      if (!item.data) {
        showNotification('File data not available', 'error')
        return
      }

      // For cloud stored files, share the URL
      if (item.isCloudStored && item.data.startsWith('http')) {
        if (navigator.share) {
          await navigator.share({
            title: item.name,
            text: `Sharing: ${item.name}`,
            url: item.data
          })
          showNotification('Shared successfully!', 'success')
        } else {
          // Copy URL to clipboard
          await navigator.clipboard.writeText(item.data)
          showNotification('Link copied to clipboard!', 'success')
        }
        return
      }

      // Convert base64 to blob
      const parts = item.data.split(',')
      const byteString = atob(parts[1])
      const mimeType = parts[0].match(/:(.*?);/)?.[1] || item.fileType

      const ab = new ArrayBuffer(byteString.length)
      const ia = new Uint8Array(ab)
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i)
      }

      const blob = new Blob([ab], { type: mimeType })
      const file = new File([blob], item.name, { type: mimeType })

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: item.name,
          text: `Sharing: ${item.name}`
        })
        showNotification('Shared successfully!', 'success')
      } else if (navigator.share) {
        await navigator.share({
          title: item.name,
          text: `File: ${item.name} (${formatFileSize(item.size)})`
        })
        showNotification('Shared!', 'success')
      } else {
        showNotification('Share not supported. Use Download instead.', 'info')
        downloadFile(item)
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Share error:', error)
        showNotification('Error sharing file', 'error')
      }
    }
  }

  const isViewable = (fileType) => {
    return fileType?.startsWith('image/') || fileType === 'application/pdf'
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

  const getSyncStatusText = () => {
    switch (syncStatus) {
      case 'synced': return 'Cloud synced'
      case 'syncing': return 'Syncing...'
      case 'checking': return 'Checking...'
      case 'offline': return 'Local only'
      default: return ''
    }
  }

  const getSyncStatusColor = () => {
    switch (syncStatus) {
      case 'synced': return '#10b981'
      case 'syncing': return '#f59e0b'
      case 'checking': return '#6b7280'
      case 'offline': return '#ef4444'
      default: return '#6b7280'
    }
  }

  // Password screen
  if (!isUnlocked) {
    return (
      <div className="app">
        <div className="auth-container">
          <div className="auth-card">
            <h1 className="auth-title">Life Goes On</h1>
            <p className="auth-subtitle">Enter your secret password</p>

            <form onSubmit={handleUnlock} className="auth-form">
              <div className="input-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
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

  // Main app
  return (
    <div className="app">
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}

      <header className="header">
        <h1>Life Goes On</h1>
        <p>Store and organize everything important to you</p>
        <div className="sync-status" style={{ color: getSyncStatusColor() }}>
          <span className="sync-dot" style={{ backgroundColor: getSyncStatusColor() }}></span>
          {getSyncStatusText()}
          {!cloudEnabled && (
            <span className="setup-hint"> - Setup Firebase for cloud sync</span>
          )}
        </div>
        {storageInfo.quota > 0 && (
          <div className="storage-indicator">
            <div className="storage-bar">
              <div
                className="storage-used"
                style={{ width: `${Math.min((storageInfo.used / storageInfo.quota) * 100, 100)}%` }}
              />
            </div>
            <span className="storage-text">
              {formatFileSize(storageInfo.used)} / {formatFileSize(storageInfo.quota)} used
              {isSaving && ' - Saving...'}
            </span>
          </div>
        )}
      </header>

      <div className="controls">
        <div className="upload-section">
          <label htmlFor="file-upload" className="upload-button">
            Upload Files
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
            Add Note
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
                  {item.type === 'file' ? 'F' : 'N'}
                </div>
                <div className="item-actions">
                  {item.isCloudStored && (
                    <span className="cloud-badge" title="Stored in cloud">C</span>
                  )}
                  <button
                    onClick={() => toggleImportant(item.id)}
                    className="action-btn"
                    title={item.important ? 'Remove from important' : 'Mark as important'}
                    aria-label={item.important ? 'Remove from important' : 'Mark as important'}
                  >
                    {item.important ? 'S' : 's'}
                  </button>
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="action-btn delete"
                    title="Delete"
                    aria-label="Delete item"
                  >
                    X
                  </button>
                </div>
              </div>

              {item.type === 'file' ? (
                <div className="file-content">
                  {item.fileType?.startsWith('image/') && item.data && (
                    <div className="image-preview" onClick={() => viewFile(item)}>
                      <img src={item.data} alt={item.name} />
                    </div>
                  )}
                  <h3 className="item-title">{item.name}</h3>
                  <p className="file-info">
                    {formatFileSize(item.size)} - {item.fileType || 'Unknown type'}
                  </p>
                  <div className="file-actions">
                    {isViewable(item.fileType) && (
                      <button
                        onClick={() => viewFile(item)}
                        className="view-btn"
                        aria-label={`View ${item.name}`}
                      >
                        View
                      </button>
                    )}
                    <button
                      onClick={() => shareFile(item)}
                      className="share-btn"
                      aria-label={`Share ${item.name}`}
                    >
                      Share
                    </button>
                    <button
                      onClick={() => downloadFile(item)}
                      className="download-btn"
                      aria-label={`Download ${item.name}`}
                    >
                      Download
                    </button>
                  </div>
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

      {/* File Viewer Modal */}
      {viewingItem && (
        <div className="viewer-overlay" onClick={closeViewer}>
          <div className="viewer-container" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-header">
              <h3>{viewingItem.name}</h3>
              <button className="viewer-close" onClick={closeViewer}>X</button>
            </div>
            <div className="viewer-content">
              {viewingItem.fileType?.startsWith('image/') ? (
                <img src={viewingItem.data} alt={viewingItem.name} />
              ) : viewingItem.fileType === 'application/pdf' ? (
                <iframe src={viewingItem.data} title={viewingItem.name} />
              ) : (
                <p>Preview not available for this file type</p>
              )}
            </div>
            <div className="viewer-footer">
              <button onClick={() => shareFile(viewingItem)} className="share-btn">
                Share
              </button>
              <button onClick={() => downloadFile(viewingItem)} className="download-btn">
                Download
              </button>
              <button onClick={closeViewer} className="view-btn" style={{background: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'}}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
