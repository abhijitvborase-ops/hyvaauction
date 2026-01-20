import { FirebaseService } from './services/firebase.service';
import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  computed,
  signal,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuctionService } from './services/auction.service';
import { DiceComponent } from './components/dice/dice.component';
import { Player, Team, User } from './models';

import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';

declare var lucide: any;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, DiceComponent],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  auctionService = inject(AuctionService);
  firebase = inject(FirebaseService);

  @ViewChild('exportTable') exportTable!: ElementRef;

  adminTab = signal<'create' | 'manage'>('create');
getCaptainRoleColor(role: 'Staff' | 'Technician'): string {
  switch (role) {
    case 'Staff':
      return 'bg-blue-500 text-blue-100';
    case 'Technician':
      return 'bg-yellow-500 text-yellow-100';
    default:
      return 'bg-gray-500 text-gray-100';
  }
}
  // =====================================================
  // LOGIN
  // =====================================================
  loginUsername = '';
  loginPassword = '';

  // =====================================================
  // CREATE TEAM
  // =====================================================
  newTeamName = signal('');
  newOwnerName = signal('');
  newUsername = signal('');
  newPassword = signal('');
  newTeamCaptainRole = signal<'Staff' | 'Technician'>('Staff');

  // =====================================================
  // EDIT TEAM
  // =====================================================
  editingTeam = signal<Team | null>(null);
  editTeamName = signal('');
  editOwnerName = signal('');
  editUsername = signal('');
  editPassword = signal('');

  // =====================================================
  // PLAYERS
  // =====================================================
  newPlayerName = signal('');
  newPlayerRole = signal<Player['role']>('Staff');

  editingPlayer = signal<Player | null>(null);
  editPlayerName = signal('');
  editPlayerRole = signal<Player['role']>('Staff');

  playerRoles: Player['role'][] = [
    'Staff',
    'Technician',
    'Contractual Worker',
  ];

  // =====================================================
  // CURRENT USER TEAM
  // =====================================================
  currentUserTeam = computed(() => {
    const user = this.auctionService.currentUser();
    if (user?.role !== 'team_owner' || !user.teamId) return null;
    return (
      this.auctionService.teams().find((t) => t.id === user.teamId) ?? null
    );
  });

  ngOnInit() {
    setTimeout(() => lucide.createIcons(), 50);
    console.log(
      'Firebase initialized, projectId =',
      this.firebase.app.options['projectId']
    );
  }

  // =====================================================
  // LOGIN / NAV
  // =====================================================
  onLogin() {
    this.auctionService.login(this.loginUsername, this.loginPassword);
  }

  onEnterPublicView() {
    this.auctionService.enterPublicView();
    setTimeout(() => lucide.createIcons(), 50);
  }

  onReturnToLogin() {
    this.auctionService.returnToLogin();
    setTimeout(() => lucide.createIcons(), 50);
  }

  // =====================================================
  // AUCTION CONTROL
  // =====================================================
  onStartAuction() {
    this.auctionService.startAuction();
    setTimeout(() => lucide.createIcons(), 50);
  }
  onStopAuction() {
  this.auctionService.stopAuction();
  setTimeout(() => lucide.createIcons(), 50);
}
onResetAuction() {
  this.auctionService.resetAuction();
  setTimeout(() => lucide.createIcons(), 50);
}
  onRollForNextPick() {
    this.auctionService.rollForNextPick();
  }

  onNextRound() {
    this.auctionService.nextRound();
    setTimeout(() => lucide.createIcons(), 50);
  }
