import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  Firestore,
  doc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';

@Injectable({
  providedIn: 'root',
})
export class FirebaseService {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;

  constructor() {
    const firebaseConfig = environment.firebase;

    // 🔹 app आधी initialize झाला असेल तर तोच वापर
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

    this.app = app;
    this.db = getFirestore(app);
    this.auth = getAuth(app);

    console.log('Firebase initialized');
  }

  // =====================================================
  // 🔥 USER SOFT DELETE (isActive = false)
  // =====================================================
  async deactivateUser(uid: string): Promise<void> {
    const userRef = doc(this.db, 'users', uid);
    await updateDoc(userRef, {
      isActive: false,
    });
  }

  // =====================================================
  // 🔥 GET ONLY ACTIVE USERS
  // =====================================================
  async getActiveUsers(): Promise<any[]> {
    const q = query(
      collection(this.db, 'users'),
      where('isActive', '==', true)
    );

    const snap = await getDocs(q);

    return snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
  }
}
