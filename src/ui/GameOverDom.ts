/**
 * DOM GAME OVER overlay — outside Phaser input/scene lifecycle.
 * Playwright and stuck Phaser loops still receive real browser clicks/keys.
 */

export type GameOverActions = {
  restart: () => void;
  select: () => void;
};

const ROOT_ID = 'ss2-gameover-overlay';

let root: HTMLDivElement | null = null;
let actions: GameOverActions | null = null;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let busy = false;

function styleButton(primary: boolean): string {
  const bg = primary ? '#2a6a3a' : '#3a3a4a';
  const border = primary ? '#6dffa0' : '#aaaacc';
  return [
    'font: 14px monospace',
    'padding: 10px 18px',
    'margin: 0 6px',
    'cursor: pointer',
    'border-radius: 6px',
    `background: ${bg}`,
    `border: 2px solid ${border}`,
    'color: #f5fff8',
    'pointer-events: auto',
    'touch-action: manipulation',
  ].join(';');
}

/** Show full-screen DOM panel. Replaces any existing overlay. */
export function showGameOverDom(next: GameOverActions): void {
  hideGameOverDom();
  busy = false;
  actions = next;

  const el = document.createElement('div');
  el.id = ROOT_ID;
  el.setAttribute('data-testid', 'gameover-overlay');
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:99999',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'background:rgba(0,0,0,0.72)',
    'pointer-events:auto',
    'touch-action:manipulation',
    'user-select:none',
    '-webkit-user-select:none',
    'font-family:monospace,system-ui,sans-serif',
    'color:#e8eef5',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = '遊戲結束';
  title.style.cssText = 'font-size:28px;color:#ff8888;margin-bottom:8px;letter-spacing:2px;';

  const sub = document.createElement('div');
  sub.textContent = 'R 重開 · Esc 選角';
  sub.style.cssText = 'font-size:12px;color:#c8d0d8;margin-bottom:20px;';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:8px;';

  const btnRestart = document.createElement('button');
  btnRestart.type = 'button';
  btnRestart.textContent = '重新開始';
  btnRestart.setAttribute('data-action', 'restart');
  btnRestart.setAttribute('data-testid', 'gameover-restart');
  btnRestart.style.cssText = styleButton(true);

  const btnSelect = document.createElement('button');
  btnSelect.type = 'button';
  btnSelect.textContent = '選角';
  btnSelect.setAttribute('data-action', 'select');
  btnSelect.setAttribute('data-testid', 'gameover-select');
  btnSelect.style.cssText = styleButton(false);

  const fire = (kind: 'restart' | 'select') => (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (busy || !actions) return;
    busy = true;
    if (kind === 'restart') actions.restart();
    else actions.select();
  };

  btnRestart.addEventListener('click', fire('restart'));
  btnSelect.addEventListener('click', fire('select'));

  row.appendChild(btnRestart);
  row.appendChild(btnSelect);
  el.appendChild(title);
  el.appendChild(sub);
  el.appendChild(row);

  // Block clicks from reaching the canvas underneath
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    // Clicking empty panel also restarts (extra affordance)
    const t = e.target as HTMLElement;
    if (t === el || t === title || t === sub) fire('restart')(e);
  });

  document.body.appendChild(el);
  root = el;

  keyHandler = (e: KeyboardEvent) => {
    if (!actions || busy) return;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      e.stopPropagation();
      busy = true;
      actions.restart();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      busy = true;
      actions.select();
    }
  };
  document.addEventListener('keydown', keyHandler, true);

  // Debug bridge for QA / console
  const w = window as Window & { __SS2_GAMEOVER__?: object };
  w.__SS2_GAMEOVER__ = {
    visible: true,
    restart: () => actions?.restart(),
    select: () => actions?.select(),
    hide: hideGameOverDom,
  };
}

export function hideGameOverDom(): void {
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
  }
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  actions = null;
  busy = false;
  const w = window as Window & { __SS2_GAMEOVER__?: { visible?: boolean } };
  if (w.__SS2_GAMEOVER__) w.__SS2_GAMEOVER__.visible = false;
}

export function isGameOverDomVisible(): boolean {
  return !!root && document.body.contains(root);
}
