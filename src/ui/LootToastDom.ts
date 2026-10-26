/**
 * DOM loot / status toast — sits above the canvas so it never covers the
 * Phaser top-left hint HUD or the inventory overlay (z-index below inventory).
 * Bottom-center, pointer-events none.
 */

const ROOT_ID = 'ss2-loot-toast';
/** Below inventory (99990) and game-over (99999); above canvas. */
const Z_INDEX = 99950;

let root: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

function ensureRoot(): HTMLDivElement {
  if (root && document.body.contains(root)) return root;
  const existing = document.getElementById(ROOT_ID);
  if (existing?.parentNode) existing.parentNode.removeChild(existing);

  const el = document.createElement('div');
  el.id = ROOT_ID;
  el.setAttribute('data-testid', 'loot-toast');
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:max(72px, 12vh)',
    'transform:translateX(-50%) translateY(8px)',
    `z-index:${Z_INDEX}`,
    'max-width:min(420px, 92vw)',
    'padding:8px 14px',
    'box-sizing:border-box',
    'background:rgba(0,0,0,0.82)',
    'border:1px solid rgba(255,224,102,0.55)',
    'border-radius:6px',
    'color:#ffe066',
    'font:12px monospace,system-ui,sans-serif',
    'text-align:center',
    'line-height:1.35',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 220ms ease, transform 220ms ease',
    'white-space:pre-wrap',
    'word-break:break-word',
  ].join(';');
  document.body.appendChild(el);
  root = el;
  return el;
}

/** Collapse runs of " · " / " / " into a single middot separator. */
export function tidyToastSeparators(msg: string): string {
  return msg
    .replace(/\s*[·/|]\s*/g, ' · ')
    .replace(/(?:\s*·\s*)+/g, ' · ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .trim();
}

export type LootToastOptions = {
  /** Override toast text/border color (rarity name color). */
  color?: string;
};

const DEFAULT_TOAST_COLOR = '#ffe066';
const DEFAULT_TOAST_BORDER = 'rgba(255,224,102,0.55)';

export function showLootToastDom(msg: string, opts?: LootToastOptions): void {
  const text = tidyToastSeparators(msg);
  if (!text) return;
  const el = ensureRoot();
  el.textContent = text;

  const color = opts?.color?.trim() || DEFAULT_TOAST_COLOR;
  el.style.color = color;
  // Soft border matching the name color when rarity-tinted.
  if (opts?.color?.trim()) {
    el.style.borderColor = color;
  } else {
    el.style.borderColor = DEFAULT_TOAST_BORDER;
  }

  if (hideTimer) clearTimeout(hideTimer);
  if (fadeTimer) clearTimeout(fadeTimer);

  // Force reflow so repeated toasts re-trigger the transition.
  el.style.opacity = '0';
  el.style.transform = 'translateX(-50%) translateY(8px)';
  void el.offsetWidth;
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';

  hideTimer = setTimeout(() => {
    if (!root) return;
    root.style.opacity = '0';
    root.style.transform = 'translateX(-50%) translateY(8px)';
    fadeTimer = setTimeout(() => {
      if (root) root.textContent = '';
    }, 240);
  }, 1400);
}

export function hideLootToastDom(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (fadeTimer) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
}
