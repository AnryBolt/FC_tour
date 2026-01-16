
export interface Player {
  id: number;
  name: string;
  telegram?: string;
}

export interface UserProfile {
  telegram: string;
  status: 'admin' | 'user';
  fullName: string;
  age: string;
  company: string;
}

export interface PlayerStats extends Player {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  extraPoints: number;
}

export type MatchType = 'league' | 'group' | 'playoff' | 'third_place' | 'extra';
export type PlayoffSeriesType = '1_game' | '2_legs' | 'best_of_3' | 'best_of_5';

export interface SeriesMatch {
  home: number;
  away: number;
  authorName?: string;
  confirmedBy?: string;
}

export interface ProposedScore {
  home: number;
  away: number;
  proposedBy: number;
  isLeg2?: boolean;
  seriesGame?: SeriesMatch;
  seriesMatches?: SeriesMatch[];
}

export interface Match {
  id: number;
  type: MatchType;
  round?: number;
  homeId: number;
  awayId: number;
  homeScore: number | null;
  awayScore: number | null;
  completed: boolean;
  groupId?: number;
  
  // Playoff specific
  homeScoreLeg2?: number | null;
  awayScoreLeg2?: number | null;
  leg1Complete?: boolean;
  leg2Complete?: boolean;
  seriesMatches?: SeriesMatch[];
  forceSingleGame?: boolean;
  winnerId?: number;
  
  // Confirmation
  isConfirmed?: boolean;
  proposedScore?: ProposedScore | null;
  
  // Auditing
  lastUpdatedBy?: string;
  authorName?: string;
  confirmedBy?: string;
}

export interface Group {
  id: number;
  name: string;
  playerIds: number[];
}

export interface TournamentConfig {
  name: string;
  playerCount: number;
  format: 'league_playoff' | 'playoff_only' | 'league_only' | 'groups_playoff';
  matchesPerOpponent: number;
  groupCount: number;
  groupMatchesPerOpponent: number;
  qualifiersPerGroup: number;
  playoffType: 'seeded' | 'random';
  playoffSeriesType: PlayoffSeriesType;
  playoffQualifiers: number;
  playoffLegs?: number; // legacy
}

export interface TournamentData {
  config: TournamentConfig;
  players: Player[];
  matches: Match[];
  groups: Group[];
  createdAt: string;
  status: 'created' | 'started';
  applications: UserProfile[];
  lastSaved?: string;
}