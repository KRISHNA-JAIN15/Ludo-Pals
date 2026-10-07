import { Home, LogOut, RotateCcw } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { CHARACTERS } from '../../shared/characters';
import type { PlayerState } from '../../shared/types';
import { sound } from '../audio/sound';
import { Mascot } from '../components/Mascot';
import { Avatar, Btn, Coin } from '../components/ui';
import { ordinal } from '../game/useGameFeed';
import { useOnline } from '../net/online';
import { coinsFor, useApp } from '../store/app';

function useCountUp(target: number, ms = 1200) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!target) return;
    const start = performance.now();
    let raf = 0;
    let lastTick = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const v = Math.round(target * (1 - Math.pow(1 - k, 3)));
      setN(v);
      if (t - lastTick > 90 && k < 1) {
        lastTick = t;
        sound.play('tick');
      }
      if (k < 1) raf = requestAnimationFrame(tick);
      else sound.play('coin');
    };
    const delay = setTimeout(() => (raf = requestAnimationFrame(tick)), 700);
    return () => {
      clearTimeout(delay);
      cancelAnimationFrame(raf);
    };
  }, [target, ms]);
  return n;
}

export function Results() {
  const result = useApp((s) => s.result);
  const go = useApp((s) => s.go);
  const startLocal = useApp((s) => s.startLocal);
  const room = useOnline((s) => s.room);
  const myId = useOnline((s) => s.myId);
  const coins = useCountUp(result?.coins ?? 0);

  useEffect(() => {
    if (!result) go('hub');
  }, [result, go]);
  if (!result) return null;

  const { state, me, online, config } = result;
  const ranked = state.ranking.map((i) => state.players[i]);
  const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean) as PlayerState[];
  const others = ranked.slice(3);
  const mine = me !== null ? state.players[me] : null;
  const humansHere = state.players.filter((p) => (online ? p.id === myId : p.kind === 'human')).length;
  const headline = mine && humansHere === 1 ? (mine.rank === 1 ? 'You won!' : `You finished ${ordinal(mine.rank)}`) : `${ranked[0]?.name} wins!`;
  const sub = mine && humansHere === 1 && mine.rank === 1 ? 'Absolute legend. The pals bow to you 👑' : 'GG! Every pal made it… eventually.';

  // Awards need a clear leader (no prize for a tie).
  const most = (key: 'captures' | 'sixes') => {
    const best = Math.max(...state.players.map((p) => p.stats[key]));
    const leaders = state.players.filter((p) => p.stats[key] === best);
    return best > 0 && leaders.length === 1 ? leaders[0] : undefined;
  };
  const bonkKing = most('captures');
  // With fair dice everyone rolls the same numbers, so "luckiest" means nothing.
  const lucky = state.rules.dice === 'fair' ? undefined : most('sixes');
  const stickers = (p: PlayerState) => {
    const out: string[] = [];
    if (p.rank === 1) out.push('WINNER');
    if (bonkKing === p) out.push('BONK KING');
    if (lucky === p) out.push('LUCKY');
    return out;
  };
  const isHost = online && room?.hostId === myId;
  // Who has gone: left during the match, or left the room since it ended.
  const stillHere = new Set(room?.seats.filter((x) => !x.left).map((x) => x.id) ?? []);
  const hasLeft = (p: PlayerState) => p.left || (online && !!room && p.kind === 'human' && p.id !== myId && !stillHere.has(p.id));

  return (
    <div className="screen results">
      <header className="results-head">
        <span className="results-kicker">GAME OVER</span>
        <h1 className="title-xl">{headline}</h1>
        <p className="muted">{sub}</p>
        {state.rules.dice === 'fair' && <p className="fair-note">🎲 Fair dice: equal luck for everyone</p>}
      </header>

      <section className={`podium podium--${podium.length}`}>
        {podium.map((p) => {
          const meta = CHARACTERS[p.character];
          return (
            <div
              key={p.id}
              className={`podium-col podium-col--${p.rank}`}
              style={{ '--c': meta.color, '--cl': meta.light, '--cd': meta.dark } as CSSProperties}
            >
              <span className="podium-rank">{ordinal(p.rank)}</span>
              <span className="podium-name">
                {p.name}
                {hasLeft(p) && <span className="left-note"> · left</span>}
              </span>
              <div className="podium-pal">
                <Mascot
                  id={p.character}
                  size="100%"
                  mood={p.rank === 1 ? 'joy' : p.rank === 2 ? 'happy' : 'smug'}
                  limbs={p.rank === 1}
                  wave={p.rank === 1}
                />
              </div>
              <div className="podium-block">
                <span className="pts">{coinsFor(state, state.players.indexOf(p))} PTS</span>
                <div className="stickers">
                  {stickers(p).map((s, i) => (
                    <span key={s} className={`sticker sticker--${i}`}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="ranks-card">
        <h2 className="ranks-title">{others.length ? 'OTHER RANKS' : 'MATCH STATS'}</h2>
        {(others.length ? others : ranked).map((p) => (
          <div key={p.id} className={`rank-row ${mine?.id === p.id ? 'is-me' : ''}`}>
            <Avatar id={p.character} size={40} />
            <div className="rank-who">
              <span className="rank-pos">{ordinal(p.rank)}</span>
              <b>
                {mine?.id === p.id && humansHere === 1 ? 'You' : p.name}
                {hasLeft(p) && <span className="tag tag--left rank-left">LEFT</span>}
              </b>
            </div>
            <span className="rank-stats">
              💥 {p.stats.captures} {p.stats.captures === 1 ? 'bonk' : 'bonks'} · 🎲 {p.stats.sixes} {p.stats.sixes === 1 ? 'six' : 'sixes'}
            </span>
          </div>
        ))}
      </section>

      {mine && (
        <section className="earned">
          <span>You earned</span>
          <b>+{coins}</b>
          <Coin size={28} />
        </section>
      )}

      <div className="results-actions">
        {online ? (
          <>
            {isHost ? (
              <Btn variant="black" size="lg" full icon={<RotateCcw size={18} />} onClick={() => useOnline.getState().rematch()}>
                Rematch
              </Btn>
            ) : room ? (
              <Btn variant="black" size="lg" full disabled>
                Waiting for host to rematch…
              </Btn>
            ) : null}
            <Btn
              variant="teal"
              size="lg"
              full
              icon={<LogOut size={18} />}
              onClick={() => {
                useOnline.getState().leave();
                go('hub');
              }}
            >
              Leave room
            </Btn>
          </>
        ) : (
          <>
            {config && (
              <Btn variant="black" size="lg" full icon={<RotateCcw size={18} />} onClick={() => startLocal({ ...config })}>
                Play again
              </Btn>
            )}
            <Btn variant="teal" size="lg" full icon={<Home size={18} />} onClick={() => go('hub')}>
              Back to Home
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}
