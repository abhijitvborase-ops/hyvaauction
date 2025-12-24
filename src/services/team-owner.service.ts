import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class TeamOwnerService {
  constructor(private firebase: FirebaseService) {}

  // =====================================================
  // ➕ ADD TEAM OWNER (DEFAULT ACTIVE)
  // =====================================================
  async addTeamOwner(data: {
    name: string;
    teamName: string;
    email: string;
  }) {
    const colRef = collection(this.firebase.db, 'users');

    return addDoc(colRef, {
      ...data,
      role: 'team',
      isActive: true,
      createdAt: new Date(),
    });
  }

  // =====================================================
  // 📥 LOAD ONLY ACTIVE TEAM OWNERS
  // =====================================================
  async getActiveTeamOwners(): Promise<any[]> {
    const q = query(
      collection(this.firebase.db, 'users'),
      where('role', '==', 'team'),
      where('isActive', '==', true)
    );

    const snap = await getDocs(q);

    return snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
  }

  // =====================================================
  // 🗑️ SOFT DELETE TEAM OWNER
  // =====================================================
  async deleteTeamOwner(uid: string): Promise<void> {
    const userRef = doc(this.firebase.db, 'users', uid);

    await updateDoc(userRef, {
      isActive: false,
      deletedAt: new Date(),
    });
  }
}
