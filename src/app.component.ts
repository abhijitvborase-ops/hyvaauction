import { FirebaseService } from './services/firebase.service';
import { Component, ChangeDetectionStrategy, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { signal } from '@angular/core';

import { AuctionService } from './services/auction.service';
import { DiceComponent } from './components/dice/dice.component';
import { Player, Team, User } from './models';

import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { ViewChild, ElementRef } from '@angular/core';


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

private buildExportRows(scope: 'all' | 'mine'): { team: string; owner: string; player: string; role: string }[] {
    const teams = this.auctionService.teams();
    const currentUser = this.auctionService.currentUser();

    let filteredTeams = teams;

    // team owner असेल तर त्याला फक्त स्वतःची team
    if (scope === 'mine' && currentUser && currentUser.role === 'team_owner' && currentUser.teamId) {
      filteredTeams = teams.filter(t => t.id === currentUser.teamId);
    }

    const rows: { team: string; owner: string; player: string; role: string }[] = [];

    for (const team of filteredTeams) {
      for (const player of team.players) {
        rows.push({
          team: team.name,
          owner: team.owner,
          player: player.name,
          role: player.role,
        });
      }
    }

    return rows;
  }
    exportDraftToExcelAll() {
    const rows = this.buildExportRows('all');
    this.exportRowsToExcel(rows, 'auction_draft_all_teams');
  }

  exportDraftToExcelMine() {
    const rows = this.buildExportRows('mine');
    this.exportRowsToExcel(rows, 'auction_draft_my_team');
  }

  private exportRowsToExcel(
    rows: { team: string; owner: string; player: string; role: string }[],
    fileName: string
  ) {
    if (!rows.length) {
      alert('Export करण्यासाठी players नाहीत.');
      return;
    }

    const header = ['Team', 'Owner', 'Player', 'Role'];
    const data = rows.map(r => [r.team, r.owner, r.player, r.role]);

    const worksheet = XLSX.utils.aoa_to_sheet([header, ...data]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Draft');

    XLSX.writeFile(workbook, `${fileName}.xlsx`);
  }
  async exportDraftToPng() {
    if (!this.exportTable) {
      alert('Export table सापडली नाही.');
      return;
    }

    const element = this.exportTable.nativeElement as HTMLElement;

    const canvas = await html2canvas(element, {
      scale: 2,         // थोडा जास्त quality
      useCORS: true,
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'auction_draft.png';
      link.click();
      URL.revokeObjectURL(url);
    });
  }
  // Form signals for login
    loginUsername = '';
    loginPassword = '';
  
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

  // Computed signal to find the current user's team
  currentUserTeam = computed(() => {
    const user = this.auctionService.currentUser();
    if (user?.role !== 'team_owner' || !user.teamId) {
      return null;
    }
    return this.auctionService.teams().find(t => t.id === user.teamId) ?? null;
  });

  ngOnInit() {
    // This is needed to render icons initially
    setTimeout(() => lucide.createIcons(), 50);
    console.log(
      'Firebase initialized, projectId =',
      this.firebase.app.options['projectId']
    );
  }
  
  onLogin() {
     this.auctionService.login(this.loginUsername, this.loginPassword);
  }
closeDraftAnnouncement() {
  this.auctionService.lastDraftedPlayerInfo.set(null);
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

  async onDraftPlayer(player: Player) {
  // Safe check – माझाच turn आहे का ते
  if (!this.auctionService.isMyTurn()) {
    return;
  }

  const ok = window.confirm(
    `Are you sure you want to draft "${player.name}" for your team?`
  );

  if (!ok) {
    // User ने "Cancel / No" निवडलं
    return;
  }

  // User ने Yes केलं → actual draft call
  await this.auctionService.draftPlayer(player);
}


  onUndoLastDraft() {
  // जर काहीच undo करायला नसेल तर काही करू नको
  if (!this.auctionService.canUndo()) {
    return;
  }

  const ok = confirm(
    'Are you sure you want to undo the last pick?\n\n' +
    '➤ The player will return to the Available Players list.\n' +
    '➤ The previous team will get its turn again.'
  );

  if (!ok) {
    return;
  }

  this.auctionService.undoLastDraft();
  setTimeout(() => lucide.createIcons(), 50);
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
  getBgColor(borderColor: string): string {
    return borderColor.replace('border-', 'bg-');
  }

  getTextColor(borderColor: string): string {
    if (!borderColor) return 'text-gray-100';
    return borderColor.replace('border-', 'text-');
  }
}