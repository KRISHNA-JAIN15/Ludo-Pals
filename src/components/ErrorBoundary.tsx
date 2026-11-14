import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence: if a screen throws while rendering, show a way back instead of a blank
 * page. A reload gets a player back into their online game (the room remembers them) or their
 * saved local game.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ludo-pals] screen crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen crash">
        <span className="crash-face" aria-hidden>
          🎲
        </span>
        <h1 className="title-lg">Oops, the dice fell off the table</h1>
        <p className="muted">Something went wrong on this screen. Reload to jump back in: your game is saved.</p>
        <button type="button" className="btn btn--black btn--lg" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
