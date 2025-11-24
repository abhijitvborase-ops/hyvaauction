
import { Injectable, signal, computed, WritableSignal } from '@angular/core';
import { Player, Team, User } from '../models';
import { FirebaseService } from './firebase.service';
import { collection, addDoc, getDocs, setDoc,
  doc,
  updateDoc,
  deleteDoc, } from 'firebase/firestore';

export type AuctionState = 'login' | 'public_view' | 'admin_lobby' | 'admin_view' | 'team_view' | 'auction_ended';

const DEFAULT_PLAYERS: Player[] = [];

@Injectable({
  providedIn: 'root',
})
export class AuctionService {
  readonly MAX_ROUNDS = 15;
  readonly TEAMS_PER_ROUND = 4;
  
  // State Signals
  auctionState: WritableSignal<AuctionState> = signal('login');
  currentUser = signal<User | null>(null);
  teams = signal<Team[]>([]);
  masterPlayerList = signal<Player[]>([]);
  availablePlayers = signal<Player[]>([]);
  users = signal<User[]>([]);

  // Auction flow signals
  currentRound = signal(1);
  diceResult = signal<Team | null>(null);
  roundOrder = signal<Team[]>([]);
  turnIndex = signal(0);
  isRolling = signal(false);
  errorMessage = signal<string | null>(null);

  // Undo functionality
  lastDraftAction = signal<{ player: Player; teamId: number } | null>(null);

  // Computed Signals
  isRoundCompleted = computed(() => {
    const order = this.roundOrder();
    const turn = this.turnIndex();
    // Round is completed when all teams in the order have picked.
    return order.length > 0 && turn >= order.length;
  });

  pickingTeam = computed(() => {
    const order = this.roundOrder();
    const turn = this.turnIndex();
    if (order.length === 0 || this.isRoundCompleted()) {
      return null;
    }
    return order[turn];
  });
  
  isMyTurn = computed(() => {
    const user = this.currentUser();
    const picking = this.pickingTeam();
    if (!user || !picking || user.role !== 'team_owner') {
      return false;
    }
    return user.teamId === picking.id;
  });

  canUndo = computed(() => this.lastDraftAction() !== null);

  constructor(private firebase: FirebaseService) {
    this.seedData();
    this.loadDataFromFirestore();  // Firestore मधून teams/users load
  }

  private seedData() {
    this.masterPlayerList.set([...DEFAULT_PLAYERS]);
    this.availablePlayers.set([...this.masterPlayerList()]);

    this.teams.set([]);

    const initialTeams: Team[] = [];
    this.teams.set(initialTeams);

    const initialUsers: User[] = [
      { id: 1, username: 'admin', password: 'password', role: 'admin' },
    ];
    this.users.set(initialUsers);    
  }
  private async loadDataFromFirestore() {
    const db = this.firebase.db;

    try {
      // TEAMS
      const teamsSnap = await getDocs(collection(db, 'teams'));
      const loadedTeams: Team[] = [];
      teamsSnap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        loadedTeams.push({
          id: data.teamId,
          name: data.name,
          owner: data.owner,
          players: [], // players नंतर sync करू
          captainRole: data.captainRole,
          color: data.color ?? 'bg-gray-500',
          logo: data.logo ?? 'star',
        });
      });

      // USERS (admin + Firestore)
      const usersSnap = await getDocs(collection(db, 'users'));
      const existingUsers = this.users(); // admin already inside
      const loadedUsers: User[] = [...existingUsers];