exportDraftToExcelAll() {
  console.log('Export All Teams (Excel)');
}
exportDraftToExcelMine() {
  console.log('Export My Team (Excel)');
}
exportDraftToPng() {
  console.log('Export as PNG');
}

  async onDraftPlayer(player: Player) {
    if (!this.auctionService.isMyTurn()) return;

    const ok = confirm(
      `Are you sure you want to draft "${player.name}" for your team?`
    );
    if (!ok) return;

    await this.auctionService.draftPlayer(player);
  }

  onUndoLastDraft() {
    if (!this.auctionService.canUndo()) return;

    const ok = confirm(
      'Are you sure you want to undo the last pick?\n\n' +
        '➤ Player will return to Available list\n' +
        '➤ Previous team gets its turn again'
    );
    if (!ok) return;

    this.auctionService.undoLastDraft();
    setTimeout(() => lucide.createIcons(), 50);
  }

  // =====================================================
  // TEAM CRUD
  // =====================================================
  onCreateTeam() {
    if (
      this.newTeamName() &&
      this.newOwnerName() &&
      this.newUsername() &&
      this.newPassword()
    ) {
      this.auctionService.createTeamOwner(
        this.newTeamName(),
        this.newOwnerName(),
        this.newUsername(),
        this.newPassword(),
        this.newTeamCaptainRole()
      );

      this.newTeamName.set('');
      this.newOwnerName.set('');
      this.newUsername.set('');
      this.newPassword.set('');
      this.newTeamCaptainRole.set('Staff');
    }
  }

  startEditing(team: Team) {
    this.editingTeam.set(team);
    this.editTeamName.set(team.name);
    this.editOwnerName.set(team.owner);

    const user = this.auctionService.users().find((u) => u.teamId === team.id);
    if (user) this.editUsername.set(user.username);

    this.editPassword.set('');
  }

  cancelEditing() {
    this.editingTeam.set(null);
    setTimeout(() => lucide.createIcons(), 50);
  }

  onUpdateTeam() {
    const team = this.editingTeam();
    if (!team) return;

    this.auctionService.updateTeamOwner(team.id, {
      teamName: this.editTeamName(),
      ownerName: this.editOwnerName(),
      username: this.editUsername(),
      password: this.editPassword() || undefined,
    });

    this.cancelEditing();
  }

  // 🔥 FIXED DELETE (SOFT DELETE)
  async onDeleteTeam(team: Team) {
    const ok = confirm(
      `Are you sure you want to delete team "${team.name}"?\n\nUser will be deactivated (safe delete).`
    );
    if (!ok) return;

    await this.auctionService.deleteTeamOwner(team.id);

       setTimeout(() => lucide.createIcons(), 50);
  }

  // =====================================================
  // PLAYER CRUD
  // =====================================================
  onCreatePlayer() {
    if (!this.newPlayerName()) return;

    this.auctionService.createPlayer({
      name: this.newPlayerName(),
      role: this.newPlayerRole(),
    });

    this.newPlayerName.set('');
    this.newPlayerRole.set('Staff');
  }

  startEditingPlayer(player: Player) {
    this.editingPlayer.set(player);
    this.editPlayerName.set(player.name);
    this.editPlayerRole.set(player.role);
  }

  cancelEditingPlayer() {
    this.editingPlayer.set(null);
  }

  onUpdatePlayer() {
    const player = this.editingPlayer();
    if (!player) return;

    this.auctionService.updatePlayer(player.id, {
      name: this.editPlayerName(),
      role: this.editPlayerRole(),
    });

    this.cancelEditingPlayer();
  }

  onDeletePlayer(player: Player) {
    const ok = confirm(
      `Are you sure you want to permanently delete player "${player.name}"?`
    );
    if (!ok) return;

    this.auctionService.deletePlayer(player.id);
  }

  // =====================================================
  // EXPORT / UTIL
  // =====================================================
  getUserForTeam(teamId: number): User | undefined {
    return this.auctionService.users().find((u) => u.teamId === teamId);
  }

  getRoleColor(role: Player['role']): string {
    switch (role) {
      case 'Staff':
        return 'text-blue-400';
      case 'Technician':
        return 'text-yellow-400';
      case 'Contractual Worker':
        return 'text-purple-400';
      default:
        return 'text-gray-400';
    }
  }
  getTextColor(bgClass: string): string {
  if (!bgClass) return 'text-white';

  if (bgClass.includes('bg-blue')) return 'text-blue-100';
  if (bgClass.includes('bg-yellow')) return 'text-yellow-100';
  if (bgClass.includes('bg-green')) return 'text-green-100';
  if (bgClass.includes('bg-red')) return 'text-red-100';
  if (bgClass.includes('bg-purple')) return 'text-purple-100';

  return 'text-white';
}
}
