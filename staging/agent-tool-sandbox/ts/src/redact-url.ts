/**
 * redact-url.ts
 * The form of a URL that may appear in an error message (extraction plan gate
 * G7, staged only, 2026-11-26). Userinfo, query and fragment are where
 * credentials and tokens travel, and in an agent tool the error text goes back
 * to the model, so each is replaced by "<redacted>". Scheme, host, port and
 * path stay, so the message still says which request failed.
 *
 * Internal module: the package entry points do not export it.
 */

const REDACTED = '<redacted>';

/** `url` with its userinfo, query and fragment replaced by "<redacted>". */
export function redactUrl(url: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || parsed.host === '') return redactUnparsed(url);
  const userinfo = parsed.username !== '' || parsed.password !== '' ? `${REDACTED}@` : '';
  const query = parsed.search === '' ? '' : `?${REDACTED}`;
  const fragment = parsed.hash === '' ? '' : `#${REDACTED}`;
  return `${parsed.protocol}//${userinfo}${parsed.host}${parsed.pathname}${query}${fragment}`;
}

/**
 * The same for a string the URL parser rejects (or one without a host). It
 * fails closed: everything before the LAST '@' counts as userinfo, because a
 * password containing '/', '?' or '#' is exactly what makes a URL unparseable,
 * and everything after the first '?' or '#' that remains is dropped.
 */
function redactUnparsed(s: string): string {
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:[/\\]+/.exec(s)?.[0] ?? '';
  let rest = s.slice(scheme.length);
  let userinfo = '';
  const at = rest.lastIndexOf('@');
  if (at >= 0) {
    userinfo = `${REDACTED}@`;
    rest = rest.slice(at + 1);
  }
  const cut = rest.search(/[?#]/);
  if (cut >= 0) rest = `${rest.slice(0, cut + 1)}${REDACTED}`;
  return `${scheme}${userinfo}${rest}`;
}
