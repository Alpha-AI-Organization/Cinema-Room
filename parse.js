// Turn any YouTube URL form or a bare id into { id, list }, or null.
const ID = /^[A-Za-z0-9_-]{11}$/;
const LIST = /^[A-Za-z0-9_-]{10,64}$/;

export function parseYouTube(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (ID.test(s)) return { id: s, list: null };
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  const list = LIST.test(u.searchParams.get('list') || '') ? u.searchParams.get('list') : null;
  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/').filter(Boolean)[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
  } else {
    return null;
  }
  if (id === 'videoseries' || !ID.test(id || '')) id = null;
  if (!id && !list) return null;
  return { id, list };
}
