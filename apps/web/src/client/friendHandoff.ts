// How a friend window (spec §11) receives its session. The visitor's window fetches a token for Deniz
// and opens `/{locale}/t/{id}?friend=1#rota-friend=<session>`; the friend window moves the fragment into
// its own sessionStorage and clears it before any of the app's code runs, so no request ever goes out
// with the visitor's cookie, and the token is never sent to a server or left in the address bar.
//
// No "use client": the server layout inlines FRIEND_HANDOFF_SCRIPT into the page's <head>.

const HASH = "#rota-friend=";

/**
 * Where a friend session is kept. sessionStorage is shared by a tab and the frames in it, so the
 * friend in a side-by-side frame keeps theirs under a key of its own, apart from the visitor's.
 */
export function friendKey(): string {
  return window.top === window.self ? "rota.friend" : "rota.friend.frame";
}

/** True in a friend window: opened with `?friend=1`, or already holding a friend session. */
export function isFriendWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("friend") === "1") return true;
  try {
    return window.sessionStorage.getItem(friendKey()) !== null;
  } catch {
    return false;
  }
}

/** The friend window's address for a trip, carrying `session` in the fragment. */
export function friendUrl(locale: string, tripId: string, session: { token: string; user: object }): string {
  return `/${locale}/t/${tripId}?friend=1${HASH}${encodeURIComponent(JSON.stringify(session))}`;
}

/**
 * Inlined at the top of every page: moves a friend handoff from the fragment into sessionStorage and
 * clears the fragment. Self-contained, and kept in step with `friendKey` and `friendUrl`.
 */
export const FRIEND_HANDOFF_SCRIPT = `(function () {
  var hash = location.hash;
  if (hash.indexOf(${JSON.stringify(HASH)}) !== 0) return;
  try {
    var key = window.top === window.self ? "rota.friend" : "rota.friend.frame";
    sessionStorage.setItem(key, decodeURIComponent(hash.slice(${HASH.length})));
  } catch (e) {
    // Storage blocked: the window stays without a friend session, and never syncs as the visitor.
  } finally {
    history.replaceState(history.state, "", location.pathname + location.search);
  }
})();`;
