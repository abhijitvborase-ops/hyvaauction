import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
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

    // app आधी initialize झाला असेल तर तोच वापर, नाहीतर नवीन initialize
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

    this.app = app;
    this.db = getFirestore(app);
    this.auth = getAuth(app);

    console.log('Firebase initialized');
  }
}
