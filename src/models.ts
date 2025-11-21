
export interface Player {
  id: number;
  name: string;
  role: 'Staff' | 'Technician' | 'Contractual Worker';
}

export interface Team {
  id: number;
  name: "Warriors" | "Stallions" | "Titans" | "Gladiators" | string;
  owner: string;
  players: Player[];
  captainRole: 'Staff' | 'Technician';
  color: string;
  logo: string;
}

export interface User {
  id: number;
  username: string;
  password?: string; // In a real app, this would not be here
  role: 'admin' | 'team_owner';
  teamId?: number;
}
