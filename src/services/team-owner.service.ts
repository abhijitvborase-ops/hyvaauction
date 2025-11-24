import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { collection, addDoc } from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class TeamOwnerService {
  constructor(private firebase: FirebaseService) {}

  addTeamOwner(data: { name: string; teamName: string; email: string }) {
    const colRef = collection(this.firebase.db, 'teamOwners');
    return addDoc(colRef, {
      ...data,
      createdAt: new Date(),
    });
  }
}
