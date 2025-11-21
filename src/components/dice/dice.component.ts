
import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuctionService } from '../../services/auction.service';

@Component({
  selector: 'app-dice',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dice.component.html',
  styleUrls: ['./dice.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiceComponent {
  auctionService = inject(AuctionService);
  
  isRolling = this.auctionService.isRolling;
  diceResultTeam = this.auctionService.diceResult;
  teams = this.auctionService.teams;
  
  cubeClass = computed(() => {
    if (this.isRolling()) {
      return 'rolling';
    }
    const team = this.diceResultTeam();
    if (team) {
      const currentTeams = this.teams();
      const teamIndex = currentTeams.findIndex(t => t.id === team.id);
      switch (teamIndex) {
        case 0: return 'show-front'; // Warriors
        case 1: return 'show-right'; // Stallions
        case 2: return 'show-back';  // Titans
        case 3: return 'show-left';  // Gladiators
        default: return ''; // For teams beyond the 4th, or if not found
      }
    }
    return '';
  });
}