      usersSnap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        loadedUsers.push({
          id: data.userId,
          username: data.username,
          password: data.password,
          role: data.role,
          teamId: data.teamId,
        });
      });
       // ---- PLAYERS ----
    const playersSnap = await getDocs(collection(db, 'players'));
    const loadedPlayers: Player[] = [];
    playersSnap.forEach((docSnap) => {
      const data = docSnap.data() as any;
      loadedPlayers.push({
        id: data.playerId ?? Number(docSnap.id),
        name: data.name,
        role: data.role,
      } as Player);
    });
  const sortFn = (a: Player, b: Player) => a.name.localeCompare(b.name);
      this.teams.set(loadedTeams);
      this.users.set(loadedUsers);
      this.masterPlayerList.set([...loadedPlayers].sort(sortFn));
      this.availablePlayers.set([...loadedPlayers].sort(sortFn));

      console.log('Loaded from Firestore:', {
        teams: loadedTeams.length,
        users: loadedUsers.length,
        players: loadedPlayers.length,
      });
    } catch (err) {
      console.error('Error loading data from Firestore', err);
      this.errorMessage.set('Could not load saved auction data.');
    }
  }

  login(username: string, password?: string) {
    const user = this.users().find(u => u.username === username && u.password === password);
    if (user) {
      this.currentUser.set(user);
      if (user.role === 'admin') {
        this.auctionState.set('admin_lobby');
      } else {
        this.auctionState.set('team_view');
      }
      this.errorMessage.set(null);
    } else {
      this.errorMessage.set('Invalid username or password.');
    }
  }

  logout() {
    this.currentUser.set(null);
    this.auctionState.set('login');
  }

  enterPublicView() {
    this.auctionState.set('public_view');
  }

  returnToLogin() {
    this.auctionState.set('login');
  }

  startAuction() {
    if (this.currentUser()?.role !== 'admin') return;
    this.auctionState.set('admin_view');
  }

  rollForNextPick() {
    const teamsInRound = this.roundOrder();
    const allTeams = this.teams();

    if (this.isRolling() || teamsInRound.length >= allTeams.length || teamsInRound.length >= this.TEAMS_PER_ROUND) {
      return;
    }

    this.isRolling.set(true);

    const availableToPick = allTeams.filter(t => !teamsInRound.find(inRound => inRound.id === t.id));
    if (availableToPick.length === 0) {
        this.isRolling.set(false);
        return;
    }

    const pickedTeam = availableToPick[Math.floor(Math.random() * availableToPick.length)];

    this.diceResult.set(pickedTeam);

    setTimeout(() => {
      this.roundOrder.update(order => [...order, pickedTeam]);
      this.isRolling.set(false);
    }, 2500); // Corresponds to animation duration + delay
  }

  draftPlayer(player: Player) {
    const pickingTeam = this.pickingTeam();
    if (!pickingTeam || !this.isMyTurn()) return;

    // Remove from available players
    this.availablePlayers.update(players => players.filter(p => p.id !== player.id));

    // Add to team
    this.teams.update(teams => {
      const teamIndex = teams.findIndex(t => t.id === pickingTeam.id);
      if (teamIndex > -1) {
        teams[teamIndex].players.push(player);
      }
      return [...teams];
    });
    
    // Set the last draft action for potential undo
    this.lastDraftAction.set({ player, teamId: pickingTeam.id });

    // Move to next turn in the round
    this.turnIndex.update(index => index + 1);
  }

  nextRound() {
    if (!this.isRoundCompleted()) return;

    const nextRoundNumber = this.currentRound() + 1;
    
    if (nextRoundNumber > this.MAX_ROUNDS || this.availablePlayers().length === 0) {
      this.auctionState.set('auction_ended');
      return;
    }

    this.currentRound.set(nextRoundNumber);
    this.roundOrder.set([]);
    this.turnIndex.set(0);
    this.diceResult.set(null); // Reset dice for next round
    this.lastDraftAction.set(null); // Clear undo state for new round
  }

  undoLastDraft() {
    if (this.currentUser()?.role !== 'admin') return;

    const lastAction = this.lastDraftAction();
    if (!lastAction) return;

    const { player, teamId } = lastAction;

    // Remove player from the team
    this.teams.update(teams => {
      const teamIndex = teams.findIndex(t => t.id === teamId);
      if (teamIndex > -1) {
        teams[teamIndex].players = teams[teamIndex].players.filter(p => p.id !== player.id);
      }
      return [...teams];
    });

    // Add player back to available players and sort by ID to maintain order
    this.availablePlayers.update(players => 
      [...players, player].sort((a, b) => a.id - b.id)
    );

    // Decrement the turn index to revert the turn
    this.turnIndex.update(index => index - 1);
    
    // Clear the last action so it can't be undone again
    this.lastDraftAction.set(null);
  }

   async createTeamOwner(
    teamName: string,
    ownerName: string,
    username: string,
    password: string,
    captainRole: 'Staff' | 'Technician'
  ) {
    if (this.currentUser()?.role !== 'admin') return;

    // 1) आधीसारखंच local state मध्ये add कर
    const newTeamId = Math.max(...this.teams().map(t => t.id), 0) + 1;
    const newTeam: Team = {
      id: newTeamId,
      name: teamName,
      owner: ownerName,
      players: [],
      captainRole: captainRole,
      color: 'bg-gray-500',
      logo: 'star'
    };
    this.teams.update(teams => [...teams, newTeam]);

    const newUserId = Math.max(...this.users().map(u => u.id), 0) + 1;
    const newUser: User = {
      id: newUserId,
      username: username,
      password: password,     // NOTE: plain text पासवर्ड – नंतर secure करू
      role: 'team_owner',
      teamId: newTeamId
    };
    this.users.update(users => [...users, newUser]);

    // 2) Firestore मध्ये टीम आणि यूजर save कर
    try {
      const db = this.firebase.db;

      // teams collection
      await addDoc(collection(db, 'teams'), {
        teamId: newTeamId,   // नंबर id वेगळा field मध्ये ठेवतोय
        name: teamName,
        owner: ownerName,
        captainRole,
        color: 'bg-gray-500',
        logo: 'star',
      });

      // users collection
      await addDoc(collection(db, 'users'), {
        userId: newUserId,
        username,
        password,            // plain text – उत्पादनात hashing गरजेचं
        role: 'team_owner',
        teamId: newTeamId,
      });

    } catch (err) {
      console.error('Error saving team owner to Firestore', err);
      // हव्यास तर इथे errorMessage signal set करू शकतोस
      this.errorMessage.set('Saved locally but failed to sync with server.');
    }
  }


  updateTeamOwner(
    teamId: number,
    updatedData: {
      teamName: string;
      ownerName: string;
      username: string;
      password?: string;
    }
  ) {
    if (this.currentUser()?.role !== 'admin') return;

    // Update team details
    this.teams.update((teams) => {
      const teamIndex = teams.findIndex((t) => t.id === teamId);
      if (teamIndex > -1) {
        teams[teamIndex] = {
          ...teams[teamIndex],
          name: updatedData.teamName,
          owner: updatedData.ownerName,
        };
      }
      return [...teams];
    });

    // Update user details
    this.users.update((users) => {
      const userIndex = users.findIndex((u) => u.teamId === teamId);
      if (userIndex > -1) {
        users[userIndex] = {
          ...users[userIndex],
          username: updatedData.username,
        };
        // Only update password if a new one is provided
        if (updatedData.password) {
          users[userIndex].password = updatedData.password;
        }
      }
      return [...users];
    });
  }

  deleteTeamOwner(teamId: number) {
    if (this.currentUser()?.role !== 'admin') return;

    const teamToDelete = this.teams().find(t => t.id === teamId);
    if (teamToDelete) {
        // Return the team's players to the available pool. They are still in the master list.
        const playersToReturn = teamToDelete.players;
        const sortFn = (a: Player, b: Player) => a.name.localeCompare(b.name);
        this.availablePlayers.update(current => [...current, ...playersToReturn].sort(sortFn));
    }

    // Remove team
    this.teams.update((teams) => teams.filter((t) => t.id !== teamId));

    // Remove user associated with the team
    this.users.update((users) => users.filter((u) => u.teamId !== teamId));
  }

  async createPlayer(playerData: Omit<Player, 'id'>) {
  if (this.currentUser()?.role !== 'admin') return;

  const newPlayerId = Math.max(...this.masterPlayerList().map(p => p.id), 0) + 1;
  const newPlayer: Player = {
    id: newPlayerId,
    ...playerData,
  };

  const sortFn = (a: Player, b: Player) => a.name.localeCompare(b.name);

  // Local state update
  this.masterPlayerList.update(players => [...players, newPlayer].sort(sortFn));
  this.availablePlayers.update(players => [...players, newPlayer].sort(sortFn));

  // Firestore save
  const db = this.firebase.db;
  try {
    await setDoc(doc(db, 'players', String(newPlayerId)), {
      playerId: newPlayerId,
      name: newPlayer.name,
      role: newPlayer.role,
    });
  } catch (err) {
    console.error('Error saving player to Firestore', err);
    this.errorMessage.set('Player saved locally, but failed to sync with server.');
  }
}
  async updatePlayer(playerId: number, updatedData: Omit<Player, 'id'>) {
  if (this.currentUser()?.role !== 'admin') return;

  const sortFn = (a: Player, b: Player) => a.name.localeCompare(b.name);

  const updateInList = (players: Player[]) => {
    const playerIndex = players.findIndex(p => p.id === playerId);
    if (playerIndex > -1) {
      players[playerIndex] = { ...players[playerIndex], ...updatedData };
    }
    return [...players].sort(sortFn);
  };

  // Local update
  this.masterPlayerList.update(updateInList);
  this.availablePlayers.update(updateInList);

  // Firestore update
  const db = this.firebase.db;
  try {
    const playerRef = doc(db, 'players', String(playerId));
    await updateDoc(playerRef, {
      name: updatedData.name,
      role: updatedData.role,
    });
  } catch (err) {
    console.error('Error updating player in Firestore', err);
    this.errorMessage.set('Player updated locally, but failed to sync with server.');
  }
}

  async deletePlayer(playerId: number) {
  if (this.currentUser()?.role !== 'admin') return;

  // Local delete
  this.masterPlayerList.update(players => players.filter(p => p.id !== playerId));
  this.availablePlayers.update(players => players.filter(p => p.id !== playerId));

  // Firestore delete
  const db = this.firebase.db;
  try {
    await deleteDoc(doc(db, 'players', String(playerId)));
  } catch (err) {
    console.error('Error deleting player in Firestore', err);
    this.errorMessage.set('Player removed locally, but failed to sync with server.');
  }
}

  resetAuction() {
    if (this.currentUser()?.role !== 'admin') return;
  
    // Reset each team's roster to be empty
    this.teams.update(currentTeams => 
        currentTeams.map(team => ({...team, players: []}))
    );

    // Available players are everyone from the master list
    this.availablePlayers.set([...this.masterPlayerList()]);
  
    // Reset auction flow state
    this.currentRound.set(1);
    this.diceResult.set(null);
    this.roundOrder.set([]);
    this.turnIndex.set(0);
    this.isRolling.set(false);
    this.errorMessage.set(null);
    this.lastDraftAction.set(null);
    
    // Return admin to the lobby to start a new auction
    this.auctionState.set('admin_lobby');
  }

  stopAuction() {
    if (this.currentUser()?.role !== 'admin') return;
    this.auctionState.set('auction_ended');
  }
}
