import { ROOM_CODE_LENGTH } from '../../shared/protocol';

/** A link that drops whoever opens it straight into the room. */
export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

export function inviteMessage(code: string): string {
  return `Join my Ludo Pals game! 🎲\nTap to play: ${inviteLink(code)}\n(or enter room code ${code})`;
}

export function whatsAppLink(code: string): string {
  return `https://wa.me/?text=${encodeURIComponent(inviteMessage(code))}`;
}

/** The room code in this page's address (an invite link), or ''. */
export function invitedRoom(): string {
  try {
    const code = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return code.length === ROOM_CODE_LENGTH ? code : '';
  } catch {
    return '';
  }
}

/** Drop the invite from the address bar once it has been used (or given up on). */
export function clearInvite() {
  try {
    if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
  } catch {
    /* ignore */
  }
}

/** Copy to the clipboard, including on pages where the async clipboard API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the old way */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
