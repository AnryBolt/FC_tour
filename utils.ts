
import { Player, Match, PlayerStats, TournamentConfig, Group, MatchType } from './types';

export const calculateStandings = (players: Player[], matches: Match[]): PlayerStats[] => {
  // Initialize stats
  const statsMap = new Map<number, PlayerStats>();
  
  players.forEach(p => {
    statsMap.set(p.id, {
      ...p,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
      extraPoints: 0
    });
  });

  // Process matches
  matches.forEach(m => {
    if (!m.completed) return;
    if (m.homeScore === null || m.awayScore === null) return;

    const home = statsMap.get(m.homeId);
    const away = statsMap.get(m.awayId);

    if (home && away) {
        // Logic for League/Group matches
        if (m.type === 'league' || m.type === 'group') {
            home.played++;
            away.played++;
            
            home.goalsFor += m.homeScore;
            home.goalsAgainst += m.awayScore;
            away.goalsFor += m.awayScore;
            away.goalsAgainst += m.homeScore;

            if (m.homeScore > m.awayScore) {
                home.won++;
                away.lost++;
                home.points += 3;
            } else if (m.homeScore < m.awayScore) {
                away.won++;
                home.lost++;
                away.points += 1;
                home.points += 1; // Assuming standard scoring, usually draws are 1 point
            } else {
                home.drawn++;
                away.drawn++;
                home.points += 1;
                away.points += 1;
            }
        }
        // Logic for Extra Matches (Additional Indicator)
        else if (m.type === 'extra') {
            if (m.homeScore > m.awayScore) {
                home.extraPoints += 1;
            } else if (m.awayScore > m.homeScore) {
                away.extraPoints += 1;
            }
            // Draws in extra matches typically don't award the specific "winner" point requested
        }
    }
  });

  // Calculate Goal Diff and return array
  const stats = Array.from(statsMap.values()).map(s => ({
    ...s,
    goalDiff: s.goalsFor - s.goalsAgainst
  }));

  // Sort: Points -> Extra Points -> Goal Diff -> Goals For
  return stats.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.extraPoints !== a.extraPoints) return b.extraPoints - a.extraPoints; // Extra points priority
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
    return b.goalsFor - a.goalsFor;
  });
};

// Berger table algorithm for Round Robin
export const generateLeagueMatches = (players: Player[], matchesPerOpponent: number): Match[] => {
  const matches: Match[] = [];
  let matchIdCounter = 0;
  
  const n = players.length;
  if (n < 2) return [];

  // Create array of player IDs
  // If odd number of players, add -1 as a dummy (Bye)
  const playerIds = players.map(p => p.id);
  if (n % 2 !== 0) {
    playerIds.push(-1);
  }

  const numPlayers = playerIds.length;
  const numRounds = numPlayers - 1;
  const half = numPlayers / 2;

  const teamIndices = playerIds.map((_, i) => i); // Working with indices 0..numPlayers-1

  // Determine rounds for one single pass (everyone plays everyone once)
  const onePassMatches: {round: number, home: number, away: number}[] = [];

  for (let r = 0; r < numRounds; r++) {
      for (let i = 0; i < half; i++) {
          const t1 = teamIndices[i];
          const t2 = teamIndices[numPlayers - 1 - i];

          const homeId = playerIds[t1];
          const awayId = playerIds[t2];

          // If neither is dummy, schedule match
          if (homeId !== -1 && awayId !== -1) {
              // Alternate home/away slightly for balance (not perfect but standard)
              if (r % 2 === 0) {
                  onePassMatches.push({ round: r + 1, home: homeId, away: awayId });
              } else {
                  onePassMatches.push({ round: r + 1, home: awayId, away: homeId });
              }
          }
      }

      // Rotate indices: fixed [0], rotate [1...end]
      // [0, 1, 2, 3] -> [0, 3, 1, 2]
      teamIndices.splice(1, 0, teamIndices.pop()!);
  }

  // Generate actual match objects repeating for matchesPerOpponent
  let currentId = 0;
  for (let loop = 0; loop < matchesPerOpponent; loop++) {
      onePassMatches.forEach(m => {
          // Swap home/away for second leg if applicable
          const isEvenLoop = loop % 2 === 0;
          matches.push({
              id: currentId++,
              type: 'league',
              // Rounds accumulate: 1..N, then N+1..2N
              round: m.round + (loop * numRounds), 
              homeId: isEvenLoop ? m.home : m.away,
              awayId: isEvenLoop ? m.away : m.home,
              homeScore: null,
              awayScore: null,
              completed: false
          });
      });
  }

  return matches;
};

export const generateGroupMatches = (groups: Group[], rounds: number): Match[] => {
  const matches: Match[] = [];
  let matchIdCounter = 0;

  groups.forEach(group => {
    // Generate small league for each group
    const groupPlayers = group.playerIds.map(id => ({ id, name: '' })); // name not needed for generator
    const groupLeague = generateLeagueMatches(groupPlayers, rounds);
    
    groupLeague.forEach(m => {
        m.id = matchIdCounter++;
        m.type = 'group';
        m.groupId = group.id;
        matches.push(m);
    });
  });
  return matches;
};

export const checkLeagueComplete = (matches: Match[], type: MatchType = 'league'): boolean => {
  // If groups, check if all group matches are done
  // If league, check if all league matches are done
  const relevantMatches = matches.filter(m => 
      type === 'league' ? (m.type === 'league' || m.type === 'group') : m.type === type
  );
  
  if (relevantMatches.length === 0) return false;
  return relevantMatches.every(m => m.completed);
};

