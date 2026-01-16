
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  TournamentData, Player, Match, TournamentConfig, 
  PlayerStats, Group, UserProfile, ProposedScore, SeriesMatch
} from './types';
import { 
  calculateStandings, generateLeagueMatches, 
  generateGroupMatches, generatePlayoffBracket, 
  updateBracketProgression, checkLeagueComplete
} from './utils';
import { Button } from './components/Button';
import { Input, Select } from './components/Input';
import { MatchCard } from './components/MatchCard';
import { analyzeTournament } from './services/geminiService';
import { initializeCloudStorage, saveToCloud } from './services/storageService';
import * as XLSX from 'xlsx';

type TabType = 'profile' | 'setup' | 'matches' | 'standings' | 'playoff' | 'saved' | 'users';

const groupMatchesByRound = (matches: Match[]) => {
  return matches.reduce((groups, match) => {
    const round = match.round || 0;
    if (!groups[round]) groups[round] = [];
    groups[round].push(match);
    return groups;
  }, {} as Record<number, Match[]>);
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem('fc25_admin_auth') === 'true' || localStorage.getItem('fc25_user_auth') === 'true';
  });
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    return localStorage.getItem('fc25_admin_auth') === 'true';
  });

  const [loginAdminUsername, setLoginAdminUsername] = useState('');
  const [loginAdminPassword, setLoginAdminPassword] = useState('');
  const [loginGuestUsername, setLoginGuestUsername] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [tournament, setTournament] = useState<TournamentData | null>(null);
  const [expandedRounds, setExpandedRounds] = useState<Record<number, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  
  // Cloud Loading State
  const [isCloudLoading, setIsCloudLoading] = useState(true);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'synced' | 'saving' | 'error'>('synced');

  const [allUsers, setAllUsers] = useState<UserProfile[]>([]); // Initial empty, loads from cloud
  const [savedTournaments, setSavedTournaments] = useState<TournamentData[]>([]); // Initial empty, loads from cloud

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('fc25_user_profile');
    if (saved) return JSON.parse(saved);
    return {
      telegram: '',
      status: 'user',
      fullName: '',
      age: '',
      company: ''
    };
  });

  const currentPlayerId = useMemo(() => {
    if (!tournament) return undefined;
    const p = tournament.players.find(p => p.telegram?.toLowerCase() === userProfile.telegram.toLowerCase());
    return p?.id;
  }, [tournament, userProfile.telegram]);

  const [sortConfig, setSortConfig] = useState<{ key: keyof UserProfile; direction: 'asc' | 'desc' }>({
    key: 'telegram',
    direction: 'asc'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [setupConfig, setSetupConfig] = useState<TournamentConfig>({
    name: '',
    playerCount: 0,
    format: 'league_playoff',
    matchesPerOpponent: 1,
    groupCount: 2,
    groupMatchesPerOpponent: 1,
    qualifiersPerGroup: 2,
    playoffType: 'seeded',
    playoffSeriesType: '1_game',
    playoffQualifiers: 4,
  });
  
  const [analysis, setAnalysis] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // --- CLOUD INITIALIZATION ---
  useEffect(() => {
    const initCloud = async () => {
        setIsCloudLoading(true);
        const data = await initializeCloudStorage();
        setAllUsers(data.users || []);
        setSavedTournaments(data.tournaments || []);
        setIsCloudLoading(false);
    };
    initCloud();
  }, []);

  // --- AUTO SAVE TO CLOUD (DEBOUNCED) ---
  useEffect(() => {
      if (isCloudLoading) return; // Don't overwrite cloud with empty initial state

      const saveData = async () => {
         setCloudSyncStatus('saving');
         await saveToCloud({
             users: allUsers,
             tournaments: savedTournaments
         });
         setCloudSyncStatus('synced');
      };

      const timer = setTimeout(saveData, 2000); // 2 second debounce
      return () => clearTimeout(timer);
  }, [allUsers, savedTournaments, isCloudLoading]);


  // Sync current profile to local storage (User session remains local)
  useEffect(() => {
    if (isAuthenticated) {
      localStorage.setItem('fc25_user_profile', JSON.stringify(userProfile));
      
      // Ensure user is in the database (synced to allUsers which goes to cloud)
      setAllUsers(prev => {
        const existing = prev.find(u => u.telegram.toLowerCase() === userProfile.telegram.toLowerCase());
        if (!existing && userProfile.telegram) {
            return [...prev, userProfile];
        } else if (existing && (existing.fullName !== userProfile.fullName || existing.company !== userProfile.company || existing.age !== userProfile.age)) {
            // Update existing profile info if changed
            return prev.map(u => u.telegram.toLowerCase() === userProfile.telegram.toLowerCase() ? userProfile : u);
        }
        return prev;
      });
    }
  }, [userProfile, isAuthenticated]);

  // AUTO-UPDATE SAVED LIST logic
  // Whenever the ACTIVE tournament changes, update it in the savedTournaments list
  useEffect(() => {
      if (tournament) {
          setSavedTournaments(prev => {
              const newList = [...prev];
              const index = newList.findIndex(t => t.createdAt === tournament.createdAt);
              if (index !== -1) {
                  newList[index] = { ...tournament, lastSaved: new Date().toISOString() };
              } else {
                  newList.push({ ...tournament, lastSaved: new Date().toISOString() });
              }
              return newList;
          });
      }
  }, [tournament?.matches, tournament?.players, tournament?.applications, tournament?.config, tournament?.status]);

  const findUserByTelegram = (tg: string) => {
    return allUsers.find(u => u.telegram.toLowerCase() === tg.toLowerCase());
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginAdminUsername === 'Anry_B' && loginAdminPassword === 'eys87iim') {
      setIsAuthenticated(true);
      setIsAdmin(true);
      
      const existing = findUserByTelegram(loginAdminUsername);
      const profile = existing || {
        telegram: loginAdminUsername,
        status: 'admin',
        fullName: '',
        age: '',
        company: ''
      };
      setUserProfile(profile as UserProfile);
      
      localStorage.setItem('fc25_admin_auth', 'true');
      localStorage.removeItem('fc25_user_auth');
      setLoginError('');
      setActiveTab('profile');
    } else {
      setLoginError('Неверный логин или пароль');
    }
  };

  const handleGuestLogin = () => {
    const tg = loginGuestUsername.trim();
    if (tg.toLowerCase() === 'anry_b') {
      setLoginError('Anry_B должен использовать пароль для входа');
      return;
    }
    
    setIsAuthenticated(true);
    setIsAdmin(false);

    const existing = findUserByTelegram(tg);
    const profile = existing || {
      telegram: tg || '',
      status: 'user',
      fullName: '',
      age: '',
      company: ''
    };
    setUserProfile(profile as UserProfile);

    localStorage.setItem('fc25_user_auth', 'true');
    localStorage.removeItem('fc25_admin_auth');
    setLoginError('');
    setActiveTab('profile');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setIsAdmin(false);
    localStorage.removeItem('fc25_admin_auth');
    localStorage.removeItem('fc25_user_auth');
    localStorage.removeItem('fc25_user_profile');
    setUserProfile({
      telegram: '',
      status: 'user',
      fullName: '',
      age: '',
      company: ''
    });
  };

  const handleSaveProfile = () => {
    if (!userProfile.telegram) {
      alert('Укажите ник в Telegram для сохранения');
      return;
    }

    setAllUsers(prev => {
      const filtered = prev.filter(u => u.telegram.toLowerCase() !== userProfile.telegram.toLowerCase());
      return [...filtered, userProfile];
    });
    alert('Профиль сохранен!');
  };

  const sortedUsersList = useMemo(() => {
    const list = [...allUsers];
    list.sort((a, b) => {
      const aVal = String(a[sortConfig.key] || '').toLowerCase();
      const bVal = String(b[sortConfig.key] || '').toLowerCase();
      
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [allUsers, sortConfig]);

  const requestSort = (key: keyof UserProfile) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const saveToLocalStorage = (currentTournament: TournamentData) => {
     alert("Турнир автоматически сохраняется в облако!");
  };

  const deleteSaved = (index: number, e: React.MouseEvent) => {
     if (!isAdmin) return;
     e.stopPropagation();
     const tToDelete = savedTournaments[index];
     if (!tToDelete) return;

     if (window.confirm(`Вы уверены, что хотите навсегда удалить турнир "${tToDelete.config.name}"? Это действие нельзя отменить.`)) {
         setSavedTournaments(prev => prev.filter((_, i) => i !== index));
         if (tournament?.createdAt === tToDelete.createdAt) setTournament(null);
     }
  };

  const handleDeleteCurrent = () => {
      if (!isAdmin || !tournament) return;
      if (!window.confirm(`Закрыть текущий турнир "${tournament.config.name}"?`)) return;
      setTournament(null);
      setActiveTab('setup');
  };

  const handleExportJSON = () => {
      if (!tournament) return;
      const dataStr = JSON.stringify(tournament, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${tournament.config.name.replace(/\s+/g, '_')}_FC25.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setShowExportMenu(false);
  };

  const handleExportXLSX = () => {
      if (!tournament) return;
      const wb = XLSX.utils.book_new();
      const standingsData = calculateStandings(tournament.players, tournament.matches).map((s, i) => ({
          "Место": i + 1,
          "Игрок": s.name,
          "Telegram": s.telegram || "-",
          "Игры": s.played,
          "В": s.won,
          "Н": s.drawn,
          "П": s.lost,
          "ЗМ": s.goalsFor,
          "ПМ": s.goalsAgainst,
          "РМ": s.goalDiff,
          "Очки": s.points,
          "ДП": s.extraPoints
      }));
      const wsStandings = XLSX.utils.json_to_sheet(standingsData);
      XLSX.utils.book_append_sheet(wb, wsStandings, "Таблица");

      const matchesData = tournament.matches.map(m => {
          const home = tournament.players.find(p => p.id === m.homeId)?.telegram || "???";
          const away = tournament.players.find(p => p.id === m.awayId)?.telegram || "???";
          let score = "-";
          if (m.completed) {
              score = `${m.homeScore} : ${m.awayScore}`;
          }
          return {
              "ID": m.id + 1,
              "Тип": m.type,
              "Тур/Раунд": m.round,
              "Дома": home,
              "Счет": score,
              "В гостях": away,
              "Статус": m.lastUpdatedBy ? `Обновлено: ${m.lastUpdatedBy}` : (m.completed ? "Завершен" : "Ожидает")
          };
      });
      const wsMatches = XLSX.utils.json_to_sheet(matchesData);
      XLSX.utils.book_append_sheet(wb, wsMatches, "Матчи");
      XLSX.writeFile(wb, `${tournament.config.name.replace(/\s+/g, '_')}_FC25.xlsx`);
      setShowExportMenu(false);
  };

  const handleImportClick = () => {
      if (!isAdmin) return;
      fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const parsed = JSON.parse(event.target?.result as string);
              if (parsed && parsed.config && parsed.players) {
                  if (!parsed.config.playoffSeriesType) {
                      parsed.config.playoffSeriesType = parsed.config.playoffLegs === 2 ? '2_legs' : '1_game';
                  }
                  if (!parsed.createdAt) parsed.createdAt = new Date().toISOString();
                  setTournament(parsed);
                  if (parsed.config.format === 'playoff_only') {
                      setActiveTab('playoff');
                  } else {
                      setActiveTab('matches');
                  }
                  alert("Турнир успешно загружен!");
              } else {
                  alert("Неверный формат файла турнира");
              }
          } catch (err) {
              alert("Ошибка при чтении файла");
          }
      };
      reader.readAsText(file);
      e.target.value = ''; 
  };

  const handleCreateTournament = () => {
    if (!isAdmin) return;
    if (!setupConfig.name) return alert('Введите название турнира');
    
    setTournament({
      config: setupConfig,
      players: [],
      matches: [],
      groups: [],
      createdAt: new Date().toISOString(),
      status: 'created',
      applications: []
    });
    alert('Турнир "' + setupConfig.name + '" успешно создан!');
  };

  const handleApply = () => {
    if (!tournament || !userProfile.telegram) return;
    const alreadyApplied = tournament.applications.some(a => a.telegram.toLowerCase() === userProfile.telegram.toLowerCase());
    const alreadyPlayer = tournament.players.some(p => p.telegram?.toLowerCase() === userProfile.telegram.toLowerCase());
    if (alreadyApplied || alreadyPlayer) return alert('Вы уже подали заявку или участвуете');
    
    setTournament({
      ...tournament,
      applications: [...tournament.applications, userProfile]
    });
    alert('Заявка отправлена!');
  };

  const handleCancelApplication = () => {
      if (!tournament || !userProfile.telegram) return;
      if (tournament.status === 'started') return alert('Турнир уже начался, заявку нельзя отменить');
      
      setTournament({
          ...tournament,
          applications: tournament.applications.filter(a => a.telegram.toLowerCase() !== userProfile.telegram.toLowerCase())
      });
      alert('Заявка отменена');
  };

  const handleApprove = (app: UserProfile) => {
    if (!isAdmin || !tournament) return;
    const newPlayer: Player = {
      id: tournament.players.length,
      name: app.fullName || app.telegram,
      telegram: app.telegram
    };
    setTournament({
      ...tournament,
      players: [...tournament.players, newPlayer],
      applications: tournament.applications.filter(a => a.telegram !== app.telegram)
    });
  };

  const handleReject = (app: UserProfile) => {
    if (!isAdmin || !tournament) return;
    setTournament({
      ...tournament,
      applications: tournament.applications.filter(a => a.telegram !== app.telegram)
    });
  };

  const handleDeletePlayer = (playerId: number) => {
      if (!isAdmin || !tournament) return;
      if (tournament.status === 'started') return alert('Нельзя удалить игрока после начала турнира');
      if (!window.confirm('Удалить участника?')) return;
      
      setTournament({
          ...tournament,
          players: tournament.players.filter(p => p.id !== playerId)
      });
  };

  const handleShufflePlayers = () => {
      if (!isAdmin || !tournament) return;
      if (tournament.status === 'started') return;
      const shuffled = [...tournament.players].sort(() => Math.random() - 0.5);
      setTournament({ ...tournament, players: shuffled });
  };

  const handleMovePlayer = (idx: number, direction: 'up' | 'down') => {
      if (!isAdmin || !tournament) return;
      if (tournament.status === 'started') return;
      const newPlayers = [...tournament.players];
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= newPlayers.length) return;
      [newPlayers[idx], newPlayers[targetIdx]] = [newPlayers[targetIdx], newPlayers[idx]];
      setTournament({ ...tournament, players: newPlayers });
  };

  const handleStartTournament = () => {
    if (!isAdmin || !tournament) return;
    if (tournament.players.length < 2) return alert('Недостаточно участников для начала');

    const players = tournament.players;
    let matches: Match[] = [];
    let groups: Group[] = [];
    const config = { ...setupConfig, playerCount: players.length };

    if (config.format === 'playoff_only') {
        matches = generatePlayoffBracket(players, config, 0);
    } else if (config.format.includes('league')) {
      matches = generateLeagueMatches(players, config.matchesPerOpponent);
    } else if (config.format === 'groups_playoff') {
      const playersPerGroup = Math.ceil(players.length / config.groupCount);
      for(let i=0; i<config.groupCount; i++) {
        const groupPlayers = players.slice(i * playersPerGroup, (i+1) * playersPerGroup);
        groups.push({
          id: i,
          name: `Группа ${String.fromCharCode(65 + i)}`,
          playerIds: groupPlayers.map(p => p.id)
        });
      }
      matches = generateGroupMatches(groups, config.groupMatchesPerOpponent);
    }

    if (matches.length === 0) {
        alert("Ошибка генерации матчей. Проверьте настройки.");
        return;
    }

    setExpandedRounds({ 1: true });
    setTournament({
      ...tournament,
      config,
      players,
      matches,
      groups,
      status: 'started'
    });
    setActiveTab('matches');
  };

  // Direct Admin finalization or score update
  const handleUpdateScore = (matchId: number, home: number, away: number, isLeg2?: boolean) => {
    if (!isAdmin || !tournament) return;
    const authorName = userProfile.telegram || userProfile.fullName || 'Admin';

    let newMatches = tournament.matches.map(m => {
      if (m.id !== matchId) return m;
      
      const updated = { ...m };
      
      if (m.type === 'playoff' && !m.forceSingleGame && tournament.config.playoffSeriesType === '2_legs') {
         if (isLeg2) {
             updated.homeScoreLeg2 = home;
             updated.awayScoreLeg2 = away;
             updated.leg2Complete = true;
         } else {
             updated.homeScore = home;
             updated.awayScore = away;
             updated.leg1Complete = true;
         }
         // Confirming a single leg doesn't confirm the match match unless it's done
         if (updated.leg1Complete && updated.leg2Complete) updated.isConfirmed = true;
      } else {
         updated.homeScore = home;
         updated.awayScore = away;
         updated.completed = true;
         updated.isConfirmed = true;
      }
      
      updated.lastUpdatedBy = authorName;
      updated.authorName = authorName;
      updated.confirmedBy = authorName; // Auto-confirm
      updated.proposedScore = null;
      
      return updated;
    });

    const isPlayoff = tournament.matches.find(m => m.id === matchId)?.type === 'playoff';
    if (isPlayoff) {
       newMatches = updateBracketProgression(newMatches, tournament.config);
       // Re-verify confirmation for 2 legs if logic changed in util
    }
    
    setTournament({ ...tournament, matches: newMatches });
  };

  const handleProposeScore = (matchId: number, score: ProposedScore) => {
      if (!tournament) return;
      const newMatches = tournament.matches.map(m => {
          if (m.id !== matchId) return m;
          return { ...m, proposedScore: score };
      });
      setTournament({ ...tournament, matches: newMatches });
  };

  const handleProcessSeriesGame = (matchId: number, gameIndex: number, action: 'confirm' | 'reject') => {
      if (!tournament) return;
      const match = tournament.matches.find(m => m.id === matchId);
      if (!match || !match.proposedScore || !match.proposedScore.seriesMatches) return;

      const pendingList = match.proposedScore.seriesMatches;
      // The gameIndex passed is relative to the pending list in the MatchCard display
      // However, we need to be careful. MatchCard merges confirmed + pending.
      // We need to know the index WITHIN the proposedScore.seriesMatches array.
      // The MatchCard should pass the correct relative index.
      
      if (gameIndex < 0 || gameIndex >= pendingList.length) return;

      const confirmerName = userProfile.telegram || userProfile.fullName || 'User';
      const proposerId = match.proposedScore.proposedBy;
      const proposer = tournament.players.find(p => p.id === proposerId);
      const proposerName = proposer?.telegram || proposer?.name || 'Игрок';

      let newMatches = tournament.matches.map(m => {
          if (m.id !== matchId) return m;
          const updated = { ...m };
          
          if (action === 'confirm') {
              const gameToConfirm = pendingList[gameIndex];
              const newSeriesHistory = [...(updated.seriesMatches || [])];
              newSeriesHistory.push({
                  ...gameToConfirm,
                  authorName: proposerName,
                  confirmedBy: confirmerName
              });
              updated.seriesMatches = newSeriesHistory;
              updated.lastUpdatedBy = `Подтверждена игра серии`;

              // Check win condition
              const mode = tournament.config.playoffSeriesType;
              if (mode === 'best_of_3' || mode === 'best_of_5') {
                 const targetWins = mode === 'best_of_3' ? 2 : 3;
                 let winsH = 0, winsA = 0;
                 newSeriesHistory.forEach(g => {
                     if (g.home > g.away) winsH++;
                     else if (g.away > g.home) winsA++;
                 });
                 if (winsH >= targetWins || winsA >= targetWins) {
                     updated.completed = true;
                     updated.isConfirmed = true;
                     updated.winnerId = winsH >= targetWins ? updated.homeId : updated.awayId;
                 }
              }
          }
          
          // Remove from pending
          const newPendingList = pendingList.filter((_, i) => i !== gameIndex);
          
          if (newPendingList.length === 0) {
              updated.proposedScore = null;
          } else {
              updated.proposedScore = { ...updated.proposedScore!, seriesMatches: newPendingList };
          }

          if (updated.completed) updated.proposedScore = null; // Clear all pending if series over

          return updated;
      });

      newMatches = updateBracketProgression(newMatches, tournament.config);
      setTournament({ ...tournament, matches: newMatches });
  };

  const handleConfirmScore = (matchId: number) => {
      if (!tournament) return;
      const match = tournament.matches.find(m => m.id === matchId);
      if (!match || !match.proposedScore) return;

      // Legacy handler - mostly used for single games or 2-legged ties
      // For series, we now prefer handleProcessSeriesGame, but we keep this as a fallback for "Approve All" if needed
      // or for the older non-series types.

      const { home, away, isLeg2, proposedBy, seriesGame, seriesMatches } = match.proposedScore;
      const proposer = tournament.players.find(p => p.id === proposedBy);
      const proposerName = proposer?.telegram || proposer?.name || 'Игрок';
      const confirmerName = userProfile.telegram || userProfile.fullName || 'User';

      let newMatches = tournament.matches.map(m => {
          if (m.id !== matchId) return m;
          const updated = { ...m };
          
          if (m.type === 'playoff' && !m.forceSingleGame && tournament.config.playoffSeriesType === '2_legs') {
            if (isLeg2) {
                updated.homeScoreLeg2 = home;
                updated.awayScoreLeg2 = away;
                updated.leg2Complete = true;
            } else {
                updated.homeScore = home;
                updated.awayScore = away;
                updated.leg1Complete = true;
            }
            if (updated.leg1Complete && updated.leg2Complete) updated.isConfirmed = true;
            updated.lastUpdatedBy = `Подтвержден: ${confirmerName}`;
          } else if (m.type === 'playoff' && (tournament.config.playoffSeriesType === 'best_of_3' || tournament.config.playoffSeriesType === 'best_of_5')) {
             // Fallback for series: confirm all pending
             if (seriesMatches && seriesMatches.length > 0) {
                 const newSeriesHistory = [...(updated.seriesMatches || [])];
                 seriesMatches.forEach(g => {
                     newSeriesHistory.push({
                         home: g.home, away: g.away,
                         authorName: proposerName, confirmedBy: confirmerName
                     });
                 });
                 updated.seriesMatches = newSeriesHistory;
                 updated.proposedScore = null;
                 
                 // Check win
                 const mode = tournament.config.playoffSeriesType;
                 const targetWins = mode === 'best_of_3' ? 2 : 3;
                 let winsH = 0, winsA = 0;
                 newSeriesHistory.forEach(g => { if (g.home > g.away) winsH++; else if (g.away > g.home) winsA++; });
                 if (winsH >= targetWins || winsA >= targetWins) {
                     updated.completed = true;
                     updated.isConfirmed = true;
                     updated.winnerId = winsH >= targetWins ? updated.homeId : updated.awayId;
                 }
             }
          } else {
             // League or Groups or Single Game Playoff
             updated.homeScore = home;
             updated.awayScore = away;
             updated.completed = true;
             updated.isConfirmed = true;
             updated.lastUpdatedBy = `Подтвержден: ${confirmerName}`;
          }
          
          if (!updated.seriesMatches) updated.proposedScore = null;
          updated.authorName = proposerName;
          updated.confirmedBy = confirmerName;
          
          return updated;
      });

      if (match.type === 'playoff') {
          newMatches = updateBracketProgression(newMatches, tournament.config);
      }
      setTournament({ ...tournament, matches: newMatches });
  };

  const handleRejectScore = (matchId: number) => {
      if (!tournament) return;
      const rejecterName = userProfile.telegram || userProfile.fullName || 'User';
      const newMatches = tournament.matches.map(m => {
          if (m.id !== matchId) return m;
          return { 
              ...m, 
              proposedScore: null, 
              lastUpdatedBy: `Отклонено ❌: ${rejecterName}`
          };
      });
      setTournament({ ...tournament, matches: newMatches });
  };

  const handleAddSeriesBatch = (matchId: number, games: {home: number, away: number}[]) => {
     if (!tournament) return;
     const match = tournament.matches.find(m => m.id === matchId);
     if (!match) return;

     const isParticipant = currentPlayerId !== undefined && (match.homeId === currentPlayerId || match.awayId === currentPlayerId);
     if (!isAdmin && !isParticipant) return;

     const authorName = userProfile.telegram || userProfile.fullName || (isAdmin ? 'Admin' : 'User');

     if (isAdmin) {
         // Admin Direct Update: Add games immediately
         let newMatches = tournament.matches.map(m => {
             if (m.id !== matchId) return m;
             const updated = { ...m };
             const newSeries = [...(updated.seriesMatches || [])];
             games.forEach(g => {
                 newSeries.push({
                     home: g.home, 
                     away: g.away,
                     authorName: authorName,
                     confirmedBy: authorName
                 });
             });
             updated.seriesMatches = newSeries;
             updated.lastUpdatedBy = authorName;

             // Check win condition immediately for Admin
             const mode = tournament.config.playoffSeriesType;
             if (mode === 'best_of_3' || mode === 'best_of_5') {
                const targetWins = mode === 'best_of_3' ? 2 : 3;
                let winsH = 0;
                let winsA = 0;
                newSeries.forEach(g => {
                     if (g.home > g.away) winsH++;
                     else if (g.away > g.home) winsA++;
                });
                if (winsH >= targetWins || winsA >= targetWins) {
                     updated.completed = true;
                     updated.isConfirmed = true;
                     updated.winnerId = winsH >= targetWins ? updated.homeId : updated.awayId;
                }
             }

             return updated;
         });
         newMatches = updateBracketProgression(newMatches, tournament.config);
         setTournament({ ...tournament, matches: newMatches });
     } else {
         // User Proposal: Merge with existing proposal or create new
         // This allows incremental addition: enter game 1 -> send -> enter game 2 -> send
         
         let currentPending = match.proposedScore?.seriesMatches || [];
         
         // Fix: Check if proposedScore exists but isn't a series proposal (shouldn't happen with correct flow but safe to check)
         if (match.proposedScore && !match.proposedScore.seriesMatches) {
             currentPending = []; 
         }

         const newPending = [...currentPending, ...games];

         const proposal: ProposedScore = {
             home: 0, away: 0, // Placeholder
             proposedBy: currentPlayerId!,
             seriesMatches: newPending
         };
         handleProposeScore(matchId, proposal);
     }
  };

  const handleDeleteSeriesGame = (matchId: number, gameIndex: number) => {
      if (!tournament || !isAdmin) return;
      let newMatches = tournament.matches.map(m => {
          if (m.id !== matchId) return m;
          const updated = { ...m };
          if (updated.seriesMatches) {
              updated.seriesMatches = updated.seriesMatches.filter((_, i) => i !== gameIndex);
              updated.completed = false; // Reset completion if game removed
              updated.isConfirmed = false;
              updated.winnerId = undefined;
          }
          return updated;
      });
      newMatches = updateBracketProgression(newMatches, tournament.config);
      setTournament({ ...tournament, matches: newMatches });
  };

  const handleAddExtraMatch = (groupId?: number) => {
      if (!isAdmin || !tournament) return;
      const maxId = Math.max(...tournament.matches.map(m => m.id), 0);
      const newMatch: Match = {
          id: maxId + 1,
          type: 'extra',
          groupId,
          homeId: -1,
          awayId: -1,
          homeScore: null,
          awayScore: null,
          completed: false,
          isConfirmed: false
      };
      setTournament({
          ...tournament,
          matches: [...tournament.matches, newMatch]
      });
  };

  const handleUpdateExtraMatchPlayers = (matchId: number, type: 'home'|'away', playerId: number) => {
      if (!isAdmin || !tournament) return;
      const newMatches = tournament.matches.map(m => {
          if (m.id !== matchId) return m;
          return type === 'home' ? { ...m, homeId: playerId } : { ...m, awayId: playerId };
      });
      setTournament({ ...tournament, matches: newMatches });
  };

  const handleDeleteMatch = (matchId: number) => {
      if (!isAdmin || !tournament) return;
      if (!window.confirm("Удалить этот дополнительный матч?")) return;
      const newMatches = tournament.matches.filter(m => m.id !== matchId);
      setTournament({ ...tournament, matches: newMatches });
  };

  const handleSimulateLeague = () => {
    if (!isAdmin || !tournament) return;
    const newMatches = tournament.matches.map(m => {
      if ((m.type === 'league' || m.type === 'group') && !m.completed) {
        const h = Math.floor(Math.random() * 5);
        const a = Math.floor(Math.random() * 5);
        return { ...m, homeScore: h, awayScore: a, completed: true, isConfirmed: true, lastUpdatedBy: 'Simulation', authorName: 'Simulation', confirmedBy: 'Simulation' };
      }
      return m;
    });
    
    setTournament({ ...tournament, matches: newMatches });
    alert("Групповые/Лиговые матчи симулированы!");
  };

  const handleSimulatePlayoff = () => {
      if (!isAdmin || !tournament) return;
      let newMatches = [...tournament.matches];
      let changed = false;

      newMatches = newMatches.map(m => {
          if (m.type === 'playoff' && !m.completed && m.homeId !== -1 && m.awayId !== -1) {
              const mode = m.forceSingleGame ? '1_game' : tournament.config.playoffSeriesType;
              changed = true;

              const simAttrs = { authorName: 'Simulation', confirmedBy: 'Simulation', lastUpdatedBy: 'Simulation' };

              if (mode === '1_game') {
                  let h = Math.floor(Math.random() * 4);
                  let a = Math.floor(Math.random() * 4);
                  if (h === a) h++;
                  return { ...m, homeScore: h, awayScore: a, completed: true, isConfirmed: true, ...simAttrs };
              } 
              else if (mode === '2_legs') {
                  if (!m.leg1Complete) {
                       return { ...m, homeScore: Math.floor(Math.random()*4), awayScore: Math.floor(Math.random()*4), leg1Complete: true, lastUpdatedBy: 'Simulation' };
                  } else if (!m.leg2Complete) {
                       return { ...m, homeScoreLeg2: Math.floor(Math.random()*4), awayScoreLeg2: Math.floor(Math.random()*4), leg2Complete: true, isConfirmed: true, ...simAttrs };
                  }
              } 
              else if (mode === 'best_of_3' || mode === 'best_of_5') {
                  const target = mode === 'best_of_3' ? 2 : 3;
                  // If no games or partial, simulate rest
                  const currentSeries = m.seriesMatches || [];
                  let hWins = 0, aWins = 0;
                  currentSeries.forEach(g => { if(g.home > g.away) hWins++; else aWins++; });
                  
                  const newSeries = [...currentSeries];
                  while(hWins < target && aWins < target) {
                      let h = Math.floor(Math.random() * 3);
                      let a = Math.floor(Math.random() * 3);
                      if (h === a) h++;
                      if (h > a) hWins++; else aWins++;
                      newSeries.push({ home: h, away: a, authorName: 'Sim', confirmedBy: 'Sim' });
                  }
                  return { ...m, seriesMatches: newSeries, isConfirmed: true, ...simAttrs }; 
              }
          }
          return m;
      });

      if (changed) {
          newMatches = updateBracketProgression(newMatches, tournament.config);
          setTournament({ ...tournament, matches: newMatches });
          alert("Раунд плей-офф симулирован!");
      } else {
          alert("Нет доступных матчей для симуляции.");
      }
  };

  const standings = useMemo(() => {
    if (!tournament || tournament.status !== 'started') return [];
    return calculateStandings(tournament.players, tournament.matches);
  }, [tournament]);

  const handleGeneratePlayoff = () => {
    if (!isAdmin || !tournament) return;
    
    let qualified: Player[] = [];
    
    if (tournament.config.format === 'groups_playoff') {
        const perGroup = tournament.config.qualifiersPerGroup;
        tournament.groups.forEach(group => {
            const groupMatches = tournament.matches.filter(m => m.groupId === group.id);
            const groupPlayers = tournament.players.filter(p => group.playerIds.includes(p.id));
            const groupStats = calculateStandings(groupPlayers, groupMatches);
            qualified.push(...groupStats.slice(0, perGroup));
        });
    } else {
        qualified = standings.slice(0, tournament.config.playoffQualifiers);
    }
    
    if (qualified.length < 2) {
        alert("Недостаточно игроков для плей-офф!");
        return;
    }

    const maxId = Math.max(...tournament.matches.map(m => m.id), 0);
    const playoffMatches = generatePlayoffBracket(qualified, tournament.config, maxId + 1);

    setTournament({
      ...tournament,
      matches: [...tournament.matches, ...playoffMatches]
    });
  };

  const handleAnalyze = async () => {
    if (!tournament || tournament.status !== 'started') return;
    setIsAnalyzing(true);
    const playersMap = new Map<number, string>(tournament.players.map(p => [p.id, p.telegram || p.name]));
    const completedMatches = tournament.matches.filter(m => m.completed);
    const result = await analyzeTournament(standings, completedMatches, playersMap);
    setAnalysis(result);
    setIsAnalyzing(false);
  };

  const toggleRound = (round: number) => setExpandedRounds(prev => ({ ...prev, [round]: !prev[round] }));
  const toggleGroup = (groupId: number) => setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));

  const playerMap = useMemo(() => tournament ? new Map(tournament.players.map(p => [p.id, p])) : new Map<number, Player>(), [tournament]);
  const isLeagueComplete = useMemo(() => tournament ? checkLeagueComplete(tournament.matches) : false, [tournament]);
  const hasPlayoffBracket = tournament?.matches.some(m => m.type === 'playoff');

  // Helper render functions
  
  const renderProfileTab = () => (
    <div className="max-w-2xl mx-auto bg-white p-6 rounded-xl shadow-sm border border-gray-200">
      <h2 className="text-2xl font-bold mb-6 border-b pb-2">Мой профиль</h2>
      <div className="space-y-4">
        <Input 
          label="Ник в Telegram" 
          value={userProfile.telegram} 
          onChange={e => setUserProfile({...userProfile, telegram: e.target.value})}
          placeholder="@username"
        />
        <Input 
          label="Полное имя" 
          value={userProfile.fullName} 
          onChange={e => setUserProfile({...userProfile, fullName: e.target.value})}
        />
        <Input 
          label="Возраст" 
          value={userProfile.age} 
          onChange={e => setUserProfile({...userProfile, age: e.target.value})}
        />
        <Input 
          label="Компания" 
          value={userProfile.company} 
          onChange={e => setUserProfile({...userProfile, company: e.target.value})}
        />
        <div className="pt-4 flex justify-between items-center">
          <Button onClick={handleSaveProfile}>Сохранить изменения</Button>
          <div className="text-xs text-gray-400">
            Статус: <span className={`font-bold ${userProfile.status === 'admin' ? 'text-red-500' : 'text-teal-600'}`}>{userProfile.status}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderUsersTab = () => (
    <div className="max-w-4xl mx-auto bg-white p-6 rounded-xl shadow-sm border border-gray-200">
      <h2 className="text-2xl font-bold mb-6 border-b pb-2">Управление пользователями</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-2 cursor-pointer hover:text-teal-600" onClick={() => requestSort('telegram')}>
                Telegram {sortConfig.key === 'telegram' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-4 py-2 cursor-pointer hover:text-teal-600" onClick={() => requestSort('fullName')}>
                Имя {sortConfig.key === 'fullName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-4 py-2">Статус</th>
              <th className="px-4 py-2">Компания</th>
            </tr>
          </thead>
          <tbody>
            {sortedUsersList.map((user, idx) => (
              <tr key={idx} className="border-b hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-teal-600">{user.telegram}</td>
                <td className="px-4 py-2">{user.fullName || '-'}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${user.status === 'admin' ? 'bg-red-100 text-red-700' : 'bg-teal-100 text-teal-700'}`}>
                    {user.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-500">{user.company || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderPlayoffWinner = () => {
    if (!tournament) return null;
    const playoffMatches = tournament.matches.filter(m => m.type === 'playoff');
    if (playoffMatches.length === 0) return null;

    // Find the max round (Final)
    const maxRound = Math.max(...playoffMatches.map(m => m.round ?? 0));
    const finalMatch = playoffMatches.find(m => m.round === maxRound);

    if (finalMatch && finalMatch.completed && finalMatch.winnerId !== undefined) {
        const winner = playerMap.get(finalMatch.winnerId);
        if (winner) {
            return (
              <div className="mt-8 text-center p-8 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-2xl border-2 border-yellow-200 shadow-lg animate-in fade-in zoom-in">
                  <div className="text-sm text-yellow-600 uppercase tracking-[0.2em] font-black mb-4">🏆 Победитель Плей-офф 🏆</div>
                  <div className="text-5xl font-black text-gray-900 drop-shadow-sm">{winner.telegram || winner.name}</div>
              </div>
            );
        }
    }
    return null;
  };

  const tabs = [
      { id: 'profile', label: 'Профиль' },
      { id: 'users', label: 'Пользователи' },
      { id: 'setup', label: 'Инфо' },
      { id: 'matches', label: 'Матчи' },
      { id: 'standings', label: 'Таблица' },
      { id: 'playoff', label: 'Плей-офф' },
      { id: 'saved', label: 'Сохраненки' }
  ].filter(t => {
      if (t.id === 'users' && !isAdmin) return false;
      if (tournament?.status === 'created' && ['matches', 'standings', 'playoff'].includes(t.id)) return false;
      if (t.id === 'playoff' && tournament?.config.format === 'league_only') return false;
      if (tournament?.config.format === 'playoff_only' && (t.id === 'matches' || t.id === 'standings')) return false;
      return true;
  });

  const renderMatchesSection = () => {
      if (!tournament || tournament.status !== 'started') return null;

      if (tournament.config.format === 'groups_playoff') {
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {tournament.groups.map(group => {
                  const groupMatches = tournament.matches.filter(m => m.groupId === group.id && m.type !== 'extra');
                  const grouped = groupMatchesByRound(groupMatches);
                  const rounds = Object.keys(grouped).map(Number).sort((a: number, b: number) => a - b);
                  const isExpanded = expandedGroups[group.id];

                  return (
                      <div key={group.id} className="border border-orange-200 rounded-xl overflow-hidden shadow-sm h-fit">
                          <button onClick={() => toggleGroup(group.id)} className="w-full bg-orange-50 px-4 py-3 border-b border-orange-200 font-bold text-orange-800 flex justify-between items-center">
                               <span>{group.name}</span>
                               <span>{isExpanded ? '▼' : '▶'}</span>
                          </button>
                          
                          {isExpanded && (
                              <div className="p-4 space-y-4 bg-white">
                                  {rounds.map(round => (
                                      <div key={round} className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                                          <button onClick={() => toggleRound(round + group.id * 100)} className="w-full px-4 py-3 bg-gray-50 flex justify-between items-center hover:bg-gray-100 text-sm">
                                              <span className="font-semibold text-gray-700">Тур {round}</span>
                                              <span>{expandedRounds[round + group.id * 100] ? '▼' : '▶'}</span>
                                          </button>
                                          {expandedRounds[round + group.id * 100] && (
                                              <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t">
                                                  {grouped[round].map(match => (
                                                      <MatchCard 
                                                          key={match.id} 
                                                          match={match} 
                                                          homePlayer={playerMap.get(match.homeId)} 
                                                          awayPlayer={playerMap.get(match.awayId)} 
                                                          onUpdateScore={handleUpdateScore} 
                                                          onAddSeriesBatch={handleAddSeriesBatch}
                                                          onDeleteSeriesGame={handleDeleteSeriesGame}
                                                          onProposeScore={handleProposeScore}
                                                          onProcessSeriesGame={handleProcessSeriesGame}
                                                          onConfirmScore={handleConfirmScore}
                                                          onRejectScore={handleRejectScore}
                                                          currentPlayerId={currentPlayerId}
                                                          isAdmin={isAdmin}
                                                          playoffSeriesType="1_game" 
                                                          readOnly={false}
                                                      />
                                                  ))}
                                              </div>
                                          )}
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                  );
              })}
            </div>
          );
      } else {
          const leagueMatches = tournament.matches.filter(m => m.type === 'league');
          const grouped = groupMatchesByRound(leagueMatches);
          const rounds = Object.keys(grouped).map(Number).sort((a: number, b: number) => a - b);

          return (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                 {rounds.map(round => (
                       <div key={round} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm h-fit">
                           <button onClick={() => toggleRound(round)} className="w-full px-4 py-3 bg-gray-50 flex justify-between items-center hover:bg-gray-100">
                               <span className="font-semibold text-gray-700">Тур {round}</span>
                               <span>{expandedRounds[round] ? '▼' : '▶'}</span>
                           </button>
                           {expandedRounds[round] && (
                               <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t">
                                   {grouped[round].map(match => (
                                       <MatchCard 
                                          key={match.id} 
                                          match={match} 
                                          homePlayer={playerMap.get(match.homeId)} 
                                          awayPlayer={playerMap.get(match.awayId)} 
                                          onUpdateScore={handleUpdateScore} 
                                          onAddSeriesBatch={handleAddSeriesBatch}
                                          onDeleteSeriesGame={handleDeleteSeriesGame}
                                          onProposeScore={handleProposeScore}
                                          onProcessSeriesGame={handleProcessSeriesGame}
                                          onConfirmScore={handleConfirmScore}
                                          onRejectScore={handleRejectScore}
                                          currentPlayerId={currentPlayerId}
                                          isAdmin={isAdmin}
                                          playoffSeriesType="1_game" 
                                          readOnly={false}
                                       />
                                   ))}
                               </div>
                           )}
                       </div>
                 ))}
             </div>
          );
      }
  };

  const renderExtraMatchesSection = (groupId?: number) => {
      if (!tournament || tournament.status !== 'started') return null;
      
      const extraMatches = tournament.matches.filter(m => m.type === 'extra' && m.groupId === groupId);
      
      let availablePlayers = tournament.players;
      if (groupId !== undefined) {
          const group = tournament.groups.find(g => g.id === groupId);
          if (group) {
              availablePlayers = tournament.players.filter(p => group.playerIds.includes(p.id));
          }
      }
      
      const playerOptions = [{value: -1, label: '-- Игрок --'}, ...availablePlayers.map(p => ({value: p.id, label: p.telegram || p.name}))];

      return (
          <div className="mt-8 bg-orange-50/50 rounded-xl border border-orange-200 p-4">
              <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-orange-800">Дополнительные матчи (ДП)</h3>
                  {isAdmin && <Button variant="secondary" className="text-xs" onClick={() => handleAddExtraMatch(groupId)}>+ Доп. матч</Button>}
              </div>
              
              {extraMatches.length === 0 && <div className="text-sm text-gray-400 italic">Нет дополнительных матчей</div>}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {extraMatches.map(match => (
                      <div key={match.id} className="flex flex-col gap-2 bg-white p-3 rounded border border-orange-100 shadow-sm relative">
                          <div className="flex gap-2 items-center w-full">
                              <Select 
                                  options={playerOptions} 
                                  value={match.homeId} 
                                  onChange={(e) => handleUpdateExtraMatchPlayers(match.id, 'home', parseInt(e.target.value))}
                                  className="mb-0 text-sm py-1 flex-1"
                                  disabled={!isAdmin}
                              />
                              <span className="font-bold text-gray-400 text-xs">vs</span>
                              <Select 
                                  options={playerOptions} 
                                  value={match.awayId} 
                                  onChange={(e) => handleUpdateExtraMatchPlayers(match.id, 'away', parseInt(e.target.value))}
                                  className="mb-0 text-sm py-1 flex-1"
                                  disabled={!isAdmin}
                              />
                          </div>
                          
                          <div className="flex items-center justify-between gap-2 border-t pt-2">
                            {match.homeId !== -1 && match.awayId !== -1 ? (
                                <div className="flex items-center gap-2 mx-auto">
                                    <input 
                                        type="number" 
                                        className="w-12 p-1 border rounded text-center text-sm" 
                                        placeholder="H"
                                        value={match.homeScore ?? ''}
                                        disabled={!isAdmin}
                                        onChange={(e) => {
                                            const val = e.target.value === '' ? -1 : parseInt(e.target.value);
                                            handleUpdateScore(match.id, val === -1 ? 0 : val, match.awayScore ?? 0);
                                        }}
                                    />
                                    <span className="text-gray-400">:</span>
                                    <input 
                                        type="number" 
                                        className="w-12 p-1 border rounded text-center text-sm" 
                                        placeholder="A"
                                        value={match.awayScore ?? ''}
                                        disabled={!isAdmin}
                                        onChange={(e) => {
                                            const val = e.target.value === '' ? -1 : parseInt(e.target.value);
                                            handleUpdateScore(match.id, match.homeScore ?? 0, val === -1 ? 0 : val);
                                        }}
                                    />
                                </div>
                            ) : (
                                <span className="text-xs text-gray-400 italic px-2">Выберите игроков</span>
                            )}
                            
                            {isAdmin && (
                                <button 
                                    onClick={() => handleDeleteMatch(match.id)} 
                                    className="text-red-400 hover:text-red-600 p-1 rounded transition-colors"
                                    title="Удалить матч"
                                >
                                    🗑️
                                </button>
                            )}
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      );
  };

  const renderStandingsTable = (players: Player[], matches: Match[], title?: string, qualifyCount?: number, groupId?: number) => {
      if (!tournament || tournament.status !== 'started') return null;
      const stats = calculateStandings(players, matches);
      const winner = (stats.length > 0 && isLeagueComplete) ? stats[0] : null;

      return (
          <div className="mb-8">
              <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
                {title && <div className="bg-gray-100 px-4 py-2 font-bold border-b">{title}</div>}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                            <th className="px-4 py-2">#</th>
                            <th className="px-4 py-2">Ник</th>
                            <th className="px-4 py-2 text-center">ДП</th>
                            <th className="px-4 py-2">И</th>
                            <th className="px-4 py-2">В</th>
                            <th className="px-4 py-2">Н</th>
                            <th className="px-4 py-2">П</th>
                            <th className="px-4 py-2 text-center" title="Забитые">ЗМ</th>
                            <th className="px-4 py-2 text-center" title="Пропущенные">ПМ</th>
                            <th className="px-4 py-2 text-center" title="Разница">РМ</th>
                            <th className="px-4 py-2">Очки</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.map((s, i) => {
                          let rowClass = "border-b ";
                          let rankClass = "px-4 py-2 ";
                          
                          if (tournament?.config.format === 'league_only') {
                              if (i === 0) { rowClass += "bg-yellow-100"; rankClass += "font-bold text-yellow-800"; }
                              else if (i === 1) { rowClass += "bg-gray-100"; rankClass += "font-bold text-gray-600"; }
                              else if (i === 2) { rowClass += "bg-orange-100"; rankClass += "font-bold text-orange-800"; }
                          } else if (qualifyCount && i < qualifyCount) {
                              rowClass += "bg-green-50";
                              rankClass += "bg-green-100 font-semibold text-green-800";
                          }

                          return (
                            <tr key={s.id} className={rowClass}>
                              <td className={rankClass}>{i+1}</td>
                              <td className="px-4 py-2 font-bold">{s.telegram || s.name}</td>
                              <td className="px-4 py-2 text-center text-orange-600 font-bold">{s.extraPoints > 0 ? `+${s.extraPoints}` : '-'}</td>
                              <td className="px-4 py-2">{s.played}</td>
                              <td className="px-4 py-2">{s.won}</td>
                              <td className="px-4 py-2">{s.drawn}</td>
                              <td className="px-4 py-2">{s.lost}</td>
                              <td className="px-4 py-2 text-center text-gray-600">{s.goalsFor}</td>
                              <td className="px-4 py-2 text-center text-gray-600">{s.goalsAgainst}</td>
                              <td className="px-4 py-2 text-center font-bold text-gray-700">{s.goalDiff > 0 ? `+${s.goalDiff}` : s.goalDiff}</td>
                              <td className="px-4 py-2 font-bold text-teal-600">{s.points}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                </div>
             </div>
             
             {renderExtraMatchesSection(groupId)}

             {winner && tournament?.config.format !== 'groups_playoff' && (
                 <div className="mt-4 text-center p-6 bg-yellow-50 rounded-xl border border-yellow-200 shadow-sm animate-in fade-in zoom-in">
                     <div className="text-sm text-yellow-600 uppercase tracking-widest font-bold mb-2">Чемпион Лиги</div>
                     <div className="text-4xl font-extrabold text-gray-900">🏆 {winner.telegram || winner.name}</div>
                 </div>
             )}
         </div>
      );
  };

  const renderParticipantsList = () => {
      if (!tournament) return null;
      return (
          <div className="mt-6 border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium">Список участников ({tournament.players.length})</h3>
                {isAdmin && tournament.status === 'created' && tournament.players.length > 1 && (
                    <Button variant="secondary" className="text-xs py-1" onClick={handleShufflePlayers}>🎲 Перемешать</Button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-2">
                {tournament.players.length === 0 ? (
                  <div className="text-gray-400 italic text-sm py-2">Участников пока нет</div>
                ) : (
                  tournament.players.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 bg-white p-3 rounded-lg border border-gray-200 shadow-sm group">
                      <span className="text-gray-400 font-bold text-xs">{i + 1}.</span>
                      <div className="flex-1 truncate font-medium text-teal-600">{p.telegram || p.name}</div>
                      
                      {isAdmin && tournament.status === 'created' && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleMovePlayer(i, 'up')} disabled={i === 0} className="text-gray-400 hover:text-teal-600 disabled:opacity-30">↑</button>
                              <button onClick={() => handleMovePlayer(i, 'down')} disabled={i === tournament.players.length - 1} className="text-gray-400 hover:text-teal-600 disabled:opacity-30">↓</button>
                              <button 
                                onClick={() => handleDeletePlayer(p.id)}
                                className="text-red-400 hover:text-red-600 transition-colors px-1 font-bold"
                                title="Удалить"
                              >
                                ✕
                              </button>
                          </div>
                      )}
                    </div>
                  ))
                )}
              </div>
          </div>
      );
  };

  const renderSetupTab = () => {
      if (!tournament) {
          return (
              <div className="max-w-4xl mx-auto">
                 <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                  <h2 className="text-xl font-semibold mb-4 border-b pb-2">{isAdmin ? 'Создание турнира' : 'Настройка (Только просмотр)'}</h2>
                  
                  {isAdmin ? (
                    <>
                      <div className="mb-4">
                        <Input 
                          label="Название турнира" 
                          value={setupConfig.name} 
                          onChange={e => setSetupConfig({...setupConfig, name: e.target.value})}
                        />
                      </div>
                      <div className="mt-4 flex justify-end">
                        <Button onClick={handleCreateTournament} className="w-full sm:w-auto text-lg px-8 py-3">Создать турнир 🏆</Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-gray-400 italic">
                        Ожидайте создания турнира администратором
                    </div>
                  )}
                </div>
              </div>
          );
      }

      // If tournament is created but NOT yet started
      if (tournament.status === 'created') {
          const userApplied = tournament.applications.some(a => a.telegram.toLowerCase() === userProfile.telegram.toLowerCase());
          const userInTournament = tournament.players.some(p => p.telegram?.toLowerCase() === userProfile.telegram.toLowerCase());

          return (
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex justify-between items-center mb-4 border-b pb-2">
                        <h2 className="text-xl font-bold text-teal-600">Турнир: {tournament.config.name}</h2>
                        
                        {!userInTournament && (
                            userApplied ? (
                                <div className="flex flex-col items-end gap-1">
                                    <span className="text-teal-600 font-bold text-sm">Вы подали заявку ✅</span>
                                    <button onClick={handleCancelApplication} className="text-red-500 text-xs hover:underline">отменить?</button>
                                </div>
                            ) : (
                                <Button variant="primary" onClick={handleApply}>Подать заявку ✋</Button>
                            )
                        )}

                        {userInTournament && (
                            <div className="text-right">
                                <span className="text-green-600 font-bold text-sm block">Ваша заявка принята в турнир</span>
                                <span className="text-green-700 font-black text-xs">"{tournament.config.name}"</span>
                            </div>
                        )}
                    </div>
                    
                    {isAdmin && (
                        <div className="mb-6 bg-teal-50 p-4 rounded-lg border border-teal-100">
                            <h3 className="text-sm font-bold text-teal-800 mb-3 uppercase">Заявки на участие ({tournament.applications.length})</h3>
                            {tournament.applications.length === 0 ? (
                                <div className="text-xs text-teal-600 italic">Новых заявок пока нет</div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {tournament.applications.map((app, idx) => (
                                        <div key={idx} className="flex justify-between items-center bg-white p-3 rounded border border-teal-200 shadow-sm">
                                            <div className="truncate min-w-0">
                                                <div className="font-bold text-sm truncate text-teal-600">{app.telegram}</div>
                                                <div className="text-[10px] text-gray-400">{app.fullName || "-"}</div>
                                            </div>
                                            <div className="flex gap-2 shrink-0 ml-2">
                                                <Button variant="success" className="px-2 py-1 text-[10px]" onClick={() => handleApprove(app)}>✅</Button>
                                                <Button variant="danger" className="px-2 py-1 text-[10px]" onClick={() => handleReject(app)}>❌</Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {renderParticipantsList()}

                    {isAdmin && (
                        <div className="mt-8 border-t pt-6 space-y-6">
                            <h3 className="font-bold text-gray-800 uppercase text-xs tracking-wider">Настройки турнира</h3>
                            
                            <div className="mb-6">
                                <Select 
                                  label="Формат турнира"
                                  value={setupConfig.format}
                                  onChange={e => setSetupConfig({...setupConfig, format: e.target.value as any})}
                                  options={[
                                    {value: 'league_playoff', label: 'Лига + Плей-офф'},
                                    {value: 'playoff_only', label: 'Только Плей-офф'},
                                    {value: 'league_only', label: 'Только Лига'},
                                    {value: 'groups_playoff', label: 'Группы + Плей-офф'},
                                  ]}
                                />
                            </div>

                            <div className="space-y-4">
                                {(setupConfig.format.includes('league')) && (
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                                        <h3 className="text-sm font-bold text-blue-800 mb-3 uppercase">Настройки Лиги</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <Input
                                                label="Игр с каждым соперником (1-4)" type="number" min={1} max={4}
                                                value={setupConfig.matchesPerOpponent}
                                                onChange={e => setSetupConfig({...setupConfig, matchesPerOpponent: Math.max(1, Math.min(4, parseInt(e.target.value) || 1))})}
                                            />
                                            {setupConfig.format === 'league_playoff' && (
                                                <Select
                                                    label="Выходят в плей-офф"
                                                    value={setupConfig.playoffQualifiers}
                                                    onChange={e => setSetupConfig({...setupConfig, playoffQualifiers: parseInt(e.target.value)})}
                                                    options={[{ value: 2, label: '2' }, { value: 4, label: '4' }, { value: 8, label: '8' }, { value: 16, label: '16' }]}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}

                                {setupConfig.format === 'groups_playoff' && (
                                    <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                                        <h3 className="text-sm font-bold text-orange-800 mb-3 uppercase">Настройки Групп</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <Select
                                                label="Количество групп"
                                                value={setupConfig.groupCount}
                                                onChange={e => setSetupConfig({...setupConfig, groupCount: parseInt(e.target.value)})}
                                                options={[{ value: 2, label: '2' }, { value: 4, label: '4' }, { value: 8, label: '8' }]}
                                            />
                                            <Input
                                                label="Игр в группе с соперником" type="number" min={1} max={2}
                                                value={setupConfig.groupMatchesPerOpponent}
                                                onChange={e => setSetupConfig({...setupConfig, groupMatchesPerOpponent: parseInt(e.target.value) || 1})}
                                            />
                                            <Select
                                                label="Выходят из группы"
                                                value={setupConfig.qualifiersPerGroup}
                                                onChange={e => setSetupConfig({...setupConfig, qualifiersPerGroup: parseInt(e.target.value)})}
                                                options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 4, label: '4' }]}
                                            />
                                        </div>
                                    </div>
                                )}
                                
                                {(setupConfig.format.includes('playoff')) && (
                                    <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                                        <h3 className="text-sm font-bold text-purple-800 mb-3 uppercase">Настройки Плей-офф</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <Select
                                                label="Формат серии"
                                                value={setupConfig.playoffSeriesType}
                                                onChange={e => setSetupConfig({...setupConfig, playoffSeriesType: e.target.value as any})}
                                                options={[
                                                    { value: '1_game', label: '1 матч' },
                                                    { value: '2_legs', label: '2 матча' },
                                                    { value: 'best_of_3', label: 'Bo3 (До 2 побед)' },
                                                    { value: 'best_of_5', label: 'Bo5 (До 3 побед)' },
                                                ]}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-8 flex justify-end">
                                <Button onClick={handleStartTournament} className="w-full sm:w-auto text-lg px-8 py-3" disabled={tournament.players.length < 2}>Начать турнир 🚀</Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
          );
      }

      // If tournament is started
      return (
             <div className="bg-white p-6 rounded-xl border border-gray-200 max-w-2xl mx-auto space-y-6">
                 <div>
                    <h2 className="text-xl font-bold mb-4 pb-2 border-b">Информация о турнире</h2>
                    <div className="space-y-3 text-sm">
                        <div className="flex justify-between border-b py-2"><span>Название</span><span className="font-bold">{tournament.config.name}</span></div>
                        <div className="flex justify-between border-b py-2"><span>Формат</span><span className="font-bold">{tournament.config.format}</span></div>
                        <div className="flex justify-between border-b py-2"><span>Игроков</span><span className="font-bold">{tournament.players.length}</span></div>
                        
                        {(tournament.config.format.includes('league')) && (
                            <div className="flex justify-between border-b py-2"><span>Матчей с соперником</span><span className="font-bold">{tournament.config.matchesPerOpponent}</span></div>
                        )}
                        
                        {tournament.config.format === 'groups_playoff' && (
                             <>
                                <div className="flex justify-between border-b py-2"><span>Групп</span><span className="font-bold">{tournament.config.groupCount}</span></div>
                                <div className="flex justify-between border-b py-2"><span>Выходят из группы</span><span className="font-bold">{tournament.config.qualifiersPerGroup}</span></div>
                             </>
                        )}

                        {tournament.config.format !== 'league_only' && (
                             <>
                                <div className="flex justify-between border-b py-2"><span>Участников плей-офф</span><span className="font-bold">{tournament.config.playoffQualifiers}</span></div>
                                <div className="flex justify-between border-b py-2"><span>Формат серии</span><span className="font-bold">{tournament.config.playoffSeriesType}</span></div>
                             </>
                        )}
                    </div>
                 </div>
                 {renderParticipantsList()}
             </div>
      );
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-[#0088cc] p-8 text-center text-white">
            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 24 24" className="w-12 h-12 fill-white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.35-.01-1.02-.2-1.52-.36-.61-.2-1.1-.3-1.05-.63.02-.17.25-.34.69-.52 2.71-1.18 4.51-1.96 5.42-2.34 2.58-1.07 3.12-1.26 3.47-1.26.08 0 .25.02.36.11.09.08.12.18.13.26.01.06.01.24 0 .38z"/></svg>
            </div>
            <h1 className="text-2xl font-bold">FC 25 Admin Login</h1>
            <p className="opacity-80 text-sm mt-1">Вход через Telegram Account</p>
          </div>
          <div className="p-8 space-y-6">
            <form onSubmit={handleLogin} className="space-y-4">
                <Input 
                name="admin_username"
                autoComplete="off"
                label="Никнейм (Admin ID)" 
                placeholder="@username" 
                value={loginAdminUsername} 
                onChange={e => setLoginAdminUsername(e.target.value)}
                required
                />
                <Input 
                name="admin_password"
                label="Пароль" 
                type="password" 
                placeholder="••••••••" 
                value={loginAdminPassword} 
                onChange={e => setLoginAdminPassword(e.target.value)}
                required
                />
                {loginError && <p className="text-red-500 text-sm text-center">{loginError}</p>}
                <Button type="submit" className="w-full bg-[#0088cc] hover:bg-[#0077b5] py-3 text-lg font-bold">Войти как Admin</Button>
            </form>

            <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-gray-300"></div>
                <span className="flex-shrink mx-4 text-gray-400 text-sm">или</span>
                <div className="flex-grow border-t border-gray-300"></div>
            </div>

            <div className="space-y-4">
              <Input 
                name="guest_username"
                autoComplete="off"
                placeholder="Гостевой ник (опционально)" 
                value={loginGuestUsername} 
                onChange={e => setLoginGuestUsername(e.target.value)}
              />
              <Button 
                  onClick={handleGuestLogin} 
                  className="w-full bg-[#31a5db] hover:bg-[#268dbd] py-3 text-lg font-bold flex items-center justify-center gap-2"
              >
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.35-.01-1.02-.2-1.52-.36-.61-.2-1.1-.3-1.05-.63.02-.17.25-.34.69-.52 2.71-1.18 4.51-1.96 5.42-2.34 2.58-1.07 3.12-1.26 3.47-1.26.08 0 .25.02.36.11.09.08.12.18.13.26.01.06.01.24 0 .38z"/></svg>
                  Войти как Пользователь
              </Button>
            </div>
          </div>
          <div className="p-4 bg-gray-50 border-t text-center text-xs text-gray-400">
            Только для аккаунта Anry_B или участников
          </div>
        </div>
      </div>
    );
  }
  
  // Loading screen for Cloud
  if (isCloudLoading) {
     return (
        <div className="min-h-screen flex items-center justify-center bg-cream-50">
           <div className="text-center">
              <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h2 className="text-teal-700 font-bold text-xl">Загрузка данных из облака...</h2>
           </div>
        </div>
     );
  }

  return (
    <div className="min-h-screen bg-cream-50 pb-12">
      <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} className="hidden" />
      
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="font-bold text-xl text-teal-600 flex items-center gap-2 truncate">
             ⚽ <span className="hidden sm:inline">FC 25 Manager</span>
             {tournament && activeTab !== 'profile' && activeTab !== 'users' && <span className="text-gray-400 text-sm font-normal truncate">| {tournament.config.name}</span>}
          </div>
          
          <div className="flex items-center gap-2 relative">
             {/* Cloud Status Indicator */}
             <div title={cloudSyncStatus === 'saving' ? 'Сохранение...' : 'Синхронизировано'} className="transition-all">
                {cloudSyncStatus === 'saving' ? (
                   <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                ) : (
                   <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                )}
             </div>

            <div className="relative">
                <Button variant="secondary" onClick={() => setShowExportMenu(!showExportMenu)} title="Скачать">📥</Button>
                {showExportMenu && (
                    <div className="absolute right-0 mt-2 w-32 bg-white border border-gray-200 rounded shadow-lg z-50">
                        <button onClick={handleExportJSON} className="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm">JSON</button>
                        <button onClick={handleExportXLSX} className="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm">XLSX</button>
                    </div>
                )}
            </div>
            {isAdmin && <Button variant="secondary" onClick={handleImportClick}>📂</Button>}
            {tournament && isAdmin && <Button variant="secondary" onClick={() => saveToLocalStorage(tournament)}>💾</Button>}
            {tournament && isAdmin && <Button variant="danger" onClick={handleDeleteCurrent} title="Удалить текущий турнир">🗑️</Button>}
            {isAdmin && <Button variant="success" onClick={() => { setTournament(null); setActiveTab('setup'); }} className="font-bold">+</Button>}
            <Button variant="danger" onClick={handleLogout} title="Выход">🚪</Button>
          </div>
        </div>
        
        <div className="max-w-7xl mx-auto px-4 flex gap-6 overflow-x-auto no-scrollbar">
          {tabs.map(tab => (
              <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-500'}`}
              >
              {tab.label}
              </button>
          ))}
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'profile' && renderProfileTab()}
        {activeTab === 'users' && isAdmin && renderUsersTab()}

        {activeTab === 'saved' && (
            <div className="max-w-2xl mx-auto space-y-4">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Турниры</h2>
                    {isAdmin && <Button variant="success" onClick={() => { setTournament(null); setActiveTab('setup'); }}>+ Новый</Button>}
                </div>
                {savedTournaments.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-dashed border-gray-300 italic">
                        Список пуст
                    </div>
                ) : (
                    <div className="space-y-3">
                        {savedTournaments.map((t, index) => (
                            <div key={t.createdAt || index} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex justify-between items-center group hover:border-teal-400 transition-all">
                                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => { setTournament(t); setActiveTab('matches'); }}>
                                    <div className="font-bold text-gray-800 truncate">{t.config.name}</div>
                                    <div className="text-xs text-gray-500 flex gap-2">
                                        <span className="bg-gray-100 px-1.5 py-0.5 rounded uppercase font-semibold">{t.config.format === 'groups_playoff' ? 'Группы' : 'Лига'}</span>
                                        <span>• {t.players.length} участников</span>
                                        <span>• {new Date(t.lastSaved || t.createdAt).toLocaleString()}</span>
                                    </div>
                                </div>
                                <div className="flex gap-2 shrink-0 ml-4">
                                    <Button variant="primary" className="px-3 py-1 text-sm" onClick={() => { setTournament(t); setActiveTab('matches'); }}>{isAdmin ? 'Загрузить' : 'Открыть'}</Button>
                                    {isAdmin && <Button variant="danger" className="px-3 py-1 text-sm" onClick={(e) => deleteSaved(index, e)}>Удалить</Button>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}

        {activeTab === 'setup' && renderSetupTab()}

        {tournament && tournament.status === 'started' && activeTab === 'matches' && (
          <div className="space-y-6 max-w-7xl mx-auto">
             <div className="flex justify-between items-center">
                 <h2 className="text-2xl font-bold hidden md:block">Список матчей</h2>
                 {!isLeagueComplete && isAdmin && (
                    <Button variant="secondary" onClick={handleSimulateLeague} className="text-sm ml-auto">⚡ Симулировать раунд</Button>
                 )}
             </div>
             {renderMatchesSection()}
          </div>
        )}

        {tournament && tournament.status === 'started' && activeTab === 'standings' && (
          <div className="space-y-6 max-w-5xl mx-auto">
             <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Таблица результатов</h2>
                <Button variant="primary" onClick={handleAnalyze} disabled={isAnalyzing}>{isAnalyzing ? '...' : 'AI Анализ'}</Button>
             </div>
             {analysis && <div className="bg-teal-50 p-4 rounded border border-teal-100 italic shadow-inner text-teal-900">{analysis}</div>}
             
             {tournament.config.format === 'groups_playoff' ? (
                 tournament.groups.map(group => {
                     const groupPlayers = tournament.players.filter(p => group.playerIds.includes(p.id));
                     const groupMatches = tournament.matches.filter(m => m.groupId === group.id); 
                     return (
                         <div key={group.id}>
                             {renderStandingsTable(groupPlayers, groupMatches, group.name, tournament.config.qualifiersPerGroup, group.id)}
                         </div>
                     );
                 })
             ) : (
                 renderStandingsTable(tournament.players, tournament.matches.filter(m => m.type === 'league' || m.type === 'extra'), undefined, tournament.config.playoffQualifiers, undefined)
             )}
          </div>
        )}

        {tournament && tournament.status === 'started' && activeTab === 'playoff' && (
          <div className="space-y-6 overflow-x-auto">
             <div className="flex justify-between items-center">
                <div className="flex gap-4 items-center">
                    <h2 className="text-2xl font-bold">Турнирная сетка</h2>
                    {hasPlayoffBracket && isAdmin && (
                        <Button variant="secondary" onClick={handleSimulatePlayoff} className="text-xs px-3 py-1">⚡ Симулировать шаг</Button>
                    )}
                </div>
                
                {!hasPlayoffBracket && isAdmin && (
                    <div className="flex items-center gap-4 bg-white p-2 rounded border shadow-sm">
                        <Button variant="primary" onClick={handleGeneratePlayoff} disabled={!isLeagueComplete} className={!isLeagueComplete ? 'opacity-50' : ''}>Создать сетку плей-офф</Button>
                        {!isLeagueComplete && <span className="text-xs text-red-500 font-medium">Сначала завершите группу!</span>}
                    </div>
                )}
             </div>

             <div className="overflow-x-auto pb-12 pt-4 px-4 bg-gray-50/50 rounded-xl min-h-[500px] flex flex-col gap-4 border border-gray-200 shadow-inner">
                 <div className="flex gap-16">
                     {[...new Set(tournament.matches.filter(m => m.type === 'playoff').map(m => m.round ?? 0))].sort((a: number, b: number) => a - b).map((round, rIdx) => {
                         const matches = tournament.matches.filter(m => m.type === 'playoff' && m.round === round);
                         let roundName = "Раунд " + round;
                         if (matches.length === 1) roundName = "🏆 Финал";
                         else if (matches.length === 2) roundName = "1/2 финала";
                         else if (matches.length === 4) roundName = "1/4 финала";
                         return (
                             <div key={round} className="flex flex-col w-80 relative">
                                 <h3 className="text-center font-bold mb-6 bg-white py-2 rounded shadow-sm border border-gray-100">{roundName}</h3>
                                 <div className="flex flex-col justify-around flex-grow gap-8">
                                     {matches.map(m => (
                                         <div key={m.id} className="relative">
                                             <MatchCard 
                                                match={m} 
                                                homePlayer={playerMap.get(m.homeId)} 
                                                awayPlayer={playerMap.get(m.awayId)} 
                                                onUpdateScore={handleUpdateScore} 
                                                onAddSeriesBatch={handleAddSeriesBatch}
                                                onDeleteSeriesGame={handleDeleteSeriesGame}
                                                onProposeScore={handleProposeScore}
                                                onProcessSeriesGame={handleProcessSeriesGame}
                                                onConfirmScore={handleConfirmScore}
                                                onRejectScore={handleRejectScore}
                                                currentPlayerId={currentPlayerId}
                                                isAdmin={isAdmin}
                                                compact={true} 
                                                playoffSeriesType={tournament.config.playoffSeriesType} 
                                                readOnly={false}
                                             />
                                         </div>
                                     ))}
                                 </div>
                             </div>
                         )
                     })}
                 </div>
                 {renderPlayoffWinner()}
             </div>
          </div>
        )}
      </main>
    </div>
  );
}
