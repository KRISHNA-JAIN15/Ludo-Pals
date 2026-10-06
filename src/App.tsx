import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { sound } from './audio/sound';
import { hadRoom, useOnline } from './net/online';
import { Hub } from './screens/Hub';
import { LocalGame, OnlineGame } from './screens/Game';
import { Lobby } from './screens/Lobby';
import { Online } from './screens/Online';
import { Results } from './screens/Results';
import { Setup } from './screens/Setup';
import { Splash } from './screens/Splash';
import { useApp } from './store/app';

export function App() {
  const screen = useApp((s) => s.screen);
  const roomStatus = useOnline((s) => s.room?.status);
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);

  useEffect(() => {
    // Browsers only allow audio after a user gesture.
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    // Resume an online room after a refresh.
    if (hadRoom()) useOnline.getState().connect();
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (screen === 'splash') sound.wantMusic(false);
  }, [screen]);

  const onlineGame = roomStatus === 'playing' || roomStatus === 'ended';

  return (
    <>
      <div className="screen-host" key={screen === 'game' ? `game-${onlineGame}` : screen}>
        {screen === 'splash' && <Splash />}
        {screen === 'hub' && <Hub />}
        {screen === 'setup' && <Setup />}
        {screen === 'online' && <Online />}
        {screen === 'lobby' && <Lobby />}
        {screen === 'game' && (onlineGame ? <OnlineGame /> : <LocalGame />)}
        {screen === 'results' && <Results />}
      </div>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} type="button" className={`toast toast--${t.tone}`} onClick={() => dismiss(t.id)}>
            {t.tone === 'error' ? <XCircle size={18} /> : t.tone === 'success' ? <CheckCircle2 size={18} /> : <Info size={18} />}
            <span>{t.text}</span>
          </button>
        ))}
      </div>
    </>
  );
}
