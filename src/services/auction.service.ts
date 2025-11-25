import { Injectable, signal, computed, WritableSignal } from '@angular/core';
import { Player, Team, User } from '../models';
import { FirebaseService } from './firebase.service';
import {
  collection,
  addDoc,
  getDocs,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';

export type AuctionState =
  | 'login'
  | 'public_view'
  | 'admin_lobby'
  | 'admin_view'
  | 'team_view'
  | 'auction_ended';

export type DraftAnnouncement = { player: Player; team: Team };

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

  // Shared popup info (now driven by Firestore)
  lastDraftedPlayerInfo = signal<DraftAnnouncement | null>(null);

  // Undo functionality
  lastDraftAction = signal<{ player: Player; teamId: number } | null>(null);

  // Auction global phase (shared across devices)
  auctionPhase = signal<'lobby' | 'running' | 'ended'>('lobby');

  // Computed Signals
  isRoundCompleted = computed(() => {
    const order = this.roundOrder();
    const turn = this.turnIndex();
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
    this.initData();
  }

  // ---------- INITIAL LOAD & REALTIME SETUP ----------

  private async initData() {
    await this.loadDataFromFirestore();   // teams/users/players load
    this.initAuctionStateSync();          // auction state realtime
    this.initPlayersSync();               // players + rosters realtime
  }

  private seedData() {
    this.masterPlayerList.set([...DEFAULT_PLAYERS]);
    this.availablePlayers.set([...this.masterPlayerList()]);

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
      // ---- TEAMS ----
      const teamsSnap = await getDocs(collection(db, 'teams'));
      const loadedTeams: Team[] = [];
      teamsSnap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        loadedTeams.push({
          id: data.teamId,
          name: data.name,
          owner: data.owner,
          players: [],
          captainRole: data.captainRole,
          color: data.color ?? 'bg-gray-500',
          logo: data.logo ?? 'star',
        });
      });

      // ---- USERS ----
      const usersSnap = await getDocs(collection(db, 'users'));
      const existingUsers = this.users(); // seedData मधला admin
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
      const draftedMap = new Map<number, Player[]>();
      const availablePlayers: Player[] = [];

      playersSnap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const player: Player = {
          id: data.playerId ?? Number(docSnap.id),
          name: data.name,
          role: data.role,
        };
        loadedPlayers.push(player);

        const draftedToTeamId = data.draftedToTeamId as number | null | undefined;
        if (draftedToTeamId) {
          if (!draftedMap.has(draftedToTeamId)) {
            draftedMap.set(draftedToTeamId, []);
          }
          draftedMap.get(draftedToTeamId)!.push(player);
        } else {
          availablePlayers.push(player);
        }
      });

      const sortFn = (a: Player, b: Player) => a.name.localeCompare(b.name);

      // teams + rosters सेट कर
      const teamsWithPlayers: Team[] = loadedTeams.map((team) => ({
        ...team,
        players: (draftedMap.get(team.id) ?? []).sort(sortFn),
      }));

      this.teams.set(teamsWithPlayers);
      this.users.set(loadedUsers);
      this.masterPlayerList.set([...loadedPlayers].sort(sortFn));
      this.availablePlayers.set([...availablePlayers].sort(sortFn));

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

  // ---------- REALTIME AUCTION STATE (ROUND, ORDER, TURN, PHASE, LAST DRAFT) ----------

  private initAuctionStateSync() {
    const db = this.firebase.db;
    const stateRef = doc(db, 'auction', 'state');

    onSnapshot(stateRef, async (snap) => {
      if (!snap.exists()) {
        // पहिल्यांदा app चालू झालं तर default state तयार करा
        await setDoc(stateRef, {
          currentRound: 1,
          roundOrderTeamIds: [],
          turnIndex: 0,
          isRolling: false,
          diceResultTeamId: null,
          phase: 'lobby',
          lastDraftPlayerId: null,
          lastDraftTeamId: null,
          lastDraftAt: null,
        });
        return;
      }

      const data = snap.data() as any;
      this.applyRemoteAuctionState(data);
    });
  }

  private applyRemoteAuctionState(data: any) {
    this.currentRound.set(data.currentRound ?? 1);
    this.turnIndex.set(data.turnIndex ?? 0);
    this.isRolling.set(!!data.isRolling);

    const teams = this.teams();
    const players = this.masterPlayerList();

    const roundOrderIds: number[] = data.roundOrderTeamIds ?? [];
    const roundOrderTeams = roundOrderIds
      .map((id) => teams.find((t) => t.id === id) || null)
      .filter((t): t is Team => t !== null);
    this.roundOrder.set(roundOrderTeams);

    if (data.diceResultTeamId != null) {
      const team = teams.find((t) => t.id === data.diceResultTeamId) ?? null;
      this.diceResult.set(team);
    } else {
      this.diceResult.set(null);
    }

    // phase sync
    this.auctionPhase.set((data.phase as any) ?? 'lobby');

    // shared last draft popup sync
    const lastPlayerId = data.lastDraftPlayerId as number | null | undefined;
    const lastTeamId = data.lastDraftTeamId as number | null | undefined;

    if (lastPlayerId != null && lastTeamId != null) {
      const team = teams.find((t) => t.id === lastTeamId) ?? null;
      const player = players.find((p) => p.id === lastPlayerId) ?? null;
      if (team && player) {
        this.lastDraftedPlayerInfo.set({ player, team });
      } else {
        this.lastDraftedPlayerInfo.set(null);
      }
    } else {
      this.lastDraftedPlayerInfo.set(null);
    }
  }

  private async updateRemoteAuctionState(extra?: any) {
    const db = this.firebase.db;
    const stateRef = doc(db, 'auction', 'state');

    const roundOrderTeamIds = this.roundOrder().map((t) => t.id);
    const diceTeamId = this.diceResult()?.id ?? null;

    await updateDoc(stateRef, {
      currentRound: this.currentRound(),
      roundOrderTeamIds,
      turnIndex: this.turnIndex(),
      isRolling: this.isRolling(),
      diceResultTeamId: diceTeamId,
      phase: this.auctionPhase(),
      ...(extra || {}),
    });
  }

  // ---------- REALTIME PLAYERS + ROSTERS ----------

  private initPlayersSync() {
    const db = this.firebase.db;
    const playersRef = collection(db, 'players');

    onSnapshot(playersRef, (snap) => {
      const loadedPlayers: Player[] = [];
      const draftedMap = new Map<number, Player[]>();
      const availablePlayers: Player[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const player: Player = {
          id: data.playerId ?? Number(docSnap.id),
          name: data.name,
          role: data.role,
        };
        loadedPlayers.push(player);

        const draftedToTeamId = data.draftedToTeamId as number | null | undefined;

        if (draftedToTeamId) {
          if (!draftedMap.has(draftedToTeamId)) {
            draftedMap.set(draftedToTeamId, []);
          }
          draftedMap.get(draftedToTeamId)!.push(player);
        } else {
          availablePlayers.push(player);
        }
      });

      const sortFn = (a: Player, b: Player) => a.name.localeCompare(b.name);

      // Teams मध्ये players भरणे
      this.teams.update((currentTeams) =>
        currentTeams.map((t) => ({
          ...t,
          players: (draftedMap.get(t.id) ?? []).sort(sortFn),
        }))
      );

      // master + available lists
      this.masterPlayerList.set([...loadedPlayers].sort(sortFn));
      this.availablePlayers.set([...availablePlayers].sort(sortFn));
    });
  }

  // ---------- AUTH & BASIC VIEW STATE ----------

  login(username: string, password?: string) {
    const user = this.users().find(
      (u) => u.username === username && u.password === password
    );
    if (user) {
      this.currentUser.set(user);

      if (user.role === 'admin') {
        const phase = this.auctionPhase();

        if (phase === 'running') {
          this.auctionState.set('admin_view');       // चालू auction resume
        } else if (phase === 'ended') {
          this.auctionState.set('auction_ended');    // result view
        } else {
          this.auctionState.set('admin_lobby');      // lobby
        }
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

  // ---------- AUCTION FLOW ----------

  async startAuction() {
    if (this.currentUser()?.role !== 'admin') return;
    this.auctionState.set('admin_view');

    this.currentRound.set(1);
    this.roundOrder.set([]);
    this.turnIndex.set(0);
    this.diceResult.set(null);
    this.isRolling.set(false);
    this.lastDraftedPlayerInfo.set(null);
    this.auctionPhase.set('running');
    await this.updateRemoteAuctionState();
  }

  async rollForNextPick() {
    this.lastDraftedPlayerInfo.set(null);
    const teamsInRound = this.roundOrder();
    const allTeams = this.teams();

    if (
      this.isRolling() ||
      teamsInRound.length >= allTeams.length ||
      teamsInRound.length >= this.TEAMS_PER_ROUND
    ) {
      return;
    }

    this.isRolling.set(true);
    await this.updateRemoteAuctionState();

    const availableToPick = allTeams.filter(
      (t) => !teamsInRound.find((inRound) => inRound.id === t.id)
    );
    if (availableToPick.length === 0) {
      this.isRolling.set(false);
      await this.updateRemoteAuctionState();
      return;
    }

    const pickedTeam =
      availableToPick[Math.floor(Math.random() * availableToPick.length)];

    this.diceResult.set(pickedTeam);
    await this.updateRemoteAuctionState();

    setTimeout(async () => {
      this.roundOrder.update((order) => [...order, pickedTeam]);
      this.isRolling.set(false);
      await this.updateRemoteAuctionState();
    }, 2500);
  }

async draftPlayer(player: Player) {
  const pickingTeam = this.pickingTeam();
  if (!pickingTeam || !this.isMyTurn()) return;

  // 1) Local state update
  this.availablePlayers.update((players) =>
    players.filter((p) => p.id !== player.id)
  );

  this.teams.update((teams) => {
    const teamIndex = teams.findIndex((t) => t.id === pickingTeam.id);
    if (teamIndex > -1) {
      teams[teamIndex].players.push(player);
    }
    return [...teams];
  });

  // Undo साठी
  this.lastDraftAction.set({ player, teamId: pickingTeam.id });

  // 2) Popup साठी नवीन announcement सेट करा
  this.lastDraftedPlayerInfo.set({ player, team: pickingTeam });

  // 3) 4 सेकंदांनी auto-close (फक्त हा announcement अजूनही same असेल तर)
  setTimeout(() => {
    const current = this.lastDraftedPlayerInfo();
    if (
      current &&
      current.player.id === player.id &&
      current.team.id === pickingTeam.id
    ) {
      this.lastDraftedPlayerInfo.set(null);
    }
  }, 4000);

  // 4) Turn पुढे सरकव
  this.turnIndex.update((index) => index + 1);

  // 5) Firestore मध्ये draft mark करा
  const db = this.firebase.db;
  try {
    const playerRef = doc(db, 'players', String(player.id));
    await updateDoc(playerRef, {
      draftedToTeamId: pickingTeam.id,
    });
  } catch (err) {
    console.error('Error updating player draft in Firestore', err);
  }

  // 6) Remote auction state अपडेट
    // 🔥 सर्व devices ला shared last draft event
    await this.updateRemoteAuctionState({
      lastDraftPlayerId: player.id,
      lastDraftTeamId: pickingTeam.id,
      lastDraftAt: Date.now(),
    });
  }

  async nextRound() {
    if (!this.isRoundCompleted()) return;

    const nextRoundNumber = this.currentRound() + 1;

    if (
      nextRoundNumber > this.MAX_ROUNDS ||
      this.availablePlayers().length === 0
    ) {
      this.auctionState.set('auction_ended');
      this.auctionPhase.set('ended');
      this.lastDraftedPlayerInfo.set(null);  
      await this.updateRemoteAuctionState();
      return;
    }

    this.currentRound.set(nextRoundNumber);
    this.roundOrder.set([]);
    this.turnIndex.set(0);
    this.diceResult.set(null);
    this.lastDraftAction.set(null);
    this.lastDraftedPlayerInfo.set(null);

    await this.updateRemoteAuctionState();
  }

  async undoLastDraft() {
    if (this.currentUser()?.role !== 'admin') return;

    const lastAction = this.lastDraftAction();
    if (!lastAction) return;

    const { player, teamId } = lastAction;

    this.teams.update((teams) => {
      const teamIndex = teams.findIndex((t) => t.id === teamId);
      if (teamIndex > -1) {
        teams[teamIndex].players = teams[teamIndex].players.filter(
          (p) => p.id !== player.id
        );
      }
      return [...teams];
    });

    this.availablePlayers.update((players) =>
      [...players, player].sort((a, b) => a.id - b.id)
    );

    this.turnIndex.update((index) => index - 1);
    this.lastDraftAction.set(null);

    const db = this.firebase.db;
    try {
      const playerRef = doc(db, 'players', String(player.id));
      await updateDoc(playerRef, {
        draftedToTeamId: null,
      });
    } catch (err) {
      console.error('Error clearing player draft in Firestore', err);
    }

    // Undo झाल्यावर shared popup clear
    await this.updateRemoteAuctionState({
      lastDraftPlayerId: null,
      lastDraftTeamId: null,
      lastDraftAt: null,
    });
  }

  // ---------- TEAMS & USERS (ADMIN) ----------

  async createTeamOwner(
    teamName: string,
    ownerName: string,
    username: string,
    password: string,
    captainRole: 'Staff' | 'Technician'
  ) {
    if (this.currentUser()?.role !== 'admin') return;

    const newTeamId = Math.max(...this.teams().map((t) => t.id), 0) + 1;
    const newTeam: Team = {
      id: newTeamId,
      name: teamName,
      owner: ownerName,
      players: [],
      captainRole: captainRole,
      color: 'bg-gray-500',
      logo: 'star',
    };
    this.teams.update((teams) => [...teams, newTeam]);

    const newUserId = Math.max(...this.users().map((u) => u.id), 0) + 1;
    const newUser: User = {
      id: newUserId,
      username: username,
      password: password,
      role: 'team_owner',
      teamId: newTeamId,
    };
    this.users.update((users) => [...users, newUser]);

    try {
      const db = this.firebase.db;

      await addDoc(collection(db, 'teams'), {
        teamId: newTeamId,
        name: teamName,
        owner: ownerName,
        captainRole,
        color: 'bg-gray-500',
        logo: 'star',
      });

      await addDoc(collection(db, 'users'), {
        userId: newUserId,
        username,
        password,
        role: 'team_owner',
        teamId: newTeamId,
      });
    } catch (err) {
      console.error('Error saving team owner to Firestore', err);
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

    this.users.update((users) => {
      const userIndex = users.findIndex((u) => u.teamId === teamId);
      if (userIndex > -1) {
        users[userIndex] = {
          ...users[userIndex],
          username: updatedData.username,
        };
        if (updatedData.password) {
          users[userIndex].password = updatedData.password;
        }
      }
      return [...users];
    });
  }

  deleteTeamOwner(teamId: number) {
    if (this.currentUser()?.role !== 'admin') return;

    const teamToDelete = this.teams().find((t) => t.id === teamId);
    if (teamToDelete) {
      const playersToReturn = teamToDelete.players;
      const sortFn = (a: Player, b: Player) => a.name.localeCompare(b.name);
      this.availablePlayers.update((current) =>
        [...current, ...playersToReturn].sort(sortFn)
      );
    }

    this.teams.update((teams) => teams.filter((t) => t.id !== teamId));
    this.users.update((users) => users.filter((u) => u.teamId !== teamId));
  }

  // ---------- PLAYERS (ADMIN) ----------

  async createPlayer(playerData: Omit<Player, 'id'>) {
    if (this.currentUser()?.role !== 'admin') return;

    const newPlayerId =
      Math.max(...this.masterPlayerList().map((p) => p.id), 0) + 1;
    const newPlayer: Player = {
      id: newPlayerId,
      ...playerData,
    };

    const sortFn = (a: Player, b: Player) => a.name.localeCompare(b.name);

    this.masterPlayerList.update((players) =>
      [...players, newPlayer].sort(sortFn)
    );
    this.availablePlayers.update((players) =>
      [...players, newPlayer].sort(sortFn)
    );

    const db = this.firebase.db;
    try {
      await setDoc(doc(db, 'players', String(newPlayerId)), {
        playerId: newPlayerId,
        name: newPlayer.name,
        role: newPlayer.role,
        draftedToTeamId: null,
      });
    } catch (err) {
      console.error('Error saving player to Firestore', err);
      this.errorMessage.set(
        'Player saved locally, but failed to sync with server.'
      );
    }
  }

  async updatePlayer(playerId: number, updatedData: Omit<Player, 'id'>) {
    if (this.currentUser()?.role !== 'admin') return;

    const sortFn = (a: Player, b: Player) => a.name.localeCompare(b.name);

    const updateInList = (players: Player[]) => {
      const playerIndex = players.findIndex((p) => p.id === playerId);
      if (playerIndex > -1) {
        players[playerIndex] = { ...players[playerIndex], ...updatedData };
      }
      return [...players].sort(sortFn);
    };

    this.masterPlayerList.update(updateInList);
    this.availablePlayers.update(updateInList);

    const db = this.firebase.db;
    try {
      const playerRef = doc(db, 'players', String(playerId));
      await updateDoc(playerRef, {
        name: updatedData.name,
        role: updatedData.role,
      });
    } catch (err) {
      console.error('Error updating player in Firestore', err);
      this.errorMessage.set(
        'Player updated locally, but failed to sync with server.'
      );
    }
  }

  async deletePlayer(playerId: number) {
    if (this.currentUser()?.role !== 'admin') return;

    this.masterPlayerList.update((players) =>
      players.filter((p) => p.id !== playerId)
    );
    this.availablePlayers.update((players) =>
      players.filter((p) => p.id !== playerId)
    );

    const db = this.firebase.db;
    try {
      await deleteDoc(doc(db, 'players', String(playerId)));
    } catch (err) {
      console.error('Error deleting player in Firestore', err);
      this.errorMessage.set(
        'Player removed locally, but failed to sync with server.'
      );
    }
  }

  // ---------- RESET / STOP ----------

  async resetAuction() {
    if (this.currentUser()?.role !== 'admin') return;

    this.teams.update((currentTeams) =>
      currentTeams.map((team) => ({ ...team, players: [] }))
    );

    this.availablePlayers.set([...this.masterPlayerList()]);

    this.currentRound.set(1);
    this.diceResult.set(null);
    this.roundOrder.set([]);
    this.turnIndex.set(0);
    this.isRolling.set(false);
    this.errorMessage.set(null);
    this.lastDraftAction.set(null);
    this.lastDraftedPlayerInfo.set(null);
    this.auctionState.set('admin_lobby');
    this.auctionPhase.set('lobby');

    // Firestore मधून सगळ्या players चे draftedToTeamId clear
    const db = this.firebase.db;
    try {
      const snap = await getDocs(collection(db, 'players'));
      const updates: Promise<any>[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        if (data.draftedToTeamId) {
          updates.push(
            updateDoc(doc(db, 'players', docSnap.id), {
              draftedToTeamId: null,
            })
          );
        }
      });
      await Promise.all(updates);
    } catch (err) {
      console.error('Error clearing draftedToTeamId in Firestore', err);
    }

    await this.updateRemoteAuctionState({
      lastDraftPlayerId: null,
      lastDraftTeamId: null,
      lastDraftAt: null,
    });
  }

  async stopAuction() {
    if (this.currentUser()?.role !== 'admin') return;
    this.auctionState.set('auction_ended');
    this.auctionPhase.set('ended');
    this.lastDraftedPlayerInfo.set(null);
    await this.updateRemoteAuctionState();
  }
}
