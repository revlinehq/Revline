/** A share link's secret: 18 random bytes, base64url (the key is `<id>.<token>`). */
export function newShareToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
