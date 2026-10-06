import { ArrowRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { CharacterId } from '../../shared/types';
import { sound } from '../audio/sound';
import { Mascot } from '../components/Mascot';
import { Btn, Topo } from '../components/ui';
import { useApp } from '../store/app';

const CROWD: { id: CharacterId; x: number; y: number; s: number; r: number; d: number; mood: 'happy' | 'joy' | 'smug' | 'idle' | 'shock' }[] = [
  { id: 'boo', x: 4, y: 3, s: 32, r: -8, d: 0.2, mood: 'smug' },
  { id: 'mossy', x: 62, y: 0, s: 32, r: 7, d: 0.6, mood: 'idle' },
  { id: 'splash', x: -3, y: 30, s: 38, r: -6, d: 0.9, mood: 'happy' },
  { id: 'sunny', x: 58, y: 27, s: 40, r: 8, d: 0.4, mood: 'joy' },
  { id: 'blaze', x: 46, y: 54, s: 42, r: 5, d: 1.1, mood: 'shock' },
  { id: 'cherry', x: 10, y: 54, s: 46, r: -4, d: 0, mood: 'happy' },
];

export function Splash() {
  const go = useApp((s) => s.go);
  return (
    <div className="screen splash">
      <div className="splash-card">
        <Topo className="topo--light" />
        <div className="logo">
          <h1 className="logo-word">
            LUD
            <span className="logo-die" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </h1>
          <span className="logo-pill">PALS</span>
        </div>
        <div className="crowd" aria-hidden>
          <div className="crowd-stage">
            {CROWD.map((c) => (
              <div
                key={c.id}
                className="crowd-pal"
                style={{ left: `${c.x}%`, top: `${c.y}%`, width: `${c.s}%`, '--r': `${c.r}deg`, animationDelay: `${c.d}s` } as CSSProperties}
              >
                <Mascot id={c.id} limbs mood={c.mood} size="100%" wave={c.id === 'cherry'} />
              </div>
            ))}
            <span className="sparkle" style={{ left: '8%', top: '30%' }}>
              ✦
            </span>
            <span className="sparkle" style={{ left: '88%', top: '18%', animationDelay: '.6s' }}>
              ✦
            </span>
            <span className="sparkle sparkle--sm" style={{ left: '52%', top: '6%', animationDelay: '1.1s' }}>
              ✦
            </span>
          </div>
        </div>
        <div className="splash-cta">
          <Btn
            variant="black"
            size="lg"
            full
            iconRight={<ArrowRight size={20} />}
            onClick={() => {
              sound.unlock();
              sound.play('start');
              go('hub');
            }}
            silent
          >
            Let&apos;s Play
          </Btn>
          <p className="splash-foot">2–6 players · bots · online rooms · voice chat</p>
        </div>
      </div>
    </div>
  );
}
