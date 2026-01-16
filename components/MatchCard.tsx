
import React, { useState } from 'react';
import { Match, Player, PlayoffSeriesType, ProposedScore, SeriesMatch } from '../types';
import { Button } from './Button';

interface MatchCardProps {
  match: Match;
  homePlayer?: Player;
  awayPlayer?: Player;
  onUpdateScore: (matchId: number, home: number, away: number, isLeg2?: boolean) => void;
  onAddSeriesBatch?: (matchId: number, games: {home: number, away: number}[]) => void;
  onDeleteSeriesGame?: (matchId: number, gameIndex: number) => void;
  onProposeScore?: (matchId: number, score: ProposedScore) => void;
  onConfirmScore?: (matchId: number) => void;
  onRejectScore?: (matchId: number) => void;
  onProcessSeriesGame?: (matchId: number, gameIndex: number, action: 'confirm' | 'reject') => void;
  currentPlayerId?: number;
  isAdmin?: boolean;
  isPlayoffLeg2?: boolean;
  compact?: boolean;
  playoffSeriesType?: PlayoffSeriesType;
  readOnly?: boolean;
}

export const MatchCard: React.FC<MatchCardProps> = ({ 
  match, homePlayer, awayPlayer, onUpdateScore, onAddSeriesBatch, onDeleteSeriesGame,
  onProposeScore, onConfirmScore, onRejectScore, onProcessSeriesGame,
  currentPlayerId, isAdmin = false,
  isPlayoffLeg2 = false, compact = false, playoffSeriesType = '1_game',
  readOnly = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [nextGameScore, setNextGameScore] = useState<{home: string, away: string}>({home: '', away: ''});

  const mode = match.forceSingleGame ? '1_game' : playoffSeriesType;
  const isSeries = mode === 'best_of_3' || mode === 'best_of_5';
  const is2Legs = mode === '2_legs';

  const currentHomeScore = isPlayoffLeg2 ? (match.homeScoreLeg2 ?? '') : (match.homeScore ?? '');
  const currentAwayScore = isPlayoffLeg2 ? (match.awayScoreLeg2 ?? '') : (match.awayScore ?? '');
  
  const isPlaceholder = !homePlayer || !awayPlayer || homePlayer.id === -1 || awayPlayer.id === -1;
  const isParticipant = currentPlayerId !== undefined && (currentPlayerId === homePlayer?.id || currentPlayerId === awayPlayer?.id);
  
  // Confirmation state logic
  const hasProposed = !!match.proposedScore;
  const isProposer = match.proposedScore?.proposedBy === currentPlayerId;
  const isConfirmed = !!match.isConfirmed;

  // Telegram priority for display
  const homeDisplay = homePlayer?.telegram || homePlayer?.name || '???';
  const awayDisplay = awayPlayer?.telegram || awayPlayer?.name || '???';

  let seriesWinsH = 0;
  let seriesWinsA = 0;
  
  // Combine Confirmed Matches + Pending Proposed Matches for Display
  const confirmedGames = match.seriesMatches || [];
  const pendingGames = (isSeries && match.proposedScore?.seriesMatches) ? match.proposedScore.seriesMatches : [];
  
  // Helper type for display
  interface DisplaySeriesGame extends SeriesMatch {
      status: 'confirmed' | 'pending';
      displayIdx: number;
      relativeIdx: number; // Index in the respective array (confirmed or pending)
  }

  const allSeriesGames: DisplaySeriesGame[] = [
      ...confirmedGames.map((g, i) => ({...g, status: 'confirmed' as const, displayIdx: i, relativeIdx: i})),
      ...pendingGames.map((g, i) => ({...g, status: 'pending' as const, displayIdx: confirmedGames.length + i, relativeIdx: i}))
  ];

  // Calculate wins based on ALL known games (Confirmed + Pending) to validate input
  allSeriesGames.forEach(g => {
      if (g.home > g.away) seriesWinsH++;
      else if (g.away > g.home) seriesWinsA++;
  });

  const targetWins = mode === 'best_of_3' ? 2 : mode === 'best_of_5' ? 3 : 0;
  const isSeriesWon = seriesWinsH >= targetWins || seriesWinsA >= targetWins;
  
  // Actual Winner (Confirmed only)
  let confirmedWinsH = 0;
  let confirmedWinsA = 0;
  confirmedGames.forEach(g => {
      if (g.home > g.away) confirmedWinsH++;
      else if (g.away > g.home) confirmedWinsA++;
  });
  const confirmedWinner = confirmedWinsH >= targetWins ? homePlayer?.id : confirmedWinsA >= targetWins ? awayPlayer?.id : null;


  const handleSendSingleGame = () => {
      if (readOnly || !onAddSeriesBatch) return;
      
      const h = parseInt(nextGameScore.home);
      const a = parseInt(nextGameScore.away);
      
      if (!isNaN(h) && !isNaN(a)) {
          // Check validation before sending
          let currentH = seriesWinsH;
          let currentA = seriesWinsA;
          
          if (h > a) currentH++;
          else if (a > h) currentA++;
          
          if (currentH > targetWins || currentA > targetWins) {
              alert(`Нельзя добавить игру. Серия идет до ${targetWins} побед.`);
              return;
          }

          onAddSeriesBatch(match.id, [{home: h, away: a}]);
          setNextGameScore({home: '', away: ''});
          // Note: NOT closing editing, so user sees the pending list update immediately
      }
  };

  const openEdit = () => {
    if (readOnly || isPlaceholder) return;
    if (!isAdmin && !isParticipant) return;
    // Allow edit even if match is 'complete' if we are in series mode to view history, 
    // or if we need to approve pending items.
    
    setIsEditing(true);
  }

  const handleSaveStandard = () => {
      const hStr = (document.getElementById(`h-${match.id}`) as HTMLInputElement).value;
      const aStr = (document.getElementById(`a-${match.id}`) as HTMLInputElement).value;
      
      if (hStr === '' || aStr === '') return;
      const h = parseInt(hStr);
      const a = parseInt(aStr);
      if (isNaN(h) || isNaN(a)) return;

      if (isAdmin) {
          onUpdateScore(match.id, h, a, isPlayoffLeg2);
      } else if (isParticipant && onProposeScore) {
          onProposeScore(match.id, { home: h, away: a, proposedBy: currentPlayerId!, isLeg2: isPlayoffLeg2 });
      }
      setIsEditing(false);
  };

  const handleSave2Legs = () => {
    const h1Val = (document.getElementById(`h1-${match.id}`) as HTMLInputElement).value;
    const a1Val = (document.getElementById(`a1-${match.id}`) as HTMLInputElement).value;
    const h2Val = (document.getElementById(`h2-${match.id}`) as HTMLInputElement).value;
    const a2Val = (document.getElementById(`a2-${match.id}`) as HTMLInputElement).value;
    
    if (isAdmin) {
        if (h1Val !== '' && a1Val !== '') onUpdateScore(match.id, parseInt(h1Val), parseInt(a1Val), false);
        if (h2Val !== '' && a2Val !== '') onUpdateScore(match.id, parseInt(h2Val), parseInt(a2Val), true);
        setIsEditing(false);
    } else {
        if (h1Val !== '' && a1Val !== '' && !match.leg1Complete && onProposeScore) {
             onProposeScore(match.id, { 
                 home: parseInt(h1Val), 
                 away: parseInt(a1Val), 
                 proposedBy: currentPlayerId!, 
                 isLeg2: false 
             });
             setIsEditing(false);
             return;
        }
        if (h2Val !== '' && a2Val !== '' && !match.leg2Complete && onProposeScore) {
             onProposeScore(match.id, { 
                 home: parseInt(h2Val), 
                 away: parseInt(a2Val), 
                 proposedBy: currentPlayerId!, 
                 isLeg2: true 
             });
             setIsEditing(false);
             return;
        }
        setIsEditing(false);
    }
  };

  const getProposerName = () => {
      if (match.proposedScore?.proposedBy === homePlayer?.id) return homePlayer?.telegram || homePlayer?.name;
      if (match.proposedScore?.proposedBy === awayPlayer?.id) return awayPlayer?.telegram || awayPlayer?.name;
      return 'Администратор';
  };

  const renderEditForm = () => (
    <div className="space-y-3 mt-2 bg-gray-50 p-3 rounded-lg border border-gray-200 shadow-inner z-50 relative">
      {isSeries ? (
          <div className="space-y-3">
              <div className="text-[10px] uppercase font-black text-gray-400 border-b pb-1">
                  Серия {mode === 'best_of_3' ? 'Bo3' : 'Bo5'}
              </div>
              
              {/* Combined List of Games (Confirmed + Pending) */}
              <div className="space-y-1">
                  {allSeriesGames.length > 0 ? (
                      allSeriesGames.map((g) => {
                          // Determine if this user can approve this pending item
                          const canApprove = (isAdmin || (isParticipant && !isProposer)) && g.status === 'pending';
                          
                          return (
                              <div key={g.displayIdx} className={`text-xs p-2 rounded border flex justify-between items-center relative overflow-hidden ${g.status === 'pending' ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}>
                                  {g.status === 'pending' && !canApprove && (
                                      <div className="absolute right-0 top-0 text-[40px] leading-3 text-amber-500/20 font-black pointer-events-none select-none">?</div>
                                  )}
                                  
                                  <div className="flex items-center gap-2 z-10">
                                      <span className={`font-bold w-4 text-center ${g.status === 'pending' ? 'text-amber-600' : 'text-gray-500'}`}>{g.displayIdx+1}.</span>
                                      <span className="font-bold text-sm">{g.home} : {g.away}</span>
                                      {g.status === 'pending' && <span className="bg-amber-100 text-amber-700 text-[8px] px-1 rounded font-bold uppercase ml-2">В ожидании</span>}
                                      {g.status === 'confirmed' && <span className="bg-teal-100 text-teal-700 text-[8px] px-1 rounded font-bold uppercase ml-2">Подтвержден</span>}
                                  </div>

                                  <div className="flex items-center gap-2 z-10">
                                      {/* APPROVE/REJECT Buttons for specific pending game */}
                                      {canApprove && onProcessSeriesGame && (
                                          <div className="flex gap-1">
                                              <button onClick={() => onProcessSeriesGame(match.id, g.relativeIdx, 'confirm')} className="bg-green-500 hover:bg-green-600 text-white rounded px-2 py-1 font-bold text-[10px]" title="Подтвердить игру">✓</button>
                                              <button onClick={() => onProcessSeriesGame(match.id, g.relativeIdx, 'reject')} className="bg-red-500 hover:bg-red-600 text-white rounded px-2 py-1 font-bold text-[10px]" title="Отклонить игру">✕</button>
                                          </div>
                                      )}

                                      <div className="text-[9px] text-gray-400 text-right flex flex-col leading-none">
                                          {g.status === 'confirmed' && g.confirmedBy && <span className="text-teal-600">✓ {g.confirmedBy}</span>}
                                      </div>

                                      {isAdmin && g.status === 'confirmed' && (
                                          <button onClick={() => onDeleteSeriesGame?.(match.id, g.relativeIdx)} className="ml-2 text-red-400 hover:text-red-600 font-bold text-[10px]">✕</button>
                                      )}
                                  </div>
                              </div>
                          );
                      })
                  ) : (
                      <div className="text-center text-gray-400 text-[10px] italic py-1">Нет сыгранных матчей</div>
                  )}
              </div>

              {/* Add New Game Form */}
              {!isSeriesWon && (
                  <div className="pt-2 border-t border-gray-200">
                      <div className="text-[10px] font-bold text-teal-600 mb-1">{isAdmin ? 'Добавить результат' : 'Ввести результат игры'}</div>
                      <div className="flex gap-2 items-center">
                          <span className="text-[10px] text-gray-400 font-bold">Game {allSeriesGames.length + 1}</span>
                          <input type="number" className="w-10 p-1 border rounded text-center text-xs" value={nextGameScore.home} onChange={e => setNextGameScore({...nextGameScore, home: e.target.value})} placeholder="H" />
                          <span className="text-gray-300">:</span>
                          <input type="number" className="w-10 p-1 border rounded text-center text-xs" value={nextGameScore.away} onChange={e => setNextGameScore({...nextGameScore, away: e.target.value})} placeholder="A" />
                          <Button variant="primary" className="ml-auto text-[10px] py-1 px-3 font-bold" onClick={handleSendSingleGame}>
                              {isAdmin ? 'Сохранить' : 'Отправить'}
                          </Button>
                      </div>
                  </div>
              )}
              
              {isSeriesWon && <div className="text-[10px] text-teal-600 font-bold text-center bg-teal-50 p-1 rounded">Серия завершена (побед: {Math.max(seriesWinsH, seriesWinsA)}) 🏆</div>}
              
              <div className="flex gap-1 pt-2 border-t mt-2">
                <Button variant="secondary" className="w-full text-[10px] py-1" onClick={() => setIsEditing(false)}>Закрыть</Button>
              </div>
          </div>
      ) : is2Legs && !match.forceSingleGame ? (
        <div className="space-y-3">
          <div>
            <div className="text-[9px] uppercase font-bold text-gray-400 mb-1">Матч 1</div>
            <div className="flex gap-2 items-center">
              <input type="number" className="w-1/2 p-1 border rounded text-center text-xs" defaultValue={match.homeScore ?? ''} id={`h1-${match.id}`} disabled={(!isAdmin && match.leg1Complete) || readOnly} />
              <input type="number" className="w-1/2 p-1 border rounded text-center text-xs" defaultValue={match.awayScore ?? ''} id={`a1-${match.id}`} disabled={(!isAdmin && match.leg1Complete) || readOnly} />
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase font-bold text-gray-400 mb-1">Матч 2</div>
            <div className="flex gap-2 items-center">
              <input type="number" className="w-1/2 p-1 border rounded text-center text-xs" defaultValue={match.homeScoreLeg2 ?? ''} id={`h2-${match.id}`} disabled={(!isAdmin && match.leg2Complete) || readOnly} />
              <input type="number" className="w-1/2 p-1 border rounded text-center text-xs" defaultValue={match.awayScoreLeg2 ?? ''} id={`a2-${match.id}`} disabled={(!isAdmin && match.leg2Complete) || readOnly} />
            </div>
          </div>
          <div className="flex gap-1 pt-1">
            <Button variant="primary" className="w-full text-[10px] py-1" onClick={handleSave2Legs}>{isAdmin ? 'Сохранить' : 'Отправить'}</Button>
            <Button variant="secondary" className="w-full text-[10px] py-1" onClick={() => setIsEditing(false)}>✕</Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[9px] uppercase font-bold text-gray-400 mb-1 text-center">{isAdmin ? 'Счет матча' : 'Ваш вариант счета'}</div>
          <div className="flex gap-2 items-center mb-2">
            <input type="number" className="w-1/2 p-1 border rounded text-center text-xs" id={`h-${match.id}`} defaultValue={currentHomeScore} autoFocus disabled={(!isAdmin && match.isConfirmed) || readOnly} />
            <input type="number" className="w-1/2 p-1 border rounded text-center text-xs" id={`a-${match.id}`} defaultValue={currentAwayScore} disabled={(!isAdmin && match.isConfirmed) || readOnly} />
          </div>
          <div className="flex gap-1 pt-1">
            <Button variant="primary" className="w-full text-[10px] py-1" onClick={handleSaveStandard}>{isAdmin ? 'OK' : 'Предложить'}</Button>
            <Button variant="secondary" className="w-full text-[10px] py-1" onClick={() => setIsEditing(false)}>✕</Button>
          </div>
        </div>
      )}
    </div>
  );

  const renderConfirmationBar = () => {
    // 1. Proposer View
    if (hasProposed && isProposer) {
      let displayText = `${match.proposedScore?.home} - ${match.proposedScore?.away}`;
      if (isSeries && match.proposedScore?.seriesMatches && match.proposedScore.seriesMatches.length > 0) {
           const count = match.proposedScore.seriesMatches.length;
           displayText = `Новых игр: ${count}`;
      } else if (isSeries && match.proposedScore?.seriesGame) {
          const g = match.proposedScore.seriesGame;
          displayText = `Игра ${(match.seriesMatches?.length || 0) + 1}: ${g.home} - ${g.away}`;
      }

      return (
        <div className="mt-2 text-[10px] bg-amber-50 text-amber-800 p-2 rounded border border-amber-200 animate-pulse text-center font-medium">
           ⏳ Ожидание подтверждения... ({displayText})
        </div>
      );
    }

    // 2. Approver View (Opponent or Admin)
    if (hasProposed && (isParticipant || isAdmin) && !isProposer) {
      // Special Series Handling: Direct user to open the card
      if (isSeries && match.proposedScore?.seriesMatches) {
           return (
             <div className="mt-2 bg-amber-100 p-2 rounded border border-amber-300 cursor-pointer" onClick={() => setIsEditing(true)}>
                <div className="text-[10px] font-bold text-amber-800 mb-1 text-center animate-pulse">
                   🔔 Требуется проверка игр ({match.proposedScore.seriesMatches.length})
                </div>
                <div className="text-[9px] text-center text-amber-700">Нажмите, чтобы принять/отклонить игры</div>
             </div>
           );
      }

      let displayText = `${match.proposedScore?.home} - ${match.proposedScore?.away}`;
      return (
        <div className="mt-2 bg-amber-100 p-2 rounded border border-amber-300">
           <div className="text-[10px] font-bold text-amber-800 mb-1 text-center">
             Проверка (от: {getProposerName()}): {displayText}
           </div>
           <div className="flex gap-1">
             <Button variant="success" className="w-full text-[10px] py-1" onClick={() => onConfirmScore?.(match.id)}>Подтвердить</Button>
             <Button variant="danger" className="w-full text-[10px] py-1" onClick={() => onRejectScore?.(match.id)}>Отклонить</Button>
           </div>
        </div>
      );
    }
    
    return null;
  };

  const renderAuditInfo = () => {
      const isRejected = match.lastUpdatedBy && match.lastUpdatedBy.includes("Отклонено");

      if (!match.authorName && !match.confirmedBy && !isRejected) return null;

      return (
          <div className="flex flex-col text-[9px] text-gray-400 mt-2 border-t pt-1 italic text-right leading-tight">
             {match.authorName && <div>автор: {match.authorName}</div>}
             {match.confirmedBy && !isRejected && <div className="text-teal-600 font-medium">подтвержден✅: {match.confirmedBy}</div>}
             {isRejected && <div className="text-red-400 font-medium">{match.lastUpdatedBy}</div>}
          </div>
      );
  };

  if (compact) {
      const renderScoreColumns = () => {
        if (isSeries) {
            const games = match.seriesMatches || [];
            return (
                <div className="flex items-center">
                   {games.map((g, idx) => (
                       <div key={idx} className="flex flex-col w-7 border-l border-gray-200 items-center justify-center text-gray-600 text-[10px] font-medium" title={`Автор: ${g.authorName}, Подтв: ${g.confirmedBy}`}>
                           <div className="h-1/2 w-full flex items-center justify-center border-b border-gray-100">{g.home}</div>
                           <div className="h-1/2 w-full flex items-center justify-center">{g.away}</div>
                       </div>
                   ))}
                   <div className="flex flex-col w-9 border-l-2 border-teal-100 items-center justify-center bg-teal-50/50 font-bold text-xs">
                       <div className="h-1/2 w-full flex items-center justify-center border-b border-teal-100/50 text-teal-800">{confirmedWinsH}</div>
                       <div className="h-1/2 w-full flex items-center justify-center text-teal-800">{confirmedWinsA}</div>
                   </div>
                </div>
            );
        } 
        
        if (is2Legs && !match.forceSingleGame) {
             const showAgg = match.leg1Complete && match.leg2Complete;
             return (
                <div className="flex items-center">
                   <div className="flex flex-col w-7 border-l border-gray-200 items-center justify-center text-gray-500 text-[10px]">
                       <div className="h-1/2 w-full flex items-center justify-center border-b border-gray-100">{match.homeScore ?? '-'}</div>
                       <div className="h-1/2 w-full flex items-center justify-center">{match.awayScore ?? '-'}</div>
                   </div>
                   <div className="flex flex-col w-7 border-l border-gray-200 items-center justify-center text-gray-500 text-[10px]">
                       <div className="h-1/2 w-full flex items-center justify-center border-b border-gray-100">{match.homeScoreLeg2 ?? '-'}</div>
                       <div className="h-1/2 w-full flex items-center justify-center">{match.awayScoreLeg2 ?? '-'}</div>
                   </div>
                   {showAgg && (
                       <div className="flex flex-col w-9 border-l-2 border-teal-100 items-center justify-center bg-teal-50/50 font-bold text-xs">
                           <div className="h-1/2 w-full flex items-center justify-center border-b border-teal-100/50 text-teal-800">{(match.homeScore||0) + (match.homeScoreLeg2||0)}</div>
                           <div className="h-1/2 w-full flex items-center justify-center text-teal-800">{(match.awayScore||0) + (match.awayScoreLeg2||0)}</div>
                       </div>
                   )}
                </div>
             );
        }

        return (
             <div className="flex flex-col w-12 border-l border-gray-200 items-center justify-center font-bold text-xs">
                   <div className="h-1/2 w-full flex items-center justify-center border-b border-gray-100 text-gray-800">{currentHomeScore !== '' ? currentHomeScore : '-'}</div>
                   <div className="h-1/2 w-full flex items-center justify-center text-gray-800">{currentAwayScore !== '' ? currentAwayScore : '-'}</div>
             </div>
        );
      };

      const hasWinner = match.winnerId !== undefined && match.winnerId !== null;

      return (
          <div className={`bg-white border rounded shadow-sm overflow-hidden text-xs w-full transition-all ${isPlaceholder ? 'opacity-60' : (isAdmin || isParticipant) ? 'hover:border-teal-400' : ''} ${hasWinner ? 'ring-2 ring-teal-500 border-teal-500' : isConfirmed ? 'border-teal-300' : hasProposed ? 'border-amber-400 border-dashed' : 'border-gray-300'}`}>
              <div className={`flex w-full transition-colors ${(isAdmin || isParticipant) ? 'cursor-pointer' : ''}`} onClick={() => openEdit()}>
                  <div className="flex flex-col flex-grow min-w-0 py-1">
                      <div className={`px-2 truncate flex items-center h-5 ${match.winnerId === homePlayer?.id ? 'font-bold text-teal-900' : 'text-gray-700'}`} title={homeDisplay}>
                          {homeDisplay}
                      </div>
                      <div className="border-t border-gray-100 my-0"></div>
                      <div className={`px-2 truncate flex items-center h-5 ${match.winnerId === awayPlayer?.id ? 'font-bold text-teal-900' : 'text-gray-700'}`} title={awayDisplay}>
                          {awayDisplay}
                      </div>
                  </div>
                  {renderScoreColumns()}
              </div>
              {isEditing && !readOnly && renderEditForm()}
              {renderConfirmationBar()}
              {renderAuditInfo()} 
          </div>
      );
  }

  const isComplete = match.completed || (is2Legs && isPlayoffLeg2 && match.leg2Complete) || (is2Legs && !isPlayoffLeg2 && match.leg1Complete);
  const displayScoreH = isSeries ? confirmedWinsH : (currentHomeScore !== '' ? currentHomeScore : 0);
  const displayScoreA = isSeries ? confirmedWinsA : (currentAwayScore !== '' ? currentAwayScore : 0);

  return (
    <div className={`bg-white border rounded-xl p-3 shadow-sm transition-all ${isConfirmed ? 'border-teal-400 ring-1 ring-teal-50' : hasProposed ? 'border-amber-300 ring-1 ring-amber-50' : 'border-gray-200'} ${isPlaceholder ? 'opacity-70' : ''} ${(!readOnly && !isPlaceholder && (isAdmin || isParticipant)) ? 'hover:shadow-md hover:border-teal-300' : ''}`}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase">
          #{match.id + 1} {isPlayoffLeg2 ? '(2)' : ''}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${isConfirmed ? 'bg-teal-100 text-teal-800 border-teal-200' : hasProposed ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-gray-100 text-gray-800 border-gray-200'}`}>
          {isConfirmed ? 'OK' : hasProposed ? 'CHECK' : 'VS'}
        </span>
      </div>

      <div className="flex items-center justify-between gap-1 mb-2">
        <div className="flex-1 text-center truncate">
          <div className="text-xs font-bold text-teal-600 px-1" title={homeDisplay}>{homeDisplay}</div>
        </div>

        <div 
          className={`flex items-center justify-center font-black text-sm min-w-[50px] h-8 bg-gray-50 rounded border border-gray-100 ${(!readOnly && !isPlaceholder && (isAdmin || isParticipant)) ? 'cursor-pointer hover:bg-gray-100' : ''} ${isComplete ? 'text-teal-700' : 'text-gray-400'}`}
          onClick={() => openEdit()}
        >
          {isComplete || (isSeries && (displayScoreH > 0 || displayScoreA > 0)) || (!isSeries && currentHomeScore !== '') ? (
             <span>{displayScoreH}:{displayScoreA}</span>
          ) : (
             <span className="text-xs font-medium">vs</span>
          )}
        </div>

        <div className="flex-1 text-center truncate">
          <div className="text-xs font-bold text-teal-600 px-1" title={awayDisplay}>{awayDisplay}</div>
        </div>
      </div>

      {isEditing && !readOnly && renderEditForm()}
      {renderConfirmationBar()}
      {renderAuditInfo()}
    </div>
  );
};
