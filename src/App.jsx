import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [items, setItems] = useState([])
  const [noteText, setNoteText] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    const savedItems = localStorage.getItem('myImportantItems')
    if (savedItems) {
      setItems(JSON.parse(savedItems))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('myImportantItems', JSON.stringify(items))
  }, [items])

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files)

    files.forEach(file => {
      const reader = new FileReader()

      reader.onload = (event) => {
        const newItem = {
          id: Date.now() + Math.random(),
          type: 'file',
          name: file.name,
          size: file.size,
          fileType: file.type,
          data: event.target.result,
          important: false,
          createdAt: new Date().toISOString()
        }
        setItems(prev => [newItem, ...prev])
      }

      reader.readAsDataURL(file)
    })

    e.target.value = ''
  }

  const handleAddNote = () => {
    if (noteText.trim()) {
      const newItem = {
        id: Date.now(),
        type: 'note',
        content: noteText,
        important: false,
        createdAt: new Date().toISOString()
      }
      setItems(prev => [newItem, ...prev])
      setNoteText('')
    }
  }

  const toggleImportant = (id) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, important: !item.important } : item
    ))
  }

  const deleteItem = (id) => {
    setItems(prev => prev.filter(item => item.id !== id))
  }

  const downloadFile = (item) => {
    const link = document.createElement('a')
    link.href = item.data
    link.download = item.name
    link.click()
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

  return (
    <div className="app">
      <header className="header">
        <h1>✨ Life Goes On ✨</h1>
        <p>Store and organize everything important to you</p>
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
              style={{ display: 'none' }}
            />
          </label>
        </div>

        <div className="note-section">
          <input
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddNote()}
            placeholder="Add a note or important item..."
            className="note-input"
          />
          <button onClick={handleAddNote} className="add-button">➕ Add Note</button>
        </div>
      </div>

      <div className="filters">
        <button
          className={filter === 'all' ? 'filter-btn active' : 'filter-btn'}
          onClick={() => setFilter('all')}
        >
          All ({items.length})
        </button>
        <button
          className={filter === 'files' ? 'filter-btn active' : 'filter-btn'}
          onClick={() => setFilter('files')}
        >
          Files ({items.filter(i => i.type === 'file').length})
        </button>
      </div>

      <div className="items-container">
        {filteredItems.length === 0 ? (
          <div className="empty-state">
            <p>No items yet. Upload files or add notes to get started!</p>
          </div>
        ) : (
          filteredItems.map(item => (
            <div key={item.id} className={`item-card ${item.important ? 'important' : ''}`}>
              <div className="item-header">
                <div className="item-type-badge">
                  {item.type === 'file' ? '📁' : '📝'}
                </div>
                <div className="item-actions">
                  <button
                    onClick={() => toggleImportant(item.id)}
                    className="action-btn"
                    title={item.important ? 'Remove from important' : 'Mark as important'}
                  >
                    {item.important ? '⭐' : '☆'}
                  </button>
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="action-btn delete"
                    title="Delete"
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
                  <button onClick={() => downloadFile(item)} className="download-btn">
                    ⬇️ Download
                  </button>
                </div>
              ) : (
                <div className="note-content">
                  <p className="note-text">{item.content}</p>
                </div>
              )}

              <div className="item-footer">
                <span className="timestamp">
                  {new Date(item.createdAt).toLocaleDateString()} at {new Date(item.createdAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default App
