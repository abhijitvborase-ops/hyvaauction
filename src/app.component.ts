
import { Component, ChangeDetectionStrategy, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { signal } from '@angular/core';

import { AuctionService } from './services/auction.service';
import { DiceComponent } from './components/dice/dice.component';
import { Player, Team, User } from './models';

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

  // Form signals for login
  loginUsername = signal('');
  loginPassword = signal('');
  
  // Form signals for creating a new team
  newTeamName = signal('');
  newOwnerName = signal('');
  newUsername = signal('');
  newPassword = signal('');
  newTeamCaptainRole = signal<'Staff' | 'Technician'>('Staff');
  
  // Signals for editing a team
  editingTeam = signal<Team | null>(null);
  editTeamName = signal('');
  editOwnerName = signal('');
  editUsername = signal('');
  editPassword = signal('');

  // Form signals for creating a player
  newPlayerName = signal('');
  newPlayerRole = signal<Player['role']>('Staff');
  
  // Signals for editing a player
  editingPlayer = signal<Player | null>(null);
  editPlayerName = signal('');
  editPlayerRole = signal<Player['role']>('Staff');

  playerRoles: Player['role'][] = ['Staff', 'Technician', 'Contractual Worker'];

  ngOnInit() {
    // This is needed to render icons initially
    setTimeout(() => lucide.createIcons(), 50);
  }
  
  onLogin() {
    this.auctionService.login(this.loginUsername(), this.loginPassword());
  }

  onEnterPublicView() {
    this.auctionService.enterPublicView();
    setTimeout(() => lucide.createIcons(), 50);
  }

  onReturnToLogin() {
    this.auctionService.returnToLogin();
    setTimeout(() => lucide.createIcons(), 50);
  }
  
  onStartAuction() {
    this.auctionService.startAuction();
    setTimeout(() => lucide.createIcons(), 50);
  }

  onRollForNextPick() {
    this.auctionService.rollForNextPick();
  }
  
  onNextRound() {
    this.auctionService.nextRound();
    setTimeout(() => lucide.createIcons(), 50);
  }

  onDraftPlayer(player: Player) {
    this.auctionService.draftPlayer(player);
    setTimeout(() => lucide.createIcons(), 50);
  }

  onUndoLastDraft() {
    this.auctionService.undoLastDraft();
  }

  onCreateTeam() {
    if (this.newTeamName() && this.newOwnerName() && this.newUsername() && this.newPassword()) {
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

        setTimeout(() => lucide.createIcons(), 50);
    }
  }

  startEditing(team: Team) {
    this.editingTeam.set(team);
    this.editTeamName.set(team.name);
    this.editOwnerName.set(team.owner);
    const user = this.auctionService.users().find(u => u.teamId === team.id);
    if (user) {
      this.editUsername.set(user.username);
    }
    this.editPassword.set(''); // Clear password field for security
  }

  cancelEditing() {
    this.editingTeam.set(null);
    setTimeout(() => lucide.createIcons(), 50); // Re-render icons after view change
  }

  onUpdateTeam() {
    const team = this.editingTeam();
    if (!team) return;

    const updatedData = {
      teamName: this.editTeamName(),
      ownerName: this.editOwnerName(),
      username: this.editUsername(),
      password: this.editPassword() || undefined,
    };
    
    this.auctionService.updateTeamOwner(team.id, updatedData);
    this.cancelEditing();
  }

  onDeleteTeam(team: Team) {
    if (confirm(`Are you sure you want to delete the team "${team.name}" and its owner? This action cannot be undone.`)) {
      this.auctionService.deleteTeamOwner(team.id);
    }
  }

  onCreatePlayer() {
    if (this.newPlayerName()) {
        this.auctionService.createPlayer({
            name: this.newPlayerName(),
            role: this.newPlayerRole()
        });
        this.newPlayerName.set('');
        this.newPlayerRole.set('Staff');
    }
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
    if (confirm(`Are you sure you want to permanently delete player "${player.name}"? This cannot be undone.`)) {
        this.auctionService.deletePlayer(player.id);
    }
  }

  onStopAuction() {
    if (confirm('Are you sure you want to end the auction? The current results will be displayed.')) {
      this.auctionService.stopAuction();
      setTimeout(() => lucide.createIcons(), 50);
    }
  }
  
  onResetAuction() {
    if (confirm('Are you sure you want to start a new auction? This will clear all drafted players and return you to the lobby.')) {
      this.auctionService.resetAuction();
      setTimeout(() => lucide.createIcons(), 50);
    }
  }

  getUserForTeam(teamId: number): User | undefined {
    return this.auctionService.users().find(u => u.teamId === teamId);
  }

  getRoleColor(role: Player['role']): string {
    switch (role) {
      case 'Staff': return 'text-blue-400';
      case 'Technician': return 'text-yellow-400';
      case 'Contractual Worker': return 'text-purple-400';
      default: return 'text-gray-400';
    }
  }

  getCaptainRoleColor(role: 'Staff' | 'Technician'): string {
    switch (role) {
      case 'Staff': return 'bg-blue-500 text-blue-100';
      case 'Technician': return 'bg-yellow-500 text-yellow-100';
    }
  }
}
