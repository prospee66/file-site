// Firebase Configuration for Life Goes On
// This file configures Firebase services for cloud sync

import { initializeApp } from 'firebase/app'
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, onSnapshot, query } from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'

// Firebase configuration
// IMPORTANT: These are placeholder values. You need to:
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (or use existing one)
// 3. Go to Project Settings > General > Your apps > Web app
// 4. Copy your config values and replace these placeholders
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
}

// Check if Firebase is configured
const isFirebaseConfigured = () => {
  return firebaseConfig.apiKey !== "YOUR_API_KEY" &&
         firebaseConfig.projectId !== "YOUR_PROJECT_ID"
}

// Initialize Firebase (only if configured)
let app = null
let db = null
let storage = null

if (isFirebaseConfigured()) {
  try {
    app = initializeApp(firebaseConfig)
    db = getFirestore(app)
    storage = getStorage(app)
    console.log('Firebase initialized successfully')
  } catch (error) {
    console.error('Firebase initialization error:', error)
  }
}

// Collection name for items
const ITEMS_COLLECTION = 'lifeGoesOnItems'

// Save item to Firestore (metadata only, files go to Storage)
export const saveItemToCloud = async (item) => {
  if (!db) {
    console.log('Firebase not configured, skipping cloud save')
    return null
  }

  try {
    const itemRef = doc(db, ITEMS_COLLECTION, item.id.toString())

    // If it's a file, upload to Storage first
    if (item.type === 'file' && item.data && item.data.startsWith('data:')) {
      // Convert base64 to blob
      const response = await fetch(item.data)
      const blob = await response.blob()

      // Upload to storage
      const storageRef = ref(storage, `files/${item.id}_${item.name}`)
      await uploadBytes(storageRef, blob)

      // Get download URL
      const downloadURL = await getDownloadURL(storageRef)

      // Save metadata with download URL instead of base64
      const itemData = {
        ...item,
        data: downloadURL,
        isCloudStored: true,
        updatedAt: Date.now()
      }

      await setDoc(itemRef, itemData)
      return itemData
    } else {
      // For notes, save directly
      const itemData = {
        ...item,
        updatedAt: Date.now()
      }
      await setDoc(itemRef, itemData)
      return itemData
    }
  } catch (error) {
    console.error('Error saving to cloud:', error)
    throw error
  }
}

// Load all items from Firestore
export const loadItemsFromCloud = async () => {
  if (!db) {
    console.log('Firebase not configured, returning empty array')
    return []
  }

  try {
    const querySnapshot = await getDocs(collection(db, ITEMS_COLLECTION))
    const items = []

    querySnapshot.forEach((doc) => {
      items.push(doc.data())
    })

    // Sort by creation date
    items.sort((a, b) => b.id - a.id)

    console.log('Loaded from cloud:', items.length, 'items')
    return items
  } catch (error) {
    console.error('Error loading from cloud:', error)
    return []
  }
}

// Delete item from Firestore and Storage
export const deleteItemFromCloud = async (item) => {
  if (!db) {
    console.log('Firebase not configured, skipping cloud delete')
    return
  }

  try {
    // Delete from Firestore
    await deleteDoc(doc(db, ITEMS_COLLECTION, item.id.toString()))

    // If it's a file stored in cloud storage, delete from storage too
    if (item.type === 'file' && item.isCloudStored) {
      try {
        const storageRef = ref(storage, `files/${item.id}_${item.name}`)
        await deleteObject(storageRef)
      } catch (storageError) {
        // File might not exist in storage, that's ok
        console.log('Storage delete skipped:', storageError.message)
      }
    }

    console.log('Deleted from cloud:', item.id)
  } catch (error) {
    console.error('Error deleting from cloud:', error)
    throw error
  }
}

// Listen for real-time updates
export const subscribeToItems = (callback) => {
  if (!db) {
    console.log('Firebase not configured, no real-time sync')
    return () => {}
  }

  try {
    const q = query(collection(db, ITEMS_COLLECTION))

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const items = []
      querySnapshot.forEach((doc) => {
        items.push(doc.data())
      })
      items.sort((a, b) => b.id - a.id)
      console.log('Real-time update:', items.length, 'items')
      callback(items)
    }, (error) => {
      console.error('Real-time sync error:', error)
    })

    return unsubscribe
  } catch (error) {
    console.error('Error setting up real-time sync:', error)
    return () => {}
  }
}

// Check if Firebase is properly configured
export const checkFirebaseConfig = () => {
  return isFirebaseConfigured()
}

export { db, storage }
