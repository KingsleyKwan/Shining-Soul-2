/**
 * DOM stage-clear overlay — outside Phaser input/scene lifecycle.
 * Same idea as Game Over: real browser clicks and keys still work if the
 * Phaser loop is paused.
 */

export type StageClearActions = {
  restart: () => void;
  select: () => void;
  /** Dismiss the panel and keep walking the cleared stage. */
  continue: () => void;
};

const ROOT_ID = 'ss2-stageclear-overlay';

let root: HTMLDivElement | null = null;
let actions: StageClearActions | null = null;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let busy = false;

function styleButton(kind: 'primary' | 'secondary' | 'continue'): string {
  const palette = {
    primary: ['#2a6a3a', '#6dffa0'],
    secondary: ['#3a3a4a', '#aaaacc'],
    continue: ['#3a4a28', '#ffe066'],
  } as const;
  const [bg, border] = palette[kind];
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

/** Show full-screen DOM panel. Replaces any existing stage-clear overlay. */
export function showStageClearDom(next: StageClearActions): void {
  hideStageClearDom();
  busy = false;
  actions = next;

  const el = document.createElement('div');
  el.id = ROOT_ID;
  el.setAttribute('data-testid', 'stageclear-overlay');
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
  title.textContent = '關卡清除';
  title.style.cssText = 'font-size:28px;color:#ffe066;margin-bottom:8px;letter-spacing:2px;';

  const sub = document.createElement('div');
  sub.textContent = 'Boss 已擊破 · 恭喜通關';
  sub.style.cssText = 'font-size:14px;color:#fff6d0;margin-bottom:8px;';

  const hint = document.createElement('div');
  hint.textContent = 'R 重新開始 · Esc 選角';
  hint.style.cssText = 'font-size:12px;color:#c8d0d8;margin-bottom:20px;';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:8px;';

  const btnRestart = document.createElement('button');
  btnRestart.type = 'button';
  btnRestart.textContent = '重新開始';
  btnRestart.setAttribute('data-action', 'restart');
  btnRestart.setAttribute('data-testid', 'stageclear-restart');
  btnRestart.style.cssText = styleButton('primary');

  const btnSelect = document.createElement('button');
  btnSelect.type = 'button';
  btnSelect.textContent = '選角';
  btnSelect.setAttribute('data-action', 'select');
  btnSelect.setAttribute('data-testid', 'stageclear-select');
  btnSelect.style.cssText = styleButton('secondary');

  const btnContinue = document.createElement('button');
  btnContinue.type = 'button';
  btnContinue.textContent = '繼續';
  btnContinue.setAttribute('data-action', 'continue');
  btnContinue.setAttribute('data-testid', 'stageclear-continue');
  btnContinue.style.cssText = styleButton('continue');

  const fire = (kind: 'restart' | 'select' | 'continue') => (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (busy || !actions) return;
    busy = true;
    if (kind === 'restart') actions.restart();
    else if (kind === 'select') actions.select();
    else actions.continue();
  };

  btnRestart.addEventListener('click', fire('restart'));
  btnSelect.addEventListener('click', fire('select'));
  btnContinue.addEventListener('click', fire('continue'));

  row.appendChild(btnRestart);
  row.appendChild(btnSelect);
  row.appendChild(btnContinue);
  el.appendChild(title);
  el.appendChild(sub);
  el.appendChild(hint);
  el.appendChild(row);

  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    // Empty panel dismisses (繼續) so a stray tap does not wipe a clear.
    const t = e.target as HTMLElement;
    if (t === el || t === title || t === sub || t === hint) fire('continue')(e);
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

  const w = window as Window & { __SS2_STAGECLEAR__?: object };
  w.__SS2_STAGECLEAR__ = {
    visible: true,
    restart: () => actions?.restart(),
    select: () => actions?.select(),
    continue: () => actions?.continue(),
    hide: hideStageClearDom,
  };
}

export function hideStageClearDom(): void {
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
  }
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  actions = null;
  busy = false;
  const w = window as Window & { __SS2_STAGECLEAR__?: { visible?: boolean } };
  if (w.__SS2_STAGECLEAR__) w.__SS2_STAGECLEAR__.visible = false;
}

export function isStageClearDomVisible(): boolean {
  return !!root && document.body.contains(root);
}