export const generatePlayoffBracket = (
  qualifiedPlayers: Player[], 
  config: TournamentConfig, 
  startId: number
): Match[] => {
  const matches: Match[] = [];
  let idCounter = startId;
  
  // Ensure power of 2
  const targetCount = Math.pow(2, Math.floor(Math.log2(qualifiedPlayers.length)));
  const players = qualifiedPlayers.slice(0, targetCount);
  const totalRounds = Math.log2(targetCount);

  // Generate Round 1 pairings
  let currentRoundMatches: Match[] = [];
  
  if (config.playoffType === 'seeded') {
    // 1st vs Last, 2nd vs 2nd Last...
    for (let i = 0; i < players.length / 2; i++) {
      // Round 1 matches might be final if only 2 players
      // Force single game only if it's NOT the final, usually we respect the series config everywhere
      // The user requested Final should have same rules as others, so passing false for forceSingleGame unless logic requires it.
      currentRoundMatches.push(createPlayoffMatch(idCounter++, 1, players[i].id, players[players.length - 1 - i].id, false, config.playoffSeriesType));
    }
  } else {
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length / 2; i++) {
      currentRoundMatches.push(createPlayoffMatch(idCounter++, 1, shuffled[i * 2].id, shuffled[i * 2 + 1].id, false, config.playoffSeriesType));
    }
  }
  matches.push(...currentRoundMatches);

  // Generate skeleton for subsequent rounds
  let prevRoundSize = currentRoundMatches.length;
  for (let r = 2; r <= totalRounds; r++) {
    const currentRoundSize = prevRoundSize / 2;
    for (let i = 0; i < currentRoundSize; i++) {
      matches.push(createPlayoffMatch(idCounter++, r, -1, -1, false, config.playoffSeriesType));
    }
    prevRoundSize = currentRoundSize;
  }

  return matches;
};

const createPlayoffMatch = (id: number, round: number, homeId: number, awayId: number, forceSingle: boolean, seriesType: any): Match => ({
  id,
  type: 'playoff',
  round,
  homeId,
  awayId,
  homeScore: null,
  awayScore: null,
  completed: false,
  homeScoreLeg2: null,
  awayScoreLeg2: null,
  leg1Complete: false,
  leg2Complete: false,
  seriesMatches: [],
  forceSingleGame: forceSingle // Now respecting input, mostly false for standard brackets
});

// Helper to update the bracket based on winners
export const updateBracketProgression = (matches: Match[], config: TournamentConfig): Match[] => {
  const updatedMatches = JSON.parse(JSON.stringify(matches));
  const playoffMatches = updatedMatches.filter((m: Match) => m.type === 'playoff');
  
  playoffMatches.sort((a: Match, b: Match) => a.id - b.id);
  const winners = new Map<number, number>();

  playoffMatches.forEach((match: Match) => {
    // Determine which logic to use
    const mode = match.forceSingleGame ? '1_game' : config.playoffSeriesType;
    
    let isComplete = false;
    let winnerId = null;

    if (mode === '2_legs') {
        isComplete = !!match.leg2Complete;
        if (isComplete) {
            const homeAgg = (match.homeScore || 0) + (match.homeScoreLeg2 || 0);
            const awayAgg = (match.awayScore || 0) + (match.awayScoreLeg2 || 0);
            if (homeAgg > awayAgg) winnerId = match.homeId;
            else if (awayAgg > homeAgg) winnerId = match.awayId;
            else winnerId = match.homeId; // Simplified tie-break
        }
    } else if (mode === 'best_of_3' || mode === 'best_of_5') {
        const targetWins = mode === 'best_of_3' ? 2 : 3;
        let winsH = 0;
        let winsA = 0;
        
        if (match.seriesMatches) {
            match.seriesMatches.forEach((g: any) => {
                if (g.home > g.away) winsH++;
                else if (g.away > g.home) winsA++;
            });
        }
        
        if (winsH >= targetWins) {
            isComplete = true;
            winnerId = match.homeId;
        } else if (winsA >= targetWins) {
            isComplete = true;
            winnerId = match.awayId;
        }
        
        match.completed = isComplete;
    } else {
        // 1_game (Standard)
        isComplete = !!match.completed;
        if (isComplete) {
             if ((match.homeScore || 0) > (match.awayScore || 0)) winnerId = match.homeId;
             else winnerId = match.awayId;
        }
    }

    if (isComplete && winnerId !== null) {
        match.winnerId = winnerId;
        match.completed = true; // Ensure flag is set
        winners.set(match.id, winnerId);
    }
  });

  // Propagate
  const roundsMap = new Map<number, Match[]>();
  playoffMatches.forEach((m: Match) => {
    const r = m.round || 1;
    if (!roundsMap.has(r)) roundsMap.set(r, []);
    roundsMap.get(r)!.push(m);
  });

  const maxRound = Math.max(...Array.from(roundsMap.keys()));

  for (let r = 1; r < maxRound; r++) {
      const currentRoundMatches = roundsMap.get(r) || [];
      const nextRoundMatches = roundsMap.get(r + 1) || [];

      currentRoundMatches.sort((a, b) => a.id - b.id);
      nextRoundMatches.sort((a, b) => a.id - b.id);

      for (let i = 0; i < nextRoundMatches.length; i++) {
          const nextMatch = nextRoundMatches[i];
          const parent1 = currentRoundMatches[i * 2];
          const parent2 = currentRoundMatches[i * 2 + 1];

          if (parent1 && winners.has(parent1.id)) {
              nextMatch.homeId = winners.get(parent1.id)!;
          }
          if (parent2 && winners.has(parent2.id)) {
              nextMatch.awayId = winners.get(parent2.id)!;
          }
      }
  }

  return updatedMatches.map((m: Match) => {
     if (m.type !== 'playoff') return m;
     const updated = playoffMatches.find((pm: Match) => pm.id === m.id);
     return updated || m;
  });
};
